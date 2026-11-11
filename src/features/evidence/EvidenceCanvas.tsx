import { useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  Plus,
  Pencil,
  Trash2,
  Scale,
  Droplets,
  X,
  Check,
  AlertTriangle,
  ChevronDown,
  ImagePlus,
  Download,
  Loader2,
  Printer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HelpTip } from "@/components/HelpTip";
import { EVIDENCE_STATUS_LABELS, type EvidenceStatus } from "@/shared/api";
import { cn } from "@/lib/utils";
import type { ViewId } from "../../components/AppShell";
import { RentalProfileCard } from "../rental/RentalProfileCard";
import { MoveInChecklist } from "./MoveInChecklist";
import { MoveOutCompare } from "./MoveOutCompare";
import { EvidenceOverview } from "./EvidenceOverview";
import { buildEvidencePackage, downloadBlob } from "./exportPackage";
import { printHtml } from "../../lib/print";
import { useRentalProfile } from "../rental/profile";
import { disputePrefill } from "./disputePrefill";
import {
  STAGES,
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
  overviewStats,
  gapHints,
  readingUsage,
  utilityBalance,
  compressImage,
  storeSizeChars,
  MAX_ATTACHMENTS,
  lastStage,
  rememberStage,
  MAX_STORE_CHARS,
  type EvidenceAttachment,
  type EvidenceRecord,
  type EvidenceStage,
  type UtilityAccount,
  type UtilityKind,
} from "./store";
import { loadEvidenceSample } from "./sample";

const STATUS_OPTIONS: EvidenceStatus[] = ["present", "missing", "to_confirm"];

function formatRecorded(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function statusDot(status: EvidenceStatus): string {
  if (status === "present") return "bg-status-present";
  if (status === "missing") return "bg-status-missing";
  return "bg-status-to-confirm";
}

function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}

function Chip({ active, onClick, children, stageId }: { active: boolean; onClick: () => void; children: React.ReactNode; stageId?: string }) {
  const stageColors: Record<string, string> = {
    signing: "data-[active=true]:bg-stage-signing data-[active=true]:text-white",
    move_in: "data-[active=true]:bg-stage-move-in data-[active=true]:text-white",
    living: "data-[active=true]:bg-stage-living data-[active=true]:text-white",
    move_out: "data-[active=true]:bg-stage-move-out data-[active=true]:text-white",
    dispute: "data-[active=true]:bg-stage-dispute data-[active=true]:text-white",
  };
  const colorClass = stageId ? stageColors[stageId] : "data-[active=true]:bg-foreground data-[active=true]:text-background";
  
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-active={active}
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] transition-colors",
        active ? "" : "text-muted-foreground hover:bg-black/[0.05] hover:text-foreground",
        colorClass,
      )}
    >
      {children}
    </button>
  );
}

export function EvidenceCanvas({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const allRecords = useEvidenceRecords();
  const rentalProfile = useRentalProfile();
  const [exporting, setExporting] = useState(false);
  const allUtilities = useUtilities();
  const selectedIds = useSelectedIds();

  const [stageFilter, setStageFilter] = useState<"all" | EvidenceStage>("all");
  const [recordForm, setRecordForm] = useState<{
    open: boolean;
    initial: EvidenceRecord | null;
    stage: EvidenceStage;
    preset?: { description: string; materialType: string } | null;
  }>({
    open: false,
    initial: null,
    stage: "signing",
    preset: null,
  });
  const [utilityForm, setUtilityForm] = useState<{ open: boolean; initial: UtilityAccount | null }>({
    open: false,
    initial: null,
  });
  const [flash, setFlash] = useState("");

  const stats = overviewStats(allRecords, allUtilities);
  const selectedSet = new Set(selectedIds);
  const selectedCount = allRecords.filter((r) => selectedSet.has(r.id)).length;

  const groups = STAGES.map((stage) => ({
    stage,
    items: sortRecords(allRecords.filter((r) => r.stage === stage.id)),
  })).filter((g) => (stageFilter === "all" ? g.items.length > 0 : g.stage.id === stageFilter));

  const emptyStages = STAGES.filter((s) => !allRecords.some((r) => r.stage === s.id));
  const hints = STAGES.flatMap((s) => gapHints(s.id, allRecords, allUtilities)).slice(0, 2);

  const utilityDiff =
    stats.utilityCount === 0
      ? null
      : stats.balanceCents == null
        ? "数据不全"
        : `${formatCents(stats.balanceCents)}${stats.balanceIncomplete ? `（${stats.balanceIncomplete} 项未计入）` : ""}`;

  function closeForms() {
    setRecordForm((f) => ({ ...f, open: false, initial: null, preset: null }));
    setUtilityForm((f) => ({ ...f, open: false, initial: null }));
  }
  function openRecord(stage?: EvidenceStage) {
    closeForms();
    setRecordForm({
      open: true,
      initial: null,
      stage: stage ?? (stageFilter === "all" ? lastStage() ?? "signing" : stageFilter),
      preset: null,
    });
  }
  function openChecklistRecord(label: string, materialType: string, detail: string, stage: EvidenceStage = "move_in") {
    closeForms();
    setRecordForm({
      open: true,
      initial: null,
      stage,
      preset: { description: `${label}：${detail}`, materialType },
    });
  }
  function editRecord(id: string) {
    const record = allRecords.find((item) => item.id === id);
    if (!record) return;
    closeForms();
    setRecordForm({ open: true, initial: record, stage: record.stage, preset: null });
  }
  function openUtility() {
    closeForms();
    setUtilityForm({ open: true, initial: null });
  }
  function saveRecord(record: EvidenceRecord) {
    if (recordForm.initial) records.update(record.id, record);
    else records.add(record);
    rememberStage(record.stage);
    closeForms();
    setFlash(recordForm.initial ? "记录已更新" : "记录已保存到本机");
  }
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(""), 2400);
    return () => window.clearTimeout(timer);
  }, [flash]);
  async function exportPackage(mode: "zip" | "print" = "zip") {
    if (exporting || allRecords.length === 0) return;
    setExporting(true);
    try {
      const { zip, fileName, printHtml: reportHtml } = await buildEvidencePackage({
        profile: rentalProfile,
        records: allRecords,
        utilities: allUtilities,
      });
      if (mode === "zip") downloadBlob(zip, `${fileName}.zip`);
      else printHtml(reportHtml);
    } finally {
      setExporting(false);
    }
  }

  function saveUtility(u: UtilityAccount) {
    if (utilityForm.initial) utilities.update(u.id, u);
    else utilities.add(u);
    closeForms();
    setFlash(utilityForm.initial ? "费用已更新" : "费用已保存到本机");
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-8 pt-6 md:px-8 md:pt-8">
      <header className="border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[26px] font-semibold leading-tight tracking-tight">证据画布</h1>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              按时间记录租住过程中的事件与材料，退租或发生争议时可直接选用。
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
            <Button size="sm" variant="outline" onClick={() => exportPackage("zip")} disabled={exporting || allRecords.length === 0}>
              {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              {exporting ? "打包中…" : "导出证据包"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => exportPackage("print")} disabled={exporting || allRecords.length === 0}>
              <Printer className="size-3.5" />
              打印 / 存为 PDF
            </Button>
            <Button size="sm" variant="outline" onClick={openUtility}>
              <Droplets className="size-3.5" />
              添加费用
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const sample = loadEvidenceSample();
                setFlash(`示例证据已就绪，共 ${sample.recordIds.length} 条演示记录`);
              }}
            >
              试用示例证据
            </Button>
            <Button size="sm" onClick={() => openRecord()}>
              <Plus className="size-3.5" />
              添加记录
            </Button>
          </div>
        </div>
      </header>

      <EvidenceOverview
        records={allRecords}
        startDate={rentalProfile.startDate}
        present={stats.present}
        missing={stats.missing}
        toConfirm={stats.toConfirm}
      />

      {flash && (
        <div
          role="status"
          className="success-feedback fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/70 bg-white/90 px-3.5 py-1.5 text-[12px] shadow-[0_8px_30px_-10px_rgba(16,24,40,0.35)] backdrop-blur-xl md:left-[calc((100vw-248px)/2)]"
        >
          <Check className="size-3.5 text-primary check-appear" />
          {flash}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span>{stats.span ? `${stats.span.from} – ${stats.span.to}` : "未记录日期"}</span>
        <span className="text-border">·</span>
        <span>{stats.totalRecords} 条记录</span>
        <span className="text-border">·</span>
        <span>水电 {stats.utilityCount} 条</span>
        {utilityDiff && (
          <>
            <span className="text-border">·</span>
            <span>水电待核对 {utilityDiff}</span>
          </>
        )}
      </div>

      <RentalProfileCard />

      <MoveInChecklist records={allRecords} onAdd={openChecklistRecord} onEdit={editRecord} />

      <MoveOutCompare
        records={allRecords}
        onAdd={(label, materialType, detail) => openChecklistRecord(label, materialType, detail, "move_out")}
        onEdit={editRecord}
      />

      {hints.length > 0 && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-600">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          <span>{hints.join(" ")}</span>
        </p>
      )}

      <p className="mt-1.5 text-[11px] text-muted-foreground">
        记录与图片仅保存在本机浏览器，清理浏览器数据或更换设备会丢失；不是云备份，也不代表已验证证据。
      </p>

      <div className="mt-4 flex flex-wrap gap-1">
        <Chip active={stageFilter === "all"} onClick={() => setStageFilter("all")}>全部 {allRecords.length}</Chip>
        {STAGES.map((s) => {
          const n = allRecords.filter((r) => r.stage === s.id).length;
          return (
            <Chip key={s.id} active={stageFilter === s.id} onClick={() => setStageFilter(s.id)} stageId={s.id}>
              {s.label}{n > 0 ? ` ${n}` : ""}
            </Chip>
          );
        })}
      </div>

      {recordForm.open && (
        <div className="mt-3">
          <RecordForm
            initial={recordForm.initial}
            initialStage={recordForm.stage}
            preset={recordForm.preset ?? null}
            onSave={saveRecord}
            onCancel={closeForms}
          />
        </div>
      )}
      {utilityForm.open && (
        <div className="mt-3">
          <UtilityForm initial={utilityForm.initial} onSave={saveUtility} onCancel={closeForms} />
        </div>
      )}

      <div className="mt-5 space-y-6">
        {groups.map(({ stage, items }) => (
          <section key={stage.id} aria-label={`${stage.label}阶段`}>
            <div className="mb-1.5 flex items-baseline gap-2 px-0.5">
              <h2 className="text-[13px] font-semibold">{stage.label}</h2>
              <span className="text-[11px] text-muted-foreground">{items.length} 条</span>
              <button
                type="button"
                onClick={() => openRecord(stage.id)}
                className="ml-auto text-[11px] text-primary hover:underline"
              >
                添加
              </button>
            </div>
            <div className="overflow-hidden rounded-xl border border-white/60 bg-white/55 backdrop-blur-md">
              {items.map((r, i) => (
                <RecordRow
                  key={r.id}
                  record={r}
                  selected={selectedSet.has(r.id)}
                  bordered={i > 0}
                  onToggle={() => selection.toggle(r.id)}
                  onEdit={() => {
                    closeForms();
                    setRecordForm({ open: true, initial: r, stage: r.stage });
                  }}
                  onDelete={() => {
                    records.remove(r.id);
                    if (selectedSet.has(r.id)) selection.toggle(r.id);
                  }}
                  onStartDispute={() => {
                    if (!selectedSet.has(r.id)) selection.toggle(r.id);
                    disputePrefill.set({
                      issue: r.description.split("\n")[0].slice(0, 80),
                      facts: [r.description, r.contractClause ? `关联条款：${r.contractClause}` : ""]
                        .filter(Boolean)
                        .join("\n"),
                      evidenceIds: Array.from(new Set([...selectedIds, r.id])),
                    });
                    onNavigate("dispute");
                  }}
                />
              ))}
            </div>
          </section>
        ))}

        {groups.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 px-4 py-12 text-center">
            <CalendarClock className="size-7 text-muted-foreground" />
            <p className="mt-2.5 text-[13px] font-medium">
              {allRecords.length === 0 ? "还没有记录" : "该阶段暂无记录"}
            </p>
            <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-muted-foreground">
              {allRecords.length === 0
                ? "先拍入住现状最有用：水电底数、墙面地面、家具家电，退租时能直接对照。"
                : "这个阶段还没有记录，可以从下面挑一项开始。"}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {allRecords.length === 0 ? (
                <>
                  <Button size="sm" onClick={() => openChecklistRecord("水电燃气底数", "表读数", "水表、电表、燃气表读数并拍表盘")}>
                    <Plus className="size-3.5" />
                    记录入住
                  </Button>
                  <Button size="sm" variant="outline" onClick={openUtility}>
                    <Droplets className="size-3.5" />
                    记一笔水电
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => openRecord(stageFilter === "all" ? undefined : stageFilter)}>
                  <Plus className="size-3.5" />
                  添加记录
                </Button>
              )}
            </div>
            {allRecords.length === 0 && (
              <p className="mt-2 text-[10px] text-muted-foreground">
                也可以直接用上方「入住必拍清单」逐项拍；点「试用示例证据」可一键看完整流程。
              </p>
            )}
          </div>
        )}
      </div>

      {emptyStages.length > 0 && stageFilter === "all" && (
        <p className="mt-5 text-[11px] text-muted-foreground">
          尚未记录：{emptyStages.map((s) => s.label).join("、")}
        </p>
      )}

      <ExpenseSection
        list={allUtilities}
        onAdd={openUtility}
        onEdit={(u) => {
          closeForms();
          setUtilityForm({ open: true, initial: u });
        }}
        onDelete={(u) => utilities.remove(u.id)}
      />

      <div className="mt-8 flex flex-wrap justify-end gap-3">
        {allUtilities.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button type="button" className="text-[11px] text-muted-foreground hover:text-destructive">清空全部费用</button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>清空全部费用账目？</AlertDialogTitle>
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
              <button type="button" className="text-[11px] text-muted-foreground hover:text-destructive">清空全部记录</button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>清空全部证据记录？</AlertDialogTitle>
                <AlertDialogDescription>
                  将删除本机保存的 {allRecords.length} 条记录与当前选择，此操作不可恢复。费用账目不受影响。
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

      {selectedCount > 0 && (
        <div className="step-appear fixed bottom-4 left-1/2 z-30 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-full border border-white/70 bg-white/85 px-4 py-2 shadow-[0_8px_30px_-10px_rgba(16,24,40,0.35)] backdrop-blur-xl md:left-[calc((100vw-248px)/2)]">
          <span className="text-[12px]">已选 {selectedCount} 条证据</span>
          <button type="button" onClick={() => selection.clear()} className="text-[11px] text-muted-foreground hover:text-foreground">
            清空
          </button>
          <Button size="sm" className="ml-auto rounded-full" onClick={() => onNavigate("dispute")}>
            <Scale className="size-3.5" />
            去争议处理
          </Button>
        </div>
      )}
    </div>
  );
}

function RecordRow({
  record,
  selected,
  bordered,
  onToggle,
  onEdit,
  onDelete,
  onStartDispute,
}: {
  record: EvidenceRecord;
  selected: boolean;
  bordered: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onStartDispute: () => void;
}) {
  const [preview, setPreview] = useState<EvidenceAttachment | null>(null);
  const [removing, setRemoving] = useState(false);
  const attachments = record.attachments ?? [];

  function remove() {
    if (removing) return;
    setRemoving(true);
    window.setTimeout(onDelete, 160);
  }

  return (
    <details
      className={cn(
        "group list-appear transition-[opacity,transform] duration-150",
        removing && "pointer-events-none -translate-x-1 opacity-0",
        bordered && "border-t border-black/[0.05]",
      )}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-black/[0.02] [&::-webkit-details-marker]:hidden">
        <span className="w-[82px] shrink-0 font-mono text-[11px] text-muted-foreground">
          {record.occurredAt ?? "时间待补"}
        </span>
        <span className={cn("size-1.5 shrink-0 rounded-full", statusDot(record.materialStatus))} aria-hidden="true" />
        <span className={cn("min-w-0 flex-1 truncate text-[13px]", selected && "font-medium")}>{firstLine(record.description)}</span>
        <span className="hidden shrink-0 items-center gap-2 text-[11px] text-muted-foreground sm:flex">
          {record.amountCents != null && <span className="font-mono">{formatCents(record.amountCents)}</span>}
          {attachments.length > 0 && <span>{attachments.length} 图</span>}
          {record.materialName && <span>{EVIDENCE_STATUS_LABELS[record.materialStatus]}</span>}
        </span>
        {selected && <Check className="size-3.5 shrink-0 text-primary" aria-label="已选入争议证据" />}
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>

      <div className="px-3 pb-3.5 sm:pl-[calc(82px+2.5rem)]">
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{record.description}</p>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-2">
          <div className="flex gap-1"><dt>材料：</dt><dd>{record.materialName || "未填"}{record.materialType ? `（${record.materialType}）` : ""}</dd></div>
          <div className="flex gap-1"><dt>状态：</dt><dd>{EVIDENCE_STATUS_LABELS[record.materialStatus]}</dd></div>
          {record.contractClause && <div className="flex gap-1"><dt>关联条款：</dt><dd>{record.contractClause}</dd></div>}
          <div className="flex gap-1"><dt>录入：</dt><dd>{formatRecorded(record.recordedAt)}</dd></div>
          {record.amountCents != null && <div className="flex gap-1"><dt>金额：</dt><dd>{formatCents(record.amountCents)}</dd></div>}
          {record.reading && <div className="flex gap-1"><dt>读数：</dt><dd>{record.reading}</dd></div>}
        </dl>

        {record.content && (
          <details className="mt-2 rounded-lg bg-secondary/50 px-2.5 py-2">
            <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
              查看材料全文（{record.content.length} 字符{record.originalText ? " · 可对比原文" : ""}）
            </summary>
            {record.originalText ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-[11px] text-muted-foreground">原文</p>
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded border bg-background p-2 font-mono text-[11px] leading-relaxed">{record.originalText}</pre>
                </div>
                <div>
                  <p className="mb-1 text-[11px] text-muted-foreground">修订副本</p>
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded border bg-background p-2 font-mono text-[11px] leading-relaxed">{record.content}</pre>
                </div>
              </div>
            ) : (
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded border bg-background p-2 font-mono text-[11px] leading-relaxed">{record.content}</pre>
            )}
          </details>
        )}

        {attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {attachments.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setPreview(a)}
                className="size-14 overflow-hidden rounded-lg border border-black/[0.06] transition-opacity hover:opacity-90"
                aria-label={`查看图片 ${a.name}`}
              >
                <img src={a.dataUrl} alt={a.name} className="size-full object-cover" />
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant={selected ? "secondary" : "outline"} onClick={onToggle}>
            {selected ? <Check className="size-3.5" /> : <Scale className="size-3.5" />}
            {selected ? "移出争议证据" : "选入争议处理"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Pencil className="size-3.5" />
            编辑
          </Button>
          <Button size="sm" variant="ghost" onClick={onStartDispute}>
            <Scale className="size-3.5" />
            就此发起争议
          </Button>
          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={remove}>
            <Trash2 className="size-3.5" />
            删除
          </Button>
        </div>
      </div>

      <Dialog open={!!preview} onOpenChange={(open) => { if (!open) setPreview(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm">{preview?.name ?? "图片"}</DialogTitle>
          </DialogHeader>
          {preview && <img src={preview.dataUrl} alt={preview.name} className="max-h-[70vh] w-full rounded-lg object-contain" />}
        </DialogContent>
      </Dialog>
    </details>
  );
}

function ExpenseSection({
  list,
  onAdd,
  onEdit,
  onDelete,
}: {
  list: UtilityAccount[];
  onAdd: () => void;
  onEdit: (u: UtilityAccount) => void;
  onDelete: (u: UtilityAccount) => void;
}) {
  let sum: number | null = null;
  let incomplete = 0;
  for (const u of list) {
    const b = utilityBalance(u);
    if (b == null) incomplete++;
    else sum = (sum ?? 0) + b;
  }

  return (
    <section className="mt-8" aria-label="水电与费用">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-border/60 pb-1.5">
        <h2 className="text-[13px] font-semibold">水电与费用</h2>
        <span className="text-[11px] text-muted-foreground">
          {list.length === 0
            ? "暂无"
            : `${list.length} 项${sum != null ? ` · 待核对 ${formatCents(sum)}` : " · 数据不全"}${incomplete ? `（${incomplete} 项未计入）` : ""}`}
        </span>
        <button type="button" onClick={onAdd} className="ml-auto text-[11px] text-primary hover:underline">
          添加
        </button>
      </div>

      {list.length === 0 ? (
        <p className="py-5 text-center text-[11px] text-muted-foreground">
          录入合同单价/分摊方式、起止读数、账单与已付款，系统只提示你录入数据之间的差异。
        </p>
      ) : (
        <div className="mt-1.5 overflow-hidden rounded-xl border border-white/60 bg-white/55 backdrop-blur-md">
          {list.map((u, i) => (
            <ExpenseRow
              key={u.id}
              account={u}
              bordered={i > 0}
              onEdit={() => onEdit(u)}
              onDelete={() => onDelete(u)}
            />
          ))}
        </div>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        仅呈现你录入数据之间的差异，供核对；未知不当作零，不认定多收或违法。
      </p>
    </section>
  );
}

function ExpenseRow({
  account,
  bordered,
  onEdit,
  onDelete,
}: {
  account: UtilityAccount;
  bordered: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const usage = readingUsage(account.startReading, account.endReading);
  const balance = utilityBalance(account);
  return (
    <details className={cn("group", bordered && "border-t border-black/[0.05]")}>
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-black/[0.02] [&::-webkit-details-marker]:hidden">
        <Droplets className="size-3 shrink-0 text-sky-500" />
        <span className="w-[82px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-muted-foreground">
          {account.periodStart ?? account.cycle ?? "周期未填"}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px]">{UTILITY_KIND_LABELS[account.kind]}</span>
        <span className="hidden shrink-0 gap-2 text-[11px] text-muted-foreground sm:flex">
          <span className="font-mono">账单 {formatCents(account.billCents)}</span>
          <span className="font-mono">已付 {formatCents(account.paidCents)}</span>
        </span>
        <span className={cn("shrink-0 font-mono text-[11px]", balance == null ? "text-muted-foreground" : "text-foreground")}>
          {balance == null ? "未计算" : formatCents(balance)}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-3 pb-3.5 sm:pl-[calc(82px+2.5rem)]">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-2">
          <div className="flex gap-1"><dt>单价/分摊：</dt><dd>{account.contractPrice || "未填"}</dd></div>
          <div className="flex gap-1"><dt>周期：</dt><dd>{account.cycle || account.periodStart || "未填"}</dd></div>
          <div className="flex gap-1"><dt>起止读数：</dt><dd>{account.startReading ?? "未填"} → {account.endReading ?? "未填"}</dd></div>
          <div className="flex gap-1"><dt>用量：</dt><dd>{usage != null ? `${usage}（请结合单价核对）` : "数据不全"}</dd></div>
          <div className="flex gap-1"><dt>对方账单：</dt><dd>{formatCents(account.billCents)}</dd></div>
          <div className="flex gap-1"><dt>已付款：</dt><dd>{formatCents(account.paidCents)}</dd></div>
          <div className="flex gap-1"><dt>差额：</dt><dd>{balance != null ? `${formatCents(balance)}，请核对` : "数据不全，未计算"}</dd></div>
          <div className="flex gap-1"><dt>录入：</dt><dd>{formatRecorded(account.recordedAt)}</dd></div>
          {account.note && <div className="flex gap-1 sm:col-span-2"><dt>备注：</dt><dd>{account.note}</dd></div>}
        </dl>
        <div className="mt-2.5 flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Pencil className="size-3.5" />
            编辑
          </Button>
          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={onDelete}>
            <Trash2 className="size-3.5" />
            删除
          </Button>
        </div>
      </div>
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
  attachments: EvidenceAttachment[];
}

function todayLocal(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function draftFrom(record: EvidenceRecord | null, initialStage: EvidenceStage): RecordDraft {
  return {
    stage: record?.stage ?? initialStage,
    occurredAt: record?.occurredAt ?? todayLocal(),
    description: record?.description ?? "",
    contractClause: record?.contractClause ?? "",
    materialName: record?.materialName ?? "",
    materialType: record?.materialType ?? "",
    materialStatus: record?.materialStatus ?? "to_confirm",
    amountYuan: record?.amountCents != null ? (record.amountCents / 100).toFixed(2) : "",
    reading: record?.reading ?? "",
    attachments: record?.attachments ?? [],
  };
}

function RecordForm({
  initial,
  initialStage,
  preset,
  onSave,
  onCancel,
}: {
  initial: EvidenceRecord | null;
  initialStage: EvidenceStage;
  preset?: { description: string; materialType: string } | null;
  onSave: (record: EvidenceRecord) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<RecordDraft>(() => {
    const base = draftFrom(initial, initialStage);
    if (initial || !preset) return base;
    return {
      ...base,
      description: preset.description,
      materialType: preset.materialType,
      materialName: preset.materialType,
    };
  });
  const [error, setError] = useState("");
  const [compressing, setCompressing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(() => !!initial);
  const advancedFilled =
    !!draft.materialName || !!draft.materialType || !!draft.amountYuan || !!draft.reading || !!draft.contractClause;
  const imageRef = useRef<HTMLInputElement>(null);
  const stageHint = STAGES.find((s) => s.id === draft.stage)?.hint ?? "";

  function set<K extends keyof RecordDraft>(key: K, value: RecordDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function onPickImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    const room = MAX_ATTACHMENTS - draft.attachments.length;
    if (room <= 0) {
      setError(`最多添加 ${MAX_ATTACHMENTS} 张图片。`);
      return;
    }
    setCompressing(true);
    setError("");
    try {
      const added: EvidenceAttachment[] = [];
      for (const file of files.slice(0, room)) {
        if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
          setError("仅支持 PNG / JPG / WEBP 图片。");
          continue;
        }
        if (file.size > 8 * 1024 * 1024) {
          setError("单张图片超过 8MB，请压缩后再添加。");
          continue;
        }
        added.push(await compressImage(file));
      }
      if (added.length > 0) {
        setDraft((prev) => ({
          ...prev,
          attachments: [...prev.attachments, ...added],
          materialStatus: prev.materialStatus === "to_confirm" ? "present" : prev.materialStatus,
          materialName: prev.materialName || added[0].name.replace(/\.[^.]+$/, ""),
        }));
      }
    } catch {
      setError("图片处理失败，请换一张或稍后重试。");
    } finally {
      setCompressing(false);
    }
  }

  function removeAttachment(id: string) {
    setDraft((prev) => ({ ...prev, attachments: prev.attachments.filter((a) => a.id !== id) }));
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
      attachments: draft.attachments,
      content: initial?.content,
      originalText: initial?.originalText,
    };
    const projected = storeSizeChars(
      initial ? records.getAll().map((r) => (r.id === record.id ? record : r)) : [...records.getAll(), record],
      utilities.getAll(),
    );
    if (projected > MAX_STORE_CHARS) {
      setError("本地存储空间不足：图片过多或过大。请减少图片，或清空历史记录后再保存。");
      return;
    }
    onSave(record);
  }

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">{initial ? "编辑记录" : "快速记录"}</h3>
        {!initial && <span className="text-[11px] text-muted-foreground">拍照 + 一句话即可保存</span>}
      </div>

      {!initial && (
        <div className="mb-3 rounded-xl border border-dashed border-border/80 bg-secondary/20 p-3">
          <div className="flex flex-wrap items-center gap-2">
            {draft.attachments.map((a) => (
              <div key={a.id} className="relative size-16 overflow-hidden rounded-lg border border-black/[0.06]">
                <img src={a.dataUrl} alt={a.name} className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeAttachment(a.id)}
                  aria-label={`移除 ${a.name}`}
                  className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            {draft.attachments.length < MAX_ATTACHMENTS && (
              <button
                type="button"
                onClick={() => imageRef.current?.click()}
                disabled={compressing}
                className="flex size-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-background text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground disabled:opacity-60"
              >
                <ImagePlus className="size-4" />
                <span className="text-[10px]">{compressing ? "处理中" : "拍照/选图"}</span>
              </button>
            )}
          </div>
          <Input
            value={draft.description}
            onChange={(event) => set("description", event.target.value)}
            className="mt-2"
            placeholder="一句话说明：例如 入住时客厅墙面已有裂缝"
          />
        </div>
      )}

      {!initial && <p className="mb-2 text-[11px] font-medium text-muted-foreground">时间与阶段（已自动带出，可改）</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="rec-stage" className="text-xs">阶段</Label>
          <Select value={draft.stage} onValueChange={(v) => set("stage", v as EvidenceStage)}>
            <SelectTrigger id="rec-stage" size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAGES.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">{stageHint}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="rec-occurred" className="text-xs">事件发生时间（可选）</Label>
          <Input id="rec-occurred" type="date" value={draft.occurredAt} onChange={(e) => set("occurredAt", e.target.value)} />
          <p className="text-[11px] text-muted-foreground">录入时间保存时自动记录。</p>
        </div>
        {initial && (
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="rec-desc" className="text-xs">事件描述（你的陈述）</Label>
            <Textarea id="rec-desc" value={draft.description} onChange={(e) => set("description", e.target.value)} className="min-h-20 text-[13px]" placeholder="例如：入住时客厅墙面已有裂缝，已拍照留存。" />
          </div>
        )}
        <div className="space-y-1.5 sm:col-span-2">
          <button
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            aria-expanded={moreOpen}
            className="flex w-full items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <span>{moreOpen ? "收起更多信息" : "更多信息（可选）"}</span>
            {!moreOpen && advancedFilled && <span className="text-primary">已填写</span>}
          </button>
          {moreOpen && (
            <div className="mt-2 grid gap-3 rounded-lg bg-secondary/30 p-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="rec-mat-name" className="text-xs">材料名称</Label>
                <Input id="rec-mat-name" value={draft.materialName} onChange={(e) => set("materialName", e.target.value)} placeholder="例如：入住交接照片" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rec-mat-type" className="text-xs">材料类型</Label>
                <Input id="rec-mat-type" value={draft.materialType} onChange={(e) => set("materialType", e.target.value)} placeholder="例如：照片 / 聊天记录 / 票据" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1">
                  <Label htmlFor="rec-status" className="text-xs">材料状态</Label>
                  <HelpTip label="材料状态说明">
                    已有：材料在你手里；缺失：对方应提供但没有；待确认：还需要核实。状态只作整理标记，不代表证据效力。
                  </HelpTip>
                </div>
                <Select value={draft.materialStatus} onValueChange={(v) => set("materialStatus", v as EvidenceStatus)}>
                  <SelectTrigger id="rec-status" size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>{EVIDENCE_STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1">
                  <Label htmlFor="rec-amount" className="text-xs">金额（元）</Label>
                  <HelpTip label="金额填写说明">
                    填实际发生的金额，例如被扣押金 4000。留空表示未知，不会被当作 0 参与核对。
                  </HelpTip>
                </div>
                <Input id="rec-amount" inputMode="decimal" value={draft.amountYuan} onChange={(e) => set("amountYuan", e.target.value)} placeholder="留空表示未知，不计为 0" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rec-reading" className="text-xs">读数</Label>
                <Input id="rec-reading" value={draft.reading} onChange={(e) => set("reading", e.target.value)} placeholder="例如：水表 123.5" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rec-clause" className="text-xs">关联合同条款</Label>
                <Input id="rec-clause" value={draft.contractClause} onChange={(e) => set("contractClause", e.target.value)} placeholder="例如：第七条 房屋维修责任" />
              </div>
            </div>
          )}
        </div>
        <div className={initial ? "space-y-1.5 sm:col-span-2" : "hidden"}>
          <Label className="text-xs">图片材料（可选）</Label>
          <div className="flex flex-wrap items-center gap-2">
            {draft.attachments.map((a) => (
              <div key={a.id} className="relative size-16 overflow-hidden rounded-lg border border-black/[0.06]">
                <img src={a.dataUrl} alt={a.name} className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeAttachment(a.id)}
                  aria-label={`移除 ${a.name}`}
                  className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            {draft.attachments.length < MAX_ATTACHMENTS && (
              <button
                type="button"
                onClick={() => imageRef.current?.click()}
                disabled={compressing}
                className="flex size-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground disabled:opacity-60"
              >
                <ImagePlus className="size-4" />
                <span className="text-[10px]">{compressing ? "处理中" : "添加"}</span>
              </button>
            )}
          </div>
          <input ref={imageRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={onPickImages} />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            图片压缩后保存在本机浏览器（每条最多 {MAX_ATTACHMENTS} 张），清理浏览器数据会丢失。
          </p>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={submit}>
          <Check className="size-3.5" />
          {initial ? "保存修改" : "保存记录"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}

interface UtilityDraft {
  kind: UtilityKind;
  periodStart: string;
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
  onSave,
  onCancel,
}: {
  initial: UtilityAccount | null;
  onSave: (u: UtilityAccount) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<UtilityDraft>(() => utilityDraftFrom(initial));
  const [error, setError] = useState("");

  function set<K extends keyof UtilityDraft>(key: K, value: UtilityDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function submit() {
    const account: UtilityAccount = {
      id: initial?.id ?? newId(),
      kind: draft.kind,
      stage: initial?.stage ?? "living",
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
    const projected = storeSizeChars(
      records.getAll(),
      [...utilities.getAll().filter((u) => u.id !== account.id), account],
    );
    if (projected > MAX_STORE_CHARS) {
      setError("本地存储空间不足：请减少图片或清空历史记录后再保存。");
      return;
    }
    onSave(account);
  }

  return (
    <div className="panel p-4">
      <h3 className="mb-3 text-[13px] font-semibold">{initial ? "编辑费用" : "添加费用"}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="util-kind" className="text-xs">费用类型</Label>
          <Select value={draft.kind} onValueChange={(v) => set("kind", v as UtilityKind)}>
            <SelectTrigger id="util-kind" size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(UTILITY_KIND_LABELS) as UtilityKind[]).map((k) => (
                <SelectItem key={k} value={k}>{UTILITY_KIND_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="util-period" className="text-xs">计费周期开始（可选）</Label>
          <Input id="util-period" type="date" value={draft.periodStart} onChange={(e) => set("periodStart", e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="util-price" className="text-xs">合同单价 / 分摊方式（可选）</Label>
          <Input id="util-price" value={draft.contractPrice} onChange={(e) => set("contractPrice", e.target.value)} placeholder="例如：电 1.2 元/度，水按人头分摊" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="util-cycle" className="text-xs">计费周期说明（可选）</Label>
          <Input id="util-cycle" value={draft.cycle} onChange={(e) => set("cycle", e.target.value)} placeholder="例如：2024-05 至 2024-06" />
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
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={submit}>
          <Check className="size-3.5" />
          {initial ? "保存修改" : "保存费用"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}