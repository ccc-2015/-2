import { useState } from "react";
import {
  Scale,
  ArrowUp,
  Loader2,
  ShieldAlert,
  Copy,
  ClipboardCopy,
  RotateCw,
  CalendarClock,
  AlertTriangle,
  Check,
  BookmarkPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SourceList } from "@/components/SourceList";
import { RegionSelect } from "../../components/RegionSelect";
import { EVIDENCE_STATUS_LABELS, type DisputeResult, type ResponseMeta } from "@/shared/api";
import { useConfig } from "../../lib/config-context";
import { useRegionCode } from "../../lib/region";
import { api, ApiError, errorMessage } from "../../lib/api";
import type { ViewId } from "../../components/AppShell";
import {
  useEvidenceRecords,
  useSelectedIds,
  selection,
  toSelectedEvidence,
  yuanToCents,
  newId,
  saveRecordChecked,
  type EvidenceRecord,
} from "../evidence/store";

const CHANNEL_LABELS: Record<string, string> = {
  negotiate: "与对方直接协商沟通",
  written_notice: "发送书面通知 / 催告并留存记录",
  consult_authority: "向主管部门或专业机构咨询当地渠道（待核实）",
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

export function DisputePanel({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const { config } = useConfig();
  const aiAvailable = config?.aiAvailable ?? false;
  const maxEvidence = config?.limits.maxEvidenceSelected ?? 20;

  const allRecords = useEvidenceRecords();
  const selectedIds = useSelectedIds();
  const selectedEvidence = toSelectedEvidence(allRecords, selectedIds);
  const overEvidenceLimit = selectedEvidence.length > maxEvidence;

  const cityCode = useRegionCode();
  const [issue, setIssue] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [counterparty, setCounterparty] = useState("");
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
  const [scriptNotice, setScriptNotice] = useState("");
  const [archivedScripts, setArchivedScripts] = useState<Record<string, string>>({});

  const selectedChannelLabel = selectedChannelId
    ? CHANNEL_LABELS[selectedChannelId] ?? selectedChannelId
    : "未选择方向";
  const scriptArchiveId = archivedScripts[selectedChannelId ?? "unknown"];
  const busy = loading;
  const canSubmit = aiAvailable && issue.trim().length > 0 && !overEvidenceLimit && !busy;

  async function diagnose(channelId: string | null) {
    if (!aiAvailable || !issue.trim() || overEvidenceLimit) return;
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
      } else if (!channelId) {
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
    try {
      await navigator.clipboard.writeText(scriptDraft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(new ApiError("internal_error", "复制失败，请手动选择话术文本复制。", false));
    }
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

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <header className="border-b border-border/60 pb-5">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">争议处理</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          选择争议与证据，补充必要事实，匹配少量一般处理方向；选定方向后生成可编辑话术，由你核对后自行提交。
        </p>
      </header>

      <p className="mt-3 rounded-xl bg-secondary/60 px-3.5 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
        一期仅一般方向：本地渠道、资格与职责待核实，不提供经核验的本地渠道推荐。话术为辅助草稿，不得补造金额、日期、对方行为、法规、电话或网址；未知项保留待补，系统不代你提交。
      </p>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="panel p-4">
            <h2 className="mb-3 text-sm font-semibold">争议与必要事实</h2>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="dp-issue" className="text-xs">争议事项（必填）</Label>
                <Textarea id="dp-issue" value={issue} onChange={(e) => setIssue(e.target.value)} className="min-h-20 text-sm" placeholder="例如：退租后房东以墙面损坏为由扣除全部押金，协商无果。" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="dp-city" className="text-xs">城市 / 地区</Label>
                  <RegionSelect id="dp-city" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="dp-date" className="text-xs">事件日期（可选）</Label>
                  <Input id="dp-date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="dp-counterparty" className="text-xs">对方身份（可选）</Label>
                  <Input id="dp-counterparty" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="例如：房东 / 中介 / 合租室友" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="dp-amount" className="text-xs">涉及金额（元，可选）</Label>
                  <Input id="dp-amount" inputMode="decimal" value={amountYuan} onChange={(e) => setAmountYuan(e.target.value)} placeholder="留空表示未知，不计为 0" />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="dp-goal" className="text-xs">你的目标（可选）</Label>
                <Input id="dp-goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="例如：退还被扣押金 / 完成维修 / 解除合约" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="dp-facts" className="text-xs">补充事实（可选）</Label>
                <Textarea id="dp-facts" value={facts} onChange={(e) => setFacts(e.target.value)} className="min-h-16 text-sm" placeholder="补充已确认的事实；未知项可不填，系统会提示缺项。" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="dp-prior" className="text-xs">已采取的行动（可选）</Label>
                <Input id="dp-prior" value={priorAction} onChange={(e) => setPriorAction(e.target.value)} placeholder="例如：已微信协商两次，对方拒绝" />
              </div>
            </div>
          </div>

          <div className="panel p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">相关证据（{selectedEvidence.length}）</h2>
              <Button size="sm" variant="ghost" onClick={() => onNavigate("evidence")}>
                <CalendarClock className="size-4" />
                去证据画布
              </Button>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              勾选带入争议处理的记录（你的陈述，未验证真实性）。最多 {maxEvidence} 条。
            </p>
            {allRecords.length === 0 ? (
              <p className="text-xs text-muted-foreground">证据画布还没有记录，可先去添加。</p>
            ) : (
              <ul className="space-y-2">
                {allRecords.map((r) => (
                  <li key={r.id} className="flex items-start gap-2 rounded-md border bg-secondary/30 p-2">
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

          <Button onClick={submitCandidates} disabled={!canSubmit} className="w-full">
            {loading && !selectedChannelId ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            {loading && !selectedChannelId ? "整理中…" : "整理事实并匹配方向"}
          </Button>
          {!aiAvailable && <p className="text-xs text-muted-foreground">服务端未配置模型密钥，争议分析暂不可用。</p>}
          {!issue.trim() && aiAvailable && <p className="text-xs text-muted-foreground">请先填写争议事项。</p>}
        </div>

        <div className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <ShieldAlert className="size-4" />
              <AlertTitle>未完成</AlertTitle>
              <AlertDescription>
                {error.message}{error.retryable && " 可稍后手动重试。"}
              </AlertDescription>
            </Alert>
          )}

          {!result && !error && (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
              <Scale className="size-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">填写争议事项后整理事实</p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                系统先整理已确认事实、提示关键缺项，并给出一个优先方向与少量可考虑项；选定方向后才生成对应话术。
              </p>
            </div>
          )}

          {result && (
            <>
              {result.factsSummary.length > 0 && (
                <div className="panel p-4">
                  <h3 className="mb-2 text-sm font-semibold">已整理的事实</h3>
                  <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                    {result.factsSummary.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              )}

              {result.missingFacts.length > 0 && (
                <Alert>
                  <AlertTriangle className="size-4" />
                  <AlertTitle>关键缺项（建议补充）</AlertTitle>
                  <AlertDescription>
                    <ul className="list-inside list-disc space-y-0.5">
                      {result.missingFacts.map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {result.recommendations.length > 0 && (
                <div className="panel p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">一般处理方向</h3>
                    {resultMeta && (
                      <Badge variant="outline">
                        {resultMeta.coverage === "supported"
                          ? "知识库已覆盖"
                          : resultMeta.coverage === "limited"
                            ? "知识库覆盖有限"
                            : "暂无渠道知识库"}
                      </Badge>
                    )}
                  </div>
                  <p className="mb-3 text-xs text-muted-foreground">均为一般方向，本地渠道与资格待核实；选定一个方向后生成专属话术。</p>
                  <div className="space-y-2">
                    {result.recommendations.map((rec, i) => {
                      const id = rec.channelId ?? "";
                      const active = selectedChannelId === id;
                      return (
                        <div key={id || i} className={active ? "rounded-md border border-primary/50 bg-primary/5 p-3" : "rounded-md border bg-secondary/30 p-3"}>
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            {i === 0 && <Badge variant="secondary">优先方向</Badge>}
                            <span className="text-sm font-medium">{rec.title || CHANNEL_LABELS[id] || id}</span>
                            <Badge variant="outline">一般 · 待核实</Badge>
                            {rec.sourceRefs.length > 0 && <Badge variant="outline">有依据</Badge>}
                          </div>
                          {rec.reason && <p className="text-xs text-muted-foreground">{rec.reason}</p>}
                          {rec.preparations.length > 0 && (
                            <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                              {rec.preparations.map((p, j) => <li key={j}>{p}</li>)}
                            </ul>
                          )}
                          <Button size="sm" variant={active ? "secondary" : "outline"} className="mt-2" onClick={() => selectChannel(id)} disabled={busy || !id}>
                            {active ? <Check className="size-4" /> : <ArrowUp className="size-4" />}
                            {active ? "已选定 · 重新生成话术" : "选择此方向生成话术"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <SourceList
                sources={result.references}
                knowledgeVersion={resultMeta?.knowledgeVersion ?? null}
                warnings={resultMeta?.warnings ?? []}
              />
              {result.references.length === 0 && (resultMeta?.warnings.length ?? 0) > 0 && (
                <p className="text-[11px] leading-relaxed text-muted-foreground">{resultMeta!.warnings.join(" ")}</p>
              )}

              <div className="panel p-4">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">处理进展</h3>
                  <button type="button" onClick={() => onNavigate("evidence")} className="text-xs text-primary hover:underline">
                    去证据画布
                  </button>
                </div>
                <p className="mb-2 text-xs text-muted-foreground">
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
                <p className="mt-2 text-[11px] text-muted-foreground">每次记录会在「争议处理」时间轴新增一条状态记录，刷新后仍保留。</p>
                {progressNotice && <p className="mt-1 text-xs text-primary">{progressNotice}</p>}
              </div>

              {selectedChannelId && result.script && (
                <div className="panel p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Copy className="size-4 text-primary" />
                    <h3 className="text-sm font-semibold">话术草稿</h3>
                    <Badge variant="outline">{CHANNEL_LABELS[selectedChannelId] ?? selectedChannelId}</Badge>
                  </div>
                  <Alert className="mb-2">
                    <ShieldAlert className="size-4" />
                    <AlertDescription>请核对并补全待补项后自行提交；系统不代发，话术不构成法律文书。</AlertDescription>
                  </Alert>
                  {result.script.placeholders.length > 0 && (
                    <div className="mb-2">
                      <p className="text-xs font-medium">待补项：</p>
                      <ul className="list-inside list-disc text-xs text-muted-foreground">
                        {result.script.placeholders.map((p, i) => <li key={i}>{p}</li>)}
                      </ul>
                    </div>
                  )}
                  <Textarea value={scriptDraft} onChange={(e) => setScriptDraft(e.target.value)} className="min-h-48 font-mono text-sm" aria-label="话术草稿（可编辑）" />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={copyScript}>
                      <ClipboardCopy className="size-4" />
                      {copied ? "已复制" : "复制话术"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={archiveScript} disabled={!scriptDraft.trim()}>
                      <BookmarkPlus className="size-4" />
                      {scriptArchiveId ? "更新话术存档" : "存档话术"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={regenerate} disabled={busy}>
                      {busy ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
                      更新事实后重新生成
                    </Button>
                  </div>
                  {scriptNotice && <p className="mt-2 text-xs text-primary">{scriptNotice}</p>}
                </div>
              )}

              {selectedChannelId && !result.script && !loading && (
                <p className="text-xs text-muted-foreground">该方向暂未生成话术，可补充事实后重新生成。</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}