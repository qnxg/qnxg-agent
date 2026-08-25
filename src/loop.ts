/**
 * 告警系统入口
 *
 * 当前阶段（MVP）：加载规则 -> 检测 -> 状态机 -> 分组+去重 -> 打印
 * 单轮跑通链路。下一步接 setInterval 循环，多轮才能看到 pending->firing->resolved 效果。
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
import { AlertRule } from "./alert/types.js";

const stateMachine = new AlertStateMachine();

setInterval(async () => {
  // 因为不同的规则要按照不同的周期检测，因此每轮都获取当前激活的规则
  const activeRules: AlertRule[] = rulesManager.activeRules();
  const activeRulesID: string[] = rulesManager.activeRulesID();

  const signals = await runDetection(activeRules); // 生成信号
  const firingSignals = stateMachine.update(signals, activeRulesID); // 更新状态机
  const groups = processSignals(firingSignals); // 分组/去重
  const stats = stateMachine.getStats();


  console.log(`  激活规则：${activeRulesID.join(", ")}`);

  console.log(
    `\n检测完成：信号 ${signals.length} 个，实例 pending=${stats.pending} firing=${stats.firing}，分组 ${groups.length} 组：`,
  );
  for (const g of groups) {
    console.log(`  ${g.groupKey}  (${g.signals.length} 信号)`);
    for (const s of g.signals) {
      console.log(`      - ${s.message}`);
    }
  }

  rulesManager.nextTick();

}, 2000);


console.log(`告警系统启动，加载规则 ${rulesManager.length} 条`);
