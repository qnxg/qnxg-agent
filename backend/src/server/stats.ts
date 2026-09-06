/**
 * 会话用量接口：GET /api/sessions/:id/stats
 *
 * 数据直接来自 SDK：
 * - getSessionStats()：累计 token（input/output/cacheRead/cacheWrite/total）
 *   和 cost，聚合整个会话（含被压缩/编辑掉的历史），反映实际计费
 * - getContextUsage()：当前上下文占用（tokens / contextWindow / percent）
 *
 * 前端在每轮对话结束（done）后拉一次，无需实时推送。
 */

import type { Hono } from "hono";
import type { SessionPool } from "./session-pool.js";

export function registerStatsRoute(app: Hono, pool: SessionPool) {
	app.get("/api/sessions/:id/stats", async (c) => {
		const pooled = await pool.acquire(c.req.param("id"));
		if (!pooled) return c.json({ error: "会话不存在" }, 404);

		const stats = pooled.session.getSessionStats();
		const context = pooled.session.getContextUsage();
		return c.json({
			tokens: stats.tokens,
			cost: stats.cost,
			messages: {
				user: stats.userMessages,
				assistant: stats.assistantMessages,
			},
			context: context ?? null,
		});
	});
}
