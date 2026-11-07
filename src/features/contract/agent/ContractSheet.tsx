import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, FileText, Pencil, Save } from "lucide-react";
import type { Excerpt } from "@/shared/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ContractDoc } from "./types";

export function ContractSheet({
  open,
  onOpenChange,
  doc,
  signingDate,
  onSigningDateChange,
  onTextChange,
  onConfirmReviewed,
  onSaveEvidence,
  saveNotice,
  saved,
  activeExcerpt,
  maxText,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: ContractDoc | null;
  signingDate: string;
  onSigningDateChange: (value: string) => void;
  onTextChange: (value: string) => void;
  onConfirmReviewed: () => void;
  onSaveEvidence: () => void;
  saveNotice: string;
  saved: boolean;
  activeExcerpt: Excerpt | null;
  maxText: number;
}) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const markRef = useRef<HTMLElement>(null);

  const ocrPending = !!doc && doc.meta.ocrUsed && !doc.reviewed;
  const over = !!doc && doc.text.length > maxText;

  useEffect(() => {
    if (!open) return;
    if (activeExcerpt) {
      setMode("view");
      return;
    }
    setMode(doc?.meta.ocrUsed && !doc.reviewed ? "edit" : "view");
  }, [open, activeExcerpt, doc?.meta.ocrUsed, doc?.reviewed]);

  useEffect(() => {
    if (open && mode === "view" && activeExcerpt) {
      markRef.current?.scrollIntoView({ block: "center" });
    }
  }, [open, mode, activeExcerpt]);

  if (!doc) return null;

  const validExcerpt =
    activeExcerpt &&
    activeExcerpt.start >= 0 &&
    activeExcerpt.end <= doc.text.length &&
    activeExcerpt.start < activeExcerpt.end
      ? activeExcerpt
      : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b px-5 py-4 pr-12">
          <div className="flex flex-wrap items-center gap-2">
            <FileText className="size-4 text-muted-foreground" />
            <SheetTitle className="text-sm">合同文本</SheetTitle>
            <Badge variant="secondary">{doc.sourceName}</Badge>
            <Badge variant="outline">{doc.meta.method === "ocr" ? "OCR 识别" : "文本提取"}</Badge>
            {doc.meta.pageCount != null && <Badge variant="outline">{doc.meta.pageCount} 页</Badge>}
          </div>
          <SheetDescription className="text-[11px]">
            {doc.text.length} 字符 · {ocrPending ? "OCR 识别文本，请核对后发送" : "已确认文本"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {doc.meta.warnings.length > 0 && (
            <Alert className="border-amber-500/50 bg-amber-500/10">
              <AlertTriangle className="size-4 text-amber-600" />
              <AlertTitle>识别提示（请校对）</AlertTitle>
              <AlertDescription>
                <ul className="list-inside list-disc space-y-0.5">
                  {doc.meta.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {ocrPending && (
            <Alert className="border-amber-500/50 bg-amber-500/10">
              <AlertTriangle className="size-4 text-amber-600" />
              <AlertTitle>OCR 识别待核对</AlertTitle>
              <AlertDescription>
                识别文本可能有错字、漏字或数字错误，请对照原件检查；核对前不会发送审查请求。
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-full bg-secondary p-0.5" role="group" aria-label="文本模式">
              <button
                type="button"
                onClick={() => setMode("view")}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] transition-colors",
                  mode === "view" ? "bg-background font-medium shadow-sm ring-1 ring-black/5" : "text-muted-foreground",
                )}
              >
                查看
              </button>
              <button
                type="button"
                onClick={() => setMode("edit")}
                className={cn(
                  "flex items-center gap-1 rounded-full px-3 py-1 text-[11px] transition-colors",
                  mode === "edit" ? "bg-background font-medium shadow-sm ring-1 ring-black/5" : "text-muted-foreground",
                )}
              >
                <Pencil className="size-3" />
                编辑
              </button>
            </div>
            <span className={cn("text-[11px] text-muted-foreground", over && "text-destructive")}>
              {doc.text.length} / {maxText} 字符
            </span>
          </div>

          {mode === "view" ? (
            <pre className="whitespace-pre-wrap rounded-lg bg-secondary/60 p-3 font-mono text-[12px] leading-relaxed">
              {validExcerpt ? (
                <>
                  {doc.text.slice(0, validExcerpt.start)}
                  <mark ref={markRef} className="rounded bg-primary/15 px-0.5 text-foreground">
                    {doc.text.slice(validExcerpt.start, validExcerpt.end)}
                  </mark>
                  {doc.text.slice(validExcerpt.end)}
                </>
              ) : (
                doc.text
              )}
            </pre>
          ) : (
            <Textarea
              value={doc.text}
              onChange={(event) => onTextChange(event.target.value)}
              className="min-h-[45vh] font-mono text-[13px]"
              aria-label="合同文本（可编辑）"
            />
          )}

          {mode === "edit" && (
            <p className="text-[11px] text-muted-foreground">
              修改后，后续追问会使用新文本；已完成的审查不会自动重跑。
            </p>
          )}

          {over && (
            <p className="text-xs text-destructive">文本超过限制，请缩小材料或选择片段，系统不会静默截断。</p>
          )}

          {doc.meta.pages.length > 0 && (
            <details className="rounded-md border bg-secondary/40 p-2 text-xs">
              <summary className="cursor-pointer font-medium text-muted-foreground">
                按页查看提取结果（{doc.meta.pages.length} 页）
              </summary>
              <div className="mt-2 space-y-2">
                {doc.meta.pages.map((page) => (
                  <div key={page.page} className="rounded border bg-card p-2">
                    <div className="mb-1 flex items-center gap-2">
                      <Badge variant="secondary">第 {page.page} 页</Badge>
                      <span className="text-muted-foreground">
                        {page.method === "ocr" ? "OCR" : "文本层"} · {page.text.length} 字符
                      </span>
                    </div>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
                      {page.text || "（本页未提取到文本）"}
                    </pre>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        <SheetFooter className="border-t px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="signing-date" className="text-[11px] text-muted-foreground">
              签约 / 拟签约日期
            </Label>
            <Input
              id="signing-date"
              type="date"
              value={signingDate}
              onChange={(event) => onSigningDateChange(event.target.value)}
              className="h-8 w-auto text-xs"
            />
            <span className="text-[11px] text-muted-foreground">可选，用于证据日期</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={onSaveEvidence} disabled={!doc.text.trim() || over}>
              <Save className="size-3.5" />
              {saved ? "更新证据" : "存为证据"}
            </Button>
            {saveNotice && <p className="text-[11px] text-primary">{saveNotice}</p>}
            <div className="ml-auto flex gap-2">
              {ocrPending && (
                <Button size="sm" onClick={onConfirmReviewed} disabled={!doc.text.trim() || over}>
                  <Check className="size-3.5" />
                  核对无误
                </Button>
              )}
              <Button size="sm" variant={ocrPending ? "ghost" : "default"} onClick={() => onOpenChange(false)}>
                {ocrPending ? "稍后" : "完成"}
              </Button>
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
