import { useRef, useState } from "react";
import { FileText, Loader2, ArrowLeft, ShieldAlert, Sparkles, Upload, AlertTriangle, Files } from "lucide-react";
import type { ContractResult, ContractIntent, Finding, ExtractResult, ExtractPage } from "@/shared/api";
import { PRIORITY_LABELS } from "@/shared/api";
import { api, ApiError, errorMessage } from "../../lib/api";
import { useConfig } from "../../lib/config-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

type Stage = "input" | "proofread" | "review";

interface ProofreadMeta {
  warnings: string[];
  pageCount: number | null;
  method: "text" | "ocr";
  ocrUsed: boolean;
  pages: ExtractPage[];
}

const PASTE_META: ProofreadMeta = { warnings: [], pageCount: null, method: "text", ocrUsed: false, pages: [] };

const ACCEPT = ".txt,.md,.markdown,.docx,.pdf,.png,.jpg,.jpeg,.webp";

const INTENTS: { id: ContractIntent; label: string }[] = [
  { id: "review", label: "整体审查" },
  { id: "ask", label: "回答问题" },
  { id: "suggest_revision", label: "修改建议" },
  { id: "draft_revision", label: "起草修订" },
];

export function ContractWorkspace() {
  const { config } = useConfig();
  const [stage, setStage] = useState<Stage>("input");
  const [pasted, setPasted] = useState("");
  const [draft, setDraft] = useState("");
  const [sourceName, setSourceName] = useState("粘贴文本");
  const [meta, setMeta] = useState<ProofreadMeta>(PASTE_META);
  const [confirmed, setConfirmed] = useState("");

  const maxText = config?.limits.maxTextLength ?? 50000;

  function goToProofread(text: string, source: string, m: ProofreadMeta) {
    setDraft(text);
    setSourceName(source);
    setMeta(m);
    setStage("proofread");
  }

  function confirmText() {
    setConfirmed(draft);
    setStage("review");
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">合同审查</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          导入合同 → 校对确认 → 对话审查与原文定位。所有识别结果须由你检查确认后才发起分析。
        </p>
        <Stepper stage={stage} />
      </header>

      {stage === "input" && (
        <InputStage
          pasted={pasted}
          setPasted={setPasted}
          maxText={maxText}
          onContinue={() => goToProofread(pasted, "粘贴文本", PASTE_META)}
          onExtracted={(r: ExtractResult) =>
            goToProofread(r.text, r.sourceName, {
              warnings: r.warnings,
              pageCount: r.pageCount,
              method: r.method,
              ocrUsed: r.ocrUsed,
              pages: r.pages,
            })
          }
        />
      )}

      {stage === "proofread" && (
        <ProofreadStage
          draft={draft}
          setDraft={setDraft}
          sourceName={sourceName}
          meta={meta}
          maxText={maxText}
          onBack={() => setStage("input")}
          onConfirm={confirmText}
        />
      )}

      {stage === "review" && (
        <ReviewStage
          text={confirmed}
          onReinput={() => {
            setDraft(confirmed);
            setStage("proofread");
          }}
        />
      )}
    </div>
  );
}

function Stepper({ stage }: { stage: Stage }) {
  const steps = ["导入", "校对确认", "审查"];
  const index = stage === "input" ? 0 : stage === "proofread" ? 1 : 2;
  return (
    <ol className="mt-4 flex items-center gap-2 text-xs">
      {steps.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
              i === index ? "bg-primary text-primary-foreground" : i < index ? "bg-secondary text-foreground" : "bg-secondary text-muted-foreground",
            )}
          >
            <span className="tabular-nums">{i + 1}</span>
            {label}
          </span>
          {i < steps.length - 1 && <span className="text-muted-foreground">→</span>}
        </li>
      ))}
    </ol>
  );
}

function InputStage({
  pasted,
  setPasted,
  maxText,
  onContinue,
  onExtracted,
}: {
  pasted: string;
  setPasted: (v: string) => void;
  maxText: number;
  onContinue: () => void;
  onExtracted: (r: ExtractResult) => void;
}) {
  const { config } = useConfig();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<ApiError | null>(null);

  const limits = config?.limits;
  const maxFileMB = limits ? Math.round(limits.maxFileBytes / (1024 * 1024)) : 10;
  const maxPdfPages = limits?.maxPdfPages ?? 50;
  const over = pasted.length > maxText;

  async function handleFile(file: File) {
    setUploadError(null);
    if (limits && file.size > limits.maxFileBytes) {
      setUploadError(new ApiError("payload_too_large", `文件超过 ${maxFileMB}MB 限制，请缩小材料或选择片段，也可直接粘贴文本。`, false));
      return;
    }
    setUploading(true);
    try {
      const { data } = await api.extract(file);
      onExtracted(data);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err : new ApiError("internal_error", errorMessage(err), false));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && !uploading) void handleFile(file);
  }

  return (
    <section className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Files className="size-4 text-primary" />
          导入合同文件
        </div>
        <div
          role="button"
          tabIndex={0}
          aria-label="选择或拖拽合同文件"
          onClick={() => !uploading && fileRef.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !uploading) {
              e.preventDefault();
              fileRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!uploading) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-8 text-center transition-colors",
            dragOver ? "border-primary bg-secondary" : "border-input hover:border-primary/50 hover:bg-secondary/50",
            uploading && "pointer-events-none opacity-60",
          )}
        >
          {uploading ? (
            <>
              <Loader2 className="size-6 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">正在本机提取文本 / OCR 识别…</span>
            </>
          ) : (
            <>
              <Upload className="size-6 text-muted-foreground" />
              <span className="text-sm font-medium">点击选择或拖拽文件到此处</span>
              <span className="text-xs text-muted-foreground">
                支持 TXT / MD / DOCX / PDF / 图片（PNG·JPG·WEBP）；单文件 ≤ {maxFileMB}MB，PDF ≤ {maxPdfPages} 页
              </span>
            </>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          文件仅提交到本机后端临时解析，不自动持久化；扫描 PDF 与图片用本地 OCR 识别。提取后须由你校对确认才会分析。
        </p>
        {uploadError && (
          <Alert variant="destructive" className="mt-3">
            <AlertTriangle className="size-4" />
            <AlertTitle>导入未完成</AlertTitle>
            <AlertDescription>
              {uploadError.message}
              {uploadError.retryable && " 你可以稍后手动重试。"}
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <FileText className="size-4 text-primary" />
          或粘贴合同文本
        </div>
        <Textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="将合同全文粘贴到此处…"
          className="min-h-48 font-mono text-sm"
          aria-label="合同文本"
        />
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span className={cn(over && "text-destructive")}>
            {pasted.length} / {maxText} 字符{over && "（超出限制，请缩小或选择片段）"}
          </span>
          <Button size="sm" disabled={!pasted.trim() || over} onClick={onContinue}>
            继续校对
          </Button>
        </div>
      </div>

      <Alert>
        <ShieldAlert className="size-4" />
        <AlertTitle>隐私提示</AlertTitle>
        <AlertDescription>
          合同全文、对话与模型结果默认不自动持久化。点击分析即表示你将所确认的文本提交给模型服务；未经核实不承诺零留存。
        </AlertDescription>
      </Alert>
    </section>
  );
}

function ProofreadStage({
  draft,
  setDraft,
  sourceName,
  meta,
  maxText,
  onBack,
  onConfirm,
}: {
  draft: string;
  setDraft: (v: string) => void;
  sourceName: string;
  meta: ProofreadMeta;
  maxText: number;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const over = draft.length > maxText;
  const empty = !draft.trim();
  const ocrPages = meta.pages.filter((p) => p.method === "ocr").length;
  return (
    <section className="space-y-4">
      {meta.warnings.length > 0 && (
        <Alert className="border-amber-500/50 bg-amber-500/10">
          <AlertTriangle className="size-4 text-amber-600" />
          <AlertTitle>识别提示（请校对）</AlertTitle>
          <AlertDescription>
            <ul className="list-inside list-disc space-y-0.5">
              {meta.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="rounded-lg border bg-card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <FileText className="size-4 text-primary" />
            校对文本
            <Badge variant="secondary">{sourceName}</Badge>
            <Badge variant="outline">{meta.method === "ocr" ? "OCR 识别" : "文本提取"}</Badge>
            {meta.pageCount != null && (
              <Badge variant="outline">
                共 {meta.pageCount} 页{ocrPages > 0 && ` · ${ocrPages} 页 OCR`}
              </Badge>
            )}
          </div>
          <span className={cn("text-xs text-muted-foreground", over && "text-destructive")}>
            {draft.length} / {maxText} 字符
          </span>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          请检查并修正识别错误（尤其是 OCR 错字、漏字与数字）。确认前不会发起任何分析请求。
        </p>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-h-72 font-mono text-sm"
          aria-label="校对合同文本"
        />
        {over && (
          <p className="mt-2 text-xs text-destructive">文本超过限制，请缩小材料或选择片段，系统不会静默截断。</p>
        )}

        {meta.pages.length > 0 && (
          <details className="mt-3 rounded-md border bg-secondary/40 p-2 text-xs">
            <summary className="cursor-pointer font-medium text-muted-foreground">按页查看提取结果（{meta.pages.length} 页）</summary>
            <div className="mt-2 space-y-2">
              {meta.pages.map((p) => (
                <div key={p.page} className="rounded border bg-card p-2">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant="secondary">第 {p.page} 页</Badge>
                    <span className="text-muted-foreground">{p.method === "ocr" ? "OCR" : "文本层"} · {p.text.length} 字符</span>
                  </div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{p.text || "（本页未提取到文本）"}</pre>
                </div>
              ))}
            </div>
          </details>
        )}

        <div className="mt-3 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="size-4" />
            返回输入
          </Button>
          <Button size="sm" disabled={empty || over} onClick={onConfirm}>
            确认文本并进入审查
          </Button>
        </div>
      </div>
    </section>
  );
}

function ReviewStage({ text, onReinput }: { text: string; onReinput: () => void }) {
  const { config } = useConfig();
  const [cityCode, setCityCode] = useState("CN");
  const [eventDate, setEventDate] = useState("");
  const [question, setQuestion] = useState("");
  const [intent, setIntent] = useState<ContractIntent>("review");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ContractResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [showText, setShowText] = useState(false);

  const aiAvailable = config?.aiAvailable ?? false;

  async function analyze() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.analyzeContract({
        text,
        textScope: "full",
        question,
        conversation: [],
        intent,
        cityCode,
        eventDate: eventDate || null,
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError("internal_error", errorMessage(err), false));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Badge variant="outline" className="border-primary/40 text-primary">已确认</Badge>
            <span className="text-muted-foreground">{text.length} 字符</span>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowText((v) => !v)}>
              {showText ? "收起原文" : "查看原文"}
            </Button>
            <Button variant="ghost" size="sm" onClick={onReinput}>重新校对</Button>
          </div>
        </div>
        {showText && (
          <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-secondary p-3 font-mono text-xs leading-relaxed">
            {text}
          </pre>
        )}
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="city">城市（仅一般建议，本地渠道待核实）</Label>
            <select
              id="city"
              value={cityCode}
              onChange={(e) => setCityCode(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {(config?.cities ?? [{ code: "CN", name: "不限 / 全国一般建议" }]).map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="date">签约 / 拟签约日期（可选）</Label>
            <Input id="date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          </div>
        </div>

        <div className="mt-4 space-y-1.5">
          <Label>分析意图</Label>
          <div className="flex flex-wrap gap-2">
            {INTENTS.map((it) => (
              <Button
                key={it.id}
                type="button"
                size="sm"
                variant={intent === it.id ? "default" : "outline"}
                onClick={() => setIntent(it.id)}
              >
                {it.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-1.5">
          <Label htmlFor="question">你的问题（可选）</Label>
          <Textarea
            id="question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="例如：押金条款是否对我不利？提前退租要注意什么？"
            className="min-h-20"
          />
        </div>

        {!aiAvailable && (
          <Alert className="mt-4">
            <ShieldAlert className="size-4" />
            <AlertDescription>
              服务端尚未配置模型密钥，分析暂不可用。配置 backend/.env 中的 MODEL_API_KEY 与 MODEL_NAME 后重启后端即可。
            </AlertDescription>
          </Alert>
        )}

        <div className="mt-4 flex justify-end">
          <Button onClick={analyze} disabled={loading || !aiAvailable}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {loading ? "分析中…" : "发起分析"}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <ShieldAlert className="size-4" />
          <AlertTitle>分析未完成</AlertTitle>
          <AlertDescription>
            {error.message}
            {error.retryable && " 你可以保留输入，稍后手动重试。"}
          </AlertDescription>
        </Alert>
      )}

      {result && <ResultView result={result} />}
    </section>
  );
}

function ResultView({ result }: { result: ContractResult }) {
  return (
    <div className="space-y-4">
      <Alert>
        <Sparkles className="size-4" />
        <AlertTitle>AI 辅助意见</AlertTitle>
        <AlertDescription>
          一期无自有审核知识库，以下为模型辅助意见，不构成确定性法律结论。
          {result.coverage !== "supported" && " 覆盖有限，请结合实际情况核实。"}
        </AlertDescription>
      </Alert>

      {result.answer && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold">回答</h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{result.answer}</p>
        </div>
      )}

      {result.findings.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">风险提示（按审查优先级）</h3>
          {result.findings.map((f, i) => (
            <FindingCard key={i} finding={f} />
          ))}
        </div>
      )}

      {result.followUpQuestions.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold">可继续追问</h3>
          <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
            {result.followUpQuestions.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const tone =
    finding.priority === "confirm_first"
      ? "border-l-amber-500"
      : finding.priority === "needs_attention"
        ? "border-l-primary"
        : "border-l-muted-foreground";
  return (
    <div className={cn("rounded-md border border-l-4 bg-card p-3", tone)}>
      <div className="mb-1 flex items-center gap-2">
        <Badge variant="secondary">{PRIORITY_LABELS[finding.priority]}</Badge>
        <span className="text-sm font-medium">{finding.issue}</span>
      </div>
      {finding.impact && <p className="text-sm text-muted-foreground">{finding.impact}</p>}
      {finding.excerpt && (
        <blockquote className="mt-2 border-l-2 border-primary/40 bg-secondary/60 px-3 py-1.5 font-mono text-xs">
          “{finding.excerpt.text}”
        </blockquote>
      )}
      {finding.suggestedQuestion && (
        <p className="mt-2 text-xs text-muted-foreground">建议确认：{finding.suggestedQuestion}</p>
      )}
    </div>
  );
}