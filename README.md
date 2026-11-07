# 租住有据

面向首次租房的毕业生与青年上班族的合同审查、证据整理与争议辅助工具。提供信息辅助，不替代专业法律意见，不承诺处理结果，不代用户提交。

> 实现以《开发基线.md》为产品行为基线（统一响应 envelope、引文闭合校验、错误语义、用户校对确认、隐私边界）。技术栈按项目环调整为 React + FastAPI 前后端分离。

## 技术栈

- **前端**：React 19 + TypeScript + Vite + Tailwind CSS 4 + shadcn 组件目录。
- **后端**：Python 3.10+ + FastAPI + Pydantic v2，httpx 调用单一 OpenAI 兼容模型 API。
- **文档解析**：PyMuPDF（PDF 文本层）、python-docx（DOCX）、RapidOCR（扫描 PDF / 图片 OCR，本机处理）。

## 目录结构

```
├── src/                  # 前端应用（features/contract、evidence、dispute）
├── components/ui/        # shadcn 组件目录（@/components/ui/*）
├── shared/api.ts         # 前后端共享的 API 契约类型
├── backend/
│   ├── app/
│   │   ├── main.py       # FastAPI 入口
│   │   ├── config.py     # 设置、输入限制、城市
│   │   ├── schemas.py    # Pydantic 模型
│   │   ├── responses.py  # 统一 envelope 与错误处理
│   │   ├── model.py      # OpenAI 兼容模型客户端（密钥仅服务端）
│   │   ├── validation.py # 输入限制 + 引文闭合校验（UTF-16）
│   │   ├── prompts.py    # 系统提示词
│   │   ├── routers/      # config / contract / dispute / extract
│   │   └── services/     # 合同 / 争议 / 提取业务逻辑
│   ├── requirements.txt
│   └── .env.example
└── 开发文档/             # 产品基线与设计说明（不纳入版本控制）
```

## 本地运行

### 后端

```sh
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate ；macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env   # 填写 MODEL_API_KEY / MODEL_NAME / MODEL_API_BASE_URL
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

未配置模型密钥时，分析类接口返回 `503 service_not_configured`，配置读取与校验仍可用。

### 前端

```sh
npm ci
npm run dev              # 默认 http://127.0.0.1:5173，/api 代理到后端 8000
npm run build            # 类型检查 + 静态构建到 dist/
```

## API（清晰 REST 路由，统一 envelope）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/config` | 版本、城市、功能开关、输入限制、模型可用状态 |
| POST | `/api/contract/analyze` | 合同问答 / 审查 / 修改建议 / 起草修订 |
| POST | `/api/dispute/diagnose` | 争议事实整理、一般方向候选、所选方向话术 |
| POST | `/api/extract` | 文件文本提取 / OCR（后续里程碑） |

成功返回 `{ ok: true, data, meta }`；失败返回 `{ ok: false, requestId, error: { code, message, retryable } }`。
引文必须满足 `text.slice(start, end) === excerpt.text`（UTF-16 下标），服务端闭合校验，虚构引文丢弃。

## 隐私与安全

- 模型密钥仅服务端持有；正文、证据、提示词、密钥不写入 URL、日志或前端。
- 合同全文、对话与模型结果默认不自动持久化；证据画布保存在用户设备本地。
- 用户文本与文件视为不可信输入；合同内的指令不改变系统提示或输出规则。
- 失败不自动重发付费请求；生产错误只显示稳定信息与请求标识。

## 里程碑

1. ✅ 项目骨架：React 前端 + FastAPI 后端、配置/合同/争议路由、模型适配器、引文校验、合同审查工作区。
2. ⏳ 文件输入与提取 / OCR + 用户校对。
3. ⏳ 合同审查对话、引用定位与错误状态完善。
4. ⏳ 风险提示展示 + 修订副本（逐条/批量应用 + 复查）。
5. ⏳ 证据画布：时间线 + 本地保存/删除 + 水电对照。
6. ⏳ 争议处理：一般方向 + 所选话术 + 结果状态。
7. ⏳ 浏览器端到端验收（桌面 + 窄屏）。