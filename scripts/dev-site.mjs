import './check-node.mjs';

// 本地联调：Vite 以 site 模式启动（端口 5181），/functions/v1/app 代理到本地 Deno 函数（8010）。
process.env.VITE_API_PREFIX = process.env.VITE_API_PREFIX || '/functions/v1/app';

const { createServer } = await import('vite');
const server = await createServer({
  mode: 'development',
  configFile: 'vite.config.ts',
  server: { host: '127.0.0.1', port: 5181, strictPort: true },
});
await server.listen();
server.printUrls();
