import { ArrowRight, Camera, CircleDashed, Check } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MOVE_IN_CHECKLIST, type EvidenceRecord } from "./store";

interface Pair {
  itemId: string;
  label: string;
  materialType: string;
  detail: string;
  moveIn: EvidenceRecord | null;
  moveOut: EvidenceRecord | null;
}

function matchByType(list: EvidenceRecord[], materialType: string): EvidenceRecord | null {
  return list.find((record) => record.materialType === materialType) ?? null;
}

function pairsFor(records: EvidenceRecord[]): Pair[] {
  const moveIn = records.filter((record) => record.stage === "move_in");
  const moveOut = records.filter((record) => record.stage === "move_out");
  return MOVE_IN_CHECKLIST.map((item) => ({
    itemId: item.id,
    label: item.label,
    materialType: item.materialType,
    detail: item.detail,
    moveIn: matchByType(moveIn, item.materialType),
    moveOut: matchByType(moveOut, item.materialType),
  })).filter((pair) => pair.moveIn || pair.moveOut);
}

export function MoveOutCompare({
  records,
  onAdd,
  onEdit,
}: {
  records: EvidenceRecord[];
  onAdd: (label: string, materialType: string, detail: string) => void;
  onEdit: (id: string) => void;
}) {
  const pairs = pairsFor(records);
  const [open, setOpen] = useState(false);
  if (pairs.length === 0) return null;

  const gaps = pairs.filter((pair) => pair.moveIn && !pair.moveOut).length;

  return (
    <div className="mt-3 rounded-xl border border-border/70 bg-background">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left"
      >
        <ArrowRight className="size-3.5 text-muted-foreground" />
        <span className="text-[12px] font-medium">退租对照</span>
        <span className="text-[11px] text-muted-foreground">
          入住 {pairs.filter((p) => p.moveIn).length} 项 · 退租 {pairs.filter((p) => p.moveOut).length} 项
        </span>
        {gaps > 0 && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700">
            {gaps} 项退租未拍
          </span>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">{open ? "收起" : "展开"}</span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-border/60 p-2">
          {pairs.map((pair) => {
            const missing = !pair.moveOut;
            return (
              <div
                key={pair.itemId}
                className={cn(
                  "rounded-lg px-2.5 py-2",
                  missing ? "bg-amber-500/5 ring-1 ring-amber-500/20" : "bg-secondary/40",
                )}
              >
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-medium">{pair.label}</span>
                  {missing ? (
                    <span className="text-[10px] text-amber-700">退租还没拍</span>
                  ) : (
                    <span className="flex items-center gap-0.5 text-[10px] text-emerald-600">
                      <Check className="size-2.5" />
                      已对照
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-6 px-1.5 text-[10px]"
                    onClick={() =>
                      missing
                        ? onAdd(pair.label, pair.materialType, `退租对照：${pair.detail}`)
                        : pair.moveOut && onEdit(pair.moveOut.id)
                    }
                  >
                    <Camera className="size-3" />
                    {missing ? "补拍退租" : "已记录"}
                  </Button>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { label: "入住", record: pair.moveIn },
                    { label: "退租", record: pair.moveOut },
                  ].map((side) => (
                    <div key={side.label} className="rounded-md border border-border/60 bg-background p-2">
                      <p className="mb-1 text-[10px] text-muted-foreground">
                        {side.label}
                        {side.record?.occurredAt ? ` · ${side.record.occurredAt}` : ""}
                      </p>
                      {side.record ? (
                        <>
                          <p className="line-clamp-2 text-[11px] leading-relaxed">
                            {side.record.description}
                          </p>
                          {side.record.attachments?.length ? (
                            <div className="mt-1.5 flex gap-1">
                              {side.record.attachments.slice(0, 3).map((attachment) => (
                                <img
                                  key={attachment.id}
                                  src={attachment.dataUrl}
                                  alt={attachment.name}
                                  className="size-12 rounded border object-cover"
                                />
                              ))}
                              {side.record.attachments.length > 3 && (
                                <span className="flex size-12 items-center justify-center rounded border text-[10px] text-muted-foreground">
                                  +{side.record.attachments.length - 3}
                                </span>
                              )}
                            </div>
                          ) : (
                            <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                              <CircleDashed className="size-2.5" />
                              无图片
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-[10px] text-muted-foreground">未记录</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
