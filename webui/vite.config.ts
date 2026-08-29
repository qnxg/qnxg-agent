import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "./src"),
		},
	},
	server: {
		proxy: {
			// 开发时把 API 请求转发给后端（src/server/index.ts，默认 3210 端口）
			"/api": "http://localhost:3210",
		},
	},
});
