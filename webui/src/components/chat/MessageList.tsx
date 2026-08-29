/**
 * 消息列表：渲染对话，新内容时自动滚动到底部
 *
 * 助手消息按 block 数组渲染：text 块走 markdown，tool 块渲染工具卡片。
 */
import { lazy, Suspense, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { ChatItem } from "@/types";
import { ToolCallCard } from "./ToolCallCard";

// markdown 解析栈体积大，按需加载（首屏空对话时不下载）
const MarkdownBlock = lazy(() => import("./MarkdownBlock"));

export function MessageList({
  items,
  running,
}: {
  items: ChatItem[];
  running: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [items]);

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-6">
      {items.length === 0 && (
        <div className="pt-24 text-center text-muted-foreground">
          <p className="text-lg">微湖大 Agent</p>
          <p className="mt-2 text-sm">
            问我任何关于校园服务后端观测数据的问题
          </p>
        </div>
      )}

      {items.map((item) =>
        item.kind === "user" ? (
          <div key={item.id} className="flex justify-end">
            <div className="max-w-[80%] rounded-2xl bg-primary px-4 py-2 text-primary-foreground whitespace-pre-wrap">
              {item.text}
            </div>
          </div>
        ) : (
          <div key={item.id} className="space-y-3">
            {item.blocks.map((block, i) =>
              block.type === "text" ? (
                <Suspense
                  key={i}
                  fallback={
                    <p className="whitespace-pre-wrap">{block.text}</p>
                  }
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
