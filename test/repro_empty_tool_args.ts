/**
 * Reproduction script: Tool call empty arguments bug.
 *
 * Calls the dify-auth proxy's /v1/responses endpoint (OpenAI Responses format)
 * with tool definitions, triggers a tool call from Dify, and verifies that the
 * streamed function_call events contain correct arguments.
 *
 * Run: npx tsx extensions/dify-auth/test/repro_empty_tool_args.ts
 */

const PROXY_BASE = "http://localhost:18789/dify-auth-proxy";
const DIFY_BASE = "http://localhost:5001/v1";
const API_KEY = "app-HzrQf5Bf3UnXoiFsl2H3l1yt";

// Composite key format used by dify-auth
const COMPOSITE_KEY = `${API_KEY}|${DIFY_BASE}|chat`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "exec",
      description: "Run shell commands",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "Shell command to execute" } },
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
        properties: { file_path: { type: "string", description: "Absolute file path" } },
        required: ["file_path"],
      },
    },
  },
];

interface SSEEvent {
  type: string;
  [key: string]: unknown;
}

async function parseSSEStream(res: Response): Promise<SSEEvent[]> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No reader");
  const decoder = new TextDecoder();
  let buffer = "";
  const events: SSEEvent[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      try {
        const data = JSON.parse(line.slice(6));
        events.push(data);
      } catch { /* ignore */ }
    }
  }
  return events;
}

async function testDirectDify() {
  console.log("=== Test 1: Direct Dify API (baseline) ===\n");
  const payload = {
    inputs: {},
    query: "请用 exec 工具运行命令: echo hello",
    response_mode: "streaming",
    user: "test-repro",
    conversation_id: "",
    files: [],
    tools: TOOLS,
  };

  const res = await fetch(`${DIFY_BASE}/chat-messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error("Direct Dify failed:", res.status, await res.text());
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  let foundToolCall = false;

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
        if (data.event === "tool_call") {
          console.log("[PASS] Dify returned tool_call event");
          const chunks = typeof data.data?.tool_call_chunks === "string"
            ? JSON.parse(data.data.tool_call_chunks) : [];
          for (const c of chunks) {
            const args = c.function?.arguments || "";
            console.log(`  Tool: ${c.function?.name}, Args: ${args}`);
            if (args && args !== "{}") {
              console.log("[PASS] Direct Dify tool_call has non-empty arguments");
              foundToolCall = true;
            }
          }
        }
        if (data.event === "node_finished" && data.data?.outputs?.tool_calls) {
          for (const tc of data.data.outputs.tool_calls) {
            const args = tc.function?.arguments || "";
            console.log(`  node_finished tool: ${tc.function?.name}, Args: ${args}`);
            if (args && args !== "{}") foundToolCall = true;
          }
        }
      } catch { /* ignore */ }
    }
  }

  if (!foundToolCall) {
    console.log("[WARN] No tool call with arguments found. LLM may not have used tools.");
    console.log("  This is model-dependent. Try running again.\n");
  }
  console.log();
}

async function testProxyOpenResponses() {
  console.log("=== Test 2: Proxy /v1/responses (OpenAI Responses format) ===\n");

  const payload = {
    model: "chat-flow",
    input: "请用 exec 工具运行命令: echo hello",
    stream: true,
    tools: TOOLS,
  };

  const res = await fetch(`${PROXY_BASE}/v1/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${COMPOSITE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error("Proxy failed:", res.status, await res.text());
    return;
  }

  const events = await parseSSEStream(res);

  console.log(`Total SSE events received: ${events.length}\n`);

  // Check for function_call events
  const outputItemAdded = events.filter(e => e.type === "response.output_item.added");
  const fcAdded = outputItemAdded.filter(e => (e.item as any)?.type === "function_call");
  const fcArgsDelta = events.filter(e => e.type === "response.function_call_arguments.delta");
  const fcArgsDone = events.filter(e => e.type === "response.function_call_arguments.done");
  const outputItemDone = events.filter(e => e.type === "response.output_item.done");
  const fcDone = outputItemDone.filter(e => (e.item as any)?.type === "function_call");
  const completed = events.filter(e => e.type === "response.completed");

  console.log("Event summary:");
  console.log(`  response.output_item.added (function_call): ${fcAdded.length}`);
  console.log(`  response.function_call_arguments.delta:      ${fcArgsDelta.length}`);
  console.log(`  response.function_call_arguments.done:       ${fcArgsDone.length}`);
  console.log(`  response.output_item.done (function_call):   ${fcDone.length}`);
  console.log();

  if (fcAdded.length === 0) {
    console.log("[WARN] No function_call items received. LLM may not have used tools.");
    console.log("  Try running again.\n");
    return;
  }

  // Verify arguments in output_item.added
  for (const evt of fcAdded) {
    const item = evt.item as any;
    console.log(`function_call added: name=${item.name}, call_id=${item.call_id}`);
    console.log(`  arguments in added event: ${item.arguments}`);
  }

  // Check: did we get the required delta/done events?
  let pass = true;

  if (fcArgsDelta.length === 0) {
    console.log("\n[FAIL] Missing response.function_call_arguments.delta events");
    console.log("  Pi SDK needs these to populate arguments (currently stays {})");
    pass = false;
  } else {
    console.log(`\n[PASS] Got ${fcArgsDelta.length} function_call_arguments.delta event(s)`);
    for (const evt of fcArgsDelta) {
      console.log(`  delta: ${evt.delta}`);
    }
  }

  if (fcArgsDone.length === 0) {
    console.log("[FAIL] Missing response.function_call_arguments.done events");
    pass = false;
  } else {
    console.log(`[PASS] Got ${fcArgsDone.length} function_call_arguments.done event(s)`);
  }

  if (fcDone.length === 0) {
    console.log("[FAIL] Missing response.output_item.done (function_call) events");
    pass = false;
  } else {
    console.log(`[PASS] Got ${fcDone.length} output_item.done (function_call) event(s)`);
    for (const evt of fcDone) {
      const item = evt.item as any;
      console.log(`  arguments in done event: ${item.arguments}`);
    }
  }

  // Check response.completed status
  if (completed.length > 0) {
    const resp = (completed[0] as any).response;
    const status = resp?.status;
    if (fcAdded.length > 0 && status !== "incomplete") {
      console.log(`[FAIL] response.completed status should be "incomplete" when tool calls present, got "${status}"`);
      pass = false;
    } else if (fcAdded.length > 0) {
      console.log(`[PASS] response.completed status is "incomplete"`);
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(pass ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED — see [FAIL] above");
  console.log(`${"=".repeat(50)}\n`);
}

async function main() {
  await testDirectDify();
  await testProxyOpenResponses();
}

main().catch(console.error);
