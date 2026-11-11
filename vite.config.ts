import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// 本地开发默认代理到 FastAPI；公网构建注入 VITE_API_PREFIX=/functions/v1/app，
// 并把函数的本地 Deno 服务代理到同一路径，保证开发与线上路由一致。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const prefix = (process.env.VITE_API_PREFIX || env.VITE_API_PREFIX || "/api").replace(/\/+$/, "");
  const target = prefix === "/api" ? "http://127.0.0.1:8000" : "http://127.0.0.1:8010";
  return {
    plugins: [react()],
    resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
    server: { host: "127.0.0.1", proxy: { [prefix]: target } },
    preview: { host: "127.0.0.1", proxy: { [prefix]: target } },
    build: { outDir: "dist" },
  };
});
