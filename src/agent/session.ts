/**
 * Agent session 创建
 *
 * 装配 ModelRuntime + 资源加载器 + quickjs_exec 工具，返回可对话的 session。
 * 订阅事件把模型输出和工具调用过程打到 stdout。
 */
import { readFileSync } from "node:fs";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
	createAgentSession,
	DefaultResourceLoader,
	type defineTool,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { quickjsTool } from "./quickjs-tool.js";

export function formatToolIO(value: unknown): string {
	if (value == null) return String(value);
	// 自定义工具的 args: { code: string }，直接展示代码
	if (typeof value === "object" && value !== null && "code" in value) {
		return String((value as { code: unknown }).code);
	}
	// 工具结果: { content: [{ type: "text", text: string }] }，提取文本
	if (typeof value === "object" && value !== null && "content" in value) {
		const content = (value as { content: unknown }).content;
		if (Array.isArray(content)) {
			const text = content
				.filter(
					(c): c is { type: string; text: string } =>
						typeof c === "object" &&
						c !== null &&
						(c as { type?: unknown }).type === "text",
				)
				.map((c) => c.text)
				.join("\n");
			return text;
		}
	}
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

export async function createAgent(
	extraTools: ReturnType<typeof defineTool>[] = [],
): Promise<AgentSession> {
	// 模型配置全部来自项目内 pi-config/ 目录，不依赖 ~/.pi/agent
	// - models.json: deepseek provider + 模型定义，apiKey 通过 $DEEPSEEK_API_KEY 引用 .env
	// - settings.json: 默认模型 deepseek-v4-flash
	// - auth.json: 凭据占位（当前 key 走 .env 环境变量插值）
	const modelRuntime = await ModelRuntime.create({
		authPath: "pi-config/auth.json",
		modelsPath: "pi-config/models.json",
	});
	const settingsManager = SettingsManager.create(process.cwd(), "pi-config");

	const promptMd = readFileSync("src/agent/prompt/prompt.md", "utf-8");

	const loader = new DefaultResourceLoader({
		cwd: process.cwd(),
		agentDir: "pi-config",
		noExtensions: true,
		systemPromptOverride: () =>
			`你是微生活 agent，负责查询和分析微湖大（weihuda）校园服务后端的观测数据。\n\n${promptMd}`,
	});
	await loader.reload();

	const { session } = await createAgentSession({
		sessionManager: SessionManager.inMemory(),
		modelRuntime,
		settingsManager,
		resourceLoader: loader,
		noTools: "all",
		customTools: [quickjsTool, ...extraTools],
		tools: ["quickjs_exec", ...extraTools.map((t) => t.name)],
	});

	return session;
}
