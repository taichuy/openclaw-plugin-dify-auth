/**
 * 复现脚本：工具回调 query 错误问题
 *
 * 模拟完整的用户输入 → 工具调用 → 工具回调链路，验证：
 * 1. 初始请求：query 是用户消息
 * 2. 工具回调请求：query 不应是用户原始消息（应为 "tool_result" 占位符）
 * 3. 工具回调后 Dify 不报 "tool_calls must be followed by tool messages" 错误
 *
 * Run: npx tsx extensions/dify-auth/test/repro_query_on_tool_callback.ts
 */

const PROXY_BASE = "http://localhost:18789/dify-auth-proxy";
const DIFY_BASE = "http://localhost:5001/v1";
const API_KEY = "app-HzrQf5Bf3UnXoiFsl2H3l1yt";
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
      try { events.push(JSON.parse(line.slice(6))); } catch { /* ignore */ }
    }
  }
  return events;
}

async function step1_sendUserMessage(): Promise<{
  events: SSEEvent[];
  toolCalls: Array<{ callId: string; name: string; args: string }>;
}> {
  console.log("=== Step 1: 发送用户消息（触发工具调用） ===\n");

  const payload = {
    model: "chat-flow",
    input: "请用 exec 工具运行命令: echo hello_world",
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
    console.error("Step 1 failed:", res.status, await res.text());
    process.exit(1);
  }

  const events = await parseSSEStream(res);
  const toolCalls: Array<{ callId: string; name: string; args: string }> = [];

  for (const evt of events) {
    if (evt.type === "response.function_call_arguments.done") {
      const item = events.find(
        (e) => e.type === "response.output_item.added" && (e.item as any)?.type === "function_call"
          && (e.item as any)?.id === evt.item_id
      );
      const fcItem = (item?.item ?? events.find(
        (e) => e.type === "response.output_item.done" && (e.item as any)?.type === "function_call"
      )?.item) as any;
      if (fcItem) {
        toolCalls.push({
          callId: fcItem.call_id,
          name: fcItem.name,
          args: evt.arguments as string,
        });
      }
    }
  }

  console.log(`收到 ${events.length} 个 SSE 事件`);
  console.log(`工具调用: ${JSON.stringify(toolCalls, null, 2)}`);

  if (toolCalls.length === 0) {
    console.log("\n[WARN] 未收到工具调用。LLM 可能没有使用工具。请重试。");
    process.exit(0);
  }

  return { events, toolCalls };
}

async function step2_sendToolResults(
  toolCalls: Array<{ callId: string; name: string; args: string }>,
): Promise<{ events: SSEEvent[]; pass: boolean }> {
  console.log("\n=== Step 2: 发送工具回调结果 ===\n");

  // 构建 OpenAI Responses 格式的 input（包含工具结果）
  const input = toolCalls.map((tc) => ({
    type: "function_call_output",
    call_id: tc.callId,
    output: `hello_world\n`,
  }));

  const payload = {
    model: "chat-flow",
    input,
    stream: true,
    tools: TOOLS,
  };

  console.log("发送 payload:", JSON.stringify(payload, null, 2));

  const res = await fetch(`${PROXY_BASE}/v1/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${COMPOSITE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[FAIL] Step 2 HTTP 错误: ${res.status}`);
    console.error(errText);
    if (errText.includes("tool_calls must be followed by tool messages")) {
      console.error("\n[FAIL] 出现 'tool_calls must be followed by tool messages' 错误！");
      console.error("这说明 query 仍然是用户原始消息，导致对话历史被污染。");
    }
    return { events: [], pass: false };
  }

  const events = await parseSSEStream(res);
  console.log(`收到 ${events.length} 个 SSE 事件`);

  // 检查是否有错误事件
  const errorEvents = events.filter((e) => e.type === "response.failed");
  if (errorEvents.length > 0) {
    console.error("[FAIL] 收到 response.failed 事件:");
    for (const e of errorEvents) {
      console.error(JSON.stringify(e, null, 2));
    }
    return { events, pass: false };
  }

  // 检查是否有文本输出（说明 LLM 正确处理了工具结果）
  const textDone = events.find((e) => e.type === "response.output_text.done");
  if (textDone) {
    console.log(`\n[PASS] LLM 返回了文本响应: "${(textDone.text as string).slice(0, 100)}..."`);
  }

  // 检查 response.completed
  const completed = events.find((e) => e.type === "response.completed");
  if (completed) {
    const status = (completed as any).response?.status;
    console.log(`[INFO] response.completed status: ${status}`);
  }

  return { events, pass: true };
}

async function step3_sendFollowUp(): Promise<boolean> {
  console.log("\n=== Step 3: 发送后续消息（验证对话历史未被污染） ===\n");

  const payload = {
    model: "chat-flow",
    input: "刚才的命令输出了什么？",
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
    const errText = await res.text();
    console.error(`[FAIL] Step 3 HTTP 错误: ${res.status}`);
    console.error(errText);
    if (errText.includes("tool_calls must be followed by tool messages")) {
      console.error("\n[FAIL] 后续消息出现 'tool_calls must be followed by tool messages' 错误！");
      console.error("这说明对话历史被之前的错误 query 污染了。");
      return false;
    }
    return false;
  }

  const events = await parseSSEStream(res);
  const errorEvents = events.filter((e) => e.type === "response.failed");
  if (errorEvents.length > 0) {
    console.error("[FAIL] 后续消息收到 response.failed:");
    for (const e of errorEvents) {
      const errMsg = JSON.stringify(e);
      console.error(errMsg);
      if (errMsg.includes("tool_calls must be followed by tool messages")) {
        console.error("\n[FAIL] 对话历史被污染！");
        return false;
      }
    }
    return false;
  }

  const textDone = events.find((e) => e.type === "response.output_text.done");
  if (textDone) {
    console.log(`[PASS] 后续消息正常返回: "${(textDone.text as string).slice(0, 200)}..."`);
  }
  return true;
}

async function main() {
  console.log("复现脚本：工具回调 query 错误问题\n");
  console.log("验证项：");
  console.log("  1. 工具回调时 query 不是用户原始消息");
  console.log("  2. 工具回调后 Dify 不报 tool_calls 错误");
  console.log("  3. 后续对话正常（对话历史未被污染）\n");

  const { toolCalls } = await step1_sendUserMessage();
  const { pass: step2Pass } = await step2_sendToolResults(toolCalls);

  if (!step2Pass) {
    console.log("\n" + "=".repeat(50));
    console.log("STEP 2 FAILED — 工具回调失败");
    console.log("=".repeat(50));
    return;
  }

  const step3Pass = await step3_sendFollowUp();

  console.log("\n" + "=".repeat(50));
  if (step2Pass && step3Pass) {
    console.log("ALL CHECKS PASSED — 工具回调 query 修复有效");
  } else {
    console.log("SOME CHECKS FAILED — 见上方 [FAIL] 信息");
  }
  console.log("=".repeat(50));
}

main().catch(console.error);
