import { useEffect, useRef, useState } from "react";
import { AlertTriangle, FileText, ShieldCheck } from "lucide-react";
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
import { Sheet, SheetContent } from "@/components/ui/sheet";
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
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const busy = exchanges.some((exchange) => exchange.loading);
  const empty = !doc && exchanges.length === 0;
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

  async function run(
    id: string,
    displayQuestion: string,
    intent: ContractIntent,
    conversation: ReturnType<typeof buildConversation>,
    text: string,
    eventDate: string = signingDate,
  ) {
    setExchanges((prev) =>
      prev.map((exchange) => (exchange.id === id ? { ...exchange, loading: true, error: null } : exchange)),
    );
    try {
      const { data, meta } = await api.analyzeContract({
        text,
        textScope: "full",
        question: displayQuestion,
        conversation,
        intent,
        cityCode,
        eventDate: eventDate || null,
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

  function startReview(nextDoc: ContractDoc) {
    const id = newId();
    const reviewQuestion = "请审查这份合同。";
    setQuestion("");
    setExchanges([
      { id, question: reviewQuestion, intent: "review", auto: true, result: null, meta: null, error: null, loading: true },
    ]);
    void run(id, reviewQuestion, "review", [], nextDoc.text, "");
  }

  async function extractFile(file: File) {
    if (uploading || busy) return;
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
      };
      resetConversation();
      setDoc(nextDoc);
      if (!nextDoc.text.trim()) {
        setUploadError(
          new ApiError("invalid_input", "未识别到合同文本，请换一张更清晰的文件，或在合同文本中手动补充。", false),
        );
        return;
      }
      startReview(nextDoc);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err : new ApiError("internal_error", errorMessage(err), false));
    } finally {
      setUploading(false);
    }
  }

  function handleFile(file: File) {
    if (uploading || busy) return;
    if (doc || exchanges.length > 0) {
      askConfirm("开始审查新合同？", "当前合同与对话将被清空，已存为证据的内容不受影响。", () => void extractFile(file));
    } else {
      void extractFile(file);
    }
  }

  function submit(override?: ContractIntent) {
    if (busy || !aiAvailable) return;
    const trimmed = question.trim();

    if (!doc) {
      if (!trimmed) return;
      if (trimmed.length > maxText) {
        setUploadError(
          new ApiError("payload_too_large", `合同文本超过 ${maxText} 字符限制，请缩小材料或分段处理。`, false),
        );
        return;
      }
      const nextDoc: ContractDoc = { text: trimmed, sourceName: "粘贴文本", meta: PASTE_META };
      resetConversation();
      setDoc(nextDoc);
      startReview(nextDoc);
      return;
    }

    if (!trimmed && !override) return;
    const intent = override ?? "ask";
    const displayQuestion = trimmed || defaultQuestion(intent);
    if (!displayQuestion) return;

    const id = newId();
    const conversation = buildConversation(exchanges);
    setQuestion("");
    setExchanges((prev) => [
      ...prev,
      { id, question: displayQuestion, intent, result: null, meta: null, error: null, loading: true },
    ]);
    void run(id, displayQuestion, intent, conversation, doc.text);
  }

  function retry(id: string) {
    const index = exchanges.findIndex((exchange) => exchange.id === id);
    if (index === -1 || busy || !doc) return;
    const exchange = exchanges[index];
    void run(id, exchange.question, exchange.intent, buildConversation(exchanges.slice(0, index)), doc.text);
  }

  function reReview() {
    if (!doc || busy || !aiAvailable) return;
    setDocOpen(false);
    setActiveExcerpt(null);
    const id = newId();
    const reviewQuestion = "请重新审查这份合同。";
    const conversation = buildConversation(exchanges);
    setExchanges((prev) => [
      ...prev,
      { id, question: reviewQuestion, intent: "review", result: null, meta: null, error: null, loading: true },
    ]);
    void run(id, reviewQuestion, "review", conversation, doc.text);
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

  function newChat() {
    if (!doc && exchanges.length === 0) return;
    askConfirm("开始新对话？", "当前合同与对话将被清空，已存为证据的内容不受影响。", resetAll);
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file && !uploading && !busy) handleFile(file);
  }

  return (
    <div
      className="mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-[680px] flex-col px-4 pb-4 pt-5 md:min-h-dvh md:px-6 md:pt-6"
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

      <div className={empty ? "flex flex-1 flex-col justify-center" : "flex flex-1 flex-col"}>
        {empty ? (
          <div className="flex flex-col items-center px-4 text-center">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-foreground text-background shadow-sm">
              <ShieldCheck className="size-5" />
            </span>
            <h2 className="mt-4 text-[22px] font-semibold tracking-tight">把合同发给我</h2>
            <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted-foreground">
              上传合同图片、PDF，或直接粘贴合同文本；我会先看押金、退租和维修责任。
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">首条消息会直接开始审查，之后可以继续追问。</p>
          </div>
        ) : (
          <div className="pb-28 pt-5">
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
              onQuickAction={(intent) => submit(intent)}
            />
            <div ref={endRef} />
          </div>
        )}

        <div
          className={
            empty
              ? "mt-8"
              : "sticky bottom-0 z-10 mt-4 -mx-4 border-t border-border/60 bg-background/85 px-4 py-3 backdrop-blur-xl md:-mx-6 md:px-6"
          }
        >
          <div className="mx-auto w-full max-w-[680px]">
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
              hasDoc={!!doc}
              uploading={uploading}
              busy={busy}
              aiAvailable={aiAvailable}
              dragOver={dragOver}
              text={question}
              onTextChange={setQuestion}
              onSend={() => submit()}
              onFile={handleFile}
              textareaRef={textareaRef}
            />
            <p className="mt-1.5 text-center text-[10px] leading-relaxed text-muted-foreground">
              {!aiAvailable
                ? "服务端未配置模型密钥，审查暂不可用。"
                : "AI 辅助意见，不构成法律结论；请核对原文。合同全文不自动保存。"}
            </p>
          </div>
        </div>
      </div>

      <ContractSheet
        open={docOpen}
        onOpenChange={handleDocOpenChange}
        doc={doc}
        signingDate={signingDate}
        onSigningDateChange={setSigningDate}
        onTextChange={updateDocText}
        onReReview={reReview}
        onSaveEvidence={saveDocEvidence}
        saveNotice={saveNotice}
        saved={textRecordId != null}
        busy={busy}
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
