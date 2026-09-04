/**
 * 底部输入区：Enter 发送，Shift+Enter 换行
 * agent 运行中禁用发送（后端会串行排队，但 UI 上直接拦住更直观）
 */

import { SendHorizonal } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ChatInput({
	disabled,
	onSend,
}: {
	disabled: boolean;
	onSend: (text: string) => void;
}) {
	const [text, setText] = useState("");

	const send = () => {
		const trimmed = text.trim();
		if (!trimmed || disabled) return;
		onSend(trimmed);
		setText("");
	};

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault();
			send();
		}
	};

	return (
		<div className="border-t bg-background">
			<div className="mx-auto flex w-full max-w-3xl items-end gap-2 px-4 py-3">
				<Textarea
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={onKeyDown}
					placeholder="输入需求，Enter 发送，Shift+Enter 换行"
					className="max-h-40 min-h-10 resize-none"
					rows={1}
				/>
				<Button
					size="icon"
					onClick={send}
					disabled={disabled || !text.trim()}
					title="发送"
				>
					<SendHorizonal className="size-4" />
				</Button>
			</div>
		</div>
	);
}
