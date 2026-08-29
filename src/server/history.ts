/**
 * 对话历史接口：GET /api/history、DELETE /api/history
 *
 * 把 pi session 的原始 messages（user / assistant / toolResult 三种角色交织）
 * 转成前端直接渲染的 ChatItem[]：
 * - user 消息直接映射
 * - assistant 消息的 content 拆成 text / tool 块，
 *   toolResult 按 toolCallId 回填到对应 tool 块里
 * - thinking 块跳过（不在 UI 展示）
 *
 * 页面刷新时前端拉这个接口恢复对话（server 不重启，内存里的对话就还在）。
 */
import type { Hono } from "hono";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Block, ChatItem } from "./types.js";

/* pi-ai 的消息结构（未从 sdk 顶层导出，这里按契约定义最小子集） */
interface RawTextContent {
  type: "text";
  text: string;
}
interface RawToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
interface RawMessage {
  role: "user" | "assistant" | "toolResult";
  content?: string | Array<RawTextContent | RawToolCall | { type: string }>;
  toolCallId?: string;
  isError?: boolean;
  timestamp: number;
}

/** 从 toolResult 的 content 数组里提取纯文本 */
function extractText(content: unknown): string {
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .filter((c) => c?.type === "text")
    .map((c) => c.text)
    .join("\n");
}

function buildChatItems(session: AgentSession): ChatItem[] {
  const messages = session.state.messages as unknown as RawMessage[];
  const items: ChatItem[] = [];

  /** toolCallId -> 所在 tool 块，用于回填 toolResult */
  const toolBlocks = new Map<string, Extract<Block, { type: "tool" }>>();

  messages.forEach((msg, i) => {
    if (msg.role === "user") {
      const text =
        typeof msg.content === "string"
          ? msg.content
          : extractText(msg.content);
      items.push({ kind: "user", id: `m${i}`, text, timestamp: msg.timestamp });
      return;
    }

    if (msg.role === "assistant") {
      const blocks: Block[] = [];
      for (const c of Array.isArray(msg.content) ? msg.content : []) {
        if (c.type === "text" && (c as RawTextContent).text) {
          blocks.push({ type: "text", text: (c as RawTextContent).text });
        } else if (c.type === "toolCall") {
          const tc = c as RawToolCall;
          const block: Extract<Block, { type: "tool" }> = {
            type: "tool",
            toolCallId: tc.id,
            toolName: tc.name,
            args:
              typeof tc.arguments?.code === "string"
                ? tc.arguments.code
                : JSON.stringify(tc.arguments, null, 2),
            status: "running",
          };
          blocks.push(block);
          toolBlocks.set(tc.id, block);
        }
      }
      if (blocks.length > 0) {
        items.push({
          kind: "assistant",
          id: `m${i}`,
          blocks,
          timestamp: msg.timestamp,
        });
      }
      return;
    }

    if (msg.role === "toolResult" && msg.toolCallId) {
      const block = toolBlocks.get(msg.toolCallId);
      if (block) {
        block.result = extractText(msg.content);
        block.isError = msg.isError;
        block.status = msg.isError ? "error" : "done";
      }
    }
  });

  return items;
}

export function registerHistoryRoutes(app: Hono, session: AgentSession) {
  app.get("/api/history", (c) => c.json(buildChatItems(session)));

  // 清空对话（新对话按钮）。与 analyzer.ts 清空上下文的做法一致
  app.delete("/api/history", (c) => {
    session.agent.state.messages = [];
    return c.json({ ok: true });
  });
}
