/**
 * 对话页：持有消息列表状态，消费 SSE 事件流
 *
 * 会话管理：
 * - 启动时从 localStorage 恢复上次会话；不存在/已失效则新建
 * - 会话建立后打开 events 通道（EventSource），既是服务端的会话保鲜信号，
 *   断线也会自动重连
 * - "新对话" = 新建服务端会话并切换过去
 *
 * 发送消息时：本地追加用户消息 + 空的助手消息，
 * SSE 事件来了就地更新最后一条助手消息的 blocks：
 * - text_delta: 最后一个块是 text 就追加文本，否则新开一个 text 块
 * - tool_start: 追加 running 状态的工具块
 * - tool_update: 按 toolCallId 更新执行中的实时输出
 * - tool_end:   按 toolCallId 回填结果
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
	createSession,
	fetchHistory,
	openEventsChannel,
	streamChat,
} from "@/api";
import type { ChatItem } from "@/types";
import { ChatInput } from "./ChatInput";
import { Header } from "./Header";
import { MessageList } from "./MessageList";

let idCounter = 0;
const nextId = () => `live-${idCounter++}`;

const LAST_SESSION_KEY = "qnxg:last-session";

export function ChatPage() {
	const [sessionId, setSessionId] = useState<string>();
	const [items, setItems] = useState<ChatItem[]>([]);
	const [running, setRunning] = useState(false);
	/** 写者锁：多标签页打开同一会话时，只有写者能发消息（由 events 通道 role 事件驱动） */
	const [writer, setWriter] = useState(false);
	const runningRef = useRef(false);
	const writerRef = useRef(false);
	writerRef.current = writer;

	// 启动：恢复上次会话，失败则新建
	useEffect(() => {
		(async () => {
			const saved = localStorage.getItem(LAST_SESSION_KEY);
			if (saved) {
				try {
					const history = await fetchHistory(saved);
					idCounter = history.length;
					setItems(history);
					setSessionId(saved);
					return;
				} catch {
					localStorage.removeItem(LAST_SESSION_KEY);
				}
			}
			const { id } = await createSession();
			localStorage.setItem(LAST_SESSION_KEY, id);
			setSessionId(id);
		})().catch(() => {});
	}, []);

	// 会话切换：打开 events 通道（卸载/切换时自动关闭）
	useEffect(() => {
		if (!sessionId) return;
		setWriter(false);
		const es = openEventsChannel(sessionId);
		es.addEventListener("role", (e) => {
			setWriter(JSON.parse((e as MessageEvent).data).writer);
		});
		return () => es.close();
	}, [sessionId]);

	/** 就地更新最后一条助手消息的 blocks */
	const patchLastAssistant = useCallback(
		(fn: (msg: Extract<ChatItem, { kind: "assistant" }>) => void) => {
			setItems((prev) => {
				const next = [...prev];
				const last = next[next.length - 1];
				if (last?.kind === "assistant") {
					const copied = { ...last, blocks: [...last.blocks] };
					next[next.length - 1] = copied;
					fn(copied);
				}
				return next;
			});
		},
		[],
	);

	const send = useCallback(
		async (text: string) => {
			if (runningRef.current || !sessionId || !writerRef.current) return;
			runningRef.current = true;
			setRunning(true);

			setItems((prev) => [
				...prev,
				{ kind: "user", id: nextId(), text, timestamp: Date.now() },
				{
					kind: "assistant",
					id: nextId(),
					blocks: [],
					timestamp: Date.now(),
				},
			]);

			const finish = () => {
				runningRef.current = false;
				setRunning(false);
			};

			try {
				await streamChat(sessionId, text, {
					onTextDelta: (delta) =>
						patchLastAssistant((msg) => {
							const last = msg.blocks[msg.blocks.length - 1];
							if (last?.type === "text") {
								msg.blocks[msg.blocks.length - 1] = {
									...last,
									text: last.text + delta,
								};
							} else {
								msg.blocks.push({ type: "text", text: delta });
							}
						}),
					onToolStart: (toolCallId, toolName, args) =>
						patchLastAssistant((msg) => {
							msg.blocks.push({
								type: "tool",
								toolCallId,
								toolName,
								args,
								status: "running",
							});
						}),
					onToolUpdate: (toolCallId, result) =>
						patchLastAssistant((msg) => {
							const block = msg.blocks.find(
								(b) => b.type === "tool" && b.toolCallId === toolCallId,
							);
							// 执行中的实时输出（累计文本，直接覆盖）
							if (block?.type === "tool") {
								block.result = result;
							}
						}),
					onToolEnd: (toolCallId, result, isError) =>
						patchLastAssistant((msg) => {
							const block = msg.blocks.find(
								(b) => b.type === "tool" && b.toolCallId === toolCallId,
							);
							if (block?.type === "tool") {
								block.result = result;
								block.isError = isError;
								block.status = isError ? "error" : "done";
							}
						}),
					onDone: finish,
					onError: (message) => {
						patchLastAssistant((msg) => {
							msg.blocks.push({ type: "text", text: `⚠️ ${message}` });
						});
						finish();
					},
				});
			} catch {
				finish();
			}
		},
		[patchLastAssistant, sessionId],
	);

	const newChat = useCallback(async () => {
		if (runningRef.current) return;
		try {
			const { id } = await createSession();
			localStorage.setItem(LAST_SESSION_KEY, id);
			setItems([]);
			setSessionId(id);
		} catch {
			// 创建失败保持现状
		}
	}, []);

	return (
		<div className="flex h-svh flex-col">
			<Header sessionId={sessionId} onNewChat={newChat} />
			<div className="flex-1 overflow-y-auto">
				<MessageList items={items} running={running} />
			</div>
			{sessionId && !writer && (
				<div className="border-t bg-muted/50 px-4 py-1.5 text-center text-xs text-muted-foreground">
					另一个页面正在使用此会话，当前页面为只读
				</div>
			)}
			<ChatInput disabled={running || !sessionId || !writer} onSend={send} />
		</div>
	);
}
