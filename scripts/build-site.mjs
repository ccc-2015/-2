import './check-node.mjs';

// Qoder Sites 构建：前端走同源函数前缀，产物移到 site/web/ 供发布。
process.env.NODE_ENV = 'production';
process.env.VITE_API_PREFIX = '/functions/v1/app';

const { build } = await import('vite');
await build({ mode: 'production' });

const { cp, rm, mkdir } = await import('node:fs/promises');
const target = new URL('../../site/web/', import.meta.url);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(new URL('../dist/', import.meta.url), target, { recursive: true });
console.log('site build ready: site/web');
