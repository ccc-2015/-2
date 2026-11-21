import './check-node.mjs';

// 本地联调：Vite 以 site 模式启动（默认 5181），/functions/v1/app 代理到本地 Deno 函数。
// 必须在 JS 内写入前缀：Git Bash 会把 `/functions/v1/app` 形式的 shell 变量改写成 Windows 路径。
const requested = process.env.VITE_API_PREFIX || '';
process.env.VITE_API_PREFIX = requested.startsWith('/functions/') ? requested : '/functions/v1/app';
const edgePort = process.env.DEV_EDGE_PORT || '8010';
process.env.VITE_API_TARGET = `http://127.0.0.1:${edgePort}`;
const port = Number(process.env.DEV_PORT || 5181);

const { createServer } = await import('vite');
const server = await createServer({
  mode: 'development',
  configFile: 'vite.config.ts',
  server: { host: '127.0.0.1', port, strictPort: true },
});
await server.listen();
server.printUrls();
