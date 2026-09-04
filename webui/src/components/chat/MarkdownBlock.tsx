/**
 * Markdown 渲染块（独立文件，供 React.lazy 动态导入）
 *
 * react-markdown 的解析栈（micromark/mdast/unified）占打包体积约 16%，
 * 首屏空对话时用不到，拆成独立 chunk 按需加载。
 */
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function MarkdownBlock({ text }: { text: string }) {
	return (
		<div className="prose prose-neutral dark:prose-invert max-w-none">
			<Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
		</div>
	);
}
