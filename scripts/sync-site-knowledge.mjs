import './check-node.mjs';
import { readdir, readFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 把后端审核资料包同步到站点函数目录，替代手工复制。
// 只复制 data/*.json；向量需随后运行 gen-site-vectors.mjs 重新生成（依赖远程 embedding）。

const dataDir = fileURLToPath(new URL('../backend/app/knowledge/data/', import.meta.url));
const outDir = fileURLToPath(new URL('../../site/functions/knowledge/', import.meta.url));

const files = (await readdir(dataDir)).filter((name) => name.endsWith('.json'));
if (files.length === 0) {
  console.error('后端资料目录没有 .json 文件。');
  process.exit(1);
}

for (const name of files) {
  const src = join(dataDir, name);
  const dst = join(outDir, name);
  await copyFile(src, dst);
  const pack = JSON.parse(await readFile(src, 'utf8'));
  const vecName = name.replace(/\.json$/, '.vectors.json');
  let vecNote = '缺少同名向量文件';
  try {
    const vec = JSON.parse(await readFile(join(outDir, vecName), 'utf8'));
    const ids = new Set(Object.keys(vec.vectors ?? {}));
    const missing = pack.entries.filter((entry) => !ids.has(entry.id)).length;
    if (vec.sourceVersion !== pack.version) {
      vecNote = `向量版本 ${vec.sourceVersion} ≠ 包版本 ${pack.version}`;
    } else if (missing > 0 || ids.size !== pack.entries.length) {
      vecNote = `向量与条目不匹配（缺 ${missing} 条，向量 ${ids.size} / 条目 ${pack.entries.length}），需重生成`;
    } else {
      vecNote = `向量已是最新（${pack.version}，${ids.size} 条）`;
    }
  } catch {
    // 没有向量文件时仅提示
  }
  console.log(`${name}: ${pack.cityCode} ${pack.version} ${pack.entries.length} 条 → site；${vecNote}`);
}

console.log('同步完成。若向量版本不一致，运行：node scripts/gen-site-vectors.mjs');
