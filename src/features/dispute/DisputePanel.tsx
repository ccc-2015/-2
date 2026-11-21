import { useEffect, useRef, useState } from "react";
import {
  Scale,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  Loader2,
  ShieldAlert,
  ClipboardCopy,
  RotateCw,
  CalendarClock,
  AlertTriangle,
  Check,
  BookmarkPlus,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import { HelpTip } from "@/components/HelpTip";
import { ModuleHeader } from "@/components/ModuleHeader";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SourceList } from "@/components/SourceList";
import { EVIDENCE_STATUS_LABELS, type DisputeResult, type ResponseMeta } from "@/shared/api";
import { disputePrefill, useDisputePrefill } from "../evidence/disputePrefill";
import {
  clearDraft,
  formatDraftTime,
  getDraftConsent,
  loadDraft,
  saveDraft,
  setDraftConsent,
  type DisputeDraft,
  type DraftConsent,
} from "./draft";
import { loadEvidenceSample } from "../evidence/sample";
import { useConfig } from "../../lib/config-context";
import { useRegionCode } from "../../lib/region";
import { api, ApiError, errorMessage } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import type { ViewId } from "../../components/AppShell";
import {
  useEvidenceRecords,
  useSelectedIds,
  selection,
  toSelectedEvidence,
  defaultSentContent,
  EVIDENCE_DEFAULT_SENT_CHARS,
  EVIDENCE_SENT_LIMIT,
  EVIDENCE_SENT_TOTAL_LIMIT,
  yuanToCents,
  newId,
  saveRecordChecked,
  type EvidenceRecord,
} from "../evidence/store";

const CHANNEL_LABELS: Record<string, string> = {
  negotiate: "与对方直接协商沟通",
  written_notice: "发送书面通知 / 催告并留存记录",
  consult_authority: "向主管部门或专业机构咨询当地渠道",
  prepare_evidence: "整理证据材料，准备后续处理",
};

const STATUS_OPTIONS = [
  { id: "not_contacted", label: "尚未联系" },
  { id: "contacted", label: "已联系" },
  { id: "awaiting_reply", label: "待回复" },
  { id: "resolved", label: "已解决" },
  { id: "unresolved", label: "未解决" },
];

function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const STEPS = [
  { id: 0, label: "发生了什么", short: "问题" },
  { id: 1, label: "证据与事实", short: "证据" },
  { id: 2, label: "匹配方向", short: "方向" },
] as const;

function DisputeSteps({
  step,
  maxStep,
  ready,
  onSelect,
}: {
  step: 0 | 1 | 2;
  maxStep: 0 | 1 | 2;
  ready: { issue: boolean; result: boolean };
  onSelect: (next: 0 | 1 | 2) => void;
}) {
  const done = [ready.issue, maxStep > 0, ready.result];
  return (
    <ol className="flex w-full min-w-0 items-center gap-1" aria-label="争议处理步骤">
      {STEPS.map((item, index) => {
        const active = step === item.id;
        const reached = item.id <= maxStep;
        const complete = done[index] && !active;
        return (
          <li key={item.id} className="flex min-w-0 flex-1 items-center gap-1">
            <button
              type="button"
              onClick={() => reached && onSelect(item.id)}
              disabled={!reached}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1.5 rounded-full px-1.5 py-1.5 text-[11px] transition-colors sm:px-2",
                active
                  ? "bg-foreground text-background"
                  : reached
                    ? "text-foreground hover:bg-black/[0.04]"
                    : "cursor-default text-muted-foreground/60",
              )}
            >
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-medium",
                  active ? "bg-background/25" : complete ? "bg-stage-dispute/15 text-stage-dispute" : "bg-black/[0.06]",
                )}
              >
                {complete ? <Check className="size-2.5" /> : item.id + 1}
              </span>
              <span className="min-w-0 truncate">
                <span className="min-[420px]:hidden">{item.short}</span>
                <span className="hidden min-[420px]:inline">{item.label}</span>
              </span>
            </button>
            {index < STEPS.length - 1 && <span className="h-px w-3 shrink-0 bg-border" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

export function DisputePanel({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const { config } = useConfig();
  const aiAvailable = config?.aiAvailable ?? false;
  const maxEvidence = config?.limits.maxEvidenceSelected ?? 20;

  const allRecords = useEvidenceRecords();
  const selectedIds = useSelectedIds();
  const [sentContents, setSentContents] = useState<Record<string, string>>({});
  const [contentEditor, setContentEditor] = useState<{
    recordId: string;
    name: string;
    value: string;
    total: number;
    defaultText: string;
    error: string;
  } | null>(null);
  const selectedEvidence = toSelectedEvidence(allRecords, selectedIds, sentContents);
  const overEvidenceLimit = selectedEvidence.length > maxEvidence;
  const totalSentChars = selectedEvidence.reduce((sum, item) => sum + (item.content ?? "").length, 0);
  const overSentLimit = totalSentChars > EVIDENCE_SENT_TOTAL_LIMIT;

  const cityCode = useRegionCode();
  const [issue, setIssue] = useState("");
  const [eventDate, setEventDate] = useState("");
  // 默认个人房东：多数用户面对的是个人房东，也避免空值时把 12315 混进推荐方向。
  const [counterparty, setCounterparty] = useState("个人房东");
  const [goal, setGoal] = useState("");
  const [amountYuan, setAmountYuan] = useState("");
  const [facts, setFacts] = useState("");
  const [priorAction, setPriorAction] = useState("");

  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [result, setResult] = useState<DisputeResult | null>(null);
  const [resultMeta, setResultMeta] = useState<ResponseMeta | null>(null);
  const [scriptDraft, setScriptDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState("not_contacted");
  const [progressNotice, setProgressNotice] = useState("");
  const [notice, setNotice] = useState("");
  const [scriptNotice, setScriptNotice] = useState("");
  const [tab, setTab] = useState<"script" | "analysis" | "progress">("analysis");
  const [archivedScripts, setArchivedScripts] = useState<Record<string, string>>({});
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [maxStep, setMaxStep] = useState<0 | 1 | 2>(0);
  const lastChannelRef = useRef<string | null>(null);
  const [draftConsentState, setDraftConsentState] = useState<DraftConsent>(() => getDraftConsent());
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [draftError, setDraftError] = useState("");
  const [draftNotice, setDraftNotice] = useState("");
  const skipFirstSave = useRef(true);
  const prefill = useDisputePrefill();

  function buildDraft(): DisputeDraft {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      issue,
      eventDate,
      counterparty,
      goal,
      amountYuan,
      facts,
      priorAction,
      selectedIds,
      sentContents,
      selectedChannelId,
      scriptDraft,
      status,
      archivedScripts,
      tab,
      step,
      maxStep,
      result,
      resultMeta,
    };
  }

  function persistDraft(): { ok: boolean; savedAt: string; error: string; notice: string } {
    const draft = buildDraft();
    if (saveDraft(draft)) return { ok: true, savedAt: draft.savedAt, error: "", notice: "" };
    const lean = { ...draft, result: null, resultMeta: null };
    if (saveDraft(lean)) {
      return {
        ok: true,
        savedAt: draft.savedAt,
        error: "",
        notice: "草稿已保存，但分析结果较大未写入；事实、材料与话术已保存。",
      };
    }
    return {
      ok: false,
      savedAt: "",
      error: "草稿未能写入本机存储，页面内容仍保留。请清理浏览器空间后重试。",
      notice: "",
    };
  }

  function acceptDraftConsent() {
    const persisted = setDraftConsent("on");
    setDraftConsentState("on");
    const saved = persistDraft();
    if (saved.ok) {
      setDraftSavedAt(saved.savedAt);
      setDraftError(persisted ? "" : "浏览器不允许写入，草稿只在本页有效。");
      setDraftNotice(saved.notice);
    } else {
      setDraftSavedAt(null);
      setDraftError(saved.error);
      setDraftNotice("");
    }
  }

  function declineDraftConsent() {
    setDraftConsent("off");
    setDraftConsentState("off");
    clearDraft();
    setDraftSavedAt(null);
    setDraftError("");
    setDraftNotice("");
  }

  function deleteStoredDraft() {
    clearDraft();
    setDraftConsent("off");
    setDraftConsentState("off");
    setDraftSavedAt(null);
    setDraftError("");
    setDraftNotice("");
  }

  useEffect(() => {
    const consent = getDraftConsent();
    setDraftConsentState(consent);
    if (consent === "on") {
      const draft = loadDraft();
      if (draft) {
        setIssue(draft.issue ?? "");
        setEventDate(draft.eventDate ?? "");
        setCounterparty(draft.counterparty || "个人房东");
        setGoal(draft.goal ?? "");
        setAmountYuan(draft.amountYuan ?? "");
        setFacts(draft.facts ?? "");
        setPriorAction(draft.priorAction ?? "");
        selection.set(draft.selectedIds ?? []);
        setSentContents(draft.sentContents ?? {});
        setSelectedChannelId(draft.selectedChannelId ?? null);
        setScriptDraft(draft.scriptDraft ?? "");
        setStatus(draft.status || "not_contacted");
        setArchivedScripts(draft.archivedScripts ?? {});
        setTab(draft.tab === "script" || draft.tab === "progress" ? draft.tab : "analysis");
        setStep(draft.step === 1 || draft.step === 2 ? draft.step : 0);
        setMaxStep(draft.maxStep === 1 || draft.maxStep === 2 ? draft.maxStep : 0);
        setResult(draft.result ?? null);
        setResultMeta(draft.resultMeta ?? null);
        setDraftSavedAt(draft.savedAt);
        setNotice(`已恢复上次争议草稿（保存于 ${formatDraftTime(draft.savedAt)}）。`);
      }
    }
    skipFirstSave.current = true;
  }, []);

  useEffect(() => {
    if (draftConsentState !== "on") return;
    if (skipFirstSave.current) {
      skipFirstSave.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      const saved = persistDraft();
      if (saved.ok) {
        setDraftSavedAt(saved.savedAt);
        setDraftError("");
        setDraftNotice(saved.notice);
      } else {
        setDraftSavedAt(null);
        setDraftError(saved.error);
        setDraftNotice("");
      }
    }, 600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    draftConsentState,
    issue,
    eventDate,
    counterparty,
    goal,
    amountYuan,
    facts,
    priorAction,
    selectedIds,
    sentContents,
    selectedChannelId,
    scriptDraft,
    status,
    archivedScripts,
    tab,
    step,
    maxStep,
    result,
    resultMeta,
  ]);
  useEffect(() => {
    if (!prefill) return;
    const next = disputePrefill.take();
    if (!next) return;
    setIssue(next.issue);
    if (next.facts) setFacts(next.facts);
    selection.set(next.evidenceIds);
    setSentContents({});
    setResult(null);
    setResultMeta(null);
    setSelectedChannelId(null);
    setScriptDraft("");
    setError(null);
    setNotice("已从证据带入所选材料，可补充事实后整理方向。");
    setStep(1);
    setMaxStep((m) => (m < 1 ? 1 : m));
    // 仅在证据页发出预填时消费一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  function goStep(next: 0 | 1 | 2) {
    setStep(next);
    setMaxStep((m) => (next > m ? next : m));
  }

  function openContentEditor(record: EvidenceRecord) {
    const fallback = defaultSentContent(record);
    setContentEditor({
      recordId: record.id,
      name: record.materialName || record.description.slice(0, 24) || "证据材料",
      value: sentContents[record.id] ?? fallback.text,
      total: record.content?.length ?? 0,
      defaultText: fallback.text,
      error: "",
    });
  }

  function saveContentEditor() {
    if (!contentEditor) return;
    const value = contentEditor.value.trim();
    if (value.length > EVIDENCE_SENT_LIMIT) {
      setContentEditor({
        ...contentEditor,
        error: `选取内容超过 ${EVIDENCE_SENT_LIMIT} 字符，请只保留与本次争议相关的条款。`,
      });
      return;
    }
    setSentContents((prev) => ({ ...prev, [contentEditor.recordId]: value }));
    setContentEditor(null);
  }

  const selectedChannelLabel = selectedChannelId
    ? result?.recommendations.find((rec) => rec.channelId === selectedChannelId)?.title ??
      CHANNEL_LABELS[selectedChannelId] ??
      selectedChannelId
    : "未选择方向";
  const scriptArchiveId = archivedScripts[selectedChannelId ?? "unknown"];
  const busy = loading;
  const canSubmit = aiAvailable && issue.trim().length > 0 && !overEvidenceLimit && !overSentLimit && !busy;

  useEffect(() => {
    if (!selectedChannelId || !result?.script) return;
    setTab("script");
  }, [selectedChannelId, result?.script]);

  // 结果生成后，小屏自动滚到结果区，先看到建议行动，而不是停在表单处。
  useEffect(() => {
    if (!result) return;
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    const timer = window.setTimeout(() => {
      const panel = document.getElementById("dispute-result");
      if (!panel) return;
      const top = panel.getBoundingClientRect().top + window.scrollY - 12;
      window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
    }, 320);
    return () => window.clearTimeout(timer);
  }, [result]);

  async function diagnose(channelId: string | null) {
    if (!aiAvailable || !issue.trim() || overEvidenceLimit || overSentLimit) return;
    lastChannelRef.current = channelId;
    setLoading(true);
    setError(null);
    try {
      const { data, meta } = await api.diagnoseDispute({
        issue: issue.trim(),
        cityCode,
        eventDate: eventDate || null,
        counterparty: counterparty.trim(),
        goal: goal.trim(),
        facts: facts.trim(),
        amountCents: yuanToCents(amountYuan),
        selectedEvidence,
        priorAction: priorAction.trim(),
        selectedChannelId: channelId,
      });
      setResult(data);
      setResultMeta(meta);
      setSelectedChannelId(channelId);
      if (channelId && data.script) {
        setScriptDraft(data.script.text);
        setCopied(false);
        setTab("script");
      } else if (!channelId) {
        setTab("analysis");
        setScriptDraft("");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError("internal_error", errorMessage(err), false));
    } finally {
      setLoading(false);
    }
  }

  function submitCandidates() {
    if (!canSubmit) return;
    void diagnose(null);
  }

  function selectChannel(id: string) {
    if (busy || !aiAvailable) return;
    void diagnose(id);
  }

  function regenerate() {
    if (busy || !aiAvailable) return;
    void diagnose(selectedChannelId);
  }

  async function copyScript() {
    const ok = await copyText(scriptDraft);
    if (!ok) {
      setError(new ApiError("internal_error", "复制失败，请手动选择话术文本复制。", false));
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function logProgress() {
    const statusLabel = STATUS_OPTIONS.find((s) => s.id === status)?.label ?? status;
    const record: EvidenceRecord = {
      id: newId(),
      stage: "dispute",
      occurredAt: todayLocal(),
      recordedAt: new Date().toISOString(),
      description: `争议状态：${statusLabel}｜联系：${counterparty.trim() || "未填"}｜渠道：${selectedChannelLabel}｜事项：${issue.trim()}`,
      contractClause: "",
      materialName: "争议处理进展",
      materialType: "进展记录",
      materialStatus: "present",
      amountCents: yuanToCents(amountYuan),
      reading: null,
    };
    if (!saveRecordChecked(record)) {
      setProgressNotice("本地存储空间不足，未能写入证据。");
      return;
    }
    setProgressNotice("已写入证据画布「争议处理」。");
  }

  function archiveScript() {
    if (!scriptDraft.trim()) return;
    const key = selectedChannelId ?? "unknown";
    const existingId = archivedScripts[key];
    const record: EvidenceRecord = {
      id: existingId ?? newId(),
      stage: "dispute",
      occurredAt: todayLocal(),
      recordedAt: new Date().toISOString(),
      description: `沟通话术 · ${selectedChannelLabel}｜事项：${issue.trim()}`,
      contractClause: "",
      materialName: "沟通话术",
      materialType: "话术草稿",
      materialStatus: "present",
      amountCents: null,
      reading: null,
      content: scriptDraft,
    };
    if (!saveRecordChecked(record, !!existingId)) {
      setScriptNotice("本地存储空间不足，未能存档。");
      return;
    }
    if (!existingId) setArchivedScripts((prev) => ({ ...prev, [key]: record.id }));
    setScriptNotice(existingId ? "已更新证据画布中的话术存档。" : "话术已存档到证据画布「争议处理」。");
  }

  function loadSample() {
    const sample = loadEvidenceSample();
    setSentContents({});
    setIssue("退租后房东以墙面裂缝为由扣全部押金 4000 元，未提供维修票据");
    setEventDate("2026-11-10");
    setCounterparty("个人房东");
    setAmountYuan("4000");
    setGoal("要回押金 4000 元");
    setFacts(
      "2026-03-01 入住时客厅墙面靠窗处已有细微裂缝，已拍照留存；2026-11-10 退租交接时房东以该裂缝为由扣除全部押金 4000 元，未提供维修发票或扣款明细。",
    );
    setPriorAction("已通过微信催要两次，房东未回复");
    selection.set([sample.depositRecordId, sample.recordIds[2], sample.recordIds[0]]);
    setResult(null);
    setResultMeta(null);
    setSelectedChannelId(null);
    setScriptDraft("");
    setError(null);
    setNotice("已载入示例争议与证据，点「整理事实并匹配方向」即可看完整流程。");
    setStep(2);
    setMaxStep(2);
  }

  useEffect(() => {
    const handler = () => loadSample();
    window.addEventListener("zzyj:trial-dispute", handler);
    return () => window.removeEventListener("zzyj:trial-dispute", handler);
  });

  return (
    <div className="w-full pb-8">
      <ModuleHeader
        icon={Scale}
        purpose="处理争议：整理事实与证据，匹配处理方向"
        tone="text-stage-dispute"
        actions={
          <Button size="sm" variant="outline" onClick={loadSample}>
            <Sparkles className="size-3.5" />
            试用示例争议
          </Button>
        }
      />

      <div className="mx-auto w-full max-w-[1024px] px-4 pt-5 md:px-8">
      {draftConsentState === "unset" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-secondary/40 px-3 py-2">
          <ShieldCheck className="size-3.5 shrink-0 text-muted-foreground" />
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground">
            把争议草稿保存在本浏览器？不上传服务器，可随时删除。
          </p>
          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={acceptDraftConsent}>
            保存草稿
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={declineDraftConsent}>
            不用了
          </Button>
        </div>
      )}
      {draftConsentState === "on" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          {draftSavedAt ? <span>草稿已保存 {formatDraftTime(draftSavedAt)}</span> : <span>草稿自动保存已开启</span>}
          {draftNotice && <span className="text-amber-700">{draftNotice}</span>}
          {draftError && <span className="text-destructive">{draftError}</span>}
          <button type="button" onClick={deleteStoredDraft} className="text-primary hover:underline">
            删除本机草稿
          </button>
        </div>
      )}
      {draftConsentState === "off" && (
        <div className="mt-2 text-[11px] text-muted-foreground">
          未保存争议草稿；
          <button type="button" onClick={acceptDraftConsent} className="ml-1 text-primary hover:underline">
            开启保存
          </button>
        </div>
      )}

      {notice && (
        <p className="mt-3 rounded-lg bg-primary/5 px-3 py-2 text-[11px] leading-relaxed text-primary">{notice}</p>
      )}

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <DisputeSteps
            step={step}
            maxStep={maxStep}
            ready={{ issue: issue.trim().length > 0, result: !!result }}
            onSelect={goStep}
          />

          {step === 0 && (
            <div className="panel space-y-3 p-4 step-appear">
              <div>
                <h2 className="text-sm font-semibold">发生了什么</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">只填你确定的信息，其余留空即可。</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1">
                  <Label htmlFor="dp-issue" className="text-xs">争议事项（必填）</Label>
                  <HelpTip label="争议事项说明">
                    用一句话说清问题与诉求，例如「退租后房东以墙面损坏为由扣除全部押金」。系统会据此整理事实并匹配处理方向。
                  </HelpTip>
                </div>
                <Textarea id="dp-issue" value={issue} onChange={(e) => setIssue(e.target.value)} className="min-h-20 text-sm" placeholder="例如：退租后房东以墙面损坏为由扣除全部押金，协商无果。" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="dp-date" className="text-xs">事件日期（可选）</Label>
                  <Input id="dp-date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <Label htmlFor="dp-counterparty" className="text-xs">对方身份</Label>
                    <HelpTip label="对方身份说明">
                      决定可推荐的处理渠道：个人房东、个人二房东不会推荐 12315（仅适用于住房租赁企业、中介等经营者）。默认个人房东，请按实际情况改选。
                    </HelpTip>
                  </div>
                  <Select value={counterparty} onValueChange={setCounterparty}>
                    <SelectTrigger id="dp-counterparty" className="w-full">
                      <SelectValue placeholder="请选择对方身份" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="个人房东">个人房东</SelectItem>
                      <SelectItem value="二房东（个人转租）">二房东（个人转租）</SelectItem>
                      <SelectItem value="住房租赁企业">住房租赁企业</SelectItem>
                      <SelectItem value="房地产经纪机构（中介）">房地产经纪机构（中介）</SelectItem>
                      <SelectItem value="其他">其他</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] leading-relaxed text-muted-foreground">默认个人房东；涉及企业或中介请改选。</p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <Label htmlFor="dp-amount" className="text-xs">涉及金额（元，可选）</Label>
                    <HelpTip label="涉及金额说明">
                      例如被扣押金或需维修的费用。留空表示未知，不会被当作 0 计算。
                    </HelpTip>
                  </div>
                  <Input id="dp-amount" inputMode="decimal" value={amountYuan} onChange={(e) => setAmountYuan(e.target.value)} placeholder="留空表示未知，不计为 0" />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="dp-goal" className="text-xs">你的目标（可选）</Label>
                <Input id="dp-goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="例如：退还被扣押金 / 完成维修 / 解除合约" />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button size="sm" onClick={() => goStep(1)} disabled={!issue.trim()} className="ml-auto">
                  下一步：证据与事实
                  <ArrowRight className="size-4" />
                </Button>
              </div>
              {!issue.trim() && <p className="text-right text-[11px] text-muted-foreground">先填写争议事项才能继续。</p>}
            </div>
          )}

          {step === 1 && (
            <div className="panel space-y-3 p-4 step-appear">
              <div>
                <h2 className="text-sm font-semibold">带上证据，补充事实</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">证据是你的陈述材料，未经验证；未知项可不填，系统会提示缺项。</p>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <h3 className="text-xs font-medium">相关证据（{selectedEvidence.length}）</h3>
                    <HelpTip label="证据选择说明">
                      勾选要带入的记录，系统会用其中的金额、日期与材料名称填写话术。最多 {maxEvidence} 条。
                    </HelpTip>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => onNavigate("evidence")}>
                    <CalendarClock className="size-4" />
                    去证据画布
                  </Button>
                </div>
                {allRecords.length === 0 ? (
                  <p className="text-xs text-muted-foreground">证据画布还没有记录，可先去添加，也可以直接跳过。</p>
                ) : (
                  <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
                    {allRecords.map((r) => (
                      <li key={r.id} className="list-appear flex items-start gap-2 rounded-md border bg-secondary/30 p-2">
                        <Checkbox
                          checked={selectedIds.includes(r.id)}
                          onCheckedChange={() => selection.toggle(r.id)}
                          aria-label="选择此证据"
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1 text-xs">
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge variant="outline">{EVIDENCE_STATUS_LABELS[r.materialStatus]}</Badge>
                            <span className="text-muted-foreground">{r.occurredAt ?? "时间未知"}</span>
                          </div>
                          <p className="mt-0.5 line-clamp-2">{r.description}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {overEvidenceLimit && (
                  <p className="mt-2 text-xs text-destructive">已选超过 {maxEvidence} 条，请减少选择后再生成。</p>
                )}
              </div>

              {selectedEvidence.length > 0 && (
                <div className="rounded-lg border border-border/70 bg-background p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1">
                      <h3 className="text-xs font-medium">AI 将读取的材料（{selectedEvidence.length}）</h3>
                      <HelpTip label="发送内容说明">
                        只发送这里列出的选取内容；长材料默认只带前 {EVIDENCE_DEFAULT_SENT_CHARS} 字并标注节选，可逐条改成相关条款。未包含的部分不会提供给 AI。
                      </HelpTip>
                    </div>
                    <span className={totalSentChars > EVIDENCE_SENT_TOTAL_LIMIT ? "text-[11px] text-destructive" : "text-[11px] text-muted-foreground"}>
                      合计 {totalSentChars} / {EVIDENCE_SENT_TOTAL_LIMIT} 字符
                    </span>
                    {overSentLimit && (
                      <span className="text-[11px] text-destructive">选取内容过多，请缩短后再生成。</span>
                    )}
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {selectedEvidence.map((item) => {
                      const record = allRecords.find((r) => r.id === item.evidenceId);
                      const isOverride = sentContents[item.evidenceId] !== undefined;
                      const totalChars = record?.content?.length ?? 0;
                      const partial = !!record && !isOverride && totalChars > EVIDENCE_DEFAULT_SENT_CHARS;
                      return (
                        <li key={item.evidenceId} className="flex items-start gap-2 text-[11px]">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">
                              {record?.materialName || item.materialName || item.description.slice(0, 20)}
                            </span>
                            <span className="text-muted-foreground">
                              {item.content ? `发送 ${item.content.length} 字` : "无正文，只发送名称与描述"}
                              {partial ? `（节选，共 ${totalChars} 字）` : record?.content ? "（全文）" : ""}
                            </span>
                          </span>
                          {record?.content && (
                            <button
                              type="button"
                              onClick={() => openContentEditor(record)}
                              className="shrink-0 text-primary hover:underline"
                            >
                              查看/选取
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                    未列出的部分不会提供给 AI；〔节选〕不等于全文。
                  </p>
                </div>
              )}

              <div className="space-y-1">
                <Label htmlFor="dp-facts" className="text-xs">补充事实（可选）</Label>
                <Textarea id="dp-facts" value={facts} onChange={(e) => setFacts(e.target.value)} className="min-h-16 text-sm" placeholder="补充已确认的事实；未知项可不填，系统会提示缺项。" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="dp-prior" className="text-xs">已采取的行动（可选）</Label>
                <Input id="dp-prior" value={priorAction} onChange={(e) => setPriorAction(e.target.value)} placeholder="例如：已微信协商两次，对方拒绝" />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button size="sm" variant="ghost" onClick={() => goStep(0)}>
                  <ArrowLeft className="size-4" />
                  上一步
                </Button>
                <Button size="sm" onClick={() => goStep(2)} className="ml-auto">
                  下一步：匹配方向
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="panel space-y-3 p-4 step-appear">
              <div>
                <h2 className="text-sm font-semibold">确认后匹配处理方向</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">系统先整理事实、提示缺项，再给出一个优先方向与少量可考虑项。</p>
              </div>
              <dl className="space-y-1.5 rounded-lg bg-secondary/40 p-3 text-[12px] leading-relaxed">
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-muted-foreground">争议事项</dt><dd className="min-w-0 flex-1">{issue.trim() || "未填写"}</dd></div>
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-muted-foreground">对方身份</dt><dd className="min-w-0 flex-1">{counterparty || "未填写"}</dd></div>
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-muted-foreground">证据</dt><dd className="min-w-0 flex-1">{selectedEvidence.length > 0 ? `${selectedEvidence.length} 条` : "未选择"}</dd></div>
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-muted-foreground">目标</dt><dd className="min-w-0 flex-1">{goal.trim() || "未填写"}</dd></div>
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-muted-foreground">已行动</dt><dd className="min-w-0 flex-1">{priorAction.trim() || "未填写"}</dd></div>
              </dl>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => goStep(1)} disabled={busy}>
                  <ArrowLeft className="size-4" />
                  上一步
                </Button>
                <Button onClick={submitCandidates} disabled={!canSubmit} className="flex-1">
                  {loading && !selectedChannelId ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                  {loading && !selectedChannelId ? "整理中…" : result ? "重新整理事实与方向" : "整理事实并匹配方向"}
                </Button>
              </div>
              {!aiAvailable && <p className="text-xs text-muted-foreground">服务端未配置模型密钥，争议分析暂不可用。</p>}
              {result && (
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  已生成 {result.recommendations.length} 个处理方向，结果已定位到下方；先看「建议先做什么」，选定后再生成话术。
                </p>
              )}
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          {error && (
            <Alert variant="destructive">
              <ShieldAlert className="size-4" />
              <AlertTitle>未完成</AlertTitle>
              <AlertDescription>
                {error.message}{error.retryable && " 可稍后手动重试。"}
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => diagnose(lastChannelRef.current)}
                  disabled={busy || !aiAvailable || !issue.trim() || overEvidenceLimit}
                >
                  <RotateCw className="size-4" />
                  重试分析
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {!result && !error && (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
              {loading ? (
                <>
                  <Loader2 className="size-7 animate-spin text-stage-dispute" />
                  <p className="mt-3 text-sm font-medium">正在整理事实并匹配方向…</p>
                  <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-muted-foreground">
                    先核对你的陈述与证据，再检索本地资料，通常需要十几秒。
                  </p>
                </>
              ) : (
                <>
                  <Scale className="size-8 text-muted-foreground" />
                  <p className="mt-3 text-sm font-medium">
                    {step === 2 ? "点「整理事实并匹配方向」开始" : "先写争议事项，再补证据，最后生成话术"}
                  </p>
                  <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                    第 1 步写清发生了什么；第 2 步选证据、补事实；第 3 步选一个方向生成可编辑话术。系统不代你提交。
                  </p>
                  <Button size="sm" variant="outline" className="mt-3" onClick={loadSample}>
                    <Sparkles className="size-3.5" />
                    载入示例争议，先看完整流程
                  </Button>
                  <p className="mt-1.5 text-[10px] text-muted-foreground">自动带入示例事项与证据，不用自己填写。</p>
                </>
              )}
            </div>
          )}

          {result && (
            <div id="dispute-result" className="panel relative flex flex-col overflow-hidden lg:h-[calc(100dvh-15rem)] lg:min-h-[520px]">
              {busy && (
                <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-stage-dispute/15">
                  <span className="block h-full w-1/3 animate-[progress-slide_1.1s_ease-in-out_infinite] rounded-full bg-stage-dispute" />
                </div>
              )}
              <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/60 px-2 pt-2">
                {(
                  [
                    { id: "script", label: "话术草稿", ready: !!result.script },
                    { id: "analysis", label: "分析依据", ready: true },
                    { id: "progress", label: "处理进展", ready: true },
                  ] as const
                ).map((item) => {
                  const active = tab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTab(item.id)}
                      className={
                        active
                          ? "rounded-t-lg border-b-2 border-foreground px-3 py-2 text-[12px] font-medium text-foreground"
                          : "rounded-t-lg border-b-2 border-transparent px-3 py-2 text-[12px] text-muted-foreground hover:text-foreground"
                      }
                    >
                      {item.label}
                      {item.id === "script" && !item.ready && (
                        <span className="ml-1 text-[10px] text-muted-foreground">待生成</span>
                      )}
                      {item.id === "analysis" && (
                        <span className="ml-1 text-[10px] text-muted-foreground">{result.recommendations.length}</span>
                      )}
                    </button>
                  );
                })}
                {resultMeta && (
                  <Badge variant="outline" className="ml-auto mr-1 text-[10px]">
                    {resultMeta.coverage === "supported"
                      ? "知识库已覆盖"
                      : resultMeta.coverage === "limited"
                        ? "知识库覆盖有限"
                        : "暂无渠道知识库"}
                  </Badge>
                )}
              </div>

              <div className="min-h-0 flex-1 p-4 lg:overflow-y-auto">
                {tab === "script" && (
                  result.script ? (
                    <div className="flex h-full flex-col">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold">话术草稿</h3>
                        <Badge variant="outline">{selectedChannelLabel}</Badge>
                        <span className="ml-auto text-[11px] text-muted-foreground">{scriptDraft.length} 字 · 可编辑</span>
                      </div>
                      <p className="mb-2 text-[12px] leading-relaxed text-muted-foreground">
                        {selectedEvidence.length > 0
                          ? `已按选定方向生成，并结合你选择的 ${selectedEvidence.length} 条证据引用金额、日期与材料名称；〔待补〕是材料里也没有的信息，请补全后自行提交。`
                          : "已按选定方向生成，内容只依据你填写的争议事项与事实；未选择证据，因此没有引用具体材料名称。〔待补〕请补全后自行提交。"}
                      </p>
                      {result.script.placeholders.length > 0 && (
                        <div className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2">
                          <p className="mb-1.5 text-[11px] font-medium text-amber-700">待补项（提交前请替换）</p>
                          <div className="flex flex-wrap gap-1.5">
                            {result.script.placeholders.map((p, i) => (
                              <span
                                key={i}
                                className="rounded-full bg-background/80 px-2 py-0.5 text-[11px] text-amber-800 ring-1 ring-amber-500/25"
                              >
                                {p}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      <Textarea
                        value={scriptDraft}
                        onChange={(e) => setScriptDraft(e.target.value)}
                        className="min-h-[260px] flex-1 resize-y bg-background text-[14px] leading-7"
                        aria-label="话术草稿（可编辑）"
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button size="sm" onClick={copyScript} className={copied ? "success-feedback" : ""}>
                          {copied ? <Check className="size-4 check-appear" /> : <ClipboardCopy className="size-4" />}
                          {copied ? "已复制" : "复制话术"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={archiveScript} disabled={!scriptDraft.trim()}>
                          <BookmarkPlus className="size-4" />
                          {scriptArchiveId ? "更新存档" : "存档到证据"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={regenerate} disabled={busy} className="ml-auto">
                          {busy ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
                          重新生成
                        </Button>
                        {scriptNotice && <p className="success-feedback w-full text-[11px] text-primary">{scriptNotice}</p>}
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center text-center">
                      <Scale className="size-7 text-muted-foreground/60" />
                      <p className="mt-2 text-[13px] font-medium">还没有生成话术</p>
                      <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-muted-foreground">
                        到「分析依据」里选一个处理方向，系统会按已有材料生成可编辑话术。
                      </p>
                      <Button size="sm" variant="outline" className="mt-3" onClick={() => setTab("analysis")}>
                        去看处理方向
                      </Button>
                    </div>
                  )
                )}

                {tab === "analysis" && (
                  <div className="space-y-3">
                    {result.recommendations.length > 0 && (() => {
                      const prepRecs = result.recommendations.filter((rec) => !rec.channelId || rec.channelId === "prepare_evidence");
                      const channelRecs = result.recommendations.filter((rec) => !!rec.channelId && rec.channelId !== "prepare_evidence");
                      return (
                        <div className="space-y-3">
                          {prepRecs.length > 0 && (
                            <div>
                              <h4 className="mb-1.5 text-[13px] font-semibold">建议先做什么（自己准备）</h4>
                              <p className="mb-2 text-[12px] leading-relaxed text-muted-foreground">
                                这些是你自己完成的准备，不生成话术；准备好后再选择沟通对象。
                              </p>
                              <div className="space-y-2">
                                {prepRecs.map((rec, i) => (
                                  <div key={rec.channelId ?? `prep-${i}`} className="rounded-md border bg-secondary/30 p-3">
                                    <div className="mb-1 flex flex-wrap items-center gap-2">
                                      <Badge variant="secondary">先准备</Badge>
                                      <span className="text-[14px] font-medium">{rec.title || "整理材料"}</span>
                                    </div>
                                    {rec.reason && <p className="text-[13px] leading-relaxed text-muted-foreground">{rec.reason}</p>}
                                    {rec.preparations.length > 0 && (
                                      <ul className="mt-1 list-inside list-disc text-[12px] leading-relaxed text-muted-foreground">
                                        {rec.preparations.map((p, j) => <li key={j}>{p}</li>)}
                                      </ul>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {channelRecs.length > 0 && (
                            <div>
                              <h4 className="mb-1.5 text-[13px] font-semibold">
                                {prepRecs.length > 0 ? "向谁沟通" : "建议先做什么"}
                              </h4>
                              <p className="mb-2 text-[12px] leading-relaxed text-muted-foreground">
                                选定一个方向即可生成话术。「本地已核验」表示该沟通对象来自官方资料。
                              </p>
                              <div className="space-y-2">
                                {channelRecs.map((rec, i) => {
                                  const id = rec.channelId ?? "";
                                  const active = selectedChannelId === id;
                                  return (
                                    <div key={id} className={active ? "rounded-md border border-primary/50 bg-primary/5 p-3" : "rounded-md border bg-secondary/30 p-3"}>
                                      <div className="mb-1 flex flex-wrap items-center gap-2">
                                        <Badge variant={i === 0 ? "default" : "secondary"}>{i === 0 ? "优先方向" : "可考虑"}</Badge>
                                        <span className="text-[14px] font-medium">{rec.title || CHANNEL_LABELS[id] || id}</span>
                                        {rec.eligibility === "local_verified" ? (
                                          <Badge variant="secondary">本地已核验</Badge>
                                        ) : (
                                          <Badge variant="outline">一般建议</Badge>
                                        )}
                                        {rec.sourceRefs.length > 0 && <Badge variant="outline">有依据</Badge>}
                                      </div>
                                      {rec.reason && <p className="text-[13px] leading-relaxed text-muted-foreground">{rec.reason}</p>}
                                      {rec.preparations.length > 0 && (
                                        <div className="mt-1.5">
                                          <p className="text-[12px] font-medium text-muted-foreground">需要自己准备</p>
                                          <ul className="list-inside list-disc text-[12px] leading-relaxed text-muted-foreground">
                                            {rec.preparations.map((p, j) => <li key={j}>{p}</li>)}
                                          </ul>
                                        </div>
                                      )}
                                      <Button size="sm" variant={active ? "secondary" : "outline"} className="mt-2" onClick={() => selectChannel(id)} disabled={busy || !id}>
                                        {active ? <Check className="size-4" /> : <ArrowUp className="size-4" />}
                                        {active ? "已选定 · 重新生成话术" : "用这个方向生成话术"}
                                      </Button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {result.factsSummary.length > 0 && (
                      <div>
                        <h4 className="mb-1.5 text-[13px] font-semibold">已整理的事实</h4>
                        <ul className="list-inside list-disc space-y-1 text-[13px] leading-relaxed text-muted-foreground">
                          {result.factsSummary.map((f, i) => <li key={i}>{f}</li>)}
                        </ul>
                      </div>
                    )}

                    {result.missingFacts.length > 0 && (
                      <Alert className="border-amber-500/40 bg-amber-500/5">
                        <AlertTriangle className="size-4 text-amber-600" />
                        <AlertTitle>关键缺项（建议补充）</AlertTitle>
                        <AlertDescription>
                          <ul className="list-inside list-disc space-y-0.5">
                            {result.missingFacts.map((f, i) => <li key={i}>{f}</li>)}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}

                    <SourceList
                      sources={result.references}
                      knowledgeVersion={resultMeta?.knowledgeVersion ?? null}
                      warnings={resultMeta?.warnings ?? []}
                    />
                    {result.references.length === 0 && (resultMeta?.warnings.length ?? 0) > 0 && (
                      <p className="text-[12px] leading-relaxed text-muted-foreground">{resultMeta!.warnings.join(" ")}</p>
                    )}
                  </div>
                )}

                {tab === "progress" && (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-border/70 p-3">
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-xs font-medium">处理进展</h4>
                        <button type="button" onClick={() => onNavigate("evidence")} className="text-[11px] text-primary hover:underline">
                          去证据画布
                        </button>
                      </div>
                      <p className="mb-2 text-[11px] text-muted-foreground">
                        联系对象：{counterparty.trim() || "未填"} · 渠道：{selectedChannelLabel} · 时间：今天
                      </p>
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="min-w-36 flex-1 space-y-1">
                          <Label htmlFor="dp-status" className="text-xs">处理状态</Label>
                          <Select value={status} onValueChange={setStatus}>
                            <SelectTrigger id="dp-status" size="sm" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUS_OPTIONS.map((s) => (
                                <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button size="sm" variant="outline" onClick={logProgress}>
                          <BookmarkPlus className="size-3.5" />
                          记录到证据
                        </Button>
                      </div>
                      {progressNotice && <p className="mt-1 text-xs text-primary">{progressNotice}</p>}
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      每次记录会在证据画布「争议处理」时间轴新增一条状态记录，刷新后仍保留。
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      </div>

      {draftError && (
        <div
          role="alert"
          className="fixed bottom-5 left-1/2 z-40 flex w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 items-start gap-2 rounded-xl border border-destructive/30 bg-white/95 px-3.5 py-2 text-[12px] leading-relaxed text-destructive shadow-[0_8px_30px_-10px_rgba(16,24,40,0.35)] backdrop-blur-xl md:left-[calc((100vw+248px)/2)]"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {draftError}
        </div>
      )}

      <Dialog open={contentEditor != null} onOpenChange={(open) => { if (!open) setContentEditor(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>选取发送给 AI 的内容</DialogTitle>
            <DialogDescription>
              {contentEditor?.name} · 共 {contentEditor?.total ?? 0} 字。只发送文本框中的内容；可只保留与本次争议相关的条款。
            </DialogDescription>
          </DialogHeader>
          {contentEditor && (
            <>
              <Textarea
                value={contentEditor.value}
                onChange={(event) =>
                  setContentEditor({ ...contentEditor, value: event.target.value, error: "" })
                }
                className="min-h-64 font-mono text-sm"
                aria-label="选取发送内容"
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className={contentEditor.value.length > EVIDENCE_SENT_LIMIT ? "text-destructive" : "text-muted-foreground"}>
                  {contentEditor.value.length} / {EVIDENCE_SENT_LIMIT} 字符
                </span>
                <div className="flex gap-1">
                  {contentEditor.total > EVIDENCE_DEFAULT_SENT_CHARS && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setContentEditor({ ...contentEditor, value: contentEditor.defaultText, error: "" })}
                    >
                      用默认前 {EVIDENCE_DEFAULT_SENT_CHARS} 字
                    </Button>
                  )}
                  {contentEditor.total > 0 && contentEditor.total <= EVIDENCE_SENT_LIMIT && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const record = allRecords.find((item) => item.id === contentEditor.recordId);
                        setContentEditor({ ...contentEditor, value: record?.content ?? "", error: "" });
                      }}
                    >
                      用全文
                    </Button>
                  )}
                </div>
              </div>
              {contentEditor.error && <p className="text-[11px] text-destructive">{contentEditor.error}</p>}
              <p className="text-[11px] text-muted-foreground">
                未包含在此文本框中的证据内容不会发送给 AI；节选不会被当作全文。
              </p>
            </>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setContentEditor(null)}>取消</Button>
            <Button
              onClick={saveContentEditor}
              disabled={!!contentEditor && contentEditor.value.length > EVIDENCE_SENT_LIMIT}
            >
              保存发送内容
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}