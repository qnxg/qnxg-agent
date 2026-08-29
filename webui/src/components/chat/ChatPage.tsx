/**
 * 对话页：持有消息列表状态，消费 SSE 事件流
 *
 * 发送消息时：本地追加用户消息 + 空的助手消息，
 * SSE 事件来了就地更新最后一条助手消息的 blocks：
 * - text_delta: 最后一个块是 text 就追加文本，否则新开一个 text 块
 * - tool_start: 追加 running 状态的工具块
 * - tool_end:   按 toolCallId 回填结果
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { clearHistory, fetchHistory, streamChat } from "@/api";
import type { ChatItem } from "@/types";
import { ChatInput } from "./ChatInput";
import { Header } from "./Header";
import { MessageList } from "./MessageList";

let idCounter = 0;
const nextId = () => `live-${idCounter++}`;

export function ChatPage() {
	const [items, setItems] = useState<ChatItem[]>([]);
	const [running, setRunning] = useState(false);
	const runningRef = useRef(false);

	useEffect(() => {
		fetchHistory()
			.then((history) => {
				idCounter = history.length;
				setItems(history);
			})
			.catch(() => {});
	}, []);

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
			if (runningRef.current) return;
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
				await streamChat(text, {
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
		[patchLastAssistant],
	);

	const newChat = useCallback(async () => {
		if (runningRef.current) return;
		await clearHistory().catch(() => {});
		setItems([]);
	}, []);

	return (
		<div className="flex h-svh flex-col">
			<Header onNewChat={newChat} />
			<div className="flex-1 overflow-y-auto">
				<MessageList items={items} running={running} />
			</div>
			<ChatInput disabled={running} onSend={send} />
		</div>
	);
}
