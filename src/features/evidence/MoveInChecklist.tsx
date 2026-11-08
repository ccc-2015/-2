import { Camera, Check, CircleDashed, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { moveInChecklist, type EvidenceRecord } from "./store";

export function MoveInChecklist({
  records,
  onAdd,
  onEdit,
}: {
  records: EvidenceRecord[];
  onAdd: (itemLabel: string, materialType: string, detail: string) => void;
  onEdit: (id: string) => void;
}) {
  const items = moveInChecklist(records);
  const done = items.filter((entry) => entry.done).length;
  const [open, setOpen] = useState(true);
  const ratio = done / items.length;

  return (
    <div className="mt-3 rounded-xl border border-border/70 bg-secondary/25">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left"
      >
        <Camera className="size-3.5 text-muted-foreground" />
        <span className="text-[12px] font-medium">入住必拍清单</span>
        <span className={cn("text-[11px]", done === items.length ? "text-emerald-600" : "text-muted-foreground")}>
          已拍 {done}/{items.length}
        </span>
        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-black/[0.06]">
          <span
            className={cn("block h-full rounded-full transition-all", done === items.length ? "bg-emerald-500" : "bg-foreground/70")}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </span>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          {done === items.length ? "已完成" : "还没拍全，退租时容易吃亏"}
          <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
        </span>
      </button>

      {open && (
        <ul className="grid gap-1.5 border-t border-border/60 p-2 sm:grid-cols-2">
          {items.map(({ item, done: itemDone, recordId }) => (
            <li
              key={item.id}
              className={cn(
                "flex items-start gap-2 rounded-lg px-2 py-1.5",
                itemDone ? "bg-background/60" : "bg-background",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
                  itemDone ? "bg-emerald-500 text-white" : "border border-dashed border-muted-foreground/50",
                )}
              >
                {itemDone ? <Check className="size-2.5" /> : <CircleDashed className="size-2.5 text-muted-foreground/60" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium">{item.label}</p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{item.detail}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 shrink-0 px-1.5 text-[10px]"
                onClick={() => (recordId ? onEdit(recordId) : onAdd(item.label, item.materialType, item.detail))}
              >
                {itemDone ? "查看" : "去拍"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
