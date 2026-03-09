/**
 * Repro: call Dify API with tools to trigger tool_call events and dump raw SSE.
 * Run: npx tsx extensions/dify-auth/test/repro_dify_sse.ts
 */

const DIFY_BASE = "http://localhost:5001/v1";
const API_KEY = "app-HzrQf5Bf3UnXoiFsl2H3l1yt";

async function main() {
  const payload = {
    inputs: {},
    query: "帮我看看这目录下有什么文件",
    response_mode: "streaming",
    user: "test-user",
    conversation_id: "",
    files: [],
    tools: [
      {
        type: "function",
        function: {
          name: "read",
          description: "Read file contents",
          parameters: {
            type: "object",
            properties: { path: { type: "string", description: "File path to read" } },
            required: ["path"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "memory_search",
          description: "Search memory files",
          parameters: {
            type: "object",
            properties: { query: { type: "string", description: "Search query" } },
            required: ["query"],
          },
        },
      },
    ],
  };

  console.log("=== Sending request to Dify with tools ===\n");

  const res = await fetch(`${DIFY_BASE}/chat-messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  console.log(`Response: ${res.status} ${res.statusText}\n`);

  if (!res.ok) {
    console.error(await res.text());
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";
  const allEvents: string[] = [];

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
        const event = data.event || "";

        if (event === "tool_call") {
          console.log(`\n========== [tool_call] ==========`);
          console.log(JSON.stringify(data, null, 2));
          allEvents.push("tool_call");
        } else if (event === "node_finished") {
          const outputs = data.data?.outputs;
          if (outputs?.tool_calls || outputs?.finish_reason === "tool_calls") {
            console.log(`\n========== [node_finished + tool_calls] ==========`);
            console.log("outputs:", JSON.stringify(outputs, null, 2));
            allEvents.push("node_finished+tool_calls");
          }
        } else if (event === "message" || event === "agent_message") {
          if (data.answer) process.stdout.write(data.answer);
        } else if (event === "agent_thought") {
          if (data.tool) {
            console.log(`\n========== [agent_thought] ==========`);
            console.log(JSON.stringify({ tool: data.tool, tool_input: data.tool_input, tool_call_id: data.tool_call_id }, null, 2));
            allEvents.push("agent_thought");
          }
        } else if (event === "error") {
          console.log(`\n========== [ERROR] ==========`);
          console.log(JSON.stringify(data, null, 2));
        }
      } catch { /* ignore */ }
    }
  }

  console.log(`\n\n=== Events with tool calls: ${allEvents.join(", ") || "NONE"} ===`);
}

main().catch(console.error);
