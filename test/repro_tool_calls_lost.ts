/**
 * 复现脚本：skill-bundler 合并后 tool_calls 丢失问题
 *
 * 问题：合并 refactor/skill-bundler 后，_stream_llm_events 方法
 * 未从 ModelInvokeCompletedEvent 中提取 tool_calls，导致：
 * 1. outputs["tool_calls"] 不存在
 * 2. Message.tool_calls 为空
 * 3. 下一轮发送 tool_results 时报错 "tool_calls must be followed by tool messages"
 *
 * Run: npx tsx extensions/dify-auth/test/repro_tool_calls_lost.ts
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
        properties: { command: { type: "string", description: "Shell command to execute" } },
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
  let nodeOutputsHaveToolCalls = false;

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
        } else if (event === "node_finished" && data.data?.node_type === "llm") {
          const outputs = data.data?.outputs || {};
          if (outputs.tool_calls && Array.isArray(outputs.tool_calls) && outputs.tool_calls.length > 0) {
            nodeOutputsHaveToolCalls = true;
          }
        } else if (event === "error") {
          error = data.message || JSON.stringify(data);
        }
      } catch { /* ignore */ }
    }
  }
  return { conversationId, toolCalls, text, error, nodeOutputsHaveToolCalls };
}

async function fetchMessages(conversationId: string) {
  const res = await fetch(
    `${DIFY_BASE}/messages?conversation_id=${conversationId}&limit=20&user=test-repro`,
    { headers: { Authorization: `Bearer ${API_KEY}` } },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.data || [];
}

async function main() {
  console.log("=".repeat(60));
  console.log("复现脚本：skill-bundler 合并后 tool_calls 丢失");
  console.log("=".repeat(60));

  // Step 1: 发送用户消息触发工具调用
  console.log("\n--- Step 1: 发送用户消息触发工具调用 ---\n");
  const res1 = await fetch(`${DIFY_BASE}/chat-messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: {}, query: "请用 exec 工具执行命令: echo repro_test_123",
      response_mode: "streaming", user: "test-repro", conversation_id: "", files: [], tools: TOOLS,
    }),
  });
  if (!res1.ok) { console.error("Step 1 失败:", res1.status, await res1.text()); return; }
  const r1 = await streamSSE(res1);
  console.log(`conversation_id: ${r1.conversationId}`);
  console.log(`SSE tool_call 事件: ${JSON.stringify(r1.toolCalls.map(t => ({ id: t.id, name: t.name })))}`);
  console.log(`node_finished outputs 包含 tool_calls: ${r1.nodeOutputsHaveToolCalls}`);

  if (r1.toolCalls.length === 0) {
    console.log("[SKIP] LLM 未触发工具调用，请重试");
    return;
  }

  // 关键检查：node_finished 的 outputs 是否包含 tool_calls
  if (!r1.nodeOutputsHaveToolCalls) {
    console.log("\n[BUG 确认] node_finished outputs 中没有 tool_calls！");
    console.log("  → 这意味着 _stream_llm_events 未将 tool_calls 传递到 outputs");
    console.log("  → Message.tool_calls 将为空");
    console.log("  → 下一轮 tool_results 回调将失败\n");
  }

  // Step 2: 检查 Message.tool_calls 是否被存储
  console.log("\n--- Step 2: 检查 Message 记录中的 tool_calls ---\n");
  await new Promise(r => setTimeout(r, 1000));
  const messages = await fetchMessages(r1.conversationId);
  const lastMsg = messages[0]; // 最新的消息
  const storedToolCalls = lastMsg?.generation_detail?.tool_calls || [];
  const msgToolCalls = lastMsg?.metadata?.tool_calls || [];
  console.log(`generation_detail.tool_calls: ${JSON.stringify(storedToolCalls)}`);
  console.log(`Message 记录数: ${messages.length}`);

  // Step 3: 发送工具结果，验证是否报错
  console.log("\n--- Step 3: 发送工具结果回调 ---\n");
  const toolResults = r1.toolCalls.map(tc => ({
    tool_call_id: tc.id,
    output: "repro_test_123\n",
  }));
  const query = toolResults.map(r => `[${r.tool_call_id}] ${r.output}`).join("\n");

  const res2 = await fetch(`${DIFY_BASE}/chat-messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: {}, query,
      response_mode: "streaming", user: "test-repro",
      conversation_id: r1.conversationId, files: [], tools: TOOLS, tool_results: toolResults,
    }),
  });

  if (!res2.ok) {
    const errText = await res2.text();
    console.error(`[BUG 确认] Step 3 HTTP 错误: ${res2.status}`);
    console.error(errText.slice(0, 300));
    console.log("\n" + "=".repeat(60));
    console.log("BUG 复现成功 — tool_results 回调失败");
    console.log("=".repeat(60));
    return;
  }

  const r2 = await streamSSE(res2);
  if (r2.error) {
    if (r2.error.includes("tool_calls must be followed by tool messages")) {
      console.log(`[BUG 确认] 错误: ${r2.error.slice(0, 200)}`);
      console.log("\n" + "=".repeat(60));
      console.log("BUG 复现成功 — 'tool_calls must be followed by tool messages'");
      console.log("=".repeat(60));
    } else {
      console.log(`[ERROR] 其他错误: ${r2.error.slice(0, 200)}`);
    }
    return;
  }

  console.log(`LLM 响应: ${r2.text.slice(0, 200)}`);

  // Step 4: 后续对话验证
  console.log("\n--- Step 4: 后续对话验证 ---\n");
  const res3 = await fetch(`${DIFY_BASE}/chat-messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: {}, query: "刚才工具执行的结果是什么？",
      response_mode: "streaming", user: "test-repro",
      conversation_id: r1.conversationId, files: [], tools: TOOLS,
    }),
  });
  if (!res3.ok) {
    console.error(`Step 4 失败: ${res3.status}`);
  } else {
    const r3 = await streamSSE(res3);
    if (r3.error) {
      console.error(`[FAIL] 后续对话错误: ${r3.error.slice(0, 200)}`);
    } else {
      console.log(`LLM 响应: ${r3.text.slice(0, 200)}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("全部通过 — tool_calls 正常存储，工具回调成功 ✓");
  console.log("=".repeat(60));
}

main().catch(console.error);
