import './check-node.mjs';

// 对比用：本地 FastAPI 版前端（端口 5174，/api 代理到 8020）。
process.env.VITE_API_PREFIX = '/api';

const { createServer } = await import('vite');
const server = await createServer({
  mode: 'development',
  configFile: false,
  root: process.cwd(),
  resolve: { alias: { '@': process.cwd() } },
  plugins: [(await import('@vitejs/plugin-react')).default()],
  server: { host: '127.0.0.1', port: 5174, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8020' } },
});
await server.listen();
server.printUrls();
