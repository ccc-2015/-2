import './check-node.mjs';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 把后端全部审核资料包合并成站点产物 packs.json，替代手工复制。
// 向量单独由 gen-site-vectors.mjs 生成；本脚本只报告是否落后。

const dataDir = fileURLToPath(new URL('../backend/app/knowledge/data/', import.meta.url));
const outDir = fileURLToPath(new URL('../../site/functions/knowledge/', import.meta.url));

function stable(value) {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const files = (await readdir(dataDir)).filter((name) => name.endsWith('.json')).sort();
if (files.length === 0) {
  console.error('后端资料目录没有 .json 文件。');
  process.exit(1);
}

const packs = [];
for (const name of files) {
  packs.push(JSON.parse(await readFile(join(dataDir, name), 'utf8')));
}
packs.sort((a, b) => String(a.cityCode).localeCompare(String(b.cityCode)));
const contentDigest = createHash('sha256').update(stable(packs)).digest('hex');
const packDigests = Object.fromEntries(
  packs.map((pack) => [pack.cityCode, createHash('sha256').update(stable(pack)).digest('hex')]),
);
await writeFile(
  join(outDir, 'packs.json'),
  JSON.stringify({ contentDigest, packDigests, generatedAt: new Date().toISOString(), packs }, null, 2),
  'utf8',
);

let vec = null;
try {
  vec = JSON.parse(await readFile(join(outDir, 'vectors.json'), 'utf8'));
} catch {
  // 没有向量文件时仅提示
}
const entries = packs.flatMap((pack) => pack.entries);
const inputDigest = createHash('sha256').update(stable(
  [...entries].sort((a, b) => a.id.localeCompare(b.id)).map((entry) => ({
    id: entry.id,
    input: [entry.title, entry.summary, entry.text, (entry.keywords || []).join(' '), (entry.topics || []).join(' ')]
      .filter((part) => part && String(part).trim()).join('\n'),
  })),
)).digest('hex');
const versionsMatch = stable(vec?.versions) === stable(Object.fromEntries(packs.map((pack) => [pack.cityCode, pack.version])));
const ids = new Set(Object.keys(vec?.vectors ?? {}));
for (const pack of packs) {
  const missing = pack.entries.filter((entry) => !ids.has(entry.id)).length;
  const note = !vec
    ? '缺少向量文件'
    : missing > 0 || ids.size !== packs.reduce((sum, item) => sum + item.entries.length, 0)
      ? `向量与条目不一致（缺 ${missing} 条）`
      : !vec.inputDigest
        ? `向量覆盖 ${ids.size} 条，但缺少输入摘要，无法确认是否对应当前正文`
        : vec.inputDigest !== inputDigest
          ? '向量输入摘要不一致，旧向量不可用'
          : !versionsMatch
            ? '向量版本映射不完整或不一致'
            : `向量输入与版本一致（${ids.size} 条；维度和数值请运行 knowledge:check）`;
  console.log(`${pack.cityCode} ${pack.version} ${pack.entries.length} 条 → packs.json；${note}`);
}

console.log(`资料包摘要：${contentDigest.slice(0, 16)}`);
console.log('同步完成。若向量不一致，运行：npm run knowledge:vectors');