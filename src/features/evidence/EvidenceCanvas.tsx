import { useState } from "react";
import {
  CalendarClock,
  Plus,
  Pencil,
  Trash2,
  ShieldAlert,
  Scale,
  Droplets,
  X,
  Check,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EVIDENCE_STATUS_LABELS, type EvidenceStatus } from "@/shared/api";
import type { ViewId } from "../../components/AppShell";
import {
  STAGES,
  STAGE_LABELS,
  UTILITY_KIND_LABELS,
  records,
  utilities,
  selection,
  useEvidenceRecords,
  useUtilities,
  useSelectedIds,
  newId,
  yuanToCents,
  formatCents,
  laneItemsFor,
  overviewStats,
  gapHints,
  readingUsage,
  utilityBalance,
  utilityStage,
  type EvidenceRecord,
  type EvidenceStage,
  type UtilityAccount,
  type UtilityKind,
} from "./store";

const STATUS_OPTIONS: EvidenceStatus[] = ["present", "missing", "to_confirm"];

function formatRecorded(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function statusDot(status: EvidenceStatus): string {
  if (status === "present") return "bg-emerald-500";
  if (status === "missing") return "bg-destructive";
  return "bg-amber-500";
}

export function EvidenceCanvas({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const allRecords = useEvidenceRecords();
  const allUtilities = useUtilities();
  const selectedIds = useSelectedIds();

  const [stageFilter, setStageFilter] = useState<"all" | EvidenceStage>("all");
  const [recordForm, setRecordForm] = useState<{ open: boolean; initial: EvidenceRecord | null; stage: EvidenceStage }>({
    open: false,
    initial: null,
    stage: "signing",
  });
  const [utilityForm, setUtilityForm] = useState<{ open: boolean; initial: UtilityAccount | null; stage: EvidenceStage }>({
    open: false,
    initial: null,
    stage: "living",
  });

  const stats = overviewStats(allRecords, allUtilities);
  const selectedCount = allRecords.filter((r) => selectedIds.includes(r.id)).length;
  const lanes = stageFilter === "all" ? STAGES : STAGES.filter((s) => s.id === stageFilter);
  const isEmpty = allRecords.length === 0 && allUtilities.length === 0;

  function closeForms() {
    setRecordForm((f) => ({ ...f, open: false, initial: null }));
    setUtilityForm((f) => ({ ...f, open: false, initial: null }));
  }
  function saveRecord(record: EvidenceRecord) {
    if (recordForm.initial) records.update(record.id, record);
    else records.add(record);
    closeForms();
  }
  function saveUtility(u: UtilityAccount) {
    if (utilityForm.initial) utilities.update(u.id, u);
    else utilities.add(u);
    closeForms();
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <h1 className="text-2xl font-semibold tracking-tight">证据画布</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        按阶段串起的租住时间轴：签约、入住、居住中、退租、争议处理。记录事件、材料与水电账目，勾选后可带入争议处理。
      </p>

      <Alert className="mt-4">
        <ShieldAlert className="size-4" />
        <AlertTitle>本机本地保存</AlertTitle>
        <AlertDescription>
          记录跨会话保存在本机浏览器，仅含你录入的结构化记录、描述、状态与账目；合同全文、原始附件、对话与模型结果不在此持久化。
          清理浏览器数据或更换设备可能导致本地记录丢失。本地记录不是云备份，也不代表已验证证据。
        </AlertDescription>
      </Alert>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard
          label="时间跨度"
          value={stats.span ? `${stats.span.from} → ${stats.span.to}` : "未记录日期"}
        />
        <StatCard label="记录 / 账目" value={`${stats.totalRecords} / ${stats.utilityCount}`} />
        <StatCard label="材料状态" value={`已有 ${stats.present} · 缺失 ${stats.missing} · 待确认 ${stats.toConfirm}`} />
        <StatCard
          label="水电待核对"
          value={
            stats.utilityCount === 0
              ? "暂无账目"
              : stats.balanceCents == null
                ? "数据不全，未计算"
                : `${formatCents(stats.balanceCents)}${stats.balanceIncomplete ? `（${stats.balanceIncomplete} 条未计入）` : ""}`
          }
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Label htmlFor="stage-filter" className="text-xs text-muted-foreground">阶段聚焦</Label>
        <NativeSelect
          id="stage-filter"
          size="sm"
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value as "all" | EvidenceStage)}
        >
          <NativeSelectOption value="all">全部阶段</NativeSelectOption>
          {STAGES.map((s) => (
            <NativeSelectOption key={s.id} value={s.id}>{s.label}</NativeSelectOption>
          ))}
        </NativeSelect>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => selection.clear()} disabled={selectedCount === 0}>
            <X className="size-4" />
            清空选择
          </Button>
          <Button size="sm" variant="outline" onClick={() => onNavigate("dispute")} disabled={selectedCount === 0}>
            <Scale className="size-4" />
            去争议处理（{selectedCount}）
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { closeForms(); setUtilityForm({ open: true, initial: null, stage: "living" }); }}
          >
            <Droplets className="size-4" />
            添加账目
          </Button>
          <Button
            size="sm"
            onClick={() => { closeForms(); setRecordForm({ open: true, initial: null, stage: stageFilter === "all" ? "signing" : stageFilter }); }}
          >
            <Plus className="size-4" />
            添加记录
          </Button>
        </div>
      </div>

      {recordForm.open && (
        <div className="mt-3">
          <RecordForm
            initial={recordForm.initial}
            initialStage={recordForm.stage}
            onSave={saveRecord}
            onCancel={closeForms}
          />
        </div>
      )}
      {utilityForm.open && (
        <div className="mt-3">
          <UtilityForm
            initial={utilityForm.initial}
            initialStage={utilityForm.stage}
            onSave={saveUtility}
            onCancel={closeForms}
          />
        </div>
      )}

      {isEmpty ? (
        <div className="mt-5 flex flex-col items-center justify-center rounded-lg border border-dashed py-14 text-center">
          <CalendarClock className="size-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">还没有证据记录</p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            点击「添加记录」录入事件时间、描述、材料状态与金额/读数，或「添加账目」录入水电。记录会按阶段串成时间轴，事件时间与录入时间分开保存。
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-emerald-500" />材料已有</span>
            <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-amber-500" />待确认</span>
            <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-destructive" />材料缺失</span>
            <span className="inline-flex items-center gap-1"><Droplets className="size-3 text-sky-500" />费用账目</span>
          </div>

          {lanes.map((stage) => (
            <StageLane
              key={stage.id}
              stage={stage.id}
              label={stage.label}
              hint={stage.hint}
              items={laneItemsFor(stage.id, allRecords, allUtilities)}
              hints={gapHints(stage.id, allRecords, allUtilities)}
              selectedIds={selectedIds}
              onToggleSelect={(id) => selection.toggle(id)}
              onAdd={() => { closeForms(); setRecordForm({ open: true, initial: null, stage: stage.id }); }}
              onEditRecord={(r) => { closeForms(); setRecordForm({ open: true, initial: r, stage: r.stage }); }}
              onDeleteRecord={(r) => {
                records.remove(r.id);
                if (selectedIds.includes(r.id)) selection.toggle(r.id);
              }}
              onEditUtility={(u) => { closeForms(); setUtilityForm({ open: true, initial: u, stage: utilityStage(u) }); }}
              onDeleteUtility={(u) => utilities.remove(u.id)}
            />
          ))}

          <UtilitySummary list={allUtilities} />

          <div className="flex flex-wrap justify-end gap-2">
            {allUtilities.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                    <Trash2 className="size-4" />
                    清空全部账目
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>清空全部水电账目？</AlertDialogTitle>
                    <AlertDialogDescription>
                      将删除本机保存的 {allUtilities.length} 条账目，此操作不可恢复。证据记录不受影响。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction onClick={() => utilities.clear()}>确认清空</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            {allRecords.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                    <Trash2 className="size-4" />
                    清空全部记录
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>清空全部证据记录？</AlertDialogTitle>
                    <AlertDialogDescription>
                      将删除本机保存的 {allRecords.length} 条记录与当前选择，此操作不可恢复。水电账目不受影响。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction onClick={() => { records.clear(); selection.clear(); }}>确认清空</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xs font-medium">{value}</div>
    </div>
  );
}

function StageLane({
  stage,
  label,
  hint,
  items,
  hints,
  selectedIds,
  onToggleSelect,
  onAdd,
  onEditRecord,
  onDeleteRecord,
  onEditUtility,
  onDeleteUtility,
}: {
  stage: EvidenceStage;
  label: string;
  hint: string;
  items: ReturnType<typeof laneItemsFor>;
  hints: string[];
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onAdd: () => void;
  onEditRecord: (r: EvidenceRecord) => void;
  onDeleteRecord: (r: EvidenceRecord) => void;
  onEditUtility: (u: UtilityAccount) => void;
  onDeleteUtility: (u: UtilityAccount) => void;
}) {
  const recordCount = items.filter((i) => i.kind === "record").length;
  const utilityCount = items.filter((i) => i.kind === "utility").length;

  return (
    <section aria-label={`${label}阶段`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{label}</h2>
        <Badge variant="secondary">{recordCount} 条记录</Badge>
        {utilityCount > 0 && <Badge variant="outline">{utilityCount} 项账目</Badge>}
        <span className="text-[11px] text-muted-foreground">{hint}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onAdd}>
          <Plus className="size-4" />
          添加
        </Button>
      </div>

      {hints.length > 0 && (
        <ul className="mb-2 space-y-1">
          {hints.map((h, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-500">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              <span>{h}</span>
            </li>
          ))}
        </ul>
      )}

      {items.length === 0 ? (
        <p className="ml-2 border-l border-dashed border-border py-2 pl-4 text-xs text-muted-foreground">
          暂无{label}阶段记录
        </p>
      ) : (
        <ol className="ml-2 space-y-3 border-l border-border pl-4">
          {items.map((item) => (
            <li key={item.kind === "record" ? item.record.id : item.account.id} className="relative">
              <span
                aria-hidden="true"
                className={
                  "absolute -left-[22px] top-3 size-2.5 rounded-full ring-2 ring-background " +
                  (item.kind === "utility" ? "bg-sky-500" : statusDot(item.record.materialStatus))
                }
              />
              {item.kind === "record" ? (
                <RecordNode
                  record={item.record}
                  selected={selectedIds.includes(item.record.id)}
                  onToggle={() => onToggleSelect(item.record.id)}
                  onEdit={() => onEditRecord(item.record)}
                  onDelete={() => onDeleteRecord(item.record)}
                />
              ) : (
                <UtilityNode
                  account={item.account}
                  stageLabel={STAGE_LABELS[stage]}
                  onEdit={() => onEditUtility(item.account)}
                  onDelete={() => onDeleteUtility(item.account)}
                />
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RecordNode({
  record,
  selected,
  onToggle,
  onEdit,
  onDelete,
}: {
  record: EvidenceRecord;
  selected: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={selected ? "rounded-lg border border-primary/50 bg-primary/5 p-3" : "rounded-lg border bg-card p-3"}>
      <div className="flex items-start gap-3">
        <Checkbox checked={selected} onCheckedChange={onToggle} aria-label="选择此记录用于争议处理" className="mt-1" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge variant={record.occurredAt ? "outline" : "secondary"} className="font-mono">
              {record.occurredAt ?? "时间待补"}
            </Badge>
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className={"size-2 rounded-full " + statusDot(record.materialStatus)} />
              {EVIDENCE_STATUS_LABELS[record.materialStatus]}
            </span>
            <span className="text-[11px] text-muted-foreground">录入：{formatRecorded(record.recordedAt)}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm">{record.description}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {record.contractClause && <Badge variant="secondary">条款：{record.contractClause}</Badge>}
            {record.materialName && (
              <Badge variant="outline">{record.materialName}{record.materialType ? `（${record.materialType}）` : ""}</Badge>
            )}
            {record.amountCents != null && <Badge variant="outline">金额 {formatCents(record.amountCents)}</Badge>}
            {record.reading && <Badge variant="outline">读数 {record.reading}</Badge>}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit} aria-label="编辑记录">
            <Pencil className="size-4" />
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onDelete} aria-label="删除记录">
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function UtilityNode({
  account,
  stageLabel,
  onEdit,
  onDelete,
}: {
  account: UtilityAccount;
  stageLabel: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const usage = readingUsage(account.startReading, account.endReading);
  const balance = utilityBalance(account);
  return (
    <div className="rounded-lg border border-sky-500/30 bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-300" variant="secondary">
              <Droplets className="size-3" />
              {UTILITY_KIND_LABELS[account.kind]}
            </Badge>
            <Badge variant="outline" className="font-mono">{account.periodStart ?? "周期未填"}</Badge>
            <span className="text-[11px] text-muted-foreground">{stageLabel} · 录入 {formatRecorded(account.recordedAt)}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {account.contractPrice && <span className="text-muted-foreground">单价/分摊：{account.contractPrice}</span>}
            {account.cycle && <span className="text-muted-foreground">周期：{account.cycle}</span>}
            <span className="text-muted-foreground">账单 {formatCents(account.billCents)} · 已付 {formatCents(account.paidCents)}</span>
          </div>
          <details className="group mt-2">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-primary hover:underline">
              <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
              查看核对明细
            </summary>
            <div className="mt-1.5 space-y-1 rounded-md bg-secondary/50 px-3 py-2 text-xs">
              <p>起止读数：{account.startReading ?? "未填"} → {account.endReading ?? "未填"}</p>
              <p>
                用量核对：
                {usage != null ? `结束 − 起始 = ${usage}（请结合合同单价核对）` : "起止读数不完整或无效，无法计算（未知不当作零）。"}
              </p>
              <p>
                账单与已付款差额：
                {balance != null ? `${formatCents(balance)}，请核对是否一致。` : "账单或已付款未填，暂不计算（未知不当作零）。"}
              </p>
              {account.note && <p className="text-muted-foreground">备注：{account.note}</p>}
              <p className="text-muted-foreground">仅提示差异供你核对，不构成多收或违法认定。</p>
            </div>
          </details>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit} aria-label="编辑账目">
            <Pencil className="size-4" />
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onDelete} aria-label="删除账目">
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function UtilitySummary({ list }: { list: UtilityAccount[] }) {
  if (list.length === 0) return null;
  return (
    <details className="rounded-lg border bg-card p-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
        <Droplets className="size-4 text-sky-500" />
        水电核对汇总（{list.length}）
        <ChevronDown className="ml-auto size-4 text-muted-foreground" />
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] text-xs">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b">
              <th className="py-1.5 pr-3 font-medium">类型 / 周期</th>
              <th className="py-1.5 pr-3 font-medium">起止读数</th>
              <th className="py-1.5 pr-3 font-medium">账单</th>
              <th className="py-1.5 pr-3 font-medium">已付款</th>
              <th className="py-1.5 font-medium">差额（待核对）</th>
            </tr>
          </thead>
          <tbody>
            {list.map((u) => {
              const balance = utilityBalance(u);
              return (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="py-1.5 pr-3">
                    {UTILITY_KIND_LABELS[u.kind]}<span className="text-muted-foreground">（{u.periodStart ?? u.cycle ?? "周期未填"}）</span>
                  </td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{u.startReading ?? "未填"} → {u.endReading ?? "未填"}</td>
                  <td className="py-1.5 pr-3">{formatCents(u.billCents)}</td>
                  <td className="py-1.5 pr-3">{formatCents(u.paidCents)}</td>
                  <td className="py-1.5">
                    {balance != null ? formatCents(balance) : <span className="text-muted-foreground">数据不全，未计算</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">仅呈现你录入数据之间的差异，提示核对；未知不当作零，不认定多收或违法。</p>
    </details>
  );
}

interface RecordDraft {
  stage: EvidenceStage;
  occurredAt: string;
  description: string;
  contractClause: string;
  materialName: string;
  materialType: string;
  materialStatus: EvidenceStatus;
  amountYuan: string;
  reading: string;
}

function draftFrom(record: EvidenceRecord | null, initialStage: EvidenceStage): RecordDraft {
  return {
    stage: record?.stage ?? initialStage,
    occurredAt: record?.occurredAt ?? "",
    description: record?.description ?? "",
    contractClause: record?.contractClause ?? "",
    materialName: record?.materialName ?? "",
    materialType: record?.materialType ?? "",
    materialStatus: record?.materialStatus ?? "to_confirm",
    amountYuan: record?.amountCents != null ? (record.amountCents / 100).toFixed(2) : "",
    reading: record?.reading ?? "",
  };
}

function RecordForm({
  initial,
  initialStage,
  onSave,
  onCancel,
}: {
  initial: EvidenceRecord | null;
  initialStage: EvidenceStage;
  onSave: (record: EvidenceRecord) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<RecordDraft>(() => draftFrom(initial, initialStage));
  const [error, setError] = useState("");
  const stageHint = STAGES.find((s) => s.id === draft.stage)?.hint ?? "";

  function set<K extends keyof RecordDraft>(key: K, value: RecordDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function submit() {
    if (!draft.description.trim()) {
      setError("请填写事件描述。");
      return;
    }
    const record: EvidenceRecord = {
      id: initial?.id ?? newId(),
      stage: draft.stage,
      occurredAt: draft.occurredAt.trim() || null,
      recordedAt: initial?.recordedAt ?? new Date().toISOString(),
      description: draft.description.trim(),
      contractClause: draft.contractClause.trim(),
      materialName: draft.materialName.trim(),
      materialType: draft.materialType.trim(),
      materialStatus: draft.materialStatus,
      amountCents: yuanToCents(draft.amountYuan),
      reading: draft.reading.trim() || null,
    };
    onSave(record);
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">{initial ? "编辑记录" : "添加记录"}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="rec-stage" className="text-xs">阶段</Label>
          <NativeSelect id="rec-stage" size="sm" value={draft.stage} onChange={(e) => set("stage", e.target.value as EvidenceStage)}>
            {STAGES.map((s) => (
              <NativeSelectOption key={s.id} value={s.id}>{s.label}</NativeSelectOption>
            ))}
          </NativeSelect>
          <p className="text-[11px] text-muted-foreground">{stageHint}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="rec-occurred" className="text-xs">事件发生时间（可选）</Label>
          <Input id="rec-occurred" type="date" value={draft.occurredAt} onChange={(e) => set("occurredAt", e.target.value)} />
          <p className="text-[11px] text-muted-foreground">系统录入时间会在保存时自动记录。</p>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="rec-desc" className="text-xs">事件描述（你的陈述）</Label>
          <Textarea id="rec-desc" value={draft.description} onChange={(e) => set("description", e.target.value)} className="min-h-20 text-sm" placeholder="例如：入住时客厅墙面已有裂缝，已拍照留存。" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="rec-clause" className="text-xs">关联合同条款（可选）</Label>
          <Input id="rec-clause" value={draft.contractClause} onChange={(e) => set("contractClause", e.target.value)} placeholder="例如：第七条 房屋维修责任" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rec-mat-name" className="text-xs">材料名称（可选）</Label>
          <Input id="rec-mat-name" value={draft.materialName} onChange={(e) => set("materialName", e.target.value)} placeholder="例如：入住交接照片" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rec-mat-type" className="text-xs">材料类型（可选）</Label>
          <Input id="rec-mat-type" value={draft.materialType} onChange={(e) => set("materialType", e.target.value)} placeholder="例如：照片 / 聊天记录 / 票据" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rec-status" className="text-xs">材料状态</Label>
          <NativeSelect id="rec-status" size="sm" value={draft.materialStatus} onChange={(e) => set("materialStatus", e.target.value as EvidenceStatus)}>
            {STATUS_OPTIONS.map((s) => (
              <NativeSelectOption key={s} value={s}>{EVIDENCE_STATUS_LABELS[s]}</NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="rec-amount" className="text-xs">金额（元，可选）</Label>
          <Input id="rec-amount" inputMode="decimal" value={draft.amountYuan} onChange={(e) => set("amountYuan", e.target.value)} placeholder="留空表示未知，不计为 0" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="rec-reading" className="text-xs">读数（可选）</Label>
          <Input id="rec-reading" value={draft.reading} onChange={(e) => set("reading", e.target.value)} placeholder="例如：水表 123.5 / 电表 4567" />
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={submit}>
          <Check className="size-4" />
          {initial ? "保存修改" : "保存记录"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}

interface UtilityDraft {
  kind: UtilityKind;
  stage: EvidenceStage;
  periodStart: string;
  contractPrice: string;
  cycle: string;
  startReading: string;
  endReading: string;
  billYuan: string;
  paidYuan: string;
  note: string;
}

function utilityDraftFrom(u: UtilityAccount | null, initialStage: EvidenceStage): UtilityDraft {
  return {
    kind: u?.kind ?? "electricity",
    stage: u?.stage ?? initialStage,
    periodStart: u?.periodStart ?? "",
    contractPrice: u?.contractPrice ?? "",
    cycle: u?.cycle ?? "",
    startReading: u?.startReading ?? "",
    endReading: u?.endReading ?? "",
    billYuan: u?.billCents != null ? (u.billCents / 100).toFixed(2) : "",
    paidYuan: u?.paidCents != null ? (u.paidCents / 100).toFixed(2) : "",
    note: u?.note ?? "",
  };
}

function UtilityForm({
  initial,
  initialStage,
  onSave,
  onCancel,
}: {
  initial: UtilityAccount | null;
  initialStage: EvidenceStage;
  onSave: (u: UtilityAccount) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<UtilityDraft>(() => utilityDraftFrom(initial, initialStage));

  function set<K extends keyof UtilityDraft>(key: K, value: UtilityDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function submit() {
    const account: UtilityAccount = {
      id: initial?.id ?? newId(),
      kind: draft.kind,
      stage: draft.stage,
      periodStart: draft.periodStart.trim() || null,
      contractPrice: draft.contractPrice.trim(),
      cycle: draft.cycle.trim(),
      startReading: draft.startReading.trim() || null,
      endReading: draft.endReading.trim() || null,
      billCents: yuanToCents(draft.billYuan),
      paidCents: yuanToCents(draft.paidYuan),
      note: draft.note.trim(),
      recordedAt: initial?.recordedAt ?? new Date().toISOString(),
    };
    onSave(account);
  }

  return (
    <div className="rounded-lg border border-sky-500/40 bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">{initial ? "编辑账目" : "添加账目"}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="util-kind" className="text-xs">费用类型</Label>
          <NativeSelect id="util-kind" size="sm" value={draft.kind} onChange={(e) => set("kind", e.target.value as UtilityKind)}>
            {(Object.keys(UTILITY_KIND_LABELS) as UtilityKind[]).map((k) => (
              <NativeSelectOption key={k} value={k}>{UTILITY_KIND_LABELS[k]}</NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="util-stage" className="text-xs">归属阶段</Label>
          <NativeSelect id="util-stage" size="sm" value={draft.stage} onChange={(e) => set("stage", e.target.value as EvidenceStage)}>
            {STAGES.map((s) => (
              <NativeSelectOption key={s.id} value={s.id}>{s.label}</NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="util-period" className="text-xs">计费周期开始（可选）</Label>
          <Input id="util-period" type="date" value={draft.periodStart} onChange={(e) => set("periodStart", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="util-cycle" className="text-xs">计费周期说明（可选）</Label>
          <Input id="util-cycle" value={draft.cycle} onChange={(e) => set("cycle", e.target.value)} placeholder="例如：2024-05 至 2024-06" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="util-price" className="text-xs">合同单价 / 分摊方式（可选）</Label>
          <Input id="util-price" value={draft.contractPrice} onChange={(e) => set("contractPrice", e.target.value)} placeholder="例如：电 1.2 元/度，水按人头分摊" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="util-start" className="text-xs">起始读数（可选）</Label>
          <Input id="util-start" inputMode="decimal" value={draft.startReading} onChange={(e) => set("startReading", e.target.value)} placeholder="留空表示未知" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="util-end" className="text-xs">结束读数（可选）</Label>
          <Input id="util-end" inputMode="decimal" value={draft.endReading} onChange={(e) => set("endReading", e.target.value)} placeholder="留空表示未知" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="util-bill" className="text-xs">对方账单（元，可选）</Label>
          <Input id="util-bill" inputMode="decimal" value={draft.billYuan} onChange={(e) => set("billYuan", e.target.value)} placeholder="留空表示未知，不计为 0" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="util-paid" className="text-xs">已付款（元，可选）</Label>
          <Input id="util-paid" inputMode="decimal" value={draft.paidYuan} onChange={(e) => set("paidYuan", e.target.value)} placeholder="留空表示未知，不计为 0" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="util-note" className="text-xs">备注（可选）</Label>
          <Input id="util-note" value={draft.note} onChange={(e) => set("note", e.target.value)} />
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={submit}>
          <Check className="size-4" />
          {initial ? "保存修改" : "保存账目"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}