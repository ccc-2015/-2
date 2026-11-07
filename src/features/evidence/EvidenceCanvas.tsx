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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  sortRecords,
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

export function EvidenceCanvas({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const allRecords = useEvidenceRecords();
  const allUtilities = useUtilities();
  const selectedIds = useSelectedIds();

  const [stageFilter, setStageFilter] = useState<"all" | EvidenceStage>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EvidenceRecord | null>(null);

  const visible = sortRecords(
    stageFilter === "all" ? allRecords : allRecords.filter((r) => r.stage === stageFilter),
  );
  const selectedCount = allRecords.filter((r) => selectedIds.includes(r.id)).length;

  function openAdd() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(record: EvidenceRecord) {
    setEditing(record);
    setFormOpen(true);
  }
  function closeForm() {
    setFormOpen(false);
    setEditing(null);
  }
  function saveRecord(record: EvidenceRecord) {
    if (editing) records.update(record.id, record);
    else records.add(record);
    closeForm();
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <h1 className="text-2xl font-semibold tracking-tight">证据画布</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        按阶段组织的租住时间线：签约、入住、居住中、退租、争议处理。记录事件、设施、水电账目，勾选后可带入争议处理。
      </p>

      <Alert className="mt-4">
        <ShieldAlert className="size-4" />
        <AlertTitle>本机本地保存</AlertTitle>
        <AlertDescription>
          记录跨会话保存在本机浏览器，仅含你录入的结构化记录、描述、状态与账目；合同全文、原始附件、对话与模型结果不在此持久化。
          清理浏览器数据或更换设备可能导致本地记录丢失。本地记录不是云备份，也不代表已验证证据。
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="timeline" className="mt-5">
        <TabsList>
          <TabsTrigger value="timeline">
            <CalendarClock className="size-4" />
            时间线（{allRecords.length}）
          </TabsTrigger>
          <TabsTrigger value="utilities">
            <Droplets className="size-4" />
            水电对照（{allUtilities.length}）
          </TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="stage-filter" className="text-xs text-muted-foreground">按阶段筛选</Label>
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
              <Button size="sm" onClick={openAdd}>
                <Plus className="size-4" />
                添加记录
              </Button>
            </div>
          </div>

          {formOpen && (
            <RecordForm
              initial={editing}
              onSave={saveRecord}
              onCancel={closeForm}
            />
          )}

          {visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-14 text-center">
              <CalendarClock className="size-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">
                {allRecords.length === 0 ? "还没有证据记录" : "该阶段暂无记录"}
              </p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                点击「添加记录」录入事件时间、描述、材料状态与金额/读数。事件时间与系统录入时间分开保存。
              </p>
            </div>
          ) : (
            <ol className="space-y-3">
              {visible.map((r) => (
                <li key={r.id}>
                  <RecordCard
                    record={r}
                    selected={selectedIds.includes(r.id)}
                    onToggle={() => selection.toggle(r.id)}
                    onEdit={() => openEdit(r)}
                    onDelete={() => {
                      records.remove(r.id);
                      if (selectedIds.includes(r.id)) selection.toggle(r.id);
                    }}
                  />
                </li>
              ))}
            </ol>
          )}

          {allRecords.length > 0 && (
            <div className="flex justify-end">
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
                      将删除本机保存的 {allRecords.length} 条记录与当前选择，此操作不可恢复。水电对照账目不受影响。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction onClick={() => { records.clear(); selection.clear(); }}>
                      确认清空
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </TabsContent>

        <TabsContent value="utilities" className="mt-4">
          <UtilityPanel />
        </TabsContent>
      </Tabs>
    </div>
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

function draftFrom(record: EvidenceRecord | null): RecordDraft {
  return {
    stage: record?.stage ?? "signing",
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
  onSave,
  onCancel,
}: {
  initial: EvidenceRecord | null;
  onSave: (record: EvidenceRecord) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<RecordDraft>(() => draftFrom(initial));
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

function RecordCard({
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
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-start gap-3">
        <Checkbox checked={selected} onCheckedChange={onToggle} aria-label="选择此记录用于争议处理" className="mt-1" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{STAGE_LABELS[record.stage]}</Badge>
            <span className="text-xs text-muted-foreground">事件时间：{record.occurredAt ?? "未填"}</span>
            <span className="text-xs text-muted-foreground">录入：{formatRecorded(record.recordedAt)}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm">{record.description}</p>
          {record.contractClause && (
            <p className="mt-1 text-xs text-muted-foreground">关联条款：{record.contractClause}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {record.materialName && <span className="text-muted-foreground">材料：{record.materialName}{record.materialType ? `（${record.materialType}）` : ""}</span>}
            <Badge variant="outline">{EVIDENCE_STATUS_LABELS[record.materialStatus]}</Badge>
            <span className="text-muted-foreground">金额：{formatCents(record.amountCents)}</span>
            {record.reading && <span className="text-muted-foreground">读数：{record.reading}</span>}
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

interface UtilityDraft {
  kind: UtilityKind;
  contractPrice: string;
  cycle: string;
  startReading: string;
  endReading: string;
  billYuan: string;
  paidYuan: string;
  note: string;
}

function utilityDraftFrom(u: UtilityAccount | null): UtilityDraft {
  return {
    kind: u?.kind ?? "electricity",
    contractPrice: u?.contractPrice ?? "",
    cycle: u?.cycle ?? "",
    startReading: u?.startReading ?? "",
    endReading: u?.endReading ?? "",
    billYuan: u?.billCents != null ? (u.billCents / 100).toFixed(2) : "",
    paidYuan: u?.paidCents != null ? (u.paidCents / 100).toFixed(2) : "",
    note: u?.note ?? "",
  };
}

function UtilityPanel() {
  const list = useUtilities();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UtilityAccount | null>(null);

  function openAdd() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(u: UtilityAccount) {
    setEditing(u);
    setFormOpen(true);
  }
  function close() {
    setFormOpen(false);
    setEditing(null);
  }
  function save(u: UtilityAccount) {
    if (editing) utilities.update(u.id, u);
    else utilities.add(u);
    close();
  }

  return (
    <div className="space-y-4">
      <Alert>
        <Droplets className="size-4" />
        <AlertDescription>
          水电对照只呈现你录入数据之间的差异（账单与已付款、起止读数），提示你核对，不自动认定多收或违法。未知数据留空，不当作零。
        </AlertDescription>
      </Alert>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">费用账目（{list.length}）</h3>
        <Button size="sm" onClick={openAdd}>
          <Plus className="size-4" />
          添加账目
        </Button>
      </div>

      {formOpen && <UtilityForm initial={editing} onSave={save} onCancel={close} />}

      {list.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
          <Droplets className="size-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">还没有水电账目</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            录入合同单价/分摊方式、计费周期、起止读数、对方账单与已付款，系统帮你列出待核对差异。
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((u) => (
            <UtilityCard key={u.id} account={u} onEdit={() => openEdit(u)} onDelete={() => utilities.remove(u.id)} />
          ))}
        </div>
      )}

      {list.length > 0 && (
        <div className="flex justify-end">
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
                  将删除本机保存的 {list.length} 条账目，此操作不可恢复。证据时间线记录不受影响。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={() => utilities.clear()}>确认清空</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}

function UtilityForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: UtilityAccount | null;
  onSave: (u: UtilityAccount) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<UtilityDraft>(() => utilityDraftFrom(initial));

  function set<K extends keyof UtilityDraft>(key: K, value: UtilityDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function submit() {
    const account: UtilityAccount = {
      id: initial?.id ?? newId(),
      kind: draft.kind,
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
    <div className="rounded-lg border border-primary/30 bg-card p-4">
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
          <Label htmlFor="util-cycle" className="text-xs">计费周期（可选）</Label>
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

function readingUsage(start: string | null, end: string | null): number | null {
  if (start == null || end == null) return null;
  const s = Number(start);
  const e = Number(end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  return e - s;
}

function UtilityCard({
  account,
  onEdit,
  onDelete,
}: {
  account: UtilityAccount;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const usage = readingUsage(account.startReading, account.endReading);
  const balance = account.billCents != null && account.paidCents != null ? account.billCents - account.paidCents : null;

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{UTILITY_KIND_LABELS[account.kind]}</Badge>
          {account.cycle && <span className="text-xs text-muted-foreground">{account.cycle}</span>}
          <span className="text-xs text-muted-foreground">录入：{formatRecorded(account.recordedAt)}</span>
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
      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        <div className="flex gap-1"><dt className="text-muted-foreground">合同单价/分摊：</dt><dd>{account.contractPrice || "未填"}</dd></div>
        <div className="flex gap-1"><dt className="text-muted-foreground">起止读数：</dt><dd>{account.startReading ?? "未填"} → {account.endReading ?? "未填"}</dd></div>
        <div className="flex gap-1"><dt className="text-muted-foreground">对方账单：</dt><dd>{formatCents(account.billCents)}</dd></div>
        <div className="flex gap-1"><dt className="text-muted-foreground">已付款：</dt><dd>{formatCents(account.paidCents)}</dd></div>
      </dl>
      {account.note && <p className="mt-1 text-xs text-muted-foreground">备注：{account.note}</p>}
      <div className="mt-2 space-y-1 rounded-md bg-secondary/50 px-3 py-2 text-xs">
        <p>
          <span className="font-medium">用量核对：</span>
          {usage != null ? `结束 − 起始 = ${usage}（请结合合同单价核对）` : "起止读数不完整或无效，无法计算用量（未知不当作零）。"}
        </p>
        <p>
          <span className="font-medium">账单与已付款差额：</span>
          {balance != null ? `${formatCents(balance)}，请核对是否一致。` : "账单或已付款未填，暂不计算差额（未知不当作零）。"}
        </p>
        <p className="text-muted-foreground">以上仅提示差异供你核对，不构成多收或违法认定。</p>
      </div>
    </div>
  );
}