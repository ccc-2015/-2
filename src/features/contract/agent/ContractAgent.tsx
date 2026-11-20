import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, FileSearch, FileText, MoreHorizontal, PencilLine, Printer, ShieldCheck, Sparkles } from "lucide-react";
import type { ContractIntent, ContractResult, Excerpt, Finding, ResponseMeta } from "@/shared/api";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModuleHeader } from "@/components/ModuleHeader";
import { PRIORITY_LABELS } from "@/shared/api";
import { analyzeContractStream, api, ApiError, errorMessage } from "../../../lib/api";
import { extractLocally, LOCAL_SITE } from "../../../lib/extractLocal";
import { useConfig } from "../../../lib/config-context";
import { useRegionCode } from "../../../lib/region";
import { newId, saveRecordChecked, type EvidenceRecord } from "../../evidence/store";
import { useRentalProfile } from "../../rental/profile";
import { Composer } from "./Composer";
import { ContractSheet } from "./ContractSheet";
import { historyBus, useHistoryRequest } from "./historyBus";
import { buildNegotiationDraft } from "./negotiationDraft";
import { RevisionPanel } from "./RevisionPanel";
import { ScrollRail } from "./ScrollRail";
import { Thread } from "./Thread";
import { buildReviewReport } from "./reviewReport";
import { downloadBlob } from "../../evidence/exportPackage";
import { printHtml } from "../../../lib/print";
import { getConsent, historySupported, listSessions, loadSession, saveSession } from "./history";
import { buildContext } from "./memory";
import {
  emptySession,
  sessionHasContent,
  type ContractSession,
  type SessionSummary,
} from "./session";
import {
  PASTE_META,
  type ContractDoc,
  type ContractDraft,
  type ContractVersion,
  type Exchange,
  type RevisionDraft,
  type RevisionSuggestion,
} from "./types";

const SAMPLE_CONTRACT = [
  "房屋租赁合同",
  "出租方（甲方）：张某　　承租方（乙方）：李某",
  "第一条 房屋位于郑州市金水区花园路 88 号 3 号楼 502，月租金 2600 元，押金 4000 元。",
  "第二条 租赁期限自 2026 年 3 月 1 日至 2027 年 2 月 28 日。",
  "第三条 乙方应于每月 5 日前支付租金，逾期每日加收 5% 滞纳金。",
  "第四条 租期届满、乙方结清费用并交还房屋后 30 日内退还押金；自然损耗由甲方负责维修。",
  "第五条 乙方提前退租的，押金不予退还，并需支付一个月租金作为违约金。",
  "第六条 甲方有权在提前 24 小时通知后进入房屋检查。",
  "第七条 保洁费 300 元、家电折旧费每月 200 元从押金中扣除。",
  "第八条 甲方可单方调整租金，提前 10 日通知乙方即可。",
].join(String.fromCharCode(10));

interface PendingConfirm {
  title: string;
  description: string;
  action: () => void;
}

function revisionListOf(exchange: Exchange | null): RevisionSuggestion[] {
  if (!exchange?.result) return [];
  const list = exchange.result.revisions?.length
    ? exchange.result.revisions
    : exchange.result.revision
      ? [exchange.result.revision]
      : [];
  return list.map((item, index) => ({
    id: `${exchange.id}:${index}`,
    kind: item.kind === "add" || item.kind === "modify" ? item.kind : item.targetExcerpt ? "modify" : "add",
    clauseLabel: item.clauseLabel?.trim() || (item.targetExcerpt ? "相关条款" : "新增条款"),
    title: item.title?.trim() || "",
    text: item.text,
    targetExcerpt: item.targetExcerpt ?? null,
    reason: item.reason?.trim() || "",
    uncertainties: item.uncertainties ?? [],
  }));
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
  const { doc, versions, exchanges, signingDate, versionRecordIds, saveNotice } = session;

  const [question, setQuestion] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<ApiError | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [activeExcerpt, setActiveExcerpt] = useState<Excerpt | null>(null);
  const [docView, setDocView] = useState<{ text: string; versionId: string | null } | null>(null);
  const [revisionTargetId, setRevisionTargetId] = useState<string | null>(null);
  const [autoOpenRevisionId, setAutoOpenRevisionId] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const [historyNotice, setHistoryNotice] = useState("");
  const [consent, setConsentState] = useState(() => getConsent());
  const [supported] = useState(() => historySupported());
  const historyRequest = useHistoryRequest();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const findingQueues = useRef(new Map<string, Finding[]>());
  const findingTimers = useRef(new Map<string, number>());
  const pendingResults = useRef(new Map<string, { data: ContractResult; meta: ResponseMeta; text: string }>());
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(0);

  const busy = exchanges.some((exchange) => exchange.loading);
  const empty = !doc && exchanges.length === 0;
  const currentVersion = doc ? versions.find((version) => version.id === doc.versionId) ?? null : null;
  const docDirty = !!doc && (!currentVersion || currentVersion.text !== doc.text);
  const sheetVersion = docView
    ? versions.find((version) => version.id === docView.versionId) ?? null
    : currentVersion;
  const sheetHistorical = !!doc && !!docView;
  const sheetDoc = doc
    ? docView
      ? {
          ...doc,
          text: docView.text,
          versionId: docView.versionId ?? doc.versionId,
          sourceName: sheetVersion?.sourceName ?? doc.sourceName,
          meta: sheetVersion?.meta ?? doc.meta,
        }
      : doc
    : null;
  const sheetSaved = !!sheetVersion && !!versionRecordIds[sheetVersion.id];
  const revisionExchangeIds = exchanges
    .filter((exchange) => revisionListOf(exchange).length > 0)
    .map((exchange) => exchange.id);
  const latestRevisionExchangeId = revisionExchangeIds.length
    ? revisionExchangeIds[revisionExchangeIds.length - 1]
    : null;
  const revisionTarget = revisionTargetId
    ? exchanges.find((exchange) => exchange.id === revisionTargetId) ?? null
    : null;
  const revisionDraft = revisionTargetId ? session.revisionDrafts[revisionTargetId] ?? null : null;
  const revisionSuggestions = revisionListOf(revisionTarget);
  const revisionSourceFindings = revisionDraft
    ? exchanges.find((exchange) => exchange.id === revisionDraft.sourceExchangeId)?.result?.findings ?? []
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
    const handler = () => {
      if (busy || uploading || !aiAvailable) return;
      const nextDoc: ContractDraft = { text: SAMPLE_CONTRACT, sourceName: "示例合同", meta: PASTE_META };
      const load = () => {
        const bound = startNewSession(nextDoc);
        if (bound) startReview(bound);
      };
      if (sessionHasContent(session)) {
        askConfirm("载入示例合同？", "当前合同与对话会被替换；已开启本机保存时会先存入历史。", load);
      } else {
        load();
      }
    };
    window.addEventListener("zzyj:trial-contract", handler);
    return () => window.removeEventListener("zzyj:trial-contract", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, uploading, aiAvailable, session]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [exchanges.length, busy]);

  useEffect(
    () => () => {
      findingTimers.current.forEach((timer) => window.clearTimeout(timer));
      findingTimers.current.clear();
      findingQueues.current.clear();
      pendingResults.current.clear();
    },
    [],
  );

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const sync = () => setComposerHeight(el.offsetHeight);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!autoOpenRevisionId) return;
    const exchange = exchanges.find((item) => item.id === autoOpenRevisionId);
    if (!exchange) return;
    if (revisionListOf(exchange).length > 0) {
      setAutoOpenRevisionId(null);
      openRevision(exchange.id);
    } else if (!exchange.loading) {
      setAutoOpenRevisionId(null);
    }
    // 只在新修订清单落库后打开一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenRevisionId, exchanges]);

  useEffect(() => {
    if (consent !== "on" || !supported || !sessionHasContent(session)) return;
    const timer = window.setTimeout(() => {
      void saveSession(session)
        .then(() => {
          setHistoryNotice("");
          void refreshHistory();
        })
        .catch(() => setHistoryNotice("本机历史保存失败，可能是浏览器存储受限或被禁用。"));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [session, consent, supported, refreshHistory]);

  function resetUi() {
    setQuestion("");
    setActiveExcerpt(null);
    setUploadError(null);
  }

  function startNewSession(nextDoc: ContractDraft | null): ContractDoc | null {
    if (!nextDoc) {
      setSession({ ...emptySession(), signingDate: profile.startDate });
      resetUi();
      setDocOpen(false);
      return null;
    }
    const createdAt = new Date().toISOString();
    const versionId = newId();
    const version: ContractVersion = {
      id: versionId,
      text: nextDoc.text,
      sourceName: nextDoc.sourceName,
      meta: nextDoc.meta,
      createdAt,
      label: "v1",
    };
    const boundDoc: ContractDoc = { ...nextDoc, versionId };
    setSession({
      ...emptySession(),
      doc: boundDoc,
      versions: [version],
      signingDate: profile.startDate,
    });
    resetUi();
    setDocOpen(false);
    return boundDoc;
  }

  /** 当前文本若与已有版本不同，先固化为新版本；审查、保存都以版本为准。 */
  function ensureCurrentVersion(): { version: ContractVersion; text: string } | null {
    if (!doc) return null;
    const current = versions.find((version) => version.id === doc.versionId);
    if (current && current.text === doc.text) return { version: current, text: doc.text };
    const versionId = newId();
    const createdAt = new Date().toISOString();
    const version: ContractVersion = {
      id: versionId,
      text: doc.text,
      sourceName: doc.sourceName,
      meta: doc.meta,
      createdAt,
      label: `v${versions.length + 1}`,
    };
    patch((currentSession) => ({
      versions: [...currentSession.versions, version],
      doc: currentSession.doc ? { ...currentSession.doc, versionId } : null,
    }));
    return { version, text: doc.text };
  }

  function askConfirm(title: string, description: string, action: () => void) {
    setPendingConfirm({ title, description, action });
  }

  function clearFindingStream(id: string) {
    const timer = findingTimers.current.get(id);
    if (timer) window.clearTimeout(timer);
    findingTimers.current.delete(id);
    findingQueues.current.delete(id);
    pendingResults.current.delete(id);
  }

  async function run(
    id: string,
    displayQuestion: string,
    intent: ContractIntent,
    context: ReturnType<typeof buildContext>,
    text: string,
    eventDate: string = signingDate,
    modelPrompt?: string,
  ) {
    clearFindingStream(id);
    patch((current) => ({
      exchanges: current.exchanges.map((exchange) =>
        exchange.id === id
          ? { ...exchange, loading: true, error: null, stage: "reading", partialAnswer: "", streamFindings: [] }
          : exchange,
      ),
    }));

    const update = (next: Partial<Exchange>) =>
      patch((current) => ({
        exchanges: current.exchanges.map((exchange) =>
          exchange.id === id ? { ...exchange, ...next } : exchange,
        ),
      }));

    const applyResult = (data: ContractResult, meta: ResponseMeta, resultText: string) =>
      update({
        loading: false,
        result: data,
        meta,
        docText: resultText,
        stage: null,
        partialAnswer: "",
        streamFindings: [],
      });

    // 逐条展示风险卡：即使多条事件同时到达，也按队列一条一条出现。
    const finishPending = (pending: { data: ContractResult; meta: ResponseMeta; text: string }) => {
      // 给最后一张卡的逐字展示留出完成时间，避免结果一到就整块替换。
      const delay = pending.data.findings.length > 0 ? 900 : 0;
      window.setTimeout(() => applyResult(pending.data, pending.meta, pending.text), delay);
    };

    const revealNext = () => {
      if (findingTimers.current.has(id)) return;
      const tick = () => {
        const queue = findingQueues.current.get(id) ?? [];
        const next = queue.shift();
        if (next) {
          patch((current) => ({
            exchanges: current.exchanges.map((exchange) =>
              exchange.id === id
                ? { ...exchange, streamFindings: [...(exchange.streamFindings ?? []), next] }
                : exchange,
            ),
          }));
        }
        if (queue.length > 0) {
          findingTimers.current.set(id, window.setTimeout(tick, 150));
          return;
        }
        findingTimers.current.delete(id);
        findingQueues.current.delete(id);
        const pending = pendingResults.current.get(id);
        if (pending) {
          pendingResults.current.delete(id);
          finishPending(pending);
        }
      };
      findingTimers.current.set(id, window.setTimeout(tick, 150));
    };

    let receivedFindings = 0;
    await analyzeContractStream(
      {
        text,
        textScope: "full",
        question: modelPrompt ?? displayQuestion,
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
        onFinding: (finding) => {
          receivedFindings += 1;
          const queue = findingQueues.current.get(id) ?? [];
          queue.push(finding);
          findingQueues.current.set(id, queue);
          revealNext();
        },
        onResult: (data, meta) => {
          // 兜底：若逐条事件丢失，仍按结果里的风险卡逐条展示。
          if (data.findings.length > 0 && receivedFindings === 0) {
            findingQueues.current.set(id, [...data.findings]);
            revealNext();
          }
          pendingResults.current.set(id, { data, meta, text });
          if ((data.revisions?.length ?? 0) > 0) setAutoOpenRevisionId(id);
          const queue = findingQueues.current.get(id);
          if (!findingTimers.current.has(id) && (!queue || queue.length === 0)) {
            pendingResults.current.delete(id);
            finishPending({ data, meta, text });
          } else {
            revealNext();
          }
        },
        onError: (error) => {
          clearFindingStream(id);
          update({ loading: false, error, stage: null, partialAnswer: "" });
        },
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
          docVersionId: nextDoc.versionId,
          result: null,
          meta: null,
          error: null,
          loading: true,
        },
      ],
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
      // 公网版没有 Python 后端，文件在本机浏览器解析；本地开发仍可走 /api 的后端抽取。
      const data = LOCAL_SITE ? await extractLocally(files) : (await api.extractMany(files)).data;
      const nextDoc: ContractDraft = {
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
      if (!nextDoc.text.trim()) {
        setUploadError(
          new ApiError("invalid_input", "未识别到合同文本，请换一张更清晰的文件，或在合同文本中手动补充。", false),
        );
        return;
      }
      const bound = startNewSession(nextDoc);
      // 图片 OCR、PDF 空页/只解析前 50 页等情况先打开原文核对，避免基于不完整文本直接审查。
      const pageIssue =
        data.pages.some((page) => !page.text.trim()) ||
        data.warnings.some((warning) => warning.includes("仅解析前 50 页"));
      const needsTextCheck = (LOCAL_SITE && data.ocrUsed) || pageIssue;
      if (needsTextCheck) setDocOpen(true);
      if (needsTextCheck) return;
      if (bound) startReview(bound);
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

  function submit() {
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
      const nextDoc: ContractDraft = { text: trimmed, sourceName: "粘贴文本", meta: PASTE_META };
      const bound = startNewSession(nextDoc);
      if (bound) startReview(bound);
      return;
    }

    if (!trimmed) return;
    const bound = ensureCurrentVersion();
    if (!bound) return;

    const id = newId();
    const context = buildContext(exchanges);
    setQuestion("");
    patch((current) => ({
      exchanges: [
        ...current.exchanges,
        {
          id,
          question: trimmed,
          intent: "ask",
          docText: bound.text,
          docVersionId: bound.version.id,
          result: null,
          meta: null,
          error: null,
          loading: true,
        },
      ],
    }));
    void run(id, trimmed, "ask", context, bound.text);
  }

  function retry(id: string) {
    const index = exchanges.findIndex((exchange) => exchange.id === id);
    if (index === -1 || busy || !doc) return;
    const exchange = exchanges[index];
    void run(
      id,
      exchange.question,
      exchange.intent,
      buildContext(exchanges.slice(0, index)),
      exchange.docText ?? doc.text,
      signingDate,
      exchange.prompt,
    );
  }

  function reReview() {
    if (!doc || busy || !aiAvailable) return;
    const bound = ensureCurrentVersion();
    if (!bound) return;
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
          docText: bound.text,
          docVersionId: bound.version.id,
          result: null,
          meta: null,
          error: null,
          loading: true,
        },
      ],
    }));
    void run(id, reviewQuestion, "review", context, bound.text);
  }

  function requestRevision(sourceExchangeId: string) {
    if (busy || !aiAvailable) return;
    const source = exchanges.find((exchange) => exchange.id === sourceExchangeId);
    if (!source?.result || source.result.findings.length === 0) return;
    const sourceVersion = versions.find((item) => item.id === source.docVersionId);
    const text = source.docText ?? sourceVersion?.text ?? doc?.text ?? "";
    if (!text.trim()) return;
    const versionId = source.docVersionId ?? doc?.versionId ?? "";
    const issueLines = source.result.findings
      .map((finding, index) => {
        const priority = PRIORITY_LABELS[finding.priority] ?? finding.priority;
        return `${index + 1}. [${priority}] ${finding.issue}${finding.excerpt ? `｜原文：${finding.excerpt.text}` : ""}`;
      })
      .join("\n");
    const displayQuestion = "请根据审查结果生成条款修改建议。";
    const modelPrompt = `请基于以下已发现的问题，给出可逐条采纳的条款修改建议：\n${issueLines}`;
    const id = newId();
    setQuestion("");
    patch((current) => ({
      exchanges: [
        ...current.exchanges,
        {
          id,
          question: displayQuestion,
          prompt: modelPrompt,
          intent: "suggest_revision",
          docText: text,
          docVersionId: versionId,
          sourceExchangeId,
          result: null,
          meta: null,
          error: null,
          loading: true,
        },
      ],
    }));
    void run(id, displayQuestion, "suggest_revision", buildContext(exchanges), text, signingDate, modelPrompt);
  }

  function openRevision(exchangeId: string) {
    const exchange = exchanges.find((item) => item.id === exchangeId);
    if (!exchange || revisionListOf(exchange).length === 0) return;
    const originalText = exchange.docText ?? doc?.text ?? "";
    const version = versions.find((item) => item.id === exchange.docVersionId);
    const index = exchanges.findIndex((item) => item.id === exchangeId);
    const sourceExchangeId =
      exchange.sourceExchangeId ??
      [...exchanges.slice(0, Math.max(0, index))].reverse().find((item) => item.intent === "review")?.id ??
      exchangeId;
    patch((current) => {
      if (current.revisionDrafts[exchangeId]) return {};
      const draft: RevisionDraft = {
        exchangeId,
        versionId: exchange.docVersionId ?? version?.id ?? doc?.versionId ?? "",
        versionLabel: version?.label ?? "历史快照",
        sourceExchangeId,
        originalText,
        baseText: originalText,
        copy: originalText,
        applied: [],
        appliedTexts: {},
        selected: [],
        notice: "",
        archiveNotice: "",
        archivedId: null,
        signedNotice: "",
        signedRecordId: null,
        result: null,
        error: null,
        loading: false,
      };
      return { revisionDrafts: { ...current.revisionDrafts, [exchangeId]: draft } };
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
    const draft = session.revisionDrafts[exchangeId];
    if (!draft || draft.loading || !aiAvailable || !draft.copy.trim()) return;
    updateRevisionDraft(exchangeId, { loading: true, error: null, result: null });
    void api
      .analyzeContract({
        text: draft.copy,
        textScope: "full",
        question: "请复查这份协商副本，指出仍存在的问题和需要确认的事项。",
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

  function exportNegotiationDraft(exchangeId: string) {
    const draft = session.revisionDrafts[exchangeId];
    const exchange = exchanges.find((item) => item.id === exchangeId);
    if (!draft || !exchange) return;
    const { html, fileName } = buildNegotiationDraft({
      draft,
      suggestions: revisionListOf(exchange),
      sourceName: doc?.sourceName ?? "合同",
      signingDate,
    });
    downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), fileName);
  }

  function saveNegotiationCopy(exchangeId: string) {
    const draft = session.revisionDrafts[exchangeId];
    if (!draft || !draft.copy.trim()) return;
    const existingId = draft.archivedId;
    const record: EvidenceRecord = {
      id: existingId ?? newId(),
      stage: "signing",
      occurredAt: signingDate || null,
      recordedAt: new Date().toISOString(),
      description: `合同协商副本 ${draft.versionLabel}（未签署，${draft.copy.length} 字符，已采纳 ${draft.applied.length} 条）`,
      contractClause: "",
      materialName: `${doc?.sourceName ?? "合同"} · 协商副本 ${draft.versionLabel}`,
      materialType: "合同协商副本",
      materialStatus: "to_confirm",
      amountCents: null,
      reading: null,
      content: draft.copy,
      originalText: draft.baseText,
      contractVersionId: draft.versionId,
      contractVersionLabel: draft.versionLabel,
    };
    if (!saveRecordChecked(record, existingId != null)) {
      updateRevisionDraft(exchangeId, {
        archiveNotice: "未能写入本机存储，协商副本未保存。请清理浏览器空间或允许本站使用存储后重试。",
      });
      return;
    }
    updateRevisionDraft(exchangeId, {
      archivedId: record.id,
      archiveNotice: existingId
        ? "已更新协商副本（未签署）。原合同与签署版本不受影响。"
        : "已留存协商副本（未签署），可在证据画布查看。",
    });
  }

  function saveSignedVersion(exchangeId: string) {
    const draft = session.revisionDrafts[exchangeId];
    if (!draft || !draft.copy.trim()) return;
    if (draft.copy.includes("待补")) {
      updateRevisionDraft(exchangeId, {
        signedNotice: "副本中仍有〔待补〕项，请填写或删除占位后再存为签署版本。",
      });
      return;
    }
    const existingId = draft.signedRecordId;
    const record: EvidenceRecord = {
      id: existingId ?? newId(),
      stage: "signing",
      occurredAt: signingDate || null,
      recordedAt: new Date().toISOString(),
      description: `签署版本 ${draft.versionLabel}（我方确认，不代表对方同意，${draft.copy.length} 字符）`,
      contractClause: "",
      materialName: `${doc?.sourceName ?? "合同"} · 签署版本`,
      materialType: "签署版本",
      materialStatus: "present",
      amountCents: null,
      reading: null,
      content: draft.copy,
      originalText: draft.baseText,
      contractVersionId: draft.versionId,
      contractVersionLabel: draft.versionLabel,
    };
    if (!saveRecordChecked(record, existingId != null)) {
      updateRevisionDraft(exchangeId, {
        signedNotice: "未能写入本机存储，签署版本未保存。请清理浏览器空间或允许本站使用存储后重试。",
      });
      return;
    }
    updateRevisionDraft(exchangeId, {
      signedRecordId: record.id,
      signedNotice: "已留存签署版本，仅代表我方确认，不代表对方已同意。",
    });
  }

  function openDoc(excerpt: Excerpt | null = null, sourceText?: string, sourceVersionId?: string) {
    setActiveExcerpt(excerpt);
    const versionText = sourceVersionId
      ? versions.find((version) => version.id === sourceVersionId)?.text
      : undefined;
    const text = sourceText ?? versionText;
    setDocView(
      text && (!doc || text !== doc.text) ? { text, versionId: sourceVersionId ?? null } : null,
    );
    setDocOpen(true);
  }

  function handleDocOpenChange(open: boolean) {
    setDocOpen(open);
    if (!open) {
      setActiveExcerpt(null);
      setDocView(null);
    }
  }

  function updateDocText(text: string) {
    patch((current) => ({
      doc: current.doc ? { ...current.doc, text } : current.doc,
      saveNotice: "",
    }));
  }

  function saveDocEvidence() {
    if (!doc || !doc.text.trim()) return;
    const bound = ensureCurrentVersion();
    if (!bound) return;
    const existingId = versionRecordIds[bound.version.id] ?? null;
    const record: EvidenceRecord = {
      id: existingId ?? newId(),
      stage: "signing",
      occurredAt: signingDate || null,
      recordedAt: new Date().toISOString(),
      description: `合同原文 ${bound.version.label}（我方留存，${bound.text.length} 字符）`,
      contractClause: "",
      materialName: `${doc.sourceName} · ${bound.version.label}`,
      materialType: "合同原文",
      materialStatus: "present",
      amountCents: null,
      reading: null,
      content: bound.text,
      contractVersionId: bound.version.id,
      contractVersionLabel: bound.version.label,
    };
    if (!saveRecordChecked(record, existingId != null)) {
      patch({ saveNotice: "未能写入本机存储，合同原文未保存。请清理浏览器空间或允许本站使用存储后重试。" });
      return;
    }
    patch((current) => ({
      versionRecordIds: { ...current.versionRecordIds, [bound.version.id]: record.id },
      saveNotice: existingId
        ? `已更新合同原文 ${bound.version.label}（其他版本记录不受影响）。`
        : `已留存合同原文 ${bound.version.label}，可在证据画布查看。`,
    }));
  }

  function exportReport(mode: "html" | "print" = "html") {
    const latest = [...exchanges].reverse().find((exchange) => exchange.intent === "review" && exchange.result);
    if (!latest?.result) return;
    const { html, json, fileName } = buildReviewReport({
      result: latest.result,
      knowledgeVersion: latest.meta?.knowledgeVersion ?? null,
      warnings: latest.meta?.warnings ?? [],
      docName: doc?.sourceName ?? "合同",
      docText: latest.docText ?? doc?.text ?? "",
      signingDate,
      profile,
      exchanges,
    });
    if (mode === "print") {
      printHtml(html);
      return;
    }
    downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), `${fileName}.html`);
    setTimeout(
      () => downloadBlob(new Blob([json], { type: "application/json;charset=utf-8" }), `${fileName}.json`),
      400,
    );
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
          setHistoryNotice("");
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
      className="flex h-full min-h-0 w-full flex-col overflow-hidden"
      onDragOver={(event) => {
        event.preventDefault();
        if (!uploading) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <ModuleHeader
        icon={FileSearch}
        purpose="审查合同：对照法规标出风险与依据"
        tone="text-stage-living"
        actions={
          <>
            {doc && (
              <Button variant="ghost" size="sm" onClick={() => openDoc()} className="hidden sm:inline-flex">
                <FileText className="size-3.5" />
                合同文本
              </Button>
            )}
            {latestRevisionExchangeId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => openRevision(latestRevisionExchangeId)}
                className="px-2 sm:px-3"
                aria-label="协商副本"
              >
                <PencilLine className="size-3.5" />
                <span className="hidden sm:inline">协商副本</span>
              </Button>
            )}
            {!latestRevisionExchangeId && sessionHasContent(session) && (
              <Button variant="ghost" size="sm" onClick={newChat}>
                新对话
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" aria-label="更多操作">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {latestRevisionExchangeId && sessionHasContent(session) && (
                  <DropdownMenuItem onSelect={newChat}>新对话</DropdownMenuItem>
                )}
                {doc && (
                  <DropdownMenuItem onSelect={() => openDoc()} className="sm:hidden">
                    <FileText className="size-3.5" />
                    合同文本
                  </DropdownMenuItem>
                )}
                {onNavigate && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onNavigate("evidence")}>去证据画布</DropdownMenuItem>
                  </>
                )}
                {exchanges.some((exchange) => exchange.result) && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => exportReport("html")}>
                      <Download className="size-3.5" />
                      导出审查报告
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => exportReport("print")}>
                      <Printer className="size-3.5" />
                      打印 / 存为 PDF
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        {empty ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-thin">
            <div className="mx-auto flex w-full max-w-[1024px] flex-1 flex-col px-4 pb-44 pt-6 text-center md:px-8">
            <div className="my-auto flex w-full flex-col items-center">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-foreground text-background shadow-sm">
              <ShieldCheck className="size-5" />
            </span>
            <h2 className="mt-4 text-[22px] font-semibold tracking-tight">把合同发给我</h2>
            <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted-foreground">
              上传合同图片、PDF（支持多张/多页，可一次多选），或直接粘贴合同文本。
            </p>

            <div className="mt-5 grid w-full max-w-md grid-cols-3 gap-2">
              {[
                { step: "1", label: "上传或粘贴", detail: "PDF、图片、文本都行" },
                { step: "2", label: "自动审查", detail: ["ZZ", "WH", "HZ"].includes(cityCode) ? "全国与本地审核资料" : "对照全国性法律资料" },
                { step: "3", label: "看风险与依据", detail: "可继续追问" },
              ].map((item) => (
                <div key={item.step} className="rounded-xl border border-border/70 bg-background px-2 py-2.5">
                  <span className="flex size-5 items-center justify-center rounded-full bg-secondary text-[10px] font-medium">
                    {item.step}
                  </span>
                  <p className="mt-1.5 text-[12px] font-medium">{item.label}</p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{item.detail}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 w-full max-w-md rounded-2xl border border-dashed border-foreground/15 bg-secondary/40 px-4 py-3 text-center">
              <p className="flex items-center justify-center gap-1.5 text-[11px] font-medium">
                <Sparkles className="size-3.5 text-stage-living" />
                第一次用？先看示例，不用准备材料
              </p>
              <Button
                size="sm"
                className="mt-2"
                onClick={() => {
                  const nextDoc: ContractDraft = { text: SAMPLE_CONTRACT, sourceName: "示例合同", meta: PASTE_META };
                  const bound = startNewSession(nextDoc);
                  if (bound) startReview(bound);
                }}
                disabled={busy || uploading || !aiAvailable}
              >
                试用示例合同
              </Button>
              <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                示例包含押金不退、单方涨租、保洁折旧等常见问题，点一下就能看完整审查结果。
              </p>
            </div>
            </div>
          </div>
          </div>
        ) : (
          <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-none">
            <div className="mx-auto w-full max-w-[1024px] px-4 pb-44 pt-5 md:px-8">
              <div className="mx-auto w-full max-w-[880px]">
                <Thread
                  exchanges={exchanges}
                  versions={versions}
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
                  onRequestRevision={requestRevision}
                  onOpenRevision={openRevision}
                  revisionAvailable={!busy && aiAvailable}
                />
              </div>
            </div>
          </div>
        )}

        {!empty && <ScrollRail targetRef={threadRef} bottomOffset={composerHeight + 8} />}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
          <div
            ref={composerRef}
            className="pointer-events-auto relative mx-auto w-full max-w-[912px] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:max-w-[944px] md:px-8"
          >
            {historyNotice && (
              <div
                role="alert"
                className="mb-2 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700"
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {historyNotice}
              </div>
            )}
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
            </div>
        </div>
      </div>

      <ContractSheet
        open={docOpen}
        onOpenChange={handleDocOpenChange}
        doc={sheetDoc}
        signingDate={signingDate}
        onSigningDateChange={(value) => patch({ signingDate: value })}
        onTextChange={updateDocText}
        onReReview={reReview}
        onSaveEvidence={saveDocEvidence}
        saveNotice={saveNotice}
        saved={sheetSaved}
        historical={sheetHistorical}
        dirty={docDirty && !sheetHistorical}
        versionLabel={sheetVersion?.label ?? (sheetHistorical ? "历史快照" : null)}
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
              <RevisionPanel
                draft={revisionDraft}
                suggestions={revisionSuggestions}
                sourceFindings={revisionSourceFindings}
                aiAvailable={aiAvailable}
                onDraftChange={(next) => {
                  if (revisionTargetId) updateRevisionDraft(revisionTargetId, next);
                }}
                onReReview={() => {
                  if (revisionTargetId) reReviewRevision(revisionTargetId);
                }}
                onExport={() => {
                  if (revisionTargetId) exportNegotiationDraft(revisionTargetId);
                }}
                onSaveNegotiation={() => {
                  if (revisionTargetId) saveNegotiationCopy(revisionTargetId);
                }}
                onSaveSigned={() => {
                  if (revisionTargetId) saveSignedVersion(revisionTargetId);
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
