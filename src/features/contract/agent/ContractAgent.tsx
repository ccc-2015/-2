import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ClipboardPaste, FileText } from "lucide-react";
import type { ContractIntent, Excerpt } from "@/shared/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { RegionSelect } from "../../../components/RegionSelect";
import { api, ApiError, errorMessage } from "../../../lib/api";
import { useConfig } from "../../../lib/config-context";
import { useRegionCode } from "../../../lib/region";
import { newId, saveRecordChecked, type EvidenceRecord } from "../../evidence/store";
import { Composer } from "./Composer";
import { ContractSheet } from "./ContractSheet";
import { RevisionCopyPanel } from "./ResultCards";
import { Thread } from "./Thread";
import {
  PASTE_META,
  buildConversation,
  defaultQuestion,
  type ContractDoc,
  type Exchange,
  type RevisionSuggestion,
} from "./types";

interface PendingConfirm {
  title: string;
  description: string;
  action: () => void;
}

export function ContractAgent() {
  const { config } = useConfig();
  const cityCode = useRegionCode();
  const aiAvailable = config?.aiAvailable ?? false;
  const maxText = config?.limits.maxTextLength ?? 50000;

  const [doc, setDoc] = useState<ContractDoc | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [question, setQuestion] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<ApiError | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [activeExcerpt, setActiveExcerpt] = useState<Excerpt | null>(null);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [signingDate, setSigningDate] = useState("");
  const [textRecordId, setTextRecordId] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const busy = exchanges.some((exchange) => exchange.loading);
  const firstTurn = !exchanges.some((exchange) => exchange.result);
  const completed = exchanges.filter((exchange) => exchange.result);
  const originalFindingCount = completed.length ? completed[completed.length - 1].result!.findings.length : null;
  const suggestions = exchanges.reduce<RevisionSuggestion[]>((list, exchange) => {
    const revision = exchange.result?.revision;
    if (revision) list.push({ id: exchange.id, text: revision.text, targetExcerpt: revision.targetExcerpt });
    return list;
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [exchanges.length, busy]);

  function resetConversation() {
    setExchanges([]);
    setQuestion("");
    setActiveExcerpt(null);
    setRevisionOpen(false);
    setTextRecordId(null);
    setSaveNotice("");
    setSigningDate("");
    setUploadError(null);
  }

  function resetAll() {
    setDoc(null);
    setDocOpen(false);
    resetConversation();
  }

  function askConfirm(title: string, description: string, action: () => void) {
    setPendingConfirm({ title, description, action });
  }

  async function extractFile(file: File) {
    setUploadError(null);
    const maxBytes = config?.limits.maxFileBytes ?? 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      setUploadError(
        new ApiError(
          "payload_too_large",
          `文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB 限制，请缩小材料或直接粘贴文本。`,
          false,
        ),
      );
      return;
    }
    setUploading(true);
    try {
      const { data } = await api.extract(file);
      const nextDoc: ContractDoc = {
        text: data.text,
        sourceName: data.sourceName,
        meta: {
          warnings: data.warnings,
          pageCount: data.pageCount,
          method: data.method,
          ocrUsed: data.ocrUsed,
          pages: data.pages,
        },
        reviewed: !data.ocrUsed,
      };
      resetConversation();
      setDoc(nextDoc);
      if (data.ocrUsed) setDocOpen(true);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err : new ApiError("internal_error", errorMessage(err), false));
    } finally {
      setUploading(false);
    }
  }

  function handleFile(file: File) {
    if (uploading) return;
    if (doc || exchanges.length > 0) {
      askConfirm("更换合同？", "更换后会开始新对话，当前对话与审查结果不会保留。", () => void extractFile(file));
    } else {
      void extractFile(file);
    }
  }

  function importPaste() {
    const text = pasteText.trim();
    if (!text) return;
    resetConversation();
    setDoc({ text, sourceName: "粘贴文本", meta: PASTE_META, reviewed: true });
    setPasteOpen(false);
    setPasteText("");
  }

  function removeDoc() {
    if (exchanges.length > 0) {
      askConfirm("移除合同？", "当前对话与审查结果将一并清空，已存为证据的内容不受影响。", resetAll);
    } else {
      resetAll();
    }
  }

  function newChat() {
    if (!doc && exchanges.length === 0) return;
    askConfirm("开始新对话？", "当前合同与对话将被清空，已存为证据的内容不受影响。", resetAll);
  }

  async function run(id: string, displayQuestion: string, intent: ContractIntent, conversation: ReturnType<typeof buildConversation>) {
    if (!doc) return;
    setExchanges((prev) => prev.map((exchange) => (exchange.id === id ? { ...exchange, loading: true, error: null } : exchange)));
    try {
      const { data, meta } = await api.analyzeContract({
        text: doc.text,
        textScope: "full",
        question: displayQuestion,
        conversation,
        intent,
        cityCode,
        eventDate: signingDate || null,
      });
      setExchanges((prev) =>
        prev.map((exchange) => (exchange.id === id ? { ...exchange, loading: false, result: data, meta } : exchange)),
      );
    } catch (err) {
      const error = err instanceof ApiError ? err : new ApiError("internal_error", errorMessage(err), false);
      setExchanges((prev) =>
        prev.map((exchange) => (exchange.id === id ? { ...exchange, loading: false, error } : exchange)),
      );
    }
  }

  async function submit(override?: ContractIntent) {
    if (!doc || !doc.text.trim() || busy || !aiAvailable) return;
    if (!doc.reviewed) {
      setDocOpen(true);
      return;
    }
    const intent = override ?? (firstTurn ? "review" : "ask");
    const trimmed = question.trim();
    if (intent === "ask" && !trimmed) return;
    const displayQuestion = trimmed || defaultQuestion(intent);
    const id = newId();
    const conversation = buildConversation(exchanges);
    setQuestion("");
    setExchanges((prev) => [
      ...prev,
      { id, question: displayQuestion, intent, result: null, meta: null, error: null, loading: true },
    ]);
    await run(id, displayQuestion, intent, conversation);
  }

  function retry(id: string) {
    const index = exchanges.findIndex((exchange) => exchange.id === id);
    if (index === -1 || busy || !doc) return;
    const exchange = exchanges[index];
    void run(id, exchange.question, exchange.intent, buildConversation(exchanges.slice(0, index)));
  }

  function openDoc(excerpt: Excerpt | null = null) {
    setActiveExcerpt(excerpt);
    setDocOpen(true);
  }

  function handleDocOpenChange(open: boolean) {
    setDocOpen(open);
    if (!open) setActiveExcerpt(null);
  }

  function updateDocText(text: string) {
    setDoc((prev) => (prev ? { ...prev, text } : prev));
    setSaveNotice("");
  }

  function confirmReviewed() {
    setDoc((prev) => (prev ? { ...prev, reviewed: true } : prev));
    setDocOpen(false);
  }

  function saveDocEvidence() {
    if (!doc || !doc.text.trim()) return;
    const existing = textRecordId != null;
    const record: EvidenceRecord = {
      id: textRecordId ?? newId(),
      stage: "signing",
      occurredAt: signingDate || null,
      recordedAt: new Date().toISOString(),
      description: `合同原文（已确认，${doc.text.length} 字符）`,
      contractClause: "",
      materialName: doc.sourceName,
      materialType: "合同文本",
      materialStatus: "present",
      amountCents: null,
      reading: null,
      content: doc.text,
    };
    if (!saveRecordChecked(record, existing)) {
      setSaveNotice("本地存储空间不足，未能保存。");
      return;
    }
    setTextRecordId(record.id);
    setSaveNotice(existing ? "已更新证据画布中的合同原文。" : "已存为签约证据，可在证据画布查看。");
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file && !uploading) handleFile(file);
  }

  return (
    <div
      className="mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-3xl flex-col px-4 pb-4 pt-5 md:min-h-dvh md:px-8 md:pt-8"
      onDragOver={(event) => {
        event.preventDefault();
        if (!uploading) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <RegionSelect compact />
          <h1 className="text-[12px] font-medium text-muted-foreground">合同审查</h1>
        </div>
        <div className="flex items-center gap-1">
          {doc && (
            <Button variant="ghost" size="sm" onClick={() => openDoc()}>
              <FileText className="size-3.5" />
              合同文本
            </Button>
          )}
          {suggestions.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setRevisionOpen(true)}>
              修订副本
              <span className="text-[11px] text-muted-foreground">{suggestions.length}</span>
            </Button>
          )}
          {(doc || exchanges.length > 0) && (
            <Button variant="ghost" size="sm" onClick={newChat}>
              新对话
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 py-5">
        {exchanges.length === 0 && !doc && (
          <div className="flex min-h-[45vh] flex-col items-center justify-center px-4 text-center">
            <FileText className="size-7 text-muted-foreground/70" />
            <p className="mt-3 text-[15px] font-medium">把合同发给我</p>
            <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-muted-foreground">
              点击输入框左侧的 + 上传文件，或粘贴文本。之后可以直接问押金、退租、维修责任。
            </p>
            <Button size="sm" variant="outline" className="mt-4" onClick={() => setPasteOpen(true)}>
              <ClipboardPaste className="size-3.5" />
              粘贴文本
            </Button>
          </div>
        )}

        {exchanges.length === 0 && doc && (
          <div className="flex min-h-[30vh] items-center justify-center px-6 text-center">
            <p className="max-w-sm text-[12px] leading-relaxed text-muted-foreground">
              已读取 {doc.text.length} 字符。直接发送开始整体审查，或先输入你想确认的条款。
            </p>
          </div>
        )}

        {exchanges.length > 0 && (
          <Thread
            exchanges={exchanges}
            doc={doc}
            busy={busy}
            aiAvailable={aiAvailable}
            signingDate={signingDate}
            onRetry={retry}
            onLocate={openDoc}
            onFollowUp={(next) => {
              setQuestion(next);
              textareaRef.current?.focus();
            }}
            onOpenDoc={() => openDoc()}
            onOpenRevision={() => setRevisionOpen(true)}
          />
        )}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 z-10 mt-auto -mx-4 border-t border-border/70 bg-background/85 px-4 py-3 backdrop-blur-xl md:-mx-8 md:px-8">
        <div className="mx-auto w-full max-w-3xl">
          {uploadError && (
            <Alert variant="destructive" className="mb-2 py-2">
              <AlertTriangle className="size-4" />
              <AlertDescription>
                {uploadError.message}
                {uploadError.retryable && " 可稍后重试。"}
              </AlertDescription>
            </Alert>
          )}
          <Composer
            doc={doc}
            uploading={uploading}
            busy={busy}
            aiAvailable={aiAvailable}
            dragOver={dragOver}
            firstTurn={firstTurn}
            text={question}
            onTextChange={setQuestion}
            onSend={() => void submit()}
            onQuickAction={(intent) => void submit(intent)}
            onFile={handleFile}
            onOpenDoc={() => openDoc()}
            onRemoveDoc={removeDoc}
            textareaRef={textareaRef}
          />
          <p className="mt-1 px-1 text-[10px] leading-relaxed text-muted-foreground">
            合同全文不自动持久化；点击分析即表示将所确认的文本提交给模型服务。
          </p>
        </div>
      </div>

      <ContractSheet
        open={docOpen}
        onOpenChange={handleDocOpenChange}
        doc={doc}
        signingDate={signingDate}
        onSigningDateChange={setSigningDate}
        onTextChange={updateDocText}
        onConfirmReviewed={confirmReviewed}
        onSaveEvidence={saveDocEvidence}
        saveNotice={saveNotice}
        saved={textRecordId != null}
        activeExcerpt={activeExcerpt}
        maxText={maxText}
      />

      <Sheet open={revisionOpen} onOpenChange={setRevisionOpen}>
        <SheetContent className="w-full sm:max-w-2xl">
          <div className="h-full overflow-y-auto p-4 pt-10">
            {doc && (
              <RevisionCopyPanel
                originalText={doc.text}
                sourceName={doc.sourceName}
                signingDate={signingDate}
                suggestions={suggestions}
                aiAvailable={aiAvailable}
                originalFindingCount={originalFindingCount}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>粘贴合同文本</DialogTitle>
            <DialogDescription className="text-xs">
              粘贴后会作为一份新合同开始对话；文本不自动保存。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            placeholder="将合同全文粘贴到此处…"
            className="min-h-64 font-mono text-sm"
            aria-label="合同文本"
          />
          <div className="flex items-center justify-between gap-2">
            <span className={pasteText.length > maxText ? "text-[11px] text-destructive" : "text-[11px] text-muted-foreground"}>
              {pasteText.length} / {maxText} 字符
            </span>
            <Button onClick={importPaste} disabled={!pasteText.trim() || pasteText.length > maxText}>
              导入为合同
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingConfirm != null}
        onOpenChange={(open) => {
          if (!open) setPendingConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingConfirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{pendingConfirm?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = pendingConfirm?.action;
                setPendingConfirm(null);
                action?.();
              }}
            >
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
