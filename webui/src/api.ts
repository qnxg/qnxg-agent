/**
 * API 客户端
 *
 * 所有会话相关接口都带 sessionId（/api/sessions/:id/*）。
 * - 列表/历史/元信息走普通 fetch
 * - 对话走 POST + SSE：EventSource 不支持 POST，
 *   这里用 fetch 的 ReadableStream 手动解析 SSE 协议（event:/data: 行）
 * - 会话事件通道走原生 EventSource（GET，自动重连）
 */
import type { ChatItem, SessionSummary } from "./types";

/**
 * 标签页级 clientId（sessionStorage：同标签页刷新保持不变，不同标签页各自唯一）。
 * 服务端用它做写者锁：多标签页打开同一会话时只有最早连接的标签页能发消息。
 */
export function getClientId(): string {
	let id = sessionStorage.getItem("qnxg:client-id");
	if (!id) {
		id = crypto.randomUUID();
		sessionStorage.setItem("qnxg:client-id", id);
	}
	return id;
}

export async function listSessions(): Promise<SessionSummary[]> {
	const res = await fetch("/api/sessions");
	if (!res.ok) throw new Error(`获取会话列表失败: ${res.status}`);
	return res.json();
}

export async function createSession(): Promise<{ id: string }> {
	const res = await fetch("/api/sessions", { method: "POST" });
	if (!res.ok) throw new Error(`创建会话失败: ${res.status}`);
	return res.json();
}

export async function fetchHistory(sessionId: string): Promise<ChatItem[]> {
	const res = await fetch(`/api/sessions/${sessionId}/history`);
	if (!res.ok) throw new Error(`获取历史失败: ${res.status}`);
	return res.json();
}

export async function fetchInfo(sessionId: string): Promise<{ model: string }> {
	const res = await fetch(`/api/sessions/${sessionId}/info`);
	if (!res.ok) throw new Error(`获取信息失败: ${res.status}`);
	return res.json();
}

/**
 * 打开会话事件通道（长驻 SSE）。
 * 只要通道连着，服务端就不会淘汰这个会话；断开超过 1 分钟会被释放内存
 * （历史在磁盘上，重开透明恢复）。原生 EventSource 自带断线重连。
 */
export function openEventsChannel(sessionId: string): EventSource {
	return new EventSource(
		`/api/sessions/${sessionId}/events?clientId=${getClientId()}`,
	);
}

export interface ChatStreamHandlers {
	onTextDelta: (delta: string) => void;
	onToolStart: (toolCallId: string, toolName: string, args: string) => void;
	onToolUpdate: (toolCallId: string, result: string) => void;
	onToolEnd: (toolCallId: string, result: string, isError: boolean) => void;
	onDone: () => void;
	onError: (message: string) => void;
}

/** 发消息并消费 SSE 流，事件通过 handlers 回调 */
export async function streamChat(
	sessionId: string,
	message: string,
	handlers: ChatStreamHandlers,
): Promise<void> {
	const res = await fetch(`/api/sessions/${sessionId}/chat`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ message, clientId: getClientId() }),
	});
	if (!res.ok || !res.body) {
		const err = await res.json().catch(() => null);
		handlers.onError(err?.error ?? `请求失败: ${res.status}`);
		return;
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	const dispatch = (event: string, data: string) => {
		const parsed = JSON.parse(data);
		switch (event) {
			case "text_delta":
				handlers.onTextDelta(parsed.delta);
				break;
			case "tool_start":
				handlers.onToolStart(parsed.toolCallId, parsed.toolName, parsed.args);
				break;
			case "tool_update":
				handlers.onToolUpdate(parsed.toolCallId, parsed.result);
				break;
			case "tool_end":
				handlers.onToolEnd(parsed.toolCallId, parsed.result, parsed.isError);
				break;
			case "done":
				handlers.onDone();
				break;
			case "error":
				handlers.onError(parsed.message);
				break;
		}
	};

	// 逐块读取，按空行切分 SSE 事件帧
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		const frames = buffer.split("\n\n");
		buffer = frames.pop() ?? ""; // 最后一段可能不完整，留给下一轮
		for (const frame of frames) {
			let event = "message";
			let data = "";
			for (const line of frame.split("\n")) {
				if (line.startsWith("event:")) event = line.slice(6).trim();
				else if (line.startsWith("data:")) data += line.slice(5).trim();
			}
			if (data) dispatch(event, data);
		}
	}
	handlers.onDone(); // 流兜底结束（done 事件重复调用是幂等的）
}
