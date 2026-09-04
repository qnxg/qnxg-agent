/**
 * .env 加载工具
 *
 * .env 位于仓库根目录（backend/ 的上一级），而包脚本运行时 CWD 是 backend/，
 * 所以不能用 process.loadEnvFile()（按 CWD 查找），需要显式指向仓库根。
 */
import path from "node:path";

export function loadRootEnv(): void {
	try {
		process.loadEnvFile(path.join(import.meta.dirname, "../../.env"));
	} catch {
		// 没有 .env，依赖外部环境变量
	}
}
