/**
 * 告警系统主循环
 *
 * 高频 tick：激活规则检测 -> 闸门去抖/聚合 -> 消费决策事件
 *   - new-problem：立即唤醒 agent 批量分析所有活跃接口（agent 忙则标记补跑）
 *   - recovered：模板生成恢复通知，直接发 MQ（不花 LLM）
 * 低频定时：每 ANALYZE_INTERVAL_MS 且有活跃告警时，跑一轮整体分析并按接口发报告。
 *
 * 配置全部走 .env（TICK_MS / ANALYZE_INTERVAL_MS / DEBOUNCE_HITS / RECOVER_AFTER_MISS /
 * RABBITMQ_URL / REPORT_QUEUE），见 .env.example。
 */

import { loadRootEnv } from "./env.js";

loadRootEnv();

import { analyzeAlerts } from "./agent/analyzer.js";
import { createAnnotateTool } from "./agent/annotate-tool.js";
import { createAgent } from "./agent/session.js";
import { runDetection } from "./alert/detector.js";
import { AlertGate } from "./alert/gate.js";
import { RouteRegistry } from "./alert/route-registry.js";
import { rulesManager } from "./alert/rules/index.js";
import { ReportPublisher } from "./notify/publisher.js";
import { buildAlertReport, buildRecoveredMessage } from "./notify/report.js";

// ---------- 配置（env 可覆盖，默认值见 .env.example） ----------

function envInt(name: string, def: number): number {
	const v = Number(process.env[name]);
	return Number.isFinite(v) && v > 0 ? v : def;
}

const TICK_MS = envInt("TICK_MS", 30_000);
const ANALYZE_INTERVAL_MS = envInt("ANALYZE_INTERVAL_MS", 30 * 60_000);
const REGISTRY_REFRESH_MS = envInt("REGISTRY_REFRESH_MS", 10 * 60_000);
const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://localhost";
const REPORT_QUEUE = process.env.REPORT_QUEUE ?? "message.qqrobot";

// ---------- 装配 ----------

const gate = new AlertGate({
	debounceHits: envInt("DEBOUNCE_HITS", 2),
	recoverAfterMiss: envInt("RECOVER_AFTER_MISS", 3),
});
const registry = new RouteRegistry();
const publisher = new ReportPublisher({
	url: RABBITMQ_URL,
	queue: REPORT_QUEUE,
});
const annotateTool = createAnnotateTool(gate);
const session = await createAgent([annotateTool]);

// ---------- agent 分析调度 ----------

let isAnalyzing = false;
let reRunNeeded = false;
let shuttingDown = false;

/** 跑一轮分析：批量分析所有活跃接口，然后按接口发报告 */
async function runAnalysis(): Promise<void> {
	isAnalyzing = true;
	try {
		const alerts = gate.getActiveAlerts();
		if (alerts.length === 0) return;

		console.log(`\n[分析] 启动 agent 分析 ${alerts.length} 个异常接口...`);
		await analyzeAlerts(session, alerts);

		// 分析完成后重新取（annotate 已写入），逐接口发报告
		for (const alert of gate.getActiveAlerts()) {
			alert.lastAnalyzedAt = Date.now();
			publisher.publish(buildAlertReport(alert));
		}
		console.log("[分析] 完成，报告已发 MQ");
	} finally {
		isAnalyzing = false;
		// 分析期间又有新问题（agent 忙时被合并的触发）：立即补跑一轮
		if (reRunNeeded && !shuttingDown) {
			reRunNeeded = false;
			void requestAnalysis();
		}
	}
}

/** 请求分析：空闲则立即跑，忙则记补跑标志（多个触发合并为一次补跑） */
function requestAnalysis(): Promise<void> {
	if (isAnalyzing) {
		reRunNeeded = true;
		console.log("[分析] 上一轮未结束，本次触发已合并，稍后补跑");
		return Promise.resolve();
	}
	return runAnalysis();
}

// 每轮循环中的操作

let tickCount = 0;

async function tick(): Promise<void> {
	const activeRules = rulesManager.activeRules();
	const activeRulesID = rulesManager.activeRulesID();

	const signals = await runDetection(activeRules);

	// 注册表为空（启动刷新失败）时 gate 自动退化为信号驱动建条目
	const knownRoutes = new Set(registry.list());

	const decisions = gate.update(signals, activeRulesID, knownRoutes);
	const stats = gate.getStats();

	console.log(
		`[tick ${tickCount}] 激活规则：${activeRulesID.join(", ") || "（无）"}，信号 ${signals.length} 个，接口 active=${stats.active} debouncing=${stats.debouncing}`,
	);

	for (const d of decisions) {
		if (d.type === "new-problem") {
			console.log(
				`  🆕 新问题: ${d.alert.route}（${d.alert.signals.map((s) => s.ruleId).join(", ")}）`,
			);
			void requestAnalysis().catch((e) => console.error("[分析] 失败:", e));
		} else if (d.type === "recovered") {
			console.log(`  ✅ 已恢复: ${d.alert.route}`);
			publisher.publish(buildRecoveredMessage(d.alert));
		} else if (d.type === "unknown-routes") {
			// 未知接口（注册表尚未收录）：只打日志，等刷新转正后走正常流程
			console.log(
				`  ❓ 未知接口异常信号（待注册表刷新转正）: ${d.routes.join(", ")}`,
			);
		}
	}

	rulesManager.nextTick();
	tickCount++;
}

/** tick 异常隔离：单轮失败不炸进程 */
async function tickSafe(): Promise<void> {
	try {
		await tick();
	} catch (e) {
		// TODO console.error显然没啥意义，真部署的话还得往qq告警或者打日志
		console.error(`[tick] 第 ${tickCount} 轮执行失败:`, e);
	}
}

// ---------- 启动 ----------

async function refreshRegistry(): Promise<void> {
	try {
		await registry.refresh();
	} catch (e) {
		console.error("[registry] 刷新失败（沿用上一次列表）:", e);
	}
}

await refreshRegistry();
// 非阻塞连接：RabbitMQ 未就绪不阻塞检测，通道就绪前消息丢弃
publisher.connect();
console.log(
	`告警系统启动：规则 ${rulesManager.length} 条，接口 ${registry.size} 个，tick=${TICK_MS}ms，分析间隔=${Math.round(ANALYZE_INTERVAL_MS / 60000)}min，注册表刷新=${Math.round(REGISTRY_REFRESH_MS / 60000)}min，MQ=${RABBITMQ_URL} 队列=${REPORT_QUEUE}\n`,
);

await tickSafe();
const tickTimer = setInterval(() => void tickSafe(), TICK_MS);

// 注册表定期刷新（独立于 tick，DISTINCT 查询有一定开销）
const registryTimer = setInterval(
	() => void refreshRegistry(),
	REGISTRY_REFRESH_MS,
);

// 低频整体检查：有活跃告警才跑（无异常不打扰）
const analyzeTimer = setInterval(() => {
	if (shuttingDown || isAnalyzing) return;
	if (gate.getActiveAlerts().length === 0) return;
	void requestAnalysis().catch((e) => console.error("[分析] 失败:", e));
}, ANALYZE_INTERVAL_MS);

// ---------- 优雅停机 ----------

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// 直接杀进程可能会在rabbitMQ那里留一个僵尸连接，约60秒
// 实际开发频繁重启的时候可能会有点小影响，如果后面有别的问题可以把这段删了
async function shutdown(signal: string): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`\n收到 ${signal}，正在停机...`);
	clearInterval(tickTimer);
	clearInterval(analyzeTimer);
	clearInterval(registryTimer);

	// 最多等5秒，要是短的话再调整
	const deadline = Date.now() + 10_000;
	while (isAnalyzing && Date.now() < deadline) {
		await sleep(500);
	}

	await publisher.close();
	console.log("已退出");
	process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
