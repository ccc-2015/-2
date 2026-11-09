import { CalendarDays, CheckCircle2, FileSignature, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGES, type EvidenceRecord, type EvidenceStage } from "./store";

const STAGE_TONE: Record<EvidenceStage, { dot: string; bar: string; text: string }> = {
  signing: { dot: "bg-stage-signing", bar: "bg-stage-signing", text: "text-stage-signing" },
  move_in: { dot: "bg-stage-move-in", bar: "bg-stage-move-in", text: "text-stage-move-in" },
  living: { dot: "bg-stage-living", bar: "bg-stage-living", text: "text-stage-living" },
  move_out: { dot: "bg-stage-move-out", bar: "bg-stage-move-out", text: "text-stage-move-out" },
  dispute: { dot: "bg-stage-dispute", bar: "bg-stage-dispute", text: "text-stage-dispute" },
};

function daysBetween(from: string, to: string): number | null {
  const start = new Date(`${from}T00:00:00`).getTime();
  const end = new Date(`${to}T00:00:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 86400000);
}

function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function EvidenceOverview({
  records,
  startDate,
  present,
  missing,
  toConfirm,
}: {
  records: EvidenceRecord[];
  startDate: string;
  present: number;
  missing: number;
  toConfirm: number;
}) {
  const firstDates = new Map<EvidenceStage, string>();
  for (const record of records) {
    if (!record.occurredAt) continue;
    const current = firstDates.get(record.stage);
    if (!current || record.occurredAt < current) firstDates.set(record.stage, record.occurredAt);
  }

  const signDate = firstDates.get("signing") ?? startDate;
  const lived = signDate ? daysBetween(signDate, today()) : null;
  const activeStage: EvidenceStage | null = (() => {
    const order: EvidenceStage[] = ["dispute", "move_out", "living", "move_in", "signing"];
    for (const stage of order) if (records.some((record) => record.stage === stage)) return stage;
    return null;
  })();

  const cards = [
    { label: "签约日期", value: signDate || "未记录", icon: FileSignature, tone: "text-stage-signing" },
    { label: "已居住", value: lived == null ? "—" : `${lived} 天`, icon: CalendarDays, tone: "text-stage-living" },
    { label: "证据已有", value: `${present} 项`, icon: CheckCircle2, tone: "text-status-present" },
    {
      label: "材料待补",
      value: missing + toConfirm > 0 ? `${missing + toConfirm} 项` : "无",
      icon: TriangleAlert,
      tone: missing > 0 ? "text-status-missing" : "text-status-to-confirm",
    },
  ];

  return (
    <div className="mt-4 space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-xl border border-border/70 bg-background px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Icon className={cn("size-3.5", card.tone)} />
                {card.label}
              </div>
              <p className="mt-1 text-[15px] font-semibold tracking-tight">{card.value}</p>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-border/70 bg-secondary/20 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {STAGES.map((stage, index) => {
            const count = records.filter((record) => record.stage === stage.id).length;
            const done = count > 0;
            const tone = STAGE_TONE[stage.id];
            const current = activeStage === stage.id;
            return (
              <div key={stage.id} className="flex min-w-0 items-center gap-1.5">
                {index > 0 && <span className="h-px w-3 bg-border" aria-hidden="true" />}
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    done ? tone.dot : "border border-dashed border-muted-foreground/40",
                    current && done && "ring-2 ring-offset-1 ring-offset-background",
                    current && done && tone.dot.replace("bg-", "ring-"),
                  )}
                  aria-hidden="true"
                />
                <span className={cn("text-[11px]", done ? "font-medium text-foreground" : "text-muted-foreground")}>
                  {stage.label}
                </span>
                {count > 0 && <span className={cn("text-[10px]", tone.text)}>{count}</span>}
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex h-1 overflow-hidden rounded-full bg-black/[0.05]">
          {STAGES.map((stage) => {
            const count = records.filter((record) => record.stage === stage.id).length;
            return (
              <span
                key={stage.id}
                className={cn("h-full flex-1", count > 0 ? STAGE_TONE[stage.id].bar : "bg-transparent")}
                style={{ opacity: count > 0 ? Math.min(1, 0.45 + count * 0.15) : 0 }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
