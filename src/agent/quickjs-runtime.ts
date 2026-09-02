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
import { greptimeQuery } from "../greptime-query.js";

export interface QuickJSRunResult {
	/** 代码 eval 的返回值（字符串），出错时为 undefined */
	result?: string;
	/** 执行错误信息（如未 catch 的 query 异常），正常时为 undefined */
	error?: string;
	/** 沙箱内 log() 收集的输出行 */
	logs: string[];
}

export interface QuickJSRunOptions {
	/** 沙箱内每次 log() 时同步回调（用于实时流式输出），参数是格式化后的单行 */
	onLog?: (line: string) => void;
}

export async function runQuickJS(
	code: string,
	options: QuickJSRunOptions = {},
): Promise<QuickJSRunResult> {
	const vm = await newAsyncContext();
	const logs: string[] = [];

	try {
		vm.runtime.setMemoryLimit(1024 * 1024 * 50);
		vm.runtime.setMaxStackSize(1024 * 256);

		// query(sql): 宿主端异步 fetch，QuickJS 内同步
		// greptimeQuery 抛错时会直接变成 QuickJS 内部的 JS 异常，
		// agent 代码可以 try/catch 自行处理；不 catch 则 evalCodeAsync 返回 error。
		vm.newAsyncifiedFunction("query", async (sqlHandle) => {
			const sql = vm.getString(sqlHandle);
			const result = await greptimeQuery(sql);
			return vm.newString(result);
		}).consume((h) => vm.setProp(vm.global, "query", h));

		// log(...args)
		vm.newFunction("log", (...args) => {
			// 正确打印 quickjs 对象
			const line = args
				.map((h) => vm.dump(h))
				.map((v) =>
					typeof v === "object" && v !== null ? JSON.stringify(v) : String(v),
				)
				.join(" ");
			logs.push(line);
			options.onLog?.(line);
		}).consume((h) => vm.setProp(vm.global, "log", h));

		// filename 没啥实际意义，纯占位
		const evalResult = await vm.evalCodeAsync(code, "agent-code.js");
		if (evalResult.error) {
			const dumped = vm.dump(evalResult.error);
			evalResult.error.dispose();
			const errStr = `${dumped.name}: ${dumped.message}`;
			return { error: errStr, logs };
		}

		const result = evalResult.value;
		const str = vm.getString(result);
		result.dispose();
		return { result: str, logs };
	} finally {
		vm.dispose();
	}
}
