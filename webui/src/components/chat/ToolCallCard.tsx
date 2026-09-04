/**
 * 工具调用卡片：展示一次 quickjs 调用的入参（代码）和输出
 *
 * 默认折叠，标题行显示工具名 + 执行状态（转圈/完成/失败）。
 */
import { ChevronsUpDown, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Block } from "@/types";

type ToolBlock = Extract<Block, { type: "tool" }>;

export function ToolCallCard({ block }: { block: ToolBlock }) {
	return (
		<Collapsible className="rounded-lg border bg-muted/40 text-sm">
			<CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left">
				{block.status === "running" ? (
					<Loader2 className="size-4 animate-spin text-muted-foreground" />
				) : (
					<span
						className={
							block.status === "error"
								? "size-2 rounded-full bg-destructive"
								: "size-2 rounded-full bg-emerald-500"
						}
					/>
				)}
				<span className="font-mono">{block.toolName}</span>
				<Badge variant="secondary" className="ml-auto">
					{block.status === "running"
						? "执行中"
						: block.status === "error"
							? "失败"
							: "完成"}
				</Badge>
				<ChevronsUpDown className="size-4 text-muted-foreground" />
			</CollapsibleTrigger>
			<CollapsibleContent className="space-y-2 border-t px-3 py-2">
				<div>
					<div className="mb-1 text-xs text-muted-foreground">输入</div>
					<pre className="overflow-x-auto rounded-md bg-background p-2 font-mono text-xs whitespace-pre-wrap">
						{block.args}
					</pre>
				</div>
				{block.result !== undefined && (
					<div>
						<div className="mb-1 text-xs text-muted-foreground">输出</div>
						<pre className="max-h-64 overflow-auto rounded-md bg-background p-2 font-mono text-xs whitespace-pre-wrap">
							{block.result}
						</pre>
					</div>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}
