import './check-node.mjs';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 构建前检查：后端审核 JSON 是权威源，站点 packs.json / vectors.json 是派生产物。
// 只报告缺失、版本不一致与「正文已变但向量未重算」，不自动调用付费 embedding。

const dataDir = fileURLToPath(new URL('../backend/app/knowledge/data/', import.meta.url));
const siteDir = fileURLToPath(new URL('../../site/functions/knowledge/', import.meta.url));
const CONTRACT_TOPICS = new Set([
  'contract', 'rent', 'repair', 'wear', 'return', 'termination', 'renewal',
  'priority', 'deposit', 'alteration', 'restoration', 'safety', 'sublease',
  'rent_increase', 'brokerage', 'filing', 'transfer', 'identity',
]);

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

function digest(value) {
  return createHash('sha256').update(stable(value)).digest('hex');
}

// 必须与 gen-site-vectors.mjs 的 embedText 一致，否则摘要比较没有意义。
function embedText(entry) {
  return [entry.title, entry.summary, entry.text, (entry.keywords || []).join(' '), (entry.topics || []).join(' ')]
    .filter((part) => part && String(part).trim())
    .join('\n');
}

const files = (await readdir(dataDir)).filter((name) => name.endsWith('.json')).sort();
const packs = [];
for (const name of files) {
  packs.push(JSON.parse(await readFile(join(dataDir, name), 'utf8')));
}
packs.sort((a, b) => String(a.cityCode).localeCompare(String(b.cityCode)));

const errors = [];
const packRows = [];
const docTypes = {};
const appliesTo = {};
for (const pack of packs) {
  const contractCount = pack.entries.filter((entry) => (entry.topics || []).some((topic) => CONTRACT_TOPICS.has(topic))).length;
  packRows.push(`${pack.cityCode} ${pack.version} ${pack.entries.length} 条（合同主题 ${contractCount} 条）`);
  for (const entry of pack.entries) {
    if (!entry.docType) errors.push(`${entry.id} 缺少 docType`);
    if (!entry.appliesTo) errors.push(`${entry.id} 缺少 appliesTo`);
    docTypes[entry.docType] = (docTypes[entry.docType] || 0) + 1;
    appliesTo[entry.appliesTo] = (appliesTo[entry.appliesTo] || 0) + 1;
  }
}

let bundle = null;
try {
  bundle = JSON.parse(await readFile(join(siteDir, 'packs.json'), 'utf8'));
} catch {
  errors.push('缺少 site/functions/knowledge/packs.json，请运行 npm run knowledge:sync');
}

if (bundle) {
  const bundled = Array.isArray(bundle.packs) ? [...bundle.packs] : [];
  const dataDigest = digest(packs);
  if (digest(bundled) !== dataDigest) {
    errors.push('packs.json 与后端审核资料不一致（版本、条目或正文已变化），请运行 npm run knowledge:sync');
  } else if (bundle.contentDigest !== dataDigest) {
    errors.push('packs.json 内的 contentDigest 与资料内容不一致，请重新运行 npm run knowledge:sync');
  }
  for (const pack of packs) {
    const found = bundled.find((item) => item.cityCode === pack.cityCode);
    if (!found) {
      errors.push(`packs.json 缺少 ${pack.cityCode} 资料包`);
    } else if (found.version !== pack.version) {
      errors.push(`packs.json 中 ${pack.cityCode} 版本为 ${found.version}，后端为 ${pack.version}`);
    }
    const recorded = bundle.packDigests?.[pack.cityCode];
    if (recorded !== digest(pack)) {
      errors.push(`packs.json 中 ${pack.cityCode} 的资料摘要与正文不一致，请重新运行 npm run knowledge:sync`);
    }
  }
}

const entries = packs.flatMap((pack) => pack.entries || []);
let vectors = null;
try {
  vectors = JSON.parse(await readFile(join(siteDir, 'vectors.json'), 'utf8'));
} catch {
  errors.push('缺少 site/functions/knowledge/vectors.json，请运行 npm run knowledge:vectors');
}

if (vectors) {
  const stored = vectors.vectors || {};
  const storedIds = new Set(Object.keys(stored));
  const dataIds = new Set(entries.map((entry) => entry.id));
  const missing = entries.filter((entry) => !storedIds.has(entry.id)).map((entry) => entry.id);
  const extra = [...storedIds].filter((id) => !dataIds.has(id));
  if (typeof vectors.model !== 'string' || !vectors.model.trim() || !Number.isInteger(vectors.dim) || vectors.dim <= 0) {
    errors.push('vectors.json 缺少有效 model 或 dim，无法确认向量模型与查询一致');
  }
  for (const [id, vector] of Object.entries(stored)) {
    if (!Array.isArray(vector) || vector.length !== vectors.dim
      || !vector.every((value) => typeof value === 'number' && Number.isFinite(value))
      || !vector.some((value) => value !== 0)) {
      errors.push(`vectors.json 中 ${id} 的向量长度、数值或范数无效`);
    }
  }
  if (missing.length > 0) {
    errors.push(`vectors.json 缺少 ${missing.length} 条向量：${missing.slice(0, 8).join('、')}${missing.length > 8 ? '…' : ''}`);
  }
  if (extra.length > 0) {
    errors.push(`vectors.json 含 ${extra.length} 条已不存在的条目：${extra.slice(0, 8).join('、')}${extra.length > 8 ? '…' : ''}`);
  }
  for (const pack of packs) {
    if (!Object.hasOwn(vectors.versions || {}, pack.cityCode)) {
      errors.push(`vectors.json 缺少 ${pack.cityCode} 的版本映射`);
    }
  }
  for (const [cityCode, version] of Object.entries(vectors.versions || {})) {
    const pack = packs.find((item) => item.cityCode === cityCode);
    if (!pack) errors.push(`vectors.json 记录了不存在的城市版本：${cityCode}`);
    else if (pack.version !== version) {
      errors.push(`vectors.json 中 ${cityCode} 版本为 ${version}，后端为 ${pack.version}`);
    }
  }
  const ordered = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const inputDigest = digest(ordered.map((entry) => ({ id: entry.id, input: embedText(entry) })));
  if (!vectors.inputDigest) {
    errors.push('vectors.json 缺少 inputDigest：不能确认向量对应当前输入，禁止将旧向量视为有效。');
  } else if (vectors.inputDigest !== inputDigest) {
    errors.push('向量输入摘要已变化（正文、摘要、关键词或主题有改动），请运行 npm run knowledge:vectors 重算；不要继续使用旧向量发布。');
  }
}

console.log('资料包：');
for (const row of packRows) console.log(`  ${row}`);
console.log(`资料类型：${JSON.stringify(docTypes)}；适用主体：${JSON.stringify(appliesTo)}`);
if (vectors) {
  console.log(`向量：${vectors.model} · ${vectors.dim} 维 · ${Object.keys(vectors.vectors || {}).length} 条`);
}
if (errors.length === 0) {
  console.log('检查通过：站点资料包与后端审核资料一致，向量覆盖完整。');
} else {
  console.error('检查失败：');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}