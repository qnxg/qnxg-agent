/**
 * 对话历史接口：GET /api/sessions/:id/history
 *
 * 数据源是 sessionManager.buildContextEntries()（当前分支路径上的会话树 entry），
 * 而不是 state.messages —— 前者带 entryId，编辑重发 / fork 分支要靠它定位，
 * 且天然处理压缩后的上下文视图。
 *
 * pi 的原始 message（user / assistant / toolResult 三种角色交织）被转成
 * 前端直接渲染的 ChatItem[]：
 * - user 消息直接映射
 * - assistant 消息的 content 拆成 text / tool 块，
 *   toolResult 按 toolCallId 回填到对应 tool 块里
 * - thinking 块跳过（不在 UI 展示）
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Hono } from "hono";
import type { SessionPool } from "./session-pool.js";
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
	const entries = session.sessionManager.buildContextEntries();
	const items: ChatItem[] = [];

	/** toolCallId -> 所在 tool 块，用于回填 toolResult */
	const toolBlocks = new Map<string, Extract<Block, { type: "tool" }>>();

	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message as unknown as RawMessage;

		if (msg.role === "user") {
			const text =
				typeof msg.content === "string"
					? msg.content
					: extractText(msg.content);
			items.push({
				kind: "user",
				id: entry.id,
				entryId: entry.id,
				text,
				timestamp: msg.timestamp,
			});
			continue;
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
					id: entry.id,
					entryId: entry.id,
					blocks,
					timestamp: msg.timestamp,
				});
			}
			continue;
		}

		if (msg.role === "toolResult" && msg.toolCallId) {
			const block = toolBlocks.get(msg.toolCallId);
			if (block) {
				block.result = extractText(msg.content);
				block.isError = msg.isError;
				block.status = msg.isError ? "error" : "done";
			}
		}
	}

	// abort/进程中断后没有 toolResult 的工具块会永远停在 running，统一收尾为 error
	for (const item of items) {
		if (item.kind !== "assistant") continue;
		for (const block of item.blocks) {
			if (block.type === "tool" && block.status === "running") {
				block.status = "error";
				block.result = block.result || "（已中断）";
			}
		}
	}

	return items;
}

export function registerHistoryRoutes(app: Hono, pool: SessionPool) {
	app.get("/api/sessions/:id/history", async (c) => {
		const pooled = await pool.acquire(c.req.param("id"));
		if (!pooled) return c.json({ error: "会话不存在" }, 404);
		return c.json(buildChatItems(pooled.session));
	});
}
