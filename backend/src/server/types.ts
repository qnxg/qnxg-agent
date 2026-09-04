/**
 * 前后端对话契约类型
 *
 * 前端渲染用的消息结构与 pi 原始 messages 解耦：
 * 一条助手消息内部是 block 数组（text / tool 交替），
 * SSE 实时流和 /api/history 历史接口共用这一套结构。
 * （web/src/types.ts 里有一份对应的前端副本，改动时要同步）
 */

/** 助手消息里的内容块 */
export type Block =
	| { type: "text"; text: string }
	| {
			type: "tool";
			toolCallId: string;
			toolName: string;
			/** 工具入参（已格式化为字符串，quickjs 工具就是代码本身） */
			args: string;
			/** 工具输出（已格式化为字符串），执行中为空 */
			result?: string;
			isError?: boolean;
			status: "running" | "done" | "error";
	  };

/** 对话里的一条消息 */
export type ChatItem =
	| { kind: "user"; id: string; text: string; timestamp: number }
	| { kind: "assistant"; id: string; blocks: Block[]; timestamp: number };
