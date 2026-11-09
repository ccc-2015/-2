import { useCallback, useEffect, useRef, useState } from "react";
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
import { analyzeContractStream, api, ApiError, errorMessage } from "../../../lib/api";
import { useConfig } from "../../../lib/config-context";
import { useRegionCode } from "../../../lib/region";
import { newId, saveRecordChecked, type EvidenceRecord } from "../../evidence/store";
import { useRentalProfile } from "../../rental/profile";
import { Composer } from "./Composer";
import { ContractSheet } from "./ContractSheet";
import { historyBus, useHistoryRequest } from "./historyBus";
import { RevisionCopyPanel } from "./ResultCards";
import { Thread } from "./Thread";
import {
  formatSessionTime,
  getConsent,
  historySupported,
  listSessions,
  loadSession,
  saveSession,
} from "./history";
import { buildContext } from "./memory";
import {
  emptySession,
  sessionHasContent,
  type ContractSession,
  type SessionSummary,
} from "./session";
import {
  PASTE_META,
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

export function ContractAgent({
  onNavigate,
  onSessionChange,
}: {
  onNavigate?: (view: "evidence" | "dispute") => void;
  onSessionChange?: (id: string) => void;
} = {}) {
  const { config } = useConfig();
  const cityCode = useRegionCode();
  const profile = useRentalProfile();
  const aiAvailable = config?.aiAvailable ?? false;
  const maxText = config?.limits.maxTextLength ?? 50000;

  const [session, setSession] = useState<ContractSession>(() => emptySession());
  const { doc, exchanges, revisionDrafts, signingDate, textRecordId, saveNotice } = session;

  const [question, setQuestion] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<ApiError | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [activeExcerpt, setActiveExcerpt] = useState<Excerpt | null>(null);
  const [revisionTargetId, setRevisionTargetId] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const [historyNotice, setHistoryNotice] = useState("");
  const [consent, setConsentState] = useState(() => getConsent());
  const [supported] = useState(() => historySupported());
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const historyRequest = useHistoryRequest();

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

  const patch = useCallback(
    (next: Partial<ContractSession> | ((current: ContractSession) => Partial<ContractSession>)) => {
      setSession((current) => ({
        ...current,
        ...(typeof next === "function" ? next(current) : next),
        updatedAt: new Date().toISOString(),
      }));
    },
    [],
  );

  const refreshHistory = useCallback(async () => {
    await historyBus.refresh();
  }, []);

  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    if (getConsent() !== "on" || !historySupported()) return;
    void historyBus
      .refresh()
      .then(async () => {
        const items = await listSessions();
        if (items.length === 0) return;
        const loaded = await loadSession(items[0].id);
        if (!loaded) return;
        setSession((current) => (sessionHasContent(current) ? current : loaded));
        setSavedAt(loaded.updatedAt);
        void historyBus.refresh();
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!historyRequest) return;
    const action = historyBus.take();
    if (!action) return;
    if (action.kind === "new") {
      if (sessionHasContent(session)) {
        newChat();
      } else {
        resetAll();
      }
      return;
    }
    openHistorySession(action.id);
    // 仅在左栏发出新请求时消费一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyRequest]);

  useEffect(() => {
    onSessionChange?.(session.id);
  }, [session.id, onSessionChange]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [exchanges.length, busy]);

  useEffect(() => {
    if (consent !== "on" || !supported || !sessionHasContent(session)) return;
    const timer = window.setTimeout(() => {
      void saveSession(session)
        .then(() => {
          setSavedAt(session.updatedAt);
          void refreshHistory();
        })
        .catch(() => setHistoryNotice("本机历史保存失败，可能是浏览器存储受限或被禁用。"));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [session, consent, supported, refreshHistory]);

  function resetUi() {
    setQuestion("");
    setActiveExcerpt(null);
    setRevisionTargetId(null);
    setUploadError(null);
  }

  function startNewSession(nextDoc: ContractDoc | null) {
    setSession({ ...emptySession(), doc: nextDoc, signingDate: profile.startDate });
    resetUi();
    setDocOpen(false);
    setSavedAt(null);
  }

  function askConfirm(title: string, description: string, action: () => void) {
    setPendingConfirm({ title, description, action });
  }

  async function run(
    id: string,
    displayQuestion: string,
    intent: ContractIntent,
    context: ReturnType<typeof buildContext>,
    text: string,
    eventDate: string = signingDate,
  ) {
    patch((current) => ({
      exchanges: current.exchanges.map((exchange) =>
        exchange.id === id
          ? { ...exchange, loading: true, error: null, stage: "reading", partialAnswer: "" }
          : exchange,
      ),
    }));

    const update = (next: Partial<Exchange>) =>
      patch((current) => ({
        exchanges: current.exchanges.map((exchange) =>
          exchange.id === id ? { ...exchange, ...next } : exchange,
        ),
      }));

    await analyzeContractStream(
      {
        text,
        textScope: "full",
        question: displayQuestion,
        conversation: context.conversation,
        memory: context.memory,
        intent,
        cityCode,
        eventDate: eventDate || null,
      },
      {
        onStage: ({ stage }) => update({ stage }),
        onDelta: (chunk) =>
          patch((current) => ({
            exchanges: current.exchanges.map((exchange) =>
              exchange.id === id
                ? { ...exchange, stage: "generating", partialAnswer: (exchange.partialAnswer ?? "") + chunk }
                : exchange,
            ),
          })),
        onResult: (data, meta) =>
          update({ loading: false, result: data, meta, docText: text, stage: null, partialAnswer: "" }),
        onError: (error) => update({ loading: false, error, stage: null, partialAnswer: "" }),
      },
    );
  }

  function startReview(nextDoc: ContractDoc) {
    const id = newId();
    const reviewQuestion = "请审查这份合同。";
    setQuestion("");
    patch({
      exchanges: [
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
      ],
      revisionDrafts: {},
      textRecordId: null,
      saveNotice: "",
    });
    void run(id, reviewQuestion, "review", { conversation: [], memory: null }, nextDoc.text, profile.startDate);
  }

  async function extractFiles(files: File[]) {
    if (uploading || busy || files.length === 0) return;
    setUploadError(null);
    const maxBytes = config?.limits.maxFileBytes ?? 10 * 1024 * 1024;
    const oversized = files.find((item) => item.size > maxBytes);
    if (oversized) {
      setUploadError(
        new ApiError(
          "payload_too_large",
          `${oversized.name} 超过 ${Math.round(maxBytes / 1024 / 1024)}MB 限制，请压缩后再上传或直接粘贴文本。`,
          false,
        ),
      );
      return;
    }
    setUploading(true);
    try {
      const { data } = files.length === 1 ? await api.extract(files[0]) : await api.extractMany(files);
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
      startNewSession(nextDoc);
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

  function handleFiles(files: File[]) {
    if (uploading || busy || files.length === 0) return;
    if (sessionHasContent(session)) {
      askConfirm("开始审查新合同？", "当前合同与对话将被替换；已开启本机保存时会先存入历史，已存为证据的内容不受影响。", () =>
        void extractFiles(files),
      );
    } else {
      void extractFiles(files);
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
      startNewSession(nextDoc);
      startReview(nextDoc);
      return;
    }

    if (!trimmed && !override) return;
    const intent = override ?? "ask";
    const displayQuestion = trimmed || defaultQuestion(intent);
    if (!displayQuestion) return;

    const id = newId();
    const context = buildContext(exchanges);
    setQuestion("");
    patch((current) => ({
      exchanges: [
        ...current.exchanges,
        { id, question: displayQuestion, intent, docText: doc.text, result: null, meta: null, error: null, loading: true },
      ],
    }));
    void run(id, displayQuestion, intent, context, doc.text);
  }

  function retry(id: string) {
    const index = exchanges.findIndex((exchange) => exchange.id === id);
    if (index === -1 || busy || !doc) return;
    const exchange = exchanges[index];
    patch((current) => {
      if (!current.revisionDrafts[id]) return {};
      const next = { ...current.revisionDrafts };
      delete next[id];
      return { revisionDrafts: next };
    });
    if (revisionTargetId === id) setRevisionTargetId(null);
    void run(id, exchange.question, exchange.intent, buildContext(exchanges.slice(0, index)), doc.text);
  }

  function reReview() {
    if (!doc || busy || !aiAvailable) return;
    setDocOpen(false);
    setActiveExcerpt(null);
    const id = newId();
    const reviewQuestion = "请重新审查这份合同。";
    const context = buildContext(exchanges);
    patch((current) => ({
      exchanges: [
        ...current.exchanges,
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
      ],
    }));
    void run(id, reviewQuestion, "review", context, doc.text);
  }

  function openRevision(exchangeId: string) {
    const exchange = exchanges.find((item) => item.id === exchangeId);
    if (!exchange?.result?.revision) return;
    const originalText = exchange.docText ?? doc?.text ?? "";
    patch((current) => {
      if (current.revisionDrafts[exchangeId]) return {};
      return {
        revisionDrafts: {
          ...current.revisionDrafts,
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
        },
      };
    });
    setRevisionTargetId(exchangeId);
  }

  function updateRevisionDraft(exchangeId: string, next: Partial<RevisionDraft>) {
    patch((current) => {
      const draft = current.revisionDrafts[exchangeId];
      if (!draft) return {};
      return { revisionDrafts: { ...current.revisionDrafts, [exchangeId]: { ...draft, ...next } } };
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
    patch((current) => ({
      doc: current.doc ? { ...current.doc, text } : current.doc,
      saveNotice: "",
    }));
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
      patch({ saveNotice: "本地存储空间不足，未能保存。" });
      return;
    }
    patch({
      textRecordId: record.id,
      saveNotice: existing ? "已更新证据画布中的合同原文。" : "已存为签约证据，可在证据画布查看。",
    });
  }

  function flushCurrent() {
    if (consent !== "on" || !sessionHasContent(session)) return;
    void saveSession(session).then(refreshHistory).catch(() => undefined);
  }

  function resetAll() {
    flushCurrent();
    setSession(emptySession());
    setDocOpen(false);
    resetUi();
    setSavedAt(null);
  }

  function newChat() {
    if (!sessionHasContent(session)) return;
    askConfirm(
      "开始新对话？",
      consent === "on"
        ? "当前会话已保存在本机历史，可随时重新打开；已存为证据的内容不受影响。"
        : "当前合同与对话将被清空，不会保存；已存为证据的内容不受影响。",
      resetAll,
    );
  }

  function acceptHistory() {
    setConsentState("on");
    historyBus.setConsent("on");
    setHistoryNotice("");
    if (sessionHasContent(session)) {
      void saveSession(session)
        .then(() => {
          setSavedAt(session.updatedAt);
          void refreshHistory();
        })
        .catch(() => setHistoryNotice("本机历史保存失败，可能是浏览器存储受限或被禁用。"));
    }
  }

  function declineHistory() {
    setConsentState("off");
    historyBus.setConsent("off");
  }

  function changeConsent(value: "on" | "off") {
    setConsentState(value);
    historyBus.setConsent(value);
    if (value === "on") {
      setHistoryNotice("");
      if (sessionHasContent(session)) {
        void saveSession(session)
          .then(() => {
            setSavedAt(session.updatedAt);
            void refreshHistory();
          })
          .catch(() => setHistoryNotice("本机历史保存失败，可能是浏览器存储受限或被禁用。"));
      }
    } else {
      setHistoryNotice("已关闭自动保存；已存历史不会被删除，可手动清空。");
    }
  }

  function openHistorySession(id: string) {
    if (busy) return;
    if (id === session.id) return;
    const proceed = async () => {
      flushCurrent();
      try {
        const loaded = await loadSession(id);
        if (!loaded) {
          setHistoryNotice("这条历史已不存在，可能已被删除。");
          void refreshHistory();
          return;
        }
        setSession(loaded);
        resetUi();
        setDocOpen(false);
        setSavedAt(loaded.updatedAt);
        void historyBus.refresh();
      } catch {
        setHistoryNotice("读取本机历史失败，请稍后重试。");
      }
    };
    if (sessionHasContent(session)) {
      askConfirm(
        "打开这条历史？",
        consent === "on" ? "当前会话会先存入本机历史，然后打开所选记录。" : "当前未保存的合同与对话将被替换。",
        () => void proceed(),
      );
    } else {
      void proceed();
    }
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragOver(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0 && !uploading && !busy) handleFiles(files);
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
          {onNavigate && (
            <Button variant="ghost" size="sm" onClick={() => onNavigate("evidence")}>
              证据画布
            </Button>
          )}
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
          {sessionHasContent(session) && (
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
              上传合同图片、PDF（支持多张/多页，可一次多选），或直接粘贴合同文本；我会先看押金、退租和维修责任。
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
            {consent === "unset" && supported && sessionHasContent(session) && (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-secondary/50 px-3 py-2">
                <ShieldCheck className="size-3.5 shrink-0 text-muted-foreground" />
                <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground">
                  把合同与对话保存在本浏览器？不上传服务器，可随时删除。
                </p>
                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={acceptHistory}>
                  保存到本机
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={declineHistory}>
                  不用了
                </Button>
              </div>
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
              onFiles={handleFiles}
              textareaRef={textareaRef}
            />
            <p className="mt-1.5 text-center text-[10px] leading-relaxed text-muted-foreground">
              {!aiAvailable
                ? "服务端未配置模型密钥，审查暂不可用。"
                : consent === "on"
                  ? `AI 辅助意见，不构成法律结论；请核对原文。合同与对话仅保存在本浏览器，可随时删除。${
                      savedAt ? ` 已保存 ${formatSessionTime(savedAt)}` : ""
                    }`
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
        onSigningDateChange={(value) => patch({ signingDate: value })}
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
                onDraftChange={(next) => {
                  if (revisionTargetId) updateRevisionDraft(revisionTargetId, next);
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
