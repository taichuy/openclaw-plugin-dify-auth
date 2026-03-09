/**
 * 验证脚本：多轮工具调用后对话历史轮次一致性
 *
 * 模拟：用户发一句话 → LLM 调用工具 → 回调结果 → LLM 再调用工具 → 回调结果 → LLM 最终回复
 * 然后发一句后续对话，验证 LLM 能正确理解历史
 *
 * Run: npx tsx extensions/dify-auth/test/verify_history_rounds.ts
 */

const DIFY_BASE = "http://localhost:5001/v1";
const API_KEY = "app-HzrQf5Bf3UnXoiFsl2H3l1yt";

const TOOLS = [
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
];

interface ToolCall { id: string; name: string; arguments: string; }

async function streamSSE(res: Response) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No reader");
  const decoder = new TextDecoder();
  let buffer = "";
  let conversationId = "";
  let text = "";
  let error = "";
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
            ? JSON.parse(data.data.tool_call_chunks) : data.data?.tool_call_chunks || [];
          for (const c of chunks) {
            const existing = toolCalls.find(tc => tc.id === c.id);
            if (existing) existing.arguments += c.function?.arguments || "";
            else toolCalls.push({ id: c.id || `call_${Date.now()}`, name: c.function?.name || "", arguments: c.function?.arguments || "" });
          }
        } else if (event === "node_finished" && data.data?.outputs?.tool_calls) {
          for (const tc of data.data.outputs.tool_calls) {
            if (!toolCalls.find(t => t.id === tc.id))
              toolCalls.push({ id: tc.id, name: tc.function?.name || "", arguments: tc.function?.arguments || JSON.stringify(tc.arguments || {}) });
          }
        } else if (event === "error") {
          error = data.message || JSON.stringify(data);
        }
      } catch { /* ignore */ }
    }
  }
  return { conversationId, toolCalls, text, error };
}

async function chat(convId: string, query: string, toolResults?: { tool_call_id: string; output: string }[]) {
  const payload: any = {
    inputs: {}, query, response_mode: "streaming",
    user: "test-history-rounds", conversation_id: convId, files: [], tools: TOOLS,
  };
  if (toolResults) payload.tool_results = toolResults;

  const res = await fetch(`${DIFY_BASE}/chat-messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text();
    return { conversationId: convId, toolCalls: [] as ToolCall[], text: "", error: `HTTP ${res.status}: ${err.slice(0, 300)}` };
  }
  return streamSSE(res);
}

async function fetchMessages(conversationId: string) {
  const res = await fetch(
    `${DIFY_BASE}/messages?conversation_id=${conversationId}&limit=20&user=test-history-rounds`,
    { headers: { Authorization: `Bearer ${API_KEY}` } },
  );
  if (!res.ok) return [];
  return ((await res.json()).data || []);
}

async function main() {
  console.log("=".repeat(60));
  console.log("验证：多轮工具调用后对话历史轮次一致性");
  console.log("=".repeat(60));

  // Round 1: 用户消息 → 触发工具调用
  console.log("\n--- Round 1: 用户消息触发工具调用 ---");
  const r1 = await chat("", "请用 exec 工具分别执行 echo AAA 和 echo BBB 两个命令，先执行第一个");
  console.log(`  conv: ${r1.conversationId}`);
  console.log(`  text: ${r1.text.slice(0, 100)}`);
  console.log(`  tools: ${JSON.stringify(r1.toolCalls.map(t => t.name))}`);
  if (r1.error) { console.error(`  ERROR: ${r1.error.slice(0, 200)}`); return; }
  if (r1.toolCalls.length === 0) { console.log("  [SKIP] 未触发工具调用"); return; }

  // Round 2: 工具结果回调
  console.log("\n--- Round 2: 工具结果回调 ---");
  const tr1 = r1.toolCalls.map(tc => ({ tool_call_id: tc.id, output: "AAA\n" }));
  const queryR2 = tr1.map(r => `[${r.tool_call_id}] ${r.output}`).join("\n");
  const r2 = await chat(r1.conversationId, queryR2, tr1);
  console.log(`  text: ${r2.text.slice(0, 100)}`);
  console.log(`  tools: ${JSON.stringify(r2.toolCalls.map(t => t.name))}`);
  if (r2.error) { console.error(`  ERROR: ${r2.error.slice(0, 200)}`); return; }

  // Round 3: 如果 LLM 又调用了工具，继续回调
  let lastResult = r2;
  let roundNum = 3;
  while (lastResult.toolCalls.length > 0 && roundNum <= 5) {
    console.log(`\n--- Round ${roundNum}: 工具结果回调 ---`);
    const tr = lastResult.toolCalls.map(tc => ({ tool_call_id: tc.id, output: "BBB\n" }));
    const q = tr.map(r => `[${r.tool_call_id}] ${r.output}`).join("\n");
    lastResult = await chat(r1.conversationId, q, tr);
    console.log(`  text: ${lastResult.text.slice(0, 100)}`);
    console.log(`  tools: ${JSON.stringify(lastResult.toolCalls.map(t => t.name))}`);
    if (lastResult.error) { console.error(`  ERROR: ${lastResult.error.slice(0, 200)}`); return; }
    roundNum++;
  }

  // Final: 后续对话
  console.log("\n--- Final: 后续对话验证 ---");
  const rFinal = await chat(r1.conversationId, "请总结一下刚才所有工具执行的结果");
  if (rFinal.error) {
    console.error(`  ERROR: ${rFinal.error.slice(0, 300)}`);
    console.log("\n[FAIL] 后续对话失败！对话历史可能被污染");
  } else {
    console.log(`  text: ${rFinal.text.slice(0, 300)}`);
  }

  // 检查对话历史
  console.log("\n--- 对话历史检查 ---");
  await new Promise(r => setTimeout(r, 1000));
  const messages = await fetchMessages(r1.conversationId);
  console.log(`  总 Message 条数: ${messages.length}`);
  for (const msg of messages.reverse()) {
    const q = (msg.query || "").slice(0, 80);
    const a = (msg.answer || "").slice(0, 60);
    const tc = msg.tool_calls ? `[tool_calls: ${msg.tool_calls.length}]` : "";
    console.log(`  Q: "${q}${msg.query?.length > 80 ? "..." : ""}" ${tc}`);
    console.log(`  A: "${a}${msg.answer?.length > 60 ? "..." : ""}"`);
    console.log();
  }

  console.log("=".repeat(60));
  console.log(!rFinal.error ? "PASSED — 后续对话正常" : "FAILED");
  console.log("=".repeat(60));
}

main().catch(console.error);
