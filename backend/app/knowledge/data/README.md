# 知识库资料包

一期只开放郑州，资料放在 `zz.json`。后续上传资料时直接替换该文件，然后运行校验脚本并重启后端。

## 上传步骤

1. 按下面的结构编辑 `zz.json`，不要把未审核资料标成 `approved`。
2. 运行校验：

```sh
cd backend
./.venv/Scripts/python.exe -m app.knowledge.validate app/knowledge/data/zz.json
```

3. 校验通过后重启后端；`/api/config` 的 `knowledgeBase` 会随已审核条目自动变化。
4. 在郑州地区发起合同审查，回答下会出现「依据」折叠区；其他城市仍返回空来源。

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

## 字段约束

- `reviewStatus`：`draft` 不入检索；`source_verified` / `approved` 才会被使用。当前检索只取 `approved`。
- `url`：`approved` 资料必须有官方地址；校验脚本会检查。
- `effectiveFrom` / `effectiveTo`：`YYYY-MM-DD`；`effectiveTo` 为空表示仍有效。
- `topics`：用于场景过滤；合同审查常用 `contract`、`rent`、`repair`、`wear`、`return`、`termination`、`deposit`；争议渠道条目请使用 `channel`、`dispute`。
- `keywords`：中文关键词，用于关键词检索；至少一个。
- `coverage` / `topicCoverage`：`supported` / `limited` / `unsupported`；未配置场景时回退到资料包整体 `coverage`。
- 条目 `cityCode` 必须等于资料包城市，或为 `CN`（全国性资料）；一期只把资料放入郑州包，其他城市不会读到。
- 同一资料包内 `id` 必须唯一；跨文件也不能重复。

## 当前种子

`zz.json` 目前是 10 条全国性条文种子（仅对郑州开放），用于验证骨架。郑州本地法规、政策和渠道资料尚未入库，因此 `contract_review` 仍是 `limited`，`dispute` 为 `unsupported`。替换为正式审核资料时，请同步更新 `version`、`checkedAt`、`coverage` 和每条资料的 `limitations`。
