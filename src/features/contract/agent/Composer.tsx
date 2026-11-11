import { useRef, type RefObject } from "react";
import { ArrowUp, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** 文本类在本机解析，图片走云端多模态转写；两种部署都开放图片格式。 */
const ACCEPT = ".txt,.md,.markdown,.docx,.pdf,.png,.jpg,.jpeg,.webp";

export function Composer({
  hasDoc,
  uploading,
  busy,
  aiAvailable,
  dragOver,
  text,
  onTextChange,
  onSend,
  onFiles,
  textareaRef,
}: {
  hasDoc: boolean;
  uploading: boolean;
  busy: boolean;
  aiAvailable: boolean;
  dragOver: boolean;
  text: string;
  onTextChange: (value: string) => void;
  onSend: () => void;
  onFiles: (files: File[]) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const canSend = text.trim().length > 0 && !uploading && !busy && aiAvailable;

  return (
    <div
      className={cn(
        "rounded-[24px] border border-border/80 bg-white/90 p-2 shadow-[0_10px_36px_-24px_rgba(16,24,40,0.45)] backdrop-blur-xl transition-shadow",
        dragOver && "ring-2 ring-primary/30",
      )}
    >
      {uploading && (
        <div className="flex items-center gap-2 px-3 pb-1 pt-2 text-[12px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          正在读取 / 识别合同材料…
        </div>
      )}

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
        placeholder={hasDoc ? "继续追问合同里的问题…" : "上传合同图片 / PDF / DOCX / TXT（可多选），或直接粘贴合同文本…"}
        aria-label="输入问题或合同文本"
        className="max-h-48 min-h-[52px] resize-none border-0 bg-transparent px-3 py-2 text-[15px] leading-6 shadow-none focus-visible:border-0 focus-visible:ring-0"
      />

      <div className="flex items-center justify-between gap-2 px-0.5">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length > 0) onFiles(files);
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || busy}
          aria-label="上传合同（可多选）"
        >
          <Plus className="size-4" />
        </Button>
        <Button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          size="icon"
          className="size-8 shrink-0 rounded-full"
          aria-label={busy ? "分析中" : "发送"}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
