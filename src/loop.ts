/**
 * 告警系统主循环
 *
 * 高频 tick：激活规则检测 -> 状态机更新 -> 输出 firing（含 annotation）
 * 低频：每 N tick 且有 firing 告警时，交给 agent 深度分析，
 *       agent 用 query() 查数据 + annotate_alert 工具给告警打注释。
 *
 * isAnalyzing 标志防止上一轮 agent 分析未完成时重复触发（LLM 耗时较长）。
 */

// 加载 .env（Node 20.12+ 原生支持，文件不存在则跳过）
try {
  process.loadEnvFile();
} catch {
  // 没有 .env，依赖外部环境变量
}

import { rulesManager } from "./alert/rules/index.js";
import { runDetection } from "./alert/detector.js";
import { AlertStateMachine } from "./alert/state-machine.js";
import { processSignals } from "./alert/processor.js";
import { createAgent } from "./agent/session.js";
import { createAnnotateTool } from "./agent/annotate-tool.js";
import { analyzeAlerts } from "./agent/analyzer.js";

const stateMachine = new AlertStateMachine();
const annotateTool = createAnnotateTool(stateMachine);
const session = await createAgent([annotateTool]);

const TICK_MS = 30000; // tick 间隔（测试用 30s，正式可调大）
const ANALYZE_EVERY_N_TICKS = 2; // 每 N tick 跑一次 agent 分析（测试用，正式调大）
let tickCount = 0;
let isAnalyzing = false;

console.log(
  `告警系统启动，加载规则 ${rulesManager.length} 条，tick=${TICK_MS}ms，分析间隔=${ANALYZE_EVERY_N_TICKS} tick\n`,
);

async function tick() {
  // 因为不同的规则按不同周期检测，每轮获取当前激活的规则
  const activeRules = rulesManager.activeRules();
  const activeRulesID = rulesManager.activeRulesID();

  const signals = await runDetection(activeRules); // 生成信号
  const firingSignals = stateMachine.update(signals, activeRulesID); // 更新状态机
  const firingInstances = stateMachine.getFiringInstances(); // firing 实例（含 annotation）
  const stats = stateMachine.getStats();


  // 打印规则的情况
  console.log(
    `[tick ${tickCount}] 激活规则：${activeRulesID.join(", ") || "（无）"}`,
  );
  console.log(
    `检测：信号 ${signals.length} 个，实例 pending=${stats.pending} firing=${stats.firing}`,
  );
  for (const inst of firingInstances) {
    const ann = inst.annotation ? `  💬 ${inst.annotation}` : "";
    console.log(`  ${inst.groupKey}  ${inst.lastSignal.message}${ann}`);
  }

  // 低频：每 N tick 且有 firing 告警且上一轮分析已结束时，跑 agent 分析
  if (
    tickCount % ANALYZE_EVERY_N_TICKS === 0 &&
    !isAnalyzing &&
    firingSignals.length > 0
  ) {
    isAnalyzing = true;
    console.log(
      `\n[分析] 启动 agent 分析 ${firingSignals.length} 个 firing 告警...`,
    );
    // 不 await：setInterval 不等 agent，下一轮 tick 正常跑；isAnalyzing 防重叠
    analyzeAlerts(session, firingSignals)
      .then(() => {
        console.log(`\n[分析] 完成，注释已写入：`);
        for (const inst of stateMachine.getFiringInstances()) {
          if (inst.annotation) {
            console.log(`  💬 ${inst.groupKey}: ${inst.annotation}`);
          }
        }
      })
      .catch((e) => console.error(`[分析] 失败:`, e))
      .finally(() => {
        isAnalyzing = false;
      });
  }

  rulesManager.nextTick();
  tickCount++;
}

tick();
setInterval(tick, TICK_MS);
