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

import { rules } from "./src/alert/rules/index.js";
import { runDetection } from "./src/alert/detector.js";
import { AlertStateMachine } from "./src/alert/state-machine.js";
import { processSignals } from "./src/alert/processor.js";

const stateMachine = new AlertStateMachine();

console.log(`告警系统启动，加载规则 ${rules.length} 条`);

for (let i = 0; i < 3; i++) {
  const signals = await runDetection(rules);
  const firingSignals = stateMachine.update(signals);
  const groups = processSignals(firingSignals);
  const stats = stateMachine.getStats();

  console.log(
    `\n检测完成：信号 ${signals.length} 个，实例 pending=${stats.pending} firing=${stats.firing}，分组 ${groups.length} 组：`,
  );
  for (const g of groups) {
    console.log(`  ${g.groupKey}  (${g.signals.length} 信号)`);
    for (const s of g.signals) {
      console.log(`      - ${s.message}`);
    }
  }

}
