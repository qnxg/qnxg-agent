/**
 * 顶栏：标题、模型名、token 用量、主题切换
 *
 * 用量展示（stats 由父组件在每轮对话结束后刷新）：
 * - 上下文：当前占用/窗口（百分比），hover 显示精确值
 * - 累计：输入/输出 token 与费用（含被压缩/编辑掉的历史，反映实际计费）
 */

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchInfo } from "@/api";
import { useTheme } from "@/components/theme-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SessionStats } from "@/types";

/** 1234 → "1.2k"，1234567 → "1.2M" */
function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

function StatsBadge({ stats }: { stats: SessionStats }) {
	const { context, tokens, cost } = stats;
	return (
		<span className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
			{context && context.tokens != null && (
				<span
					title={`上下文 ${context.tokens.toLocaleString()} / ${context.contextWindow.toLocaleString()} tokens`}
				>
					上下文 {formatTokens(context.tokens)}/
					{formatTokens(context.contextWindow)}
					{context.percent != null && ` (${Math.round(context.percent)}%)`}
				</span>
			)}
			<span
				title={`累计输入 ${tokens.input.toLocaleString()} / 输出 ${tokens.output.toLocaleString()} / 缓存命中 ${tokens.cacheRead.toLocaleString()} tokens`}
			>
				累计 ↑{formatTokens(tokens.input)} ↓{formatTokens(tokens.output)}
			</span>
			{cost > 0 && <span>${cost.toFixed(4)}</span>}
		</span>
	);
}

export function Header({
	sessionId,
	stats,
}: {
	sessionId?: string;
	stats?: SessionStats;
}) {
	const { theme, setTheme } = useTheme();
	const [model, setModel] = useState<string>();

	useEffect(() => {
		if (!sessionId) return;
		fetchInfo(sessionId)
			.then((info) => setModel(info.model))
			.catch(() => {});
	}, [sessionId]);

	return (
		<header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
			<h1 className="text-base font-semibold">微湖大 Agent</h1>
			{model && <Badge variant="secondary">{model}</Badge>}
			{stats && <StatsBadge stats={stats} />}

			<div className="ml-auto flex items-center gap-1">
				<DropdownMenu>
					<DropdownMenuTrigger
						render={<Button variant="ghost" size="icon" title="主题" />}
					>
						{theme === "dark" ? (
							<Moon className="size-4" />
						) : theme === "light" ? (
							<Sun className="size-4" />
						) : (
							<Monitor className="size-4" />
						)}
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={() => setTheme("light")}>
							<Sun className="size-4" /> 浅色
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => setTheme("dark")}>
							<Moon className="size-4" /> 深色
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => setTheme("system")}>
							<Monitor className="size-4" /> 跟随系统
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</header>
	);
}
