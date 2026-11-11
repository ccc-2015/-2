import './check-node.mjs';
import { readFile, writeFile } from 'node:fs/promises';

// 预生成站点知识库向量：复用 backend/.env 的远程 embedding（与云函数查询时同模型同维度）。
// 密钥只从 .env 读取，绝不打印、绝不写入产物。产物 zz.vectors.json 仅含公开法条的向量。

const envUrl = new URL('../backend/.env', import.meta.url);
const packUrl = new URL('../../site/functions/knowledge/zz.json', import.meta.url);
const outUrl = new URL('../../site/functions/knowledge/zz.vectors.json', import.meta.url);

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = parseEnv(await readFile(envUrl, 'utf8'));
const baseUrl = (env.EMBEDDING_API_BASE_URL || '').replace(/\/+$/, '');
const apiKey = env.EMBEDDING_API_KEY || '';
const model = env.EMBEDDING_MODEL_NAME || '';
const dim = Number(env.EMBEDDING_DIM || '0');
const batch = Math.max(1, Number(env.EMBEDDING_BATCH_SIZE || '16'));
const timeoutMs = Math.min(30000, Math.max(1000, Number(env.EMBEDDING_TIMEOUT_MS || '15000')));

if (!baseUrl || !apiKey || !model || !dim) {
  console.error('远程 embedding 未配置齐全：需要 EMBEDDING_API_BASE_URL / EMBEDDING_API_KEY / EMBEDDING_MODEL_NAME / EMBEDDING_DIM。');
  console.error('请在 backend/.env 配置远程向量模型后重试（云函数无法跑本地 fastembed）。');
  process.exit(1);
}
const endpoint = baseUrl.endsWith('/embeddings') ? baseUrl : `${baseUrl}/embeddings`;

const pack = JSON.parse(await readFile(packUrl, 'utf8'));
const entries = pack.entries;

// 与后端 postgres.py::_embed_text 完全一致：标题+摘要+正文+关键词+主题。
function embedText(entry) {
  return [entry.title, entry.summary, entry.text, (entry.keywords || []).join(' '), (entry.topics || []).join(' ')]
    .filter((part) => part && String(part).trim())
    .join('\n');
}

async function embedBatch(texts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: texts }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`向量服务返回 ${res.status}`);
    const body = await res.json();
    const rows = body.data;
    if (!Array.isArray(rows) || rows.length !== texts.length) throw new Error('向量服务返回结构无效');
    const ordered = [...rows].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return ordered.map((row) => row.embedding.map(Number));
  } finally {
    clearTimeout(timer);
  }
}

console.log(`模型 ${model} · 维度 ${dim} · 资料 ${entries.length} 条 · 批大小 ${batch}`);
const vectors = {};
for (let start = 0; start < entries.length; start += batch) {
  const slice = entries.slice(start, start + batch);
  const result = await embedBatch(slice.map(embedText));
  slice.forEach((entry, i) => {
    const vector = result[i];
    if (!Array.isArray(vector) || vector.length !== dim) {
      throw new Error(`维度不匹配：${entry.id} 返回 ${vector?.length}，配置 ${dim}`);
    }
    vectors[entry.id] = vector.map((v) => Number(v.toFixed(8)));
  });
  console.log(`  已生成 ${Math.min(start + batch, entries.length)}/${entries.length}`);
}

const output = { model, dim, generatedAt: new Date().toISOString(), sourceVersion: pack.version, vectors };
await writeFile(outUrl, JSON.stringify(output), 'utf8');
const bytes = (await readFile(outUrl)).length;
console.log(`完成：site/functions/knowledge/zz.vectors.json（${(bytes / 1024).toFixed(0)} KB，${Object.keys(vectors).length} 条向量）`);