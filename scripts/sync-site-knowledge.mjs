import './check-node.mjs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 把后端全部审核资料包合并成站点产物 packs.json，替代手工复制。
// 向量单独由 gen-site-vectors.mjs 生成；本脚本只报告是否落后。

const dataDir = fileURLToPath(new URL('../backend/app/knowledge/data/', import.meta.url));
const outDir = fileURLToPath(new URL('../../site/functions/knowledge/', import.meta.url));

const files = (await readdir(dataDir)).filter((name) => name.endsWith('.json'));
if (files.length === 0) {
  console.error('后端资料目录没有 .json 文件。');
  process.exit(1);
}

const packs = [];
for (const name of files) {
  packs.push(JSON.parse(await readFile(join(dataDir, name), 'utf8')));
}
await writeFile(join(outDir, 'packs.json'), JSON.stringify({ packs }, null, 2), 'utf8');

let vec = null;
try {
  vec = JSON.parse(await readFile(join(outDir, 'vectors.json'), 'utf8'));
} catch {
  // 没有向量文件时仅提示
}
const ids = new Set(Object.keys(vec?.vectors ?? {}));
for (const pack of packs) {
  const missing = pack.entries.filter((entry) => !ids.has(entry.id)).length;
  const note = !vec
    ? '缺少向量文件'
    : missing > 0 || ids.size !== packs.reduce((sum, item) => sum + item.entries.length, 0)
      ? `向量与条目不一致（缺 ${missing} 条）`
      : `向量已是最新（${ids.size} 条）`;
  console.log(`${pack.cityCode} ${pack.version} ${pack.entries.length} 条 → packs.json；${note}`);
}

console.log('同步完成。若向量不一致，运行：npm run knowledge:vectors');
