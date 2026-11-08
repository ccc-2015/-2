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
- `topics`：用于场景过滤；合同审查常用 `contract`、`rent`、`repair`、`wear`、`return`、`termination`、`deposit`；争议渠道条目请使用 `channel`、`dispute`。
- `keywords`：中文关键词，用于关键词检索；至少一个。
- `coverage` / `topicCoverage`：`supported` / `limited` / `unsupported`；未配置场景时回退到资料包整体 `coverage`。
- 条目 `cityCode` 必须等于资料包城市，或为 `CN`（全国性资料）；一期只把资料放入郑州包，其他城市不会读到。
- 同一资料包内 `id` 必须唯一；跨文件也不能重复。

## 当前资料

`zz.json` 现有 80 条：10 条民法典条文 + 70 条来自郑州/全国官方语料（`法律条例/documents.jsonl`），其中 41 条为郑州本地资料、4 条本地渠道（`local_verified`）。`contract_review` 为 `supported`，`dispute` 为 `limited`。

资料包由脚本生成，不要手改：

```sh
# 仓库根目录
backend/.venv/Scripts/python.exe scripts/build_knowledge_pack.py [documents.jsonl]
cd backend && ./.venv/Scripts/python.exe -m app.knowledge.validate app/knowledge/data/zz.json
./.venv/Scripts/python.exe -m app.knowledge.ingest app/knowledge/data/zz.json
```

`scripts/build_knowledge_pack.py` 只挑与合同、押金、维修、退租、经纪相关的条文；公告、配租名单、处罚程序等不入库。`scripts/eval_retrieval.py` 用 16 条标注 query 比较向量/关键词权重（当前 0.5/0.5，top1 10/16，Recall@4 16/16）。

## 检索链路与精排序（rerank）

1. **粗排**：pgvector 余弦召回 `RERANK_CANDIDATES` 条（未启用精排时只取 `top_k`），再按「向量 0.5 + 关键词 0.5」加权融合。
2. **精排**：若配置了 `RERANK_MODEL_NAME`，把粗排候选送 `POST {RERANK_API_BASE_URL}/rerank` 重排；未配置或调用失败则直接用粗排顺序，不阻断审查。
3. `RERANK_MIN_SCORE` 过滤低分候选，全部被过滤时回退粗排。

```env
RERANK_MODEL_NAME=BAAI/bge-reranker-v2-m3   # 留空即关闭精排
RERANK_API_BASE_URL=                        # 留空复用 MODEL_API_BASE_URL
RERANK_API_KEY=                             # 留空复用 MODEL_API_KEY
RERANK_TIMEOUT_MS=8000
RERANK_CANDIDATES=12
RERANK_MIN_SCORE=0.0
```

接口按 OpenAI 兼容格式返回 `{"results":[{"index":0,"relevance_score":0.87}]}`（也兼容 Cohere 的 `data` 字段）。改完 `.env` 需重启后端。

更新资料时请同步 `version`、`checkedAt`、`coverage`、`topicCoverage` 和每条资料的 `limitations`。
