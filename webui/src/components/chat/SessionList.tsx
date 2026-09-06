/**
 * 侧边栏会话列表
 *
 * 每个会话显示首条消息摘要（空会话显示"新会话"）和相对时间，
 * hover 出现删除按钮。列表数据来自 GET /api/sessions，
 * 新建/切换/删除后由父组件刷新。
 */

import { MessageSquare, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SessionSummary } from "@/types";

/** 相对时间："刚刚" / "5 分钟前" / "3 小时前" / "2 天前" / 日期 */
function formatRelative(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime();
	const min = Math.floor(diff / 60_000);
	if (min < 1) return "刚刚";
	if (min < 60) return `${min} 分钟前`;
	const hours = Math.floor(min / 60);
	if (hours < 24) return `${hours} 小时前`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days} 天前`;
	return new Date(iso).toLocaleDateString();
}

export function SessionList({
	sessions,
	currentId,
	onSelect,
	onNew,
	onDelete,
}: {
	sessions: SessionSummary[];
	currentId?: string;
	onSelect: (id: string) => void;
	onNew: () => void;
	onDelete: (id: string) => void;
}) {
	return (
		<aside className="flex w-64 shrink-0 flex-col border-r bg-muted/30">
			<div className="border-b p-2">
				<Button
					variant="outline"
					className="w-full justify-start gap-2"
					onClick={onNew}
				>
					<Plus className="size-4" />
					新对话
				</Button>
			</div>
			<div className="flex-1 overflow-y-auto p-2">
				{sessions.length === 0 && (
					<p className="px-2 py-8 text-center text-xs text-muted-foreground">
						还没有会话
					</p>
				)}
				<ul className="flex flex-col gap-0.5">
					{sessions.map((s) => (
						<li key={s.id} className="group relative">
							<button
								type="button"
								onClick={() => onSelect(s.id)}
								className={`flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors ${
									s.id === currentId
										? "bg-accent text-accent-foreground"
										: "hover:bg-accent/50"
								}`}
							>
								<MessageSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
								<span className="min-w-0 flex-1">
									<span className="block truncate">
										{s.name || s.firstMessage || "新会话"}
									</span>
									<span className="block text-xs text-muted-foreground">
										{formatRelative(s.modified)}
									</span>
								</span>
							</button>
							<button
								type="button"
								title="删除会话"
								onClick={(e) => {
									e.stopPropagation();
									onDelete(s.id);
								}}
								className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
							>
								<Trash2 className="size-3.5" />
							</button>
						</li>
					))}
				</ul>
			</div>
		</aside>
	);
}
