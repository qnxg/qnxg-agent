/**
 * QuickJS 沙箱运行时（asyncify 构建）
 *
 * 用 quickjs-emscripten 的 Asyncify 构建：
 *   - 宿主函数 query 用 async + fetch 实现
 *   - QuickJS 内部仍然是同步调用：var raw = query("...")
 *
 * 参考: https://github.com/justjake/quickjs-emscripten#async-on-host-sync-in-quickjs
 */

import { newAsyncContext } from "quickjs-emscripten";
import { greptimeQuery } from "./greptime-query.js";

export interface QuickJSRunResult {
  /** 代码 eval 的返回值（字符串） */
  result: string;
  /** 沙箱内 log() 收集的输出行 */
  logs: string[];
}

export async function runQuickJS(code: string): Promise<QuickJSRunResult> {
  const vm = await newAsyncContext();
  const logs: string[] = [];

  try {
    vm.runtime.setMemoryLimit(1024 * 1024 * 50);
    vm.runtime.setMaxStackSize(1024 * 256);

    // query(sql): 宿主端异步 fetch，QuickJS 内同步
    vm
      .newAsyncifiedFunction("query", async (sqlHandle) => {
        const sql = vm.getString(sqlHandle);
        try {
          const result = await greptimeQuery(sql);
          return vm.newString(result);
        } catch (e) {
          return vm.newString(`[query error] ${String(e)}`);
        }
      })
      .consume((h) => vm.setProp(vm.global, "query", h));

    // log(...args)
    vm
      .newFunction("log", (...args) => {
        logs.push(args.map((h) => vm.dump(h)).join(" "));
      })
      .consume((h) => vm.setProp(vm.global, "log", h));

    const result = vm.unwrapResult(await vm.evalCodeAsync(code, "agent-code.js"));
    const str = vm.getString(result);
    result.dispose();
    return { result: str, logs };
  } finally {
    vm.dispose();
  }
}
