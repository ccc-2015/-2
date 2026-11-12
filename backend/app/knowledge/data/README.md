# 知识库资料包

一期只开放郑州，资料放在 `zz.json`。JSON 是审核与版本发布的权威源；PostgreSQL 16 + pgvector 是检索索引。后续上传资料时替换该文件，校验后 ingest 到 PG。

## 上传步骤

1. 启动 PostgreSQL（仓库根目录）：

```sh
docker compose up -d
```

2. 按下面的结构编辑 `zz.json`，不要把未审核资料标成 `approved`。
3. 运行校验：

```sh
cd backend
./.venv/Scripts/python.exe -m app.knowledge.validate app/knowledge/data/zz.json
```

4. 校验通过后同步到 PG 并生成 embedding：

```sh
./.venv/Scripts/python.exe -m app.knowledge.ingest app/knowledge/data/zz.json
```

5. 接口直接读 PG，通常无需重启；只有改表结构或 embedding 模型/维度时才重启后端。
6. 在郑州地区发起合同审查，回答下会出现「依据」折叠区；其他城市仍返回空来源。

`/api/config` 的 `knowledgeBase` 会随 PG 中已审核条目自动变化。embedding 首次下载约百 MB，可用 `HF_ENDPOINT` 指定镜像。

## 资料包结构

```json
{
  "cityCode": "ZZ",
  "cityName": "郑州",
  "version": "zz-2026.11.08.1",
  "coverage": "limited",
  "topicCoverage": {
    "contract_review": "limited",
    "dispute": "unsupported"
  },
  "checkedAt": "2026-11-08",
  "entries": [
    {
      "id": "zz-rent-001",
      "title": "资料标题",
      "publisher": "发布机关",
      "url": "https://官方地址",
      "scope": "city",
      "cityCode": "ZZ",
      "effectiveFrom": "2025-01-01",
      "effectiveTo": null,
      "version": "2025-01-01",
      "checkedAt": "2026-11-08",
      "reviewStatus": "approved",
      "topics": ["rent", "deposit"],
      "keywords": ["押金", "退还", "扣款"],
      "text": "资料原文或可核验的条文片段",
      "summary": "通俗说明（可选）",
      "limitations": "适用限制与不构成法律意见的说明"
    }
  ]
}
```

## 渠道条目

渠道资料在普通条目上增加 `channel` 对象。只有 `reviewStatus: "approved"` 且有官方 `url` 的资料才能标 `local_verified`；服务端以这里的 `eligibility` 为准，模型不能自行提升资格。

```json
{
  "id": "zz-12345",
  "title": "郑州市 12345 政务服务便民热线",
  "publisher": "郑州市人民政府",
  "url": "https://官方地址",
  "scope": "city",
  "cityCode": "ZZ",
  "effectiveFrom": "2025-01-01",
  "effectiveTo": null,
  "version": "2025-01-01",
  "checkedAt": "2026-11-08",
  "reviewStatus": "approved",
  "topics": ["channel", "dispute"],
  "keywords": ["12345", "投诉", "咨询", "押金"],
  "text": "渠道职责与受理范围的官方原文",
  "limitations": "按当地公开受理条件；不承诺受理结果。",
  "channel": {
    "id": "zz_12345",
    "title": "郑州市 12345 政务服务便民热线",
    "eligibility": "local_verified",
    "responsibilities": ["受理咨询、投诉、建议等非紧急诉求"],
    "conditions": ["按当地公开受理条件"],
    "materials": ["合同", "付款凭证", "沟通记录"]
  }
}
```

- `channel.id` 在同一资料包内必须唯一；`channel.title` 用于界面展示。
- `local_verified` 只能来自 approved 且有官方 url 的资料；否则校验失败。
- `topics` 必须包含 `channel` 或 `dispute`，否则不会进入争议检索。
- 没有 `channel` 的条目仍可作为争议的法律依据来源，但不会新增渠道目录。

## 字段约束

- `reviewStatus`：`draft` 不入检索；`source_verified` / `approved` 才会被使用。当前检索只取 `approved`。
- `url`：`approved` 资料必须有官方地址；校验脚本会检查。
- `effectiveFrom` / `effectiveTo`：`YYYY-MM-DD`；`effectiveTo` 为空表示仍有效。
- `topics`：用于场景过滤；合同审查常用 `contract`、`rent`、`repair`、`wear`、`return`、`termination`、`renewal`、`priority`、`deposit`、`alteration`、`restoration`、`safety`、`sublease`、`rent_increase`、`brokerage`、`filing`、`transfer`、`identity`；争议渠道条目请使用 `channel`、`dispute`。主题词表以后端 `store.py` 的 `SCENARIO_TOPICS` 为准，站点 `site/functions/lib/knowledge.ts` 必须与之逐项一致。
- `keywords`：中文关键词，用于关键词检索；至少一个。
- `coverage` / `topicCoverage`：`supported` / `limited` / `unsupported`；未配置场景时回退到资料包整体 `coverage`。
- 条目 `cityCode` 必须等于资料包城市，或为 `CN`（全国性资料）；一期只把资料放入郑州包，其他城市不会读到。
- 同一资料包内 `id` 必须唯一；跨文件也不能重复。

## 当前资料

资料按城市分包：`cn.json` 收 67 条全国资料（15 条民法典条文 + 52 条全国法规/政策 + 3 条全国渠道）；`zz.json` 收 42 条郑州资料（34 条市域法规/政策/渠道 + 8 条河南省级规章）；`wh.json` 17 条武汉、`hz.json` 17 条杭州（含浙江省规章）。新增城市时只加该城市的 `<city>.json`，不要复制全国条目，否则 `validate` 会因跨文件 id 重复而失败。

城市资料流程：`scripts/fetch_city_sources.py <wh|hz>` 按登记的官方 URL 抓取并生成 `sources/drafts/<city>.json`（`reviewStatus=draft`，不会被后端加载）；人工确认后运行 `scripts/promote_city_draft.py <city>` 转为 `approved` 并写入 `data/<city>.json`。原文快照与 sha256 留在 `sources/raw/<city>/`。

民法典与省级规章由 `sources/` 下的 `civil-code.json`、`provincial-lease.json` 生成，出处分别为最高人民法院官网与河南省人民政府官网，不再从现有资料包继承，资料包可只凭源文件复现。条号切分前会剔除「第X章」章标题，避免下一条被并入；省级条文直接放进城市包并标 `province`，检索时按 `national ∪ province ∪ city` 取用。

资料包来自官方语料整理，转换脚本与标注评测脚本仅本地保留（含抓取数据与用例，不随仓库分发）。

## 三套模型（完全独立）

| 用途 | 变量 | 接口 | 缺失时 |
| --- | --- | --- | --- |
| 文字模型 | `MODEL_NAME` / `MODEL_API_BASE_URL` / `MODEL_API_KEY` | `/chat/completions` | 审查不可用（`aiAvailable=false`） |
| 向量模型 | `EMBEDDING_MODEL_NAME` / `EMBEDDING_API_BASE_URL` / `EMBEDDING_API_KEY` | `/embeddings` | 回退本地 fastembed `MODEL_EMBEDDING_NAME` |
| 精排模型 | `RERANK_MODEL_NAME` / `RERANK_API_BASE_URL` / `RERANK_API_KEY` | `/rerank` | 跳过精排，直接用粗排顺序 |

三者不共用 URL/Key。向量模型三项齐全才走远程，否则用本地；精排三项齐全才启用，任一缺失即关闭。

## 检索链路

1. **粗排**：pgvector 余弦召回（启用精排时取 `RERANK_CANDIDATES` 条，否则只取 `top_k`），再按「向量 0.5 + 关键词 0.5」融合。
2. **精排**：把粗排候选送 `POST {RERANK_API_BASE_URL}/rerank` 重排；失败或超时静默回退，不阻断审查。
3. `RERANK_MIN_SCORE` 过滤低分候选，全部被过滤时回退粗排。

```env
# 向量（远程）
EMBEDDING_MODEL_NAME=bge-m3
EMBEDDING_API_BASE_URL=https://your-embedding-host/v1
EMBEDDING_API_KEY=sk-embed-xxx
EMBEDDING_DIM=1024

# 精排
RERANK_MODEL_NAME=BAAI/bge-reranker-v2-m3
RERANK_API_BASE_URL=https://your-rerank-host/v1
RERANK_API_KEY=sk-rerank-xxx
```

接口返回格式兼容 `{"results":[{"index":0,"relevance_score":0.87}]}` 与 Cohere 的 `data` 字段。

**换向量模型必须重建向量**：`EMBEDDING_DIM` 要与新模型实际输出一致，然后重新 ingest（会覆盖同一城市的条目并重新生成 embedding）。维度不一致时启动/入库会直接报错，不会静默降级。

**维度 > 2000 时自动跳过 HNSW**：pgvector 的 HNSW/IVFFlat 索引最多支持 2000 维，`Qwen3-VL-Embedding-8B`（4096 维）这类模型只能走精确顺序扫描。当前 80 条资料下顺序扫描耗时 < 10ms，规模上千条后再考虑降维或换小维度模型。

**地址可填 base 或完整接口**：`EMBEDDING_API_BASE_URL` / `RERANK_API_BASE_URL` 既可写 `https://host/v1`，也可写完整的 `https://host/v1/embeddings`、`https://host/v1/rerank`，代码会自动识别，不会拼接成重复路径。

改完 `.env` 需重启后端；只有改表结构或维度时才需要重建表。
