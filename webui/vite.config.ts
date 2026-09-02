import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
	// 从项目根目录加载 .env
	const env = loadEnv(mode, path.resolve(import.meta.dirname, ".."), "");
	const port = env.PORT || "3210";

	return {
		plugins: [react(), tailwindcss()],
		resolve: {
			alias: {
				"@": path.resolve(import.meta.dirname, "./src"),
			},
		},
		server: {
			proxy: {
				// 开发时把 API 请求转发给后端（src/server/index.ts）
				"/api": `http://localhost:${port}`,
			},
		},
	};
});
