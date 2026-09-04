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
	| { kind: "user"; id: string; text: string; timestamp: number }
	| { kind: "assistant"; id: string; blocks: Block[]; timestamp: number };
