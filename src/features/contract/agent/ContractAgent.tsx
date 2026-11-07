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
  type RevisionDraft,
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
  const [revisionDrafts, setRevisionDrafts] = useState<Record<string, RevisionDraft>>({});
  const [revisionTargetId, setRevisionTargetId] = useState<string | null>(null);
  const [signingDate, setSigningDate] = useState("");
  const [textRecordId, setTextRecordId] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const busy = exchanges.some((exchange) => exchange.loading);
  const empty = !doc && exchanges.length === 0;
  const revisionExchangeIds = exchanges.filter((exchange) => exchange.result?.revision).map((exchange) => exchange.id);
  const latestRevisionExchangeId = revisionExchangeIds.length
    ? revisionExchangeIds[revisionExchangeIds.length - 1]
    : null;
  const revisionTarget = revisionTargetId
    ? exchanges.find((exchange) => exchange.id === revisionTargetId) ?? null
    : null;
  const revisionDraft = revisionTargetId ? revisionDrafts[revisionTargetId] ?? null : null;
  const revisionSuggestions: RevisionSuggestion[] = revisionTarget?.result?.revision
    ? [
        {
          id: revisionTarget.id,
          text: revisionTarget.result.revision.text,
          targetExcerpt: revisionTarget.result.revision.targetExcerpt,
        },
      ]
    : [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [exchanges.length, busy]);

  function resetConversation() {
    setExchanges([]);
    setQuestion("");
    setActiveExcerpt(null);
    setRevisionDrafts({});
    setRevisionTargetId(null);
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
        prev.map((exchange) =>
          exchange.id === id ? { ...exchange, loading: false, result: data, meta, docText: text } : exchange,
        ),
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
      {
        id,
        question: reviewQuestion,
        intent: "review",
        auto: true,
        docText: nextDoc.text,
        result: null,
        meta: null,
        error: null,
        loading: true,
      },
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
      { id, question: displayQuestion, intent, docText: doc.text, result: null, meta: null, error: null, loading: true },
    ]);
    void run(id, displayQuestion, intent, conversation, doc.text);
  }

  function retry(id: string) {
    const index = exchanges.findIndex((exchange) => exchange.id === id);
    if (index === -1 || busy || !doc) return;
    const exchange = exchanges[index];
    setRevisionDrafts((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (revisionTargetId === id) setRevisionTargetId(null);
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
      {
        id,
        question: reviewQuestion,
        intent: "review",
        docText: doc.text,
        result: null,
        meta: null,
        error: null,
        loading: true,
      },
    ]);
    void run(id, reviewQuestion, "review", conversation, doc.text);
  }

  function openRevision(exchangeId: string) {
    const exchange = exchanges.find((item) => item.id === exchangeId);
    if (!exchange?.result?.revision) return;
    const originalText = exchange.docText ?? doc?.text ?? "";
    setRevisionDrafts((prev) => {
      if (prev[exchangeId]) return prev;
      return {
        ...prev,
        [exchangeId]: {
          exchangeId,
          originalText,
          copy: originalText,
          applied: [],
          selected: [],
          notice: "",
          archiveNotice: "",
          archivedId: null,
          result: null,
          error: null,
          loading: false,
        },
      };
    });
    setRevisionTargetId(exchangeId);
  }

  function updateRevisionDraft(exchangeId: string, patch: Partial<RevisionDraft>) {
    setRevisionDrafts((prev) => {
      const current = prev[exchangeId];
      if (!current) return prev;
      return { ...prev, [exchangeId]: { ...current, ...patch } };
    });
  }

  function reReviewRevision(exchangeId: string) {
    const draft = revisionDrafts[exchangeId];
    if (!draft || draft.loading || !aiAvailable || !draft.copy.trim()) return;
    updateRevisionDraft(exchangeId, { loading: true, error: null });
    void api
      .analyzeContract({
        text: draft.copy,
        textScope: "full",
        question: "请复查这份修订副本，指出仍存在的风险。",
        conversation: [],
        intent: "review",
        cityCode,
        eventDate: signingDate || null,
      })
      .then(({ data }) => {
        updateRevisionDraft(exchangeId, { loading: false, result: data });
      })
      .catch((err) => {
        const error = err instanceof ApiError ? err : new ApiError("internal_error", errorMessage(err), false);
        updateRevisionDraft(exchangeId, { loading: false, error });
      });
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
          {latestRevisionExchangeId && (
            <Button variant="ghost" size="sm" onClick={() => openRevision(latestRevisionExchangeId)}>
              修订副本
              <span className="text-[11px] text-muted-foreground">{revisionExchangeIds.length}</span>
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
              onOpenRevision={openRevision}
              onQuickAction={(intent) => submit(intent)}
            />
            <div ref={endRef} className="scroll-mb-40" />
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

      <Sheet
        open={revisionTargetId != null}
        onOpenChange={(open) => {
          if (!open) setRevisionTargetId(null);
        }}
      >
        <SheetContent className="w-full sm:max-w-2xl">
          <div className="h-full overflow-y-auto p-4 pt-10">
            {revisionTarget && revisionDraft && (
              <RevisionCopyPanel
                draft={revisionDraft}
                sourceName={doc?.sourceName ?? ""}
                signingDate={signingDate}
                suggestions={revisionSuggestions}
                aiAvailable={aiAvailable}
                originalFindingCount={revisionTarget.result?.findings.length ?? null}
                onDraftChange={(patch) => {
                  if (revisionTargetId) updateRevisionDraft(revisionTargetId, patch);
                }}
                onReReview={() => {
                  if (revisionTargetId) reReviewRevision(revisionTargetId);
                }}
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
