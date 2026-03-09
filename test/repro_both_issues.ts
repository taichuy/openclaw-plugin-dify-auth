/**
 * 复现脚本：问题1 — query 发送 "tool_result" 字符串 + 问题2 — summary 请求中断会话
 *
 * 直接调用 Dify API（绕过 dify-auth 代理），模拟代理当前的行为，验证：
 * 1. 工具回调时 query="tool_result" 被存入对话历史（问题1复现）
 * 2. 工具调用后发送 summary 请求导致 400 错误（问题2复现）
 * 3. 查询 Dify 对话历史确认 query 字段内容
 *
 * Run: npx tsx extensions/dify-auth/test/repro_both_issues.ts
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

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

async function streamSSE(res: Response): Promise<{
  conversationId: string;
  toolCalls: ToolCall[];
  text: string;
  error: string;
}> {
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
          error = data.message || JSON.stringify(data);
        }
      } catch { /* ignore */ }
    }
  }
  return { conversationId, toolCalls, text, error };
}

async function fetchMessages(conversationId: string): Promise<any[]> {
  const res = await fetch(
    `${DIFY_BASE}/messages?conversation_id=${conversationId}&limit=20&user=test-repro-issues`,
    { headers: { Authorization: `Bearer ${API_KEY}` } },
  );
  if (!res.ok) {
    console.error("获取消息历史失败:", res.status, await res.text());
    return [];
  }
  const data = await res.json();
  return data.data || [];
}

async function main() {
  console.log("=" .repeat(60));
  console.log("复现脚本：两个核心问题");
  console.log("=".repeat(60));

  // === Step 1: 发送初始消息触发工具调用 ===
  console.log("\n--- Step 1: 发送用户消息触发工具调用 ---\n");

  const res1 = await fetch(`${DIFY_BASE}/chat-messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: {},
      query: "请用 exec 工具执行命令: echo hello",
      response_mode: "streaming",
      user: "test-repro-issues",
      conversation_id: "",
      files: [],
      tools: TOOLS,
    }),
  });

  if (!res1.ok) {
    console.error("Step 1 失败:", res1.status, await res1.text());
    return;
  }

  const r1 = await streamSSE(res1);
  console.log(`conversation_id: ${r1.conversationId}`);
  console.log(`text: ${r1.text.slice(0, 100)}`);
  console.log(`tool_calls: ${JSON.stringify(r1.toolCalls, null, 2)}`);

  if (r1.toolCalls.length === 0) {
    console.log("\n[SKIP] 未收到工具调用，LLM 未使用工具。请重试。");
    return;
  }

  // === Step 2: 复现问题1 — 发送 query="tool_result" ===
  console.log("\n--- Step 2: 复现问题1 — 发送 query='tool_result' + tool_results ---\n");

  const toolResults = r1.toolCalls.map(tc => ({
    tool_call_id: tc.id,
    output: "hello\n",
  }));

  const res2 = await fetch(`${DIFY_BASE}/chat-messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: {},
      query: "tool_result",  // <-- 当前代理的行为：硬编码字符串
      response_mode: "streaming",
      user: "test-repro-issues",
      conversation_id: r1.conversationId,
      files: [],
      tools: TOOLS,
      tool_results: toolResults,
    }),
  });

  if (!res2.ok) {
    console.error("Step 2 失败:", res2.status, await res2.text());
    return;
  }

  const r2 = await streamSSE(res2);
  console.log(`text: ${r2.text.slice(0, 200)}`);
  console.log(`tool_calls: ${JSON.stringify(r2.toolCalls, null, 2)}`);

  // === Step 3: 查询对话历史，验证 query 字段 ===
  console.log("\n--- Step 3: 检查 Dify 对话历史中的 query 字段 ---\n");

  // 等待一下让 Dify 写入完成
  await new Promise(r => setTimeout(r, 1000));
  const messages = await fetchMessages(r1.conversationId);

  let issue1Found = false;
  for (const msg of messages.reverse()) {
    const q = msg.query || "";
    const isToolResult = q === "tool_result" || q === ".";
    console.log(`  query: "${q.slice(0, 80)}${q.length > 80 ? "..." : ""}" ${isToolResult ? "  ← [问题1] 无意义的 query!" : ""}`);
    if (isToolResult) issue1Found = true;
  }

  if (issue1Found) {
    console.log("\n[复现成功] 问题1: 对话历史中存在 query='tool_result' 或 query='.'");
    console.log("  影响: LLM 在后续对话中无法从历史获知工具的真实输出");
  } else {
    console.log("\n[未复现] 问题1: 对话历史中未发现无意义的 query");
  }

  // === Step 4: 复现问题2 — 发送 <previous-summary> 请求 ===
  console.log("\n--- Step 4: 复现问题2 — 模拟 openclaw 发送 summary 请求 ---\n");

  // 先触发一次工具调用，让对话历史中最后一条 assistant 消息包含 tool_calls
  const res4a = await fetch(`${DIFY_BASE}/chat-messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: {},
      query: "请用 exec 工具执行: echo test_summary",
      response_mode: "streaming",
      user: "test-repro-issues",
      conversation_id: r1.conversationId,
      files: [],
      tools: TOOLS,
    }),
  });

  if (!res4a.ok) {
    console.error("Step 4a 失败:", res4a.status, await res4a.text());
    return;
  }

  const r4a = await streamSSE(res4a);
  console.log(`触发工具调用: ${JSON.stringify(r4a.toolCalls.map(t => t.name))}`);

  if (r4a.toolCalls.length === 0) {
    console.log("[SKIP] 未触发工具调用，无法复现问题2");
    return;
  }

  // 不发送 tool_results，直接发送 summary 请求（模拟 openclaw 压缩行为）
  console.log("\n模拟 openclaw 在工具调用期间发送 summary 请求...\n");

  const summaryQuery = `<conversation>\n\n</conversation>\n\n<previous-summary>\n## Goal\n- Test summary\n</previous-summary>\n\nThe messages above are NEW conversation messages. Update the summary.`;

  const res4b = await fetch(`${DIFY_BASE}/chat-messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: {},
      query: summaryQuery,
      response_mode: "streaming",
      user: "test-repro-issues",
      conversation_id: r1.conversationId,
      files: [],
    }),
  });

  const status = res4b.status;
  if (!res4b.ok) {
    const errText = await res4b.text();
    console.log(`HTTP ${status}: ${errText.slice(0, 300)}`);
    if (errText.includes("tool_calls must be followed by tool messages")) {
      console.log("\n[复现成功] 问题2: summary 请求导致 'tool_calls must be followed by tool messages' 错误");
      console.log("  原因: 上一轮 assistant 消息包含 tool_calls，但 summary 请求没有携带 tool_results");
    }
  } else {
    const r4b = await streamSSE(res4b);
    if (r4b.error && r4b.error.includes("tool_calls must be followed")) {
      console.log(`\n[复现成功] 问题2: SSE 流中返回错误: ${r4b.error.slice(0, 200)}`);
    } else {
      console.log("[未复现] 问题2: summary 请求未报错（可能对话历史中没有未完成的 tool_calls）");
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("复现完成");
  console.log("=".repeat(60));
}

main().catch(console.error);
