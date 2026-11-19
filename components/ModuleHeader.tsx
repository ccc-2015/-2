import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 三个模块共用页头：图标 + 动作型用途 + 精简操作区。 */
export function ModuleHeader({
  icon: Icon,
  purpose,
  tone,
  actions,
}: {
  icon: LucideIcon;
  purpose: string;
  tone: string;
  actions?: ReactNode;
}) {
  return (
    <header className="border-b border-border/60">
      <div className="mx-auto flex w-full max-w-[1024px] flex-wrap items-center justify-between gap-3 px-4 pb-4 pt-5 md:px-8 md:pt-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-secondary", tone)}>
            <Icon className="size-4" />
          </span>
          <p className="min-w-0 truncate text-[14px] font-medium leading-5 text-foreground/85">{purpose}</p>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-1">{actions}</div>}
      </div>
    </header>
  );
}