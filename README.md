# 租住有据

面向首次租房的毕业生与青年上班族的合同审查、证据整理与争议辅助工具。提供信息辅助，不替代专业法律意见，不承诺处理结果，不代用户提交。

> 实现以《开发基线.md》为产品行为基线（统一响应 envelope、引文闭合校验、错误语义、上传/粘贴即审查、OCR 文本可编辑后重新审查、隐私边界）。技术栈按项目环调整为 React + FastAPI 前后端分离。

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
copy .env.example .env   # 填写 MODEL_API_KEY / MODEL_NAME / MODEL_API_BASE_URL（可选 MODEL_REASONING_EFFORT）
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
| POST | `/api/extract` | 文件文本提取 / OCR（TXT·MD·DOCX·PDF·图片，本机处理， multipart 上传） |
| GET | `/api/sources` | 二期知识库来源查询（一期仅郑州试点；其他城市返回空） |

成功返回 `{ ok: true, data, meta }`；失败返回 `{ ok: false, requestId, error: { code, message, retryable } }`。
引文必须满足 `text.slice(start, end) === excerpt.text`（UTF-16 下标），服务端闭合校验，虚构引文丢弃。

## 隐私与安全

- 模型密钥仅服务端持有；正文、证据、提示词、密钥不写入 URL、日志或前端。
- 合同全文、对话与模型结果默认不自动持久化；证据画布保存在用户设备本地。
- 用户文本与文件视为不可信输入；合同内的指令不改变系统提示或输出规则。
- 失败不自动重发付费请求；生产错误只显示稳定信息与请求标识。

## 里程碑

1. ✅ 项目骨架：React 前端 + FastAPI 后端、配置/合同/争议路由、模型适配器、引文校验、合同审查工作区。
2. ✅ 文件输入与提取 / OCR + 自动审查：TXT/MD/DOCX/PDF/图片本机提取，扫描 PDF 与图片本地 OCR，服务端强制大小/页数/文本限制，损坏/加密/空白/超限明确状态；上传/粘贴后自动审查，OCR 文本可在合同抽屉编辑并重新审查。
3. ✅ 合同审查对话、引用定位与错误状态：多轮会话保留上下文，引文点击精确高亮定位，虚构引文不展示定位，追问快捷填入，失败保留输入并手动重试（不自动重发）。
4. ✅ 风险提示展示 + 修订副本：findings 按优先级展示并可定位原文；修订建议逐条/批量应用到独立可编辑副本，原文只读不变；支持放弃修改、复制副本（失败降级提示）、对副本重新审查并对比修改前后发现数。
5. ✅ 证据画布：按阶段分组的时间轴列表（签约/入住/居住中/退租/争议处理），每条记录单行展示、点击展开详情与操作；独立「水电与费用」区（账单/已付/差额，未知不当作零、不定性违法）；顶部一行摘要（时间跨度、材料状态、水电待核对）与阶段胶囊筛选；记录可附图片材料（本机压缩、缩略图与大图预览、容量拦截）；选中证据后底部浮动条直达争议处理；事件时间与录入时间分开；localStorage 跨会话保存、逐条删除与清空；本机保存隐私说明。
6. ✅ 争议处理：一般方向 + 所选话术 + 结果状态：填写争议与必要事实（未知可留空），从证据画布带入所选记录；先整理事实、提示关键缺项并给出优先方向与少量待核实项；选定方向后才生成话术，可编辑/复制/补全待补项；记录处理状态；服务端强制一般方向、丢弃虚构渠道、未知金额不当作零。
7. ✅ 浏览器端到端验收（桌面 + 窄屏）：窄屏 718px 实测三视图单栏/移动导航、无横向溢出；桌面 1280px 实测侧栏导航、表单两列、争议双栏、无溢出；键盘操作（文件区 Enter/Space 打开选择、Ctrl/⌘+Enter 发送）；隐私边界（正文走 POST 不进 URL、模型密钥仅服务端、前端无敏感日志）；后端提取/引文/争议单测全通过。
8. ✅ 合同审查改为单页聊天 agent：上传/粘贴即审查、地区合同/争议共用、修订状态按消息持久化；390px 窄屏回归通过。
9. ✅ 二期知识库第一步：郑州试点资料包、关键词检索、合同回答「依据」折叠区与 knowledgeVersion；非郑州返回空来源并降级。