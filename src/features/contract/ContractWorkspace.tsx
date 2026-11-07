import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, ArrowLeft, ShieldAlert, Upload, AlertTriangle, Files, ArrowUp, RefreshCw, RotateCw, MapPin, Copy, ClipboardCopy, Undo2, Check } from "lucide-react";
import type { ContractResult, ContractIntent, Finding, ExtractResult, ExtractPage, Excerpt, ConversationTurn } from "@/shared/api";
import { PRIORITY_LABELS } from "@/shared/api";
import { api, ApiError, errorMessage } from "../../lib/api";
import { useConfig } from "../../lib/config-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
      <header className="mb-6 border-b border-border/60 pb-5">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">合同审查</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
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
    <ol className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
      {steps.map((label, i) => (
        <li key={label} className="flex items-center gap-1.5">
          <span className={i === index ? "font-medium text-foreground" : undefined}>{label}</span>
          {i < steps.length - 1 && <span aria-hidden="true" className="text-border">/</span>}
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
      <div className="overflow-hidden panel">
        <div className="p-5">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-medium">
            <Files className="size-4 text-muted-foreground" />
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
              "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-10 text-center transition-colors",
              dragOver ? "border-primary/60 bg-primary/[0.04]" : "border-border hover:border-foreground/20 hover:bg-secondary/40",
              uploading && "pointer-events-none opacity-60",
            )}
          >
            {uploading ? (
              <>
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
                <span className="text-[13px] text-muted-foreground">正在提取文本 / 识别中…</span>
              </>
            ) : (
              <>
                <Upload className="size-5 text-muted-foreground" />
                <span className="mt-1 text-[13px] font-medium">点击选择，或拖拽文件到此处</span>
                <span className="text-[11px] text-muted-foreground">
                  TXT / MD / DOCX / PDF / PNG / JPG / WEBP · 单文件 ≤ {maxFileMB}MB · PDF ≤ {maxPdfPages} 页
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
          <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
            文件仅提交到本机后端临时解析，不自动持久化；扫描 PDF 与图片用本地 OCR 识别，提取后须由你校对确认才会分析。
          </p>
          {uploadError && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/[0.06] px-3 py-2 text-[12px] text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{uploadError.message}{uploadError.retryable && " 你可以稍后手动重试。"}</span>
            </div>
          )}
        </div>

        <div className="border-t border-border/60 p-5">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-medium">
            <FileText className="size-4 text-muted-foreground" />
            或粘贴合同文本
          </div>
          <Textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="将合同全文粘贴到此处…"
            aria-label="合同文本"
            className="min-h-44 resize-y border-0 bg-transparent px-0 text-[15px] leading-relaxed shadow-none focus-visible:border-0 focus-visible:ring-0"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className={cn("text-[11px] text-muted-foreground", over && "text-destructive")}>
              {pasted.length} / {maxText} 字符{over && "（超出限制，请缩小或选择片段）"}
            </span>
            <Button size="sm" disabled={!pasted.trim() || over} onClick={onContinue}>
              继续校对
            </Button>
          </div>
        </div>
      </div>

      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        合同全文、对话与模型结果默认不自动持久化。点击分析即表示你将所确认的文本提交给模型服务；未经核实不承诺零留存。
      </p>
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

interface Exchange {
  id: string;
  question: string;
  intent: ContractIntent;
  result: ContractResult | null;
  error: ApiError | null;
  loading: boolean;
}

interface RevisionSuggestion {
  id: string;
  text: string;
  targetExcerpt: Excerpt | null;
}

function buildConversation(list: Exchange[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (const e of list) {
    if (e.result) {
      turns.push({ role: "user", content: e.question });
      turns.push({ role: "assistant", content: e.result.answer });
    }
  }
  return turns;
}

const INTENT_LABELS: Record<ContractIntent, string> = {
  ask: "回答问题",
  review: "整体审查",
  suggest_revision: "修改建议",
  draft_revision: "起草修订",
};

function ReviewStage({ text, onReinput }: { text: string; onReinput: () => void }) {
  const { config } = useConfig();
  const [cityCode, setCityCode] = useState("CN");
  const [eventDate, setEventDate] = useState("");
  const [question, setQuestion] = useState("");
  const [intent, setIntent] = useState<ContractIntent>("review");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [showText, setShowText] = useState(false);
  const [active, setActive] = useState<Excerpt | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const markRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const aiAvailable = config?.aiAvailable ?? false;
  const busy = exchanges.some((e) => e.loading);

  const suggestions: RevisionSuggestion[] = exchanges
    .filter((e) => e.result?.revision)
    .map((e) => ({ id: e.id, text: e.result!.revision!.text, targetExcerpt: e.result!.revision!.targetExcerpt }));
  const completed = exchanges.filter((e) => e.result);
  const originalFindingCount = completed.length ? completed[completed.length - 1].result!.findings.length : null;

  useEffect(() => {
    if (showText && active && markRef.current) {
      markRef.current.scrollIntoView({ block: "center" });
    }
  }, [active, showText]);

  function locate(ex: Excerpt) {
    setActive(ex);
    setShowText(true);
  }

  function followUp(q: string) {
    setQuestion(q);
    setIntent("ask");
    composerRef.current?.focus();
  }

  async function run(id: string, q: string, it: ContractIntent, conv: ConversationTurn[]) {
    setExchanges((prev) => prev.map((e) => (e.id === id ? { ...e, loading: true, error: null } : e)));
    try {
      const { data } = await api.analyzeContract({
        text,
        textScope: "full",
        question: q,
        conversation: conv,
        intent: it,
        cityCode,
        eventDate: eventDate || null,
      });
      setExchanges((prev) => prev.map((e) => (e.id === id ? { ...e, loading: false, result: data } : e)));
    } catch (err) {
      const error = err instanceof ApiError ? err : new ApiError("internal_error", errorMessage(err), false);
      setExchanges((prev) => prev.map((e) => (e.id === id ? { ...e, loading: false, error } : e)));
    }
  }

  function submit() {
    const q = question.trim();
    if (busy || !aiAvailable || (intent === "ask" && !q)) return;
    const conv = buildConversation(exchanges);
    const id = crypto.randomUUID();
    const displayQ = q || "请审查这份合同。";
    setExchanges((prev) => [...prev, { id, question: displayQ, intent, result: null, error: null, loading: true }]);
    setQuestion("");
    void run(id, displayQ, intent, conv);
  }

  function retry(id: string) {
    const idx = exchanges.findIndex((e) => e.id === id);
    if (idx === -1 || busy) return;
    const ex = exchanges[idx];
    void run(id, ex.question, ex.intent, buildConversation(exchanges.slice(0, idx)));
  }

  const submitDisabled = busy || !aiAvailable || (intent === "ask" && !question.trim());

  return (
    <section className="flex flex-col gap-4 md:min-h-[calc(100dvh-12rem)]">
      <div className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">已确认文本</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-[13px] text-muted-foreground">{text.length} 字符</span>
            {active && <span className="text-[13px] text-muted-foreground">· 已定位引文</span>}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setShowText((v) => !v)}>
              {showText ? "收起原文" : "查看原文"}
            </Button>
            <Button variant={copyOpen ? "secondary" : "ghost"} size="sm" onClick={() => setCopyOpen((v) => !v)}>
              <Copy className="size-3.5" />
              {copyOpen ? "收起副本" : "修订副本"}
              {suggestions.length > 0 && <span className="ml-1 text-[13px] text-muted-foreground">{suggestions.length}</span>}
            </Button>
            <Button variant="ghost" size="sm" onClick={onReinput}>重新校对</Button>
          </div>
        </div>
        {showText && (
          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-secondary/60 p-3 font-mono text-xs leading-relaxed">
            {active ? (
              <>
                {text.slice(0, active.start)}
                <mark ref={markRef} className="rounded bg-primary/15 px-0.5 text-foreground">
                  {text.slice(active.start, active.end)}
                </mark>
                {text.slice(active.end)}
              </>
            ) : (
              text
            )}
          </pre>
        )}
        {showText && active && (
          <button type="button" className="mt-2 text-xs text-primary underline-offset-2 hover:underline" onClick={() => setActive(null)}>
            清除定位高亮
          </button>
        )}
      </div>

      {copyOpen && (
        <RevisionCopyPanel
          originalText={text}
          suggestions={suggestions}
          aiAvailable={aiAvailable}
          originalFindingCount={originalFindingCount}
        />
      )}

      <details className="rounded-lg border bg-card p-4" open={exchanges.length === 0}>
        <summary className="cursor-pointer text-sm font-medium">审查上下文（城市 / 日期）</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="city">城市（仅一般建议，本地渠道待核实）</Label>
            <Select value={cityCode} onValueChange={setCityCode}>
              <SelectTrigger id="city" className="w-full">
                <SelectValue placeholder="选择城市" />
              </SelectTrigger>
              <SelectContent>
                {(config?.cities ?? [{ code: "CN", name: "不限 / 全国一般建议" }]).map((c) => (
                  <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="date">签约 / 拟签约日期（可选）</Label>
            <Input id="date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          </div>
        </div>
      </details>

      {exchanges.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/70 px-6 py-12 text-center text-[13px] text-muted-foreground">
          选择分析意图并发送第一条消息；此后可继续追问，对话会保留上下文。
        </div>
      ) : (
        <div className="space-y-5">
          {exchanges.map((ex) => (
            <ExchangeView key={ex.id} exchange={ex} busy={busy} onRetry={() => retry(ex.id)} onLocate={locate} onFollowUp={followUp} />
          ))}
        </div>
      )}

      <div className="sticky bottom-0 z-10 mt-auto -mx-4 border-t border-border/70 bg-background/85 px-4 py-3 backdrop-blur-xl md:-mx-8 md:px-8">
        <div className="mx-auto w-full max-w-5xl">
          <div className="panel p-2.5">
            <div className="mb-1.5 flex flex-wrap items-center gap-2 px-1">
              <div className="inline-flex rounded-full bg-secondary p-0.5" role="group" aria-label="分析意图">
                {INTENTS.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => setIntent(it.id)}
                    aria-pressed={intent === it.id}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs transition-colors",
                      intent === it.id
                        ? "bg-background font-medium text-foreground shadow-sm ring-1 ring-black/5"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {it.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-end gap-2">
              <Textarea
                id="question"
                ref={composerRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={intent === "ask" ? "描述你的问题，例如：押金条款是否对我不利？" : "可补充说明，或直接发送（可选）"}
                aria-label="你的问题"
                className="max-h-40 min-h-[54px] flex-1 resize-none border-0 bg-transparent px-2 py-1 text-[15px] shadow-none focus-visible:border-0 focus-visible:ring-0"
              />
              <Button
                onClick={submit}
                disabled={submitDisabled}
                size="icon"
                className="mb-0.5 size-9 shrink-0 rounded-full"
                aria-label={busy ? "分析中" : "发送"}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
              </Button>
            </div>

            <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2 px-2 text-[11px] text-muted-foreground">
              <span>
                {!aiAvailable
                  ? "服务端未配置模型密钥，分析暂不可用。配置 backend/.env 中的 MODEL_API_KEY 与 MODEL_NAME 后重启后端。"
                  : "Ctrl/⌘ + Enter 发送 · 点击分析即表示将所确认文本提交给模型服务"}
              </span>
              {aiAvailable && intent === "ask" && !question.trim() && <span>请填写问题</span>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ExchangeView({
  exchange,
  busy,
  onRetry,
  onLocate,
  onFollowUp,
}: {
  exchange: Exchange;
  busy: boolean;
  onRetry: () => void;
  onLocate: (ex: Excerpt) => void;
  onFollowUp: (q: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-sm">
          <div className="mb-0.5 text-[11px] text-muted-foreground">{INTENT_LABELS[exchange.intent]}</div>
          <p className="whitespace-pre-wrap">{exchange.question}</p>
        </div>
      </div>

      {exchange.loading && (
        <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-card px-4 py-3 text-[13px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在分析并核验引文…
        </div>
      )}

      {exchange.error && (
        <Alert variant="destructive">
          <ShieldAlert className="size-4" />
          <AlertTitle>分析未完成</AlertTitle>
          <AlertDescription>
            <p>{exchange.error.message}{exchange.error.retryable && " 输入已保留，可稍后手动重试。"}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={onRetry} disabled={busy}>
              <RotateCw className="size-4" />
              手动重试
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {exchange.result && <ResultView result={exchange.result} onLocate={onLocate} onFollowUp={onFollowUp} />}
    </div>
  );
}

function ResultView({
  result,
  onLocate,
  onFollowUp,
}: {
  result: ContractResult;
  onLocate: (ex: Excerpt) => void;
  onFollowUp: (q: string) => void;
}) {
  return (
    <div className="space-y-3 panel p-4">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        AI 辅助意见，覆盖有限，不构成确定性法律结论；请结合实际情况核实。
      </p>

      {result.answer && <p className="whitespace-pre-wrap text-sm leading-relaxed">{result.answer}</p>}

      {result.findings.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[13px] font-semibold text-muted-foreground">风险提示（按审查优先级）</h3>
          {result.findings.map((f, i) => (
            <FindingCard key={i} finding={f} onLocate={onLocate} />
          ))}
        </div>
      )}

      {result.revision && (
        <div className="rounded-xl bg-secondary/60 p-3">
          <div className="mb-1 flex flex-wrap items-baseline gap-2">
            <span className="text-[11px] font-medium">修订草稿</span>
            <span className="text-[11px] text-muted-foreground">协商用，须自行检查；在「修订副本」面板中逐条或批量应用。</span>
          </div>
          {result.revision.targetExcerpt && (
            <button
              type="button"
              className="mb-2 flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
              onClick={() => onLocate(result.revision!.targetExcerpt!)}
            >
              <MapPin className="size-3" />
              定位目标原文
            </button>
          )}
          <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{result.revision.text}</p>
        </div>
      )}

      {result.followUpQuestions.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-[13px] font-semibold text-muted-foreground">可继续追问</h3>
          <div className="flex flex-wrap gap-1.5">
            {result.followUpQuestions.map((q, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onFollowUp(q)}
                className="rounded-full border border-border/80 px-3 py-1 text-xs text-foreground/80 transition-colors hover:border-foreground/30 hover:text-foreground"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FindingCard({ finding, onLocate }: { finding: Finding; onLocate: (ex: Excerpt) => void }) {
  const tone =
    finding.priority === "confirm_first"
      ? "text-amber-600"
      : finding.priority === "needs_attention"
        ? "text-primary"
        : "text-muted-foreground";
  return (
    <div className="rounded-xl border border-border/70 bg-background p-3">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <span className={cn("text-[11px] font-medium", tone)}>{PRIORITY_LABELS[finding.priority]}</span>
        <span className="text-sm font-medium">{finding.issue}</span>
      </div>
      {finding.impact && <p className="text-[13px] leading-relaxed text-muted-foreground">{finding.impact}</p>}
      {finding.excerpt && (
        <div className="mt-2 rounded-lg bg-secondary/70 px-3 py-2">
          <blockquote className="font-mono text-xs leading-relaxed">“{finding.excerpt.text}”</blockquote>
          <button
            type="button"
            className="mt-1 flex items-center gap-1 text-[11px] text-primary underline-offset-2 hover:underline"
            onClick={() => onLocate(finding.excerpt!)}
          >
            <MapPin className="size-3" />
            定位原文
          </button>
        </div>
      )}
      {finding.suggestedQuestion && (
        <p className="mt-2 text-[11px] text-muted-foreground">建议确认：{finding.suggestedQuestion}</p>
      )}
      {finding.uncertainties.length > 0 && (
        <ul className="mt-1 list-inside list-disc text-[11px] text-muted-foreground">
          {finding.uncertainties.map((u, i) => <li key={i}>{u}</li>)}
        </ul>
      )}
    </div>
  );
}

function RevisionCopyPanel({
  originalText,
  suggestions,
  aiAvailable,
  originalFindingCount,
}: {
  originalText: string;
  suggestions: RevisionSuggestion[];
  aiAvailable: boolean;
  originalFindingCount: number | null;
}) {
  const [copy, setCopy] = useState(originalText);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<ContractResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [copied, setCopied] = useState(false);

  const dirty = copy !== originalText;
  const pendingCount = suggestions.filter((s) => !applied.has(s.id)).length;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function applyOne(s: RevisionSuggestion) {
    if (applied.has(s.id)) return;
    let next: string;
    if (s.targetExcerpt) {
      const target = s.targetExcerpt.text;
      const idx = copy.indexOf(target);
      if (idx === -1) {
        setNotice(`未找到目标原文「${target.slice(0, 18)}${target.length > 18 ? "…" : ""}」，可能已被修改，请手动编辑副本。`);
        return;
      }
      next = copy.slice(0, idx) + s.text + copy.slice(idx + target.length);
    } else {
      next = `${copy}\n\n【新增条款草稿】\n${s.text}`;
    }
    setCopy(next);
    setApplied((prev) => new Set(prev).add(s.id));
    setSelected((prev) => {
      const n = new Set(prev);
      n.delete(s.id);
      return n;
    });
    setNotice("已应用 1 条建议到副本（原文不变）。");
    setResult(null);
  }

  function applySelected() {
    const items = suggestions.filter((s) => selected.has(s.id) && !applied.has(s.id));
    if (items.length === 0) return;
    let next = copy;
    const done: string[] = [];
    let skipped = 0;
    for (const s of items) {
      if (s.targetExcerpt) {
        const target = s.targetExcerpt.text;
        const idx = next.indexOf(target);
        if (idx === -1) {
          skipped++;
          continue;
        }
        next = next.slice(0, idx) + s.text + next.slice(idx + target.length);
      } else {
        next = `${next}\n\n【新增条款草稿】\n${s.text}`;
      }
      done.push(s.id);
    }
    setCopy(next);
    setApplied((prev) => {
      const n = new Set(prev);
      done.forEach((id) => n.add(id));
      return n;
    });
    setSelected(new Set());
    setNotice(`已应用 ${done.length} 条建议到副本${skipped ? `；${skipped} 条未找到目标原文，请手动编辑` : ""}（原文不变）。`);
    setResult(null);
  }

  function discard() {
    setCopy(originalText);
    setApplied(new Set());
    setSelected(new Set());
    setResult(null);
    setError(null);
    setNotice("已放弃修改，副本恢复为原文。");
  }

  async function copyClipboard() {
    try {
      await navigator.clipboard.writeText(copy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice("复制失败，请手动选择副本文本复制。");
    }
  }

  async function reReview() {
    if (loading || !aiAvailable || !copy.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.analyzeContract({
        text: copy,
        textScope: "full",
        question: "请复查这份修订副本，指出仍存在的风险。",
        conversation: [],
        intent: "review",
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError("internal_error", errorMessage(err), false));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Copy className="size-4 text-muted-foreground" />
          修订副本
          <span className="text-[11px] text-muted-foreground">{dirty ? "已修改" : "与原文一致"}</span>
        </div>
        <span className="text-[11px] text-muted-foreground">原文只读保留，所有修改仅发生在副本。</span>
      </div>

      <Alert className="mb-3">
        <ShieldAlert className="size-4" />
        <AlertDescription>修订内容为协商草稿，须自行检查，不代替法律审定或自动签约。</AlertDescription>
      </Alert>

      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">修订建议（{suggestions.length}）</h4>
          {pendingCount > 0 && (
            <Button size="sm" variant="outline" onClick={applySelected} disabled={selected.size === 0}>
              <Check className="size-4" />
              批量应用已选（{selected.size}）
            </Button>
          )}
        </div>
        {suggestions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            暂无修订建议。请用「修改建议」或「起草修订」意图生成后，在此逐条或批量应用。
          </p>
        ) : (
          suggestions.map((s) => (
            <div key={s.id} className="rounded-md border bg-secondary/30 p-2">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-primary"
                  checked={selected.has(s.id)}
                  disabled={applied.has(s.id)}
                  onChange={() => toggleSelect(s.id)}
                  aria-label="选择此建议"
                />
                <div className="min-w-0 flex-1">
                  {s.targetExcerpt && (
                    <p className="mb-1 font-mono text-[11px] text-muted-foreground">目标原文：「{s.targetExcerpt.text}」</p>
                  )}
                  <p className="whitespace-pre-wrap font-mono text-xs">{s.text}</p>
                </div>
                <div className="shrink-0">
                  {applied.has(s.id) ? (
                    <Badge variant="secondary"><Check className="size-3" /> 已应用</Badge>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => applyOne(s)}>应用</Button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {notice && <p className="mb-2 text-xs text-primary">{notice}</p>}

      <Label htmlFor="copy-editor" className="text-xs">副本全文（可编辑）</Label>
      <Textarea
        id="copy-editor"
        value={copy}
        onChange={(e) => {
          setCopy(e.target.value);
          setResult(null);
        }}
        className="mt-1 min-h-56 font-mono text-sm"
        aria-label="修订副本全文"
      />
      <div className="mt-1 text-xs text-muted-foreground">{copy.length} 字符</div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={copyClipboard}>
          <ClipboardCopy className="size-4" />
          {copied ? "已复制" : "复制副本"}
        </Button>
        <Button size="sm" variant="outline" onClick={discard} disabled={!dirty && applied.size === 0}>
          <Undo2 className="size-4" />
          放弃修改
        </Button>
        <Button size="sm" onClick={reReview} disabled={loading || !aiAvailable || !copy.trim()}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {loading ? "复查中…" : "复查副本"}
        </Button>
      </div>

      {!aiAvailable && <p className="mt-2 text-xs text-muted-foreground">服务端未配置模型密钥，复查暂不可用。</p>}

      {error && (
        <Alert variant="destructive" className="mt-3">
          <ShieldAlert className="size-4" />
          <AlertTitle>复查未完成</AlertTitle>
          <AlertDescription>{error.message}{error.retryable && " 可稍后手动重试。"}</AlertDescription>
        </Alert>
      )}

      {result && (
        <div className="mt-3 space-y-2 rounded-md border bg-secondary/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold">副本复查结果</h4>
            {originalFindingCount != null && (
              <Badge variant="outline">原文 {originalFindingCount} 条 → 副本 {result.findings.length} 条</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">AI 辅助意见，仅供协商参考；请对比修改前后发现。</p>
          {result.answer && <p className="whitespace-pre-wrap text-sm">{result.answer}</p>}
          {result.findings.length > 0 ? (
            <ul className="space-y-1">
              {result.findings.map((f, i) => (
                <li key={i} className="text-xs">
                  <Badge variant="secondary">{PRIORITY_LABELS[f.priority]}</Badge>{" "}
                  <span className="font-medium">{f.issue}</span>
                  {f.excerpt && <span className="font-mono text-muted-foreground"> —「{f.excerpt.text}」</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">副本未发现明显风险项（仍建议自行核对）。</p>
          )}
        </div>
      )}
    </div>
  );
}