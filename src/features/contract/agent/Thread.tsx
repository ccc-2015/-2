import { Check, FileText, Loader2, MapPin, RotateCw, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ContractIntent, ContractResult, Excerpt, Finding } from "@/shared/api";
import { SourceList } from "@/components/SourceList";
import { HelpTip } from "@/components/HelpTip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FindingCard } from "./ResultCards";
import type { ContractDoc, Exchange } from "./types";

function StageProgress({
  stage,
  auto,
  streaming,
}: {
  stage: string | null;
  auto: boolean;
  streaming: boolean;
}) {
  const message = streaming
    ? "正在逐段生成回答并整理审查结果…"
    : stage === "retrieving"
      ? "正在匹配本地审核资料…"
      : auto
        ? "正在读取并审查合同…"
        : "正在分析问题并核对依据…";

  return (
    <div className="flex items-center gap-2 py-1 text-[12px] text-muted-foreground" role="status" aria-live="polite">
      <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
      <span>{message}</span>
    </div>
  );
}

export function Thread({
  exchanges,
  doc,
  busy,
  aiAvailable,
  signingDate,
  onRetry,
  onLocate,
  onFollowUp,
  onOpenDoc,
  onOpenRevision,
  onQuickAction,
}: {
  exchanges: Exchange[];
  doc: ContractDoc | null;
  busy: boolean;
  aiAvailable: boolean;
  signingDate: string;
  onRetry: (id: string) => void;
  onLocate: (excerpt: Excerpt) => void;
  onFollowUp: (question: string) => void;
  onOpenDoc: () => void;
  onOpenRevision: (exchangeId: string) => void;
  onQuickAction: (intent: ContractIntent) => void;
}) {
  return (
    <div className="space-y-7">
      {exchanges.map((exchange, index) => (
        <div key={exchange.id} className="space-y-3">
          <div className="flex justify-end">
            {exchange.auto && doc ? (
              <div className="max-w-[85%] rounded-[22px] bg-secondary px-2 py-2">
                <button
                  type="button"
                  onClick={onOpenDoc}
                  className="flex items-center gap-2.5 rounded-2xl px-2 py-1.5 text-left transition-colors hover:bg-black/[0.03]"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background">
                    <FileText className="size-4 text-muted-foreground" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">
                      {doc.sourceName === "粘贴文本" ? "合同文本" : doc.sourceName}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {doc.text.length} 字符
                      {doc.meta.pageCount != null ? ` · ${doc.meta.pageCount} 页` : ""}
                      {doc.meta.ocrUsed ? " · OCR" : ""}
                    </span>
                  </span>
                </button>
              </div>
            ) : (
              <div className="max-w-[85%] rounded-[22px] bg-secondary px-4 py-2.5 text-[15px] leading-relaxed">
                <p className="whitespace-pre-wrap">{exchange.question}</p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-lg bg-foreground text-background">
                <ShieldCheck className="size-3.5" />
              </span>
              <span className="text-[12px] font-medium">租住有据</span>
              <span className="text-[10px] text-muted-foreground">AI 辅助</span>
            </div>

            {exchange.loading && (
              <StageProgress
                stage={exchange.stage ?? null}
                auto={!!exchange.auto}
                streaming={!!exchange.partialAnswer}
              />
            )}

            {exchange.partialAnswer ? (
              <p className="whitespace-pre-wrap text-[15px] leading-7">
                {exchange.partialAnswer}
                {exchange.loading && <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-foreground/60 align-middle" />}
              </p>
            ) : null}

            {exchange.error && (
              <Alert variant="destructive">
                <ShieldAlert className="size-4" />
                <AlertTitle>分析未完成</AlertTitle>
                <AlertDescription>
                  <p>
                    {exchange.error.message}
                    {exchange.error.retryable && " 输入已保留，可稍后手动重试。"}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => onRetry(exchange.id)}
                    disabled={busy || !aiAvailable}
                  >
                    <RotateCw className="size-4" />
                    手动重试
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {exchange.result && (
              <ResultBlock
                exchangeId={exchange.id}
                result={exchange.result}
                signingDate={signingDate}
                knowledgeVersion={exchange.meta?.knowledgeVersion ?? null}
                warnings={exchange.meta?.warnings ?? []}
                isLast={index === exchanges.length - 1}
                onLocate={onLocate}
                onFollowUp={onFollowUp}
                onOpenRevision={onOpenRevision}
                onQuickAction={onQuickAction}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultBlock({
  exchangeId,
  result,
  signingDate,
  knowledgeVersion,
  warnings,
  isLast,
  onLocate,
  onFollowUp,
  onOpenRevision,
  onQuickAction,
}: {
  exchangeId: string;
  result: ContractResult;
  signingDate: string;
  knowledgeVersion: string | null;
  warnings: string[];
  isLast: boolean;
  onLocate: (excerpt: Excerpt) => void;
  onFollowUp: (question: string) => void;
  onOpenRevision: (exchangeId: string) => void;
  onQuickAction: (intent: ContractIntent) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px]",
            result.coverage === "unsupported"
              ? "border-amber-500/40 bg-amber-500/10 text-amber-700"
              : "border-border/70 text-muted-foreground",
          )}
        >
          {result.coverage === "supported"
            ? "知识库已覆盖"
            : result.coverage === "limited"
              ? "知识库覆盖有限"
              : "暂无本地知识库"}
        </span>
        <HelpTip label="知识库覆盖说明">
          已覆盖：所选城市与全国性资料能支撑这类问题；覆盖有限：只有部分依据；暂无：本次未检索到可用资料，回答仅基于合同原文。
        </HelpTip>
      </div>

      {result.answer && <p className="whitespace-pre-wrap text-[15px] leading-7">{result.answer}</p>}

      {result.references.length === 0 && warnings.length > 0 && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{warnings.join(" ")}</p>
      )}

      {result.findings.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[12px] font-medium text-muted-foreground">风险提示</h3>
          {result.findings.map((finding, index) => (
            <FindingCard key={index} finding={finding} onLocate={onLocate} />
          ))}
        </div>
      )}

      {result.revision && (
        <div className="rounded-xl border border-border/70 bg-secondary/40 p-3">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[11px] font-medium">修订草稿</span>
              <span className="text-[11px] text-muted-foreground">协商用，须自行检查。</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={() => onOpenRevision(exchangeId)}
            >
              打开修订副本
            </Button>
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
          <p className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed">
            {result.revision.text}
          </p>
        </div>
      )}

      <SourceList
        sources={result.references}
        retrieved={result.retrieved ?? []}
        knowledgeVersion={knowledgeVersion}
        warnings={warnings}
      />

      {result.followUpQuestions.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-[12px] font-medium text-muted-foreground">可继续追问</h3>
          <div className="flex flex-wrap gap-1.5">
            {result.followUpQuestions.map((question, index) => (
              <button
                key={index}
                type="button"
                onClick={() => onFollowUp(question)}
                className="rounded-full border border-border/80 px-3 py-1 text-xs text-foreground/80 transition-colors hover:border-foreground/30 hover:text-foreground"
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      )}

      {isLast && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
          <span>继续</span>
          <button
            type="button"
            onClick={() => onQuickAction("suggest_revision")}
            className="rounded-full border border-border/80 px-3 py-1 text-foreground/80 transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            生成修改建议
          </button>
          <button
            type="button"
            onClick={() => onQuickAction("draft_revision")}
            className="rounded-full border border-border/80 px-3 py-1 text-foreground/80 transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            起草修订条款
          </button>
        </div>
      )}
    </div>
  );
}
