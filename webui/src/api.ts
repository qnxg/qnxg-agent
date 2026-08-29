/**
 * API 客户端
 *
 * - 历史/元信息走普通 fetch
 * - 对话走 POST + SSE：EventSource 不支持 POST，
 *   这里用 fetch 的 ReadableStream 手动解析 SSE 协议（event:/data: 行）
 */
import type { ChatItem } from "./types";

export async function fetchHistory(): Promise<ChatItem[]> {
  const res = await fetch("/api/history");
  if (!res.ok) throw new Error(`获取历史失败: ${res.status}`);
  return res.json();
}

export async function clearHistory(): Promise<void> {
  await fetch("/api/history", { method: "DELETE" });
}

export async function fetchInfo(): Promise<{ model: string }> {
  const res = await fetch("/api/info");
  if (!res.ok) throw new Error(`获取信息失败: ${res.status}`);
  return res.json();
}

export interface ChatStreamHandlers {
  onTextDelta: (delta: string) => void;
  onToolStart: (toolCallId: string, toolName: string, args: string) => void;
  onToolEnd: (toolCallId: string, result: string, isError: boolean) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/** 发消息并消费 SSE 流，事件通过 handlers 回调 */
export async function streamChat(
  message: string,
  handlers: ChatStreamHandlers,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok || !res.body) {
    handlers.onError(`请求失败: ${res.status}`);
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
