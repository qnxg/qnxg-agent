/**
 * 消息列表：渲染对话，新内容时自动滚动到底部
 *
 * 助手消息按 block 数组渲染：text 块走 markdown，tool 块渲染工具卡片。
 * 最后一条用户消息（editableEntryId 命中的）hover 出编辑按钮，
 * 点击进入行内编辑，提交后由父组件截断本地消息并调 edit 接口重发。
 */
import { Pencil } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ChatItem } from "@/types";
import { ToolCallCard } from "./ToolCallCard";

// markdown 解析栈体积大，按需加载（首屏空对话时不下载）
const MarkdownBlock = lazy(() => import("./MarkdownBlock"));

export function MessageList({
	items,
	running,
	editableEntryId,
	onEdit,
}: {
	items: ChatItem[];
	running: boolean;
	/** 当前可编辑的用户消息 entryId（最后一条 user 消息；运行中/非写者为空） */
	editableEntryId?: string;
	onEdit?: (entryId: string, text: string) => void;
}) {
	const bottomRef = useRef<HTMLDivElement>(null);
	/** 正在编辑的用户消息 entryId */
	const [editingId, setEditingId] = useState<string>();
	const [draft, setDraft] = useState("");

	// biome-ignore lint/correctness/useExhaustiveDependencies: items 变化时滚动到底部，effect 内不需要直接读取它
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
	}, [items]);

	const submitEdit = () => {
		const trimmed = draft.trim();
		if (!editingId || !trimmed || !onEdit) return;
		setEditingId(undefined);
		onEdit(editingId, trimmed);
	};

	return (
		<div className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-6">
			{items.length === 0 && (
				<div className="pt-24 text-center text-muted-foreground">
					<p className="text-lg">微湖大 Agent</p>
					<p className="mt-2 text-sm">问我任何关于校园服务后端观测数据的问题</p>
				</div>
			)}

			{items.map((item) =>
				item.kind === "user" ? (
					<div key={item.id} className="group flex justify-end">
						{item.entryId && item.entryId === editingId ? (
							<div className="w-full max-w-[80%] space-y-2">
								<Textarea
									value={draft}
									onChange={(e) => setDraft(e.target.value)}
									className="max-h-60 min-h-16 resize-none"
									autoFocus
								/>
								<div className="flex justify-end gap-2">
									<Button
										variant="ghost"
										size="sm"
										onClick={() => setEditingId(undefined)}
									>
										取消
									</Button>
									<Button
										size="sm"
										disabled={!draft.trim()}
										onClick={submitEdit}
									>
										发送
									</Button>
								</div>
							</div>
						) : (
							<>
								{item.entryId && item.entryId === editableEntryId && onEdit && (
									<button
										type="button"
										title="编辑并重发"
										className="mr-1 self-start rounded p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent"
										onClick={() => {
											setEditingId(item.entryId);
											setDraft(item.text);
										}}
									>
										<Pencil className="size-3.5" />
									</button>
								)}
								<div className="max-w-[80%] rounded-2xl bg-primary px-4 py-2 text-primary-foreground whitespace-pre-wrap">
									{item.text}
								</div>
							</>
						)}
					</div>
				) : (
					<div key={item.id} className="space-y-3">
						{item.blocks.map((block, i) =>
							block.type === "text" ? (
								<Suspense
									// biome-ignore lint/suspicious/noArrayIndexKey: text 块无稳定 id，blocks 仅追加不重排
									key={i}
									fallback={<p className="whitespace-pre-wrap">{block.text}</p>}
								>
									<MarkdownBlock text={block.text} />
								</Suspense>
							) : (
								<ToolCallCard key={block.toolCallId} block={block} />
							),
						)}
					</div>
				),
			)}

			<div
				className={cn(
					"items-center gap-2 text-sm text-muted-foreground",
					running ? "flex" : "hidden",
				)}
			>
				<span className="size-2 animate-pulse rounded-full bg-muted-foreground" />
				Agent 正在工作…
			</div>

			<div ref={bottomRef} />
		</div>
	);
}
