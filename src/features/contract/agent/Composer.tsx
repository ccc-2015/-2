import { useRef, type RefObject } from "react";
import { ArrowUp, FileText, Loader2, Plus, X } from "lucide-react";
import type { ContractIntent } from "@/shared/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { QUICK_ACTIONS, type ContractDoc } from "./types";

const ACCEPT = ".txt,.md,.markdown,.docx,.pdf,.png,.jpg,.jpeg,.webp";

export function Composer({
  doc,
  uploading,
  busy,
  aiAvailable,
  dragOver,
  firstTurn,
  text,
  onTextChange,
  onSend,
  onQuickAction,
  onFile,
  onOpenDoc,
  onRemoveDoc,
  textareaRef,
}: {
  doc: ContractDoc | null;
  uploading: boolean;
  busy: boolean;
  aiAvailable: boolean;
  dragOver: boolean;
  firstTurn: boolean;
  text: string;
  onTextChange: (value: string) => void;
  onSend: () => void;
  onQuickAction: (intent: ContractIntent) => void;
  onFile: (file: File) => void;
  onOpenDoc: () => void;
  onRemoveDoc: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const ocrPending = !!doc && doc.meta.ocrUsed && !doc.reviewed;
  const canSend =
    !!doc &&
    doc.text.trim().length > 0 &&
    doc.reviewed &&
    !uploading &&
    !busy &&
    aiAvailable &&
    (firstTurn || text.trim().length > 0);
  const quickDisabled = !doc || !doc.reviewed || uploading || busy || !aiAvailable;

  let hint = "Enter 发送 · Shift+Enter 换行";
  if (!doc) hint = "先上传或粘贴合同";
  else if (uploading) hint = "正在提取文本…";
  else if (ocrPending) hint = "请先核对 OCR 识别文本";
  else if (!aiAvailable) hint = "服务端未配置模型密钥，审查暂不可用";
  else if (busy) hint = "正在分析，请稍候";

  return (
    <div className={cn("panel p-2.5", dragOver && "ring-2 ring-primary/40")}>
      {uploading && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-black/[0.06] bg-secondary/50 px-2.5 py-1.5 text-[12px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          正在提取文本 / 识别中…
        </div>
      )}

      {doc && !uploading && (
        <div className="mb-2 flex items-center gap-1 rounded-xl border border-black/[0.06] bg-secondary/50 px-2 py-1.5">
          <button type="button" onClick={onOpenDoc} className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[12px]">{doc.sourceName}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {doc.text.length} 字符
              {doc.meta.pageCount != null ? ` · ${doc.meta.pageCount} 页` : ""}
              {doc.meta.ocrUsed ? " · OCR" : ""}
            </span>
            {ocrPending && (
              <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                待核对
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={onRemoveDoc}
            aria-label="移除合同"
            className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {doc && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1 px-1">
          <div className="inline-flex rounded-full bg-secondary p-0.5" role="group" aria-label="快捷指令">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => onQuickAction(action.id)}
                disabled={quickDisabled}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] transition-colors",
                  quickDisabled
                    ? "text-muted-foreground/50"
                    : "text-muted-foreground hover:bg-background hover:text-foreground hover:shadow-sm",
                )}
              >
                {action.label}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground">
            {firstTurn ? "自由输入将作为审查问题" : "自由输入为追问"}
          </span>
        </div>
      )}

      <div className="flex items-end gap-1.5">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="mb-0.5 size-9 shrink-0 rounded-full"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          aria-label="上传合同"
        >
          <Plus className="size-4" />
        </Button>
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (canSend) onSend();
            }
          }}
          placeholder={doc ? "输入问题，或直接发送开始审查…" : "先上传合同，再开始提问…"}
          aria-label="输入问题"
          className="max-h-40 min-h-[44px] flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-[15px] shadow-none focus-visible:border-0 focus-visible:ring-0"
        />
        <Button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          size="icon"
          className="mb-0.5 size-9 shrink-0 rounded-full"
          aria-label={busy ? "分析中" : "发送"}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
        </Button>
      </div>

      <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2 px-2 text-[11px] text-muted-foreground">
        <span>{hint}</span>
      </div>
    </div>
  );
}
