import { Camera, Check, CircleDashed, ChevronDown, ImagePlus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { moveInChecklist, type EvidenceRecord } from "./store";

export function MoveInChecklist({
  records,
  onAdd,
  onEdit,
  onEditPhoto,
}: {
  records: EvidenceRecord[];
  onAdd: (itemLabel: string, materialType: string, detail: string) => void;
  onEdit: (id: string) => void;
  onEditPhoto: (id: string) => void;
}) {
  const items = moveInChecklist(records);
  const photo = items.filter((entry) => entry.hasPhoto).length;
  const recorded = items.filter((entry) => entry.done).length;
  const pending = items.length - recorded;
  const [open, setOpen] = useState(true);
  const ratio = photo / items.length;

  return (
    <div className="mt-3 rounded-xl border border-border/70 bg-secondary/25">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left"
      >
        <Camera className="size-3.5 text-muted-foreground" />
        <span className="text-[13px] font-medium">入住必拍清单</span>
        <span className={cn("text-[12px]", photo === items.length ? "text-emerald-600" : "text-muted-foreground")}>
          已附照片 {photo}/{items.length}
        </span>
        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-black/[0.06]">
          <span
            className={cn("block h-full rounded-full transition-all", photo === items.length ? "bg-emerald-500" : "bg-foreground/70")}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </span>
        <span className="ml-auto flex items-center gap-1 text-[12px] text-muted-foreground">
          {items.length - photo > 0 ? `待补照片 ${items.length - photo} 项` : "已拍全"}
          <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
        </span>
      </button>

      {open && (
        <>
          <p className="border-t border-border/60 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
            {recorded === 0
              ? "尚未开始记录。点「去拍」会直接打开拍照/选图；文字记录会显示为“已记录、缺照片”。"
              : `已记录 ${recorded} 项，其中 ${photo} 项附了照片${pending > 0 ? `，${pending} 项尚未记录` : ""}。只写文字不算已拍。`}
          </p>
          <ul className="grid gap-1.5 border-t border-border/60 p-2 sm:grid-cols-2">
            {items.map(({ item, done, hasPhoto, recordId }) => (
              <li
                key={item.id}
                className={cn(
                  "flex items-start gap-2 rounded-lg px-2 py-1.5",
                  hasPhoto ? "bg-background/60" : "bg-background",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
                    hasPhoto
                      ? "bg-emerald-500 text-white"
                      : done
                        ? "bg-amber-100 text-amber-700"
                        : "border border-dashed border-muted-foreground/50",
                  )}
                >
                  {hasPhoto ? <Check className="size-2.5" /> : done ? <ImagePlus className="size-2.5" /> : <CircleDashed className="size-2.5 text-muted-foreground/60" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{item.label}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{item.detail}</p>
                  {done && !hasPhoto && <p className="mt-0.5 text-[12px] font-medium text-amber-700">已记录，缺照片</p>}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-2 text-[12px]"
                  onClick={() => {
                    if (!recordId) onAdd(item.label, item.materialType, item.detail);
                    else if (hasPhoto) onEdit(recordId);
                    else onEditPhoto(recordId);
                  }}
                >
                  {hasPhoto ? "查看" : done ? "补照片" : "去拍"}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}