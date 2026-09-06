/**
 * 对话页：持有消息列表状态，消费 SSE 事件流
 *
 * 会话管理：
 * - 启动时从 localStorage 恢复上次会话；不存在/已失效则新建
 * - 会话建立后打开 events 通道（EventSource），既是服务端的会话保鲜信号，
 *   也接收写者锁 role 事件（多标签页同会话只有写者能操作）
 * - "新对话" = 新建服务端会话并切换过去
 *
 * 对话操作：
 * - 发送/编辑重发都是 SSE 流，事件就地更新最后一条助手消息的 blocks：
 *   text_delta 追加文本、tool_start 开工具块、tool_update/end 按 toolCallId 更新
 * - 每轮结束后拉一次历史，把 live 消息换成带 entryId 的持久化版本
 *   （编辑/分支定位要用 entryId）
 * - 中断 = POST abort，服务端中断后 chat 流正常收到 done，无需额外处理
 * - 编辑重发 = 本地截断到被编辑消息 + 调 edit 接口（服务端 navigateTree 回退
 *   会话树再跑新 prompt，旧尾部在会话文件里保留为分支）
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
	abortChat,
	createSession,
	deleteSession,
	fetchHistory,
	listSessions,
	openEventsChannel,
	streamChat,
	streamEdit,
} from "@/api";
import type { ChatItem, SessionSummary } from "@/types";
import { ChatInput } from "./ChatInput";
import { Header } from "./Header";
import { MessageList } from "./MessageList";
import { SessionList } from "./SessionList";

let idCounter = 0;
const nextId = () => `live-${idCounter++}`;

const LAST_SESSION_KEY = "qnxg:last-session";

export function ChatPage() {
	const [sessionId, setSessionId] = useState<string>();
	const [sessions, setSessions] = useState<SessionSummary[]>([]);
	const [items, setItems] = useState<ChatItem[]>([]);
	const [running, setRunning] = useState(false);
	/** 写者锁：多标签页打开同一会话时，只有写者能发消息（由 events 通道 role 事件驱动） */
	const [writer, setWriter] = useState(false);
	const runningRef = useRef(false);

	const refreshSessions = useCallback(async () => {
		try {
			setSessions(await listSessions());
		} catch {
			// 列表刷新失败不影响对话
		}
	}, []);

	/** 切换到指定会话并加载历史 */
	const selectSession = useCallback(async (id: string) => {
		const history = await fetchHistory(id);
		setItems(history);
		localStorage.setItem(LAST_SESSION_KEY, id);
		setSessionId(id);
	}, []);

	// 启动：恢复上次会话，失败则新建
	useEffect(() => {
		(async () => {
			const saved = localStorage.getItem(LAST_SESSION_KEY);
			if (saved) {
				try {
					await selectSession(saved);
					return;
				} catch {
					localStorage.removeItem(LAST_SESSION_KEY);
				}
			}
			const { id } = await createSession();
			localStorage.setItem(LAST_SESSION_KEY, id);
			setSessionId(id);
		})().catch(() => {});
		refreshSessions();
	}, [selectSession, refreshSessions]);

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

	/** SSE handlers 工厂：chat / edit 共用一套块更新逻辑 */
	const makeStreamHandlers = useCallback(() => {
		// done 事件 + 流结束兜底会重复触发 finish，守卫只执行一次
		let finished = false;
		const finish = (refetchHistory: boolean) => {
			if (finished) return;
			finished = true;
			runningRef.current = false;
			setRunning(false);
			// 首条消息会成为会话标题，跑完刷新侧边栏
			refreshSessions();
			// 成功结束后拉历史，把 live 消息换成带 entryId 的持久化版本
			// （编辑定位要用 entryId）。失败路径不拉：避免把刚发的消息和
			// 错误提示整体抹掉
			if (refetchHistory && sessionId) {
				fetchHistory(sessionId)
					.then((history) => setItems(history))
					.catch(() => {});
			}
		};
		return {
			onTextDelta: (delta: string) =>
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
			onToolStart: (toolCallId: string, toolName: string, args: string) =>
				patchLastAssistant((msg) => {
					msg.blocks.push({
						type: "tool",
						toolCallId,
						toolName,
						args,
						status: "running",
					});
				}),
			onToolUpdate: (toolCallId: string, result: string) =>
				patchLastAssistant((msg) => {
					const block = msg.blocks.find(
						(b) => b.type === "tool" && b.toolCallId === toolCallId,
					);
					// 执行中的实时输出（累计文本，直接覆盖）
					if (block?.type === "tool") {
						block.result = result;
					}
				}),
			onToolEnd: (toolCallId: string, result: string, isError: boolean) =>
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
			onDone: () => finish(true),
			onError: (message: string) => {
				patchLastAssistant((msg) => {
					msg.blocks.push({ type: "text", text: `⚠️ ${message}` });
				});
				finish(false);
			},
		};
	}, [patchLastAssistant, refreshSessions, sessionId]);

	/** 开始一轮流式对话：置 running，然后消费 SSE */
	const startStream = useCallback(async (run: () => Promise<void>) => {
		runningRef.current = true;
		setRunning(true);
		try {
			await run();
		} catch {
			runningRef.current = false;
			setRunning(false);
		}
	}, []);

	const send = useCallback(
		async (text: string) => {
			if (runningRef.current || !sessionId || !writer) return;

			setItems((prev) => [
				...prev,
				{ kind: "user", id: nextId(), text, timestamp: Date.now() },
				{ kind: "assistant", id: nextId(), blocks: [], timestamp: Date.now() },
			]);

			await startStream(() =>
				streamChat(sessionId, text, makeStreamHandlers()),
			);
		},
		[sessionId, writer, startStream, makeStreamHandlers],
	);

	/** 编辑最后一条用户消息并重发（entryId 定位，更早的消息服务端会拒绝） */
	const editResend = useCallback(
		async (entryId: string, text: string) => {
			if (runningRef.current || !sessionId || !writer) return;

			// 本地截断到被编辑消息（不含），追加新消息对
			setItems((prev) => {
				const idx = prev.findIndex(
					(i) => i.kind === "user" && i.entryId === entryId,
				);
				const base = idx >= 0 ? prev.slice(0, idx) : prev;
				return [
					...base,
					{ kind: "user", id: nextId(), text, timestamp: Date.now() },
					{
						kind: "assistant",
						id: nextId(),
						blocks: [],
						timestamp: Date.now(),
					},
				];
			});

			await startStream(() =>
				streamEdit(sessionId, entryId, text, makeStreamHandlers()),
			);
		},
		[sessionId, writer, startStream, makeStreamHandlers],
	);

	/** 中断当前回复（服务端 abort 后 chat 流正常收到 done，running 随之结束） */
	const stop = useCallback(() => {
		if (sessionId) abortChat(sessionId).catch(() => {});
	}, [sessionId]);

	const newChat = useCallback(async () => {
		if (runningRef.current) return;
		try {
			const { id } = await createSession();
			localStorage.setItem(LAST_SESSION_KEY, id);
			setItems([]);
			setSessionId(id);
			refreshSessions();
		} catch {
			// 创建失败保持现状
		}
	}, [refreshSessions]);

	/** 侧边栏切换会话（运行中禁止切换，避免事件串台） */
	const switchSession = useCallback(
		(id: string) => {
			if (runningRef.current || id === sessionId) return;
			selectSession(id).catch(() => {});
		},
		[selectSession, sessionId],
	);

	const removeSession = useCallback(
		async (id: string) => {
			// 运行中的会话禁止删除（服务端也会先 abort，但 UI 上直接拦住更直观）
			if (runningRef.current && id === sessionId) return;
			try {
				await deleteSession(id);
			} catch {
				return;
			}
			if (id !== sessionId) {
				refreshSessions();
				return;
			}
			// 删掉的是当前会话：切到列表里下一个，没有就新建
			const remaining = sessions.filter((s) => s.id !== id);
			if (remaining.length > 0) {
				selectSession(remaining[0].id).catch(() => {});
			} else {
				newChat();
				return;
			}
			refreshSessions();
		},
		[sessionId, sessions, selectSession, newChat, refreshSessions],
	);

	// 只有最后一条用户消息可编辑，且必须带 entryId（live 消息要等历史刷新；
	// 不能往前找更早的持久化消息，否则会错指到倒数第二条）
	const lastUser = [...items].reverse().find((i) => i.kind === "user");
	const editableEntryId =
		!running && writer && lastUser?.entryId ? lastUser.entryId : undefined;

	return (
		<div className="flex h-svh">
			<SessionList
				sessions={sessions}
				currentId={sessionId}
				onSelect={switchSession}
				onNew={newChat}
				onDelete={removeSession}
			/>
			<div className="flex min-w-0 flex-1 flex-col">
				<Header sessionId={sessionId} />
				<div className="flex-1 overflow-y-auto">
					<MessageList
						items={items}
						running={running}
						editableEntryId={editableEntryId}
						onEdit={editResend}
					/>
				</div>
				{sessionId && !writer && (
					<div className="border-t bg-muted/50 px-4 py-1.5 text-center text-xs text-muted-foreground">
						另一个页面正在使用此会话，当前页面为只读
					</div>
				)}
				<ChatInput
					disabled={running || !sessionId || !writer}
					running={running}
					onSend={send}
					onStop={stop}
				/>
			</div>
		</div>
	);
}
