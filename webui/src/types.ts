/**
 * 前后端对话契约类型（src/server/types.ts 的前端副本，改动时要同步）
 */

/** 助手消息里的内容块 */
export type Block =
	| { type: "text"; text: string }
	| {
			type: "tool";
			toolCallId: string;
			toolName: string;
			args: string;
			result?: string;
			isError?: boolean;
			status: "running" | "done" | "error";
	  };

/** 对话里的一条消息 */
export type ChatItem =
	| {
			kind: "user";
			id: string;
			/** 会话树中的 entryId（实时流里新消息暂时没有），编辑/分支定位用 */
			entryId?: string;
			text: string;
			timestamp: number;
	  }
	| {
			kind: "assistant";
			id: string;
			entryId?: string;
			blocks: Block[];
			timestamp: number;
	  };

/** 会话列表项（GET /api/sessions） */
export interface SessionSummary {
	id: string;
	name?: string;
	firstMessage: string;
	messageCount: number;
	created: string;
	modified: string;
	resident: boolean;
}
