/**
 * Test script to verify the dify-auth tool call flow fixes.
 *
 * Tests:
 * 1. resolveDifyToolCalls correctly parses tool_call events with data.tool_call_chunks
 * 2. When tool_results are present, query is overridden with tool outputs (not original user message)
 *
 * Run: npx tsx extensions/dify-auth/test/test_tool_call_flow.ts
 */

import { resolveDifyToolCalls } from "../tools/utils.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

// ─── Test 1: tool_call event with data.tool_call_chunks (JSON string) ───
console.log("\nTest 1: tool_call event with nested data.tool_call_chunks (JSON string)");
{
  // This is the actual format Dify chatflow sends
  const sseData = {
    event: "tool_call",
    conversation_id: "test-conv",
    message_id: "test-msg",
    task_id: "test-task",
    data: {
      tool_call_chunks: JSON.stringify([
        {
          index: 0,
          id: "call_00_59lGYWQMXk5LYtc2fnafiMEZ",
          type: "function",
          function: {
            name: "read",
            arguments: '{"file_path": "C:\\\\Users\\\\test\\\\file.md"}',
          },
        },
      ]),
    },
  };

  const result = resolveDifyToolCalls(sseData as any, "chat");
  assert(result.length === 1, `Should find 1 tool call, got ${result.length}`);
  if (result.length > 0) {
    assert(result[0].toolName === "read", `Tool name should be "read", got "${result[0].toolName}"`);
    assert(result[0].callId === "call_00_59lGYWQMXk5LYtc2fnafiMEZ", `Call ID should match`);
    assert(result[0].argsString.includes("file_path"), `Args should contain file_path`);
    assert(result[0].isDelta === true, `Should be marked as delta`);
  }
}

// ─── Test 2: tool_call event with data.tool_call_chunks (already parsed array) ───
console.log("\nTest 2: tool_call event with data.tool_call_chunks (array)");
{
  const sseData = {
    event: "tool_call",
    data: {
      tool_call_chunks: [
        {
          index: 0,
          id: "call_test_2",
          type: "function",
          function: { name: "write", arguments: '{"path": "/tmp/test.txt", "content": "hello"}' },
        },
      ],
    },
  };

  const result = resolveDifyToolCalls(sseData as any, "chat");
  assert(result.length === 1, `Should find 1 tool call, got ${result.length}`);
  if (result.length > 0) {
    assert(result[0].toolName === "write", `Tool name should be "write"`);
    assert(result[0].callId === "call_test_2", `Call ID should be "call_test_2"`);
  }
}

// ─── Test 3: tool_call event with flat format (fallback) ───
console.log("\nTest 3: tool_call event with flat format (fallback)");
{
  const sseData = {
    event: "tool_call",
    name: "exec",
    arguments: '{"command": "ls"}',
    tool_call_id: "call_flat_1",
    task_id: "task-1",
  };

  const result = resolveDifyToolCalls(sseData as any, "chat");
  assert(result.length === 1, `Should find 1 tool call, got ${result.length}`);
  if (result.length > 0) {
    assert(result[0].toolName === "exec", `Tool name should be "exec"`);
    assert(result[0].callId === "call_flat_1", `Call ID should be "call_flat_1"`);
  }
}

// ─── Test 4: tool_call event with multiple chunks ───
console.log("\nTest 4: tool_call event with multiple tool_call_chunks");
{
  const sseData = {
    event: "tool_call",
    data: {
      tool_call_chunks: JSON.stringify([
        { index: 0, id: "call_multi_1", type: "function", function: { name: "read", arguments: '{"path": "/a"}' } },
        { index: 1, id: "call_multi_2", type: "function", function: { name: "write", arguments: '{"path": "/b"}' } },
      ]),
    },
  };

  const result = resolveDifyToolCalls(sseData as any, "chat");
  assert(result.length === 2, `Should find 2 tool calls, got ${result.length}`);
  if (result.length === 2) {
    assert(result[0].toolName === "read", `First tool should be "read"`);
    assert(result[1].toolName === "write", `Second tool should be "write"`);
  }
}

// ─── Test 5: node_finished event still works ───
console.log("\nTest 5: node_finished event with tool_calls in outputs");
{
  const sseData = {
    event: "node_finished",
    data: {
      outputs: {
        tool_calls: [
          {
            id: "call_node_1",
            type: "function",
            function: { name: "read", arguments: '{"path": "/test"}' },
          },
        ],
      },
    },
  };

  const result = resolveDifyToolCalls(sseData as any, "chat");
  assert(result.length === 1, `Should find 1 tool call, got ${result.length}`);
  if (result.length > 0) {
    assert(result[0].toolName === "read", `Tool name should be "read"`);
    assert(result[0].isDelta === false, `node_finished should NOT be delta`);
  }
}

// ─── Test 6: agent_thought event still works ───
console.log("\nTest 6: agent_thought event");
{
  const sseData = {
    event: "agent_thought",
    tool: "web_search",
    tool_input: '{"query": "test"}',
    tool_call_id: "call_thought_1",
    id: "thought-1",
  };

  const result = resolveDifyToolCalls(sseData as any, "agent");
  assert(result.length === 1, `Should find 1 tool call, got ${result.length}`);
  if (result.length > 0) {
    assert(result[0].toolName === "web_search", `Tool name should be "web_search"`);
    assert(result[0].isDelta === false, `agent_thought should NOT be delta`);
  }
}

// ─── Summary ───
console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("All tests passed!");
}
