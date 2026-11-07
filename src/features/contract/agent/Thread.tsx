import { FileText, Loader2, MapPin, RotateCw, ShieldAlert } from "lucide-react";
import type { ContractResult, Excerpt } from "@/shared/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FindingCard } from "./ResultCards";
import { INTENT_LABELS, type ContractDoc, type Exchange } from "./types";

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
  onOpenRevision: () => void;
}) {
  return (
    <div className="space-y-5">
      {exchanges.map((exchange, index) => (
        <div key={exchange.id} className="space-y-2">
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-sm">
              <div className="mb-0.5 text-[11px] text-muted-foreground">{INTENT_LABELS[exchange.intent]}</div>
              {index === 0 && doc && (
                <button
                  type="button"
                  onClick={onOpenDoc}
                  className="mb-1.5 flex w-full items-center gap-2 rounded-xl border border-black/[0.06] bg-background/70 px-2.5 py-1.5 text-left"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px]">{doc.sourceName}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {doc.text.length} 字符
                      {doc.meta.pageCount != null ? ` · ${doc.meta.pageCount} 页` : ""}
                      {doc.meta.ocrUsed ? " · OCR" : ""}
                    </span>
                  </span>
                </button>
              )}
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
              result={exchange.result}
              signingDate={signingDate}
              onLocate={onLocate}
              onFollowUp={onFollowUp}
              onOpenRevision={onOpenRevision}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ResultBlock({
  result,
  signingDate,
  onLocate,
  onFollowUp,
  onOpenRevision,
}: {
  result: ContractResult;
  signingDate: string;
  onLocate: (excerpt: Excerpt) => void;
  onFollowUp: (question: string) => void;
  onOpenRevision: () => void;
}) {
  return (
    <div className="panel space-y-3 p-4">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        AI 辅助意见，覆盖有限，不构成确定性法律结论；请结合实际情况核实。
      </p>

      {result.answer && <p className="whitespace-pre-wrap text-sm leading-relaxed">{result.answer}</p>}

      {result.findings.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[13px] font-semibold text-muted-foreground">风险提示（按审查优先级）</h3>
          {result.findings.map((finding, index) => (
            <FindingCard key={index} finding={finding} signingDate={signingDate} onLocate={onLocate} />
          ))}
        </div>
      )}

      {result.revision && (
        <div className="rounded-xl bg-secondary/60 p-3">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[11px] font-medium">修订草稿</span>
              <span className="text-[11px] text-muted-foreground">协商用，须自行检查。</span>
            </div>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={onOpenRevision}>
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

      {result.references.length > 0 && (
        <div className="border-t border-border/60 pt-2">
          <h3 className="mb-1 text-[11px] font-semibold text-muted-foreground">依据</h3>
          <ul className="list-inside list-disc space-y-0.5 text-[11px] text-muted-foreground">
            {result.references.map((reference, index) => (
              <li key={index}>{reference}</li>
            ))}
          </ul>
        </div>
      )}

      {result.followUpQuestions.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-[13px] font-semibold text-muted-foreground">可继续追问</h3>
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
    </div>
  );
}
