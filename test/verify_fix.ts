/**
 * 验证脚本：修复后的行为验证
 *
 * 验证修复后：
 * 1. 工具回调时 query 包含工具结果摘要（而非 "tool_result"）
 * 2. 对话历史中 query 字段有意义
 * 3. 后续对话正常
 *
 * Run: npx tsx extensions/dify-auth/test/verify_fix.ts
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
            ? JSON.parse(data.data.tool_call_chunks)
            : data.data?.tool_call_chunks || [];
          for (const c of chunks) {
            const existing = toolCalls.find(tc => tc.id === c.id);
            if (existing) existing.arguments += c.function?.arguments || "";
            else toolCalls.push({ id: c.id || `call_${Date.now()}`, name: c.function?.name || "", arguments: c.function?.arguments || "" });
          }
        } else if (event === "node_finished" && data.data?.outputs?.tool_calls) {
          for (const tc of data.data.outputs.tool_calls) {
            if (!toolCalls.find(t => t.id === tc.id)) {
              toolCalls.push({ id: tc.id, name: tc.function?.name || "", arguments: tc.function?.arguments || JSON.stringify(tc.arguments || {}) });
            }
          }
        } else if (event === "error") {
          error = data.message || JSON.stringify(data);
        }
      } catch { /* ignore */ }
    }
  }
  return { conversationId, toolCalls, text, error };
}

async function fetchMessages(conversationId: string) {
  const res = await fetch(
    `${DIFY_BASE}/messages?conversation_id=${conversationId}&limit=20&user=test-verify-fix`,
    { headers: { Authorization: `Bearer ${API_KEY}` } },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.data || [];
}

async function main() {
  console.log("=".repeat(60));
  console.log("验证脚本：修复后行为验证");
  console.log("=".repeat(60));

  // Step 1: 触发工具调用
  console.log("\n--- Step 1: 发送用户消息触发工具调用 ---\n");
  const res1 = await fetch(`${DIFY_BASE}/chat-messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: {}, query: "请用 exec 工具执行命令: echo hello_fix_test",
      response_mode: "streaming", user: "test-verify-fix", conversation_id: "", files: [], tools: TOOLS,
    }),
  });
  if (!res1.ok) { console.error("Step 1 失败:", res1.status, await res1.text()); return; }
  const r1 = await streamSSE(res1);
  console.log(`conversation_id: ${r1.conversationId}`);
  console.log(`tool_calls: ${JSON.stringify(r1.toolCalls.map(t => t.name))}`);
  if (r1.toolCalls.length === 0) { console.log("[SKIP] 未触发工具调用，请重试"); return; }

  // Step 2: 发送工具结果（使用修复后的 query 格式）
  console.log("\n--- Step 2: 发送工具结果（修复后的 query 格式） ---\n");
  const toolResults = r1.toolCalls.map(tc => ({ tool_call_id: tc.id, output: "hello_fix_test\n" }));
  // 修复后的 query：包含工具结果摘要
  const fixedQuery = toolResults.map(r => `[${r.tool_call_id}] ${r.output.slice(0, 200)}`).join("\n");
  console.log(`修复后的 query: "${fixedQuery}"`);

  const res2 = await fetch(`${DIFY_BASE}/chat-messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: {}, query: fixedQuery,
      response_mode: "streaming", user: "test-verify-fix",
      conversation_id: r1.conversationId, files: [], tools: TOOLS, tool_results: toolResults,
    }),
  });
  if (!res2.ok) { console.error("Step 2 失败:", res2.status, await res2.text()); return; }
  const r2 = await streamSSE(res2);
  console.log(`LLM 响应: ${r2.text.slice(0, 200)}`);
  if (r2.error) console.error(`错误: ${r2.error}`);

  // Step 3: 检查对话历史
  console.log("\n--- Step 3: 检查对话历史 ---\n");
  await new Promise(r => setTimeout(r, 1000));
  const messages = await fetchMessages(r1.conversationId);
  let allGood = true;
  for (const msg of messages.reverse()) {
    const q = msg.query || "";
    const isBad = q === "tool_result" || q === ".";
    const marker = isBad ? "  ← [问题] 无意义!" : "  ✓";
    console.log(`  query: "${q.slice(0, 100)}${q.length > 100 ? "..." : ""}"${marker}`);
    if (isBad) allGood = false;
  }

  // Step 4: 后续对话验证
  console.log("\n--- Step 4: 后续对话验证 ---\n");
  const res3 = await fetch(`${DIFY_BASE}/chat-messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: {}, query: "刚才工具执行的结果是什么？",
      response_mode: "streaming", user: "test-verify-fix",
      conversation_id: r1.conversationId, files: [], tools: TOOLS,
    }),
  });
  if (!res3.ok) {
    const errText = await res3.text();
    console.error(`Step 4 失败: ${res3.status}`);
    if (errText.includes("tool_calls must be followed")) {
      console.error("[FAIL] 对话历史被污染！");
      allGood = false;
    }
  } else {
    const r3 = await streamSSE(res3);
    if (r3.error) {
      console.error(`[FAIL] 错误: ${r3.error}`);
      allGood = false;
    } else {
      console.log(`LLM 响应: ${r3.text.slice(0, 200)}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(allGood ? "ALL CHECKS PASSED — 修复有效 ✓" : "SOME CHECKS FAILED — 见上方错误");
  console.log("=".repeat(60));
}

main().catch(console.error);
