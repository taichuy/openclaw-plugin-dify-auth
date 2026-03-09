/**
 * Repro: Full tool call round-trip with Dify ChatFlow.
 *
 * Step 1: Send a message with tool definitions -> Dify returns tool_call
 * Step 2: Send tool_results back -> Dify should continue (but gets 400 error)
 *
 * Run: npx tsx extensions/dify-auth/test/repro_tool_callback.ts
 */

const DIFY_BASE = "http://localhost:5001/v1";
const API_KEY = "app-HzrQf5Bf3UnXoiFsl2H3l1yt";

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

async function streamSSE(res: Response): Promise<{ conversationId: string; toolCalls: ToolCall[]; text: string }> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No reader");

  const decoder = new TextDecoder();
  let buffer = "";
  let conversationId = "";
  let text = "";
  const toolCalls: ToolCall[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.conversation_id) conversationId = data.conversation_id;

        const event = data.event || "";
        if (event === "message" || event === "agent_message") {
          if (data.answer) text += data.answer;
        } else if (event === "tool_call") {
          const chunks = typeof data.data?.tool_call_chunks === "string"
            ? JSON.parse(data.data.tool_call_chunks)
            : data.data?.tool_call_chunks || [];
          for (const c of chunks) {
            const existing = toolCalls.find(tc => tc.id === c.id);
            if (existing) {
              existing.arguments += c.function?.arguments || "";
            } else {
              toolCalls.push({
                id: c.id || `call_${Date.now()}`,
                name: c.function?.name || c.name || "",
                arguments: c.function?.arguments || "",
              });
            }
          }
        } else if (event === "node_finished") {
          const outputs = data.data?.outputs;
          if (outputs?.tool_calls) {
            for (const tc of outputs.tool_calls) {
              if (!toolCalls.find(t => t.id === tc.id)) {
                toolCalls.push({
                  id: tc.id,
                  name: tc.function?.name || tc.name || "",
                  arguments: tc.function?.arguments || JSON.stringify(tc.arguments || {}),
                });
              }
            }
          }
        } else if (event === "error") {
          console.error("\n[ERROR]", data.message || JSON.stringify(data));
        }
      } catch { /* ignore */ }
    }
  }
  return { conversationId, toolCalls, text };
}

async function main() {
  const tools = [
    {
      type: "function",
      function: {
        name: "exec",
        description: "Run shell commands",
        parameters: {
          type: "object",
          properties: { command: { type: "string", description: "Shell command" } },
          required: ["command"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read",
        description: "Read file contents",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "File path" } },
          required: ["path"],
        },
      },
    },
  ];

  // === Step 1: Initial message with tools ===
  console.log("=== Step 1: Sending initial message with tools ===\n");
  const step1Payload = {
    inputs: {},
    query: "请列出 C:\\Users\\Lw 目录下的文件",
    response_mode: "streaming",
    user: "test-repro",
    conversation_id: "",
    files: [],
    tools,
  };

  const res1 = await fetch(`${DIFY_BASE}/chat-messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(step1Payload),
  });

  if (!res1.ok) {
    console.error("Step 1 failed:", res1.status, await res1.text());
    return;
  }

  const result1 = await streamSSE(res1);
  console.log(`\nConversation ID: ${result1.conversationId}`);
  console.log(`Text: ${result1.text.slice(0, 200)}`);
  console.log(`Tool calls: ${JSON.stringify(result1.toolCalls, null, 2)}`);

  if (result1.toolCalls.length === 0) {
    console.log("\nNo tool calls returned. LLM may have responded with text instead.");
    console.log("Try running again - DeepSeek sometimes doesn't use tools on first try.");
    return;
  }

  // === Step 2: Send tool results back ===
  console.log("\n=== Step 2: Sending tool results back ===\n");

  const toolResults = result1.toolCalls.map(tc => ({
    tool_call_id: tc.id,
    output: `Mock result for ${tc.name}: [file1.txt, file2.txt, folder1/]`,
  }));

  // This is what the proxy currently does - sends query + tool_results
  const step2Payload = {
    inputs: {},
    query: toolResults.map(r => `[Tool Result: ${r.tool_call_id}] ${r.output}`).join("\n\n"),
    response_mode: "streaming",
    user: "test-repro",
    conversation_id: result1.conversationId,
    files: [],
    tools,
    tool_results: toolResults,
  };

  console.log("Payload tool_results:", JSON.stringify(toolResults, null, 2));

  const res2 = await fetch(`${DIFY_BASE}/chat-messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(step2Payload),
  });

  console.log(`\nStep 2 response: ${res2.status} ${res2.statusText}`);

  if (!res2.ok) {
    const errText = await res2.text();
    console.error("Step 2 FAILED:", errText);
    return;
  }

  const result2 = await streamSSE(res2);
  console.log(`\nStep 2 text: ${result2.text.slice(0, 500)}`);
  console.log(`Step 2 tool calls: ${JSON.stringify(result2.toolCalls, null, 2)}`);

  console.log("\n=== Done ===");
}

main().catch(console.error);
