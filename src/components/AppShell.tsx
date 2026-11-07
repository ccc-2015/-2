import type { ReactNode } from "react";
import { FileSearch, CalendarClock, Scale, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfig } from "../lib/config-context";

export type ViewId = "contract" | "evidence" | "dispute";

const NAV: { id: ViewId; label: string; icon: typeof FileSearch }[] = [
  { id: "contract", label: "合同", icon: FileSearch },
  { id: "evidence", label: "证据", icon: CalendarClock },
  { id: "dispute", label: "争议", icon: Scale },
];

function ModelStatus() {
  const { config, loading } = useConfig();
  if (loading) {
    return <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="size-1.5 rounded-full bg-muted-foreground/40" />连接中</span>;
  }
  if (!config) {
    return <span className="flex items-center gap-1.5 text-[11px] text-destructive"><span className="size-1.5 rounded-full bg-destructive" />服务未连接</span>;
  }
  return config.aiAvailable ? (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="size-1.5 rounded-full bg-emerald-500" />模型可用</span>
  ) : (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title="服务端尚未配置模型密钥，分析类功能暂不可用"><span className="size-1.5 rounded-full bg-amber-500" />未配置模型</span>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-[10px] bg-foreground text-background">
        <ShieldCheck className="size-4" />
      </span>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight">租住有据</div>
        <div className="text-[11px] text-muted-foreground">合同与证据助手</div>
      </div>
    </div>
  );
}

export function AppShell({
  active,
  onNavigate,
  children,
}: {
  active: ViewId;
  onNavigate: (view: ViewId) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-20 border-b border-black/[0.06] md:hidden">
          <div className="flex items-center justify-between px-5 py-3">
            <Brand />
            <ModelStatus />
          </div>
          <nav className="flex gap-1 px-3 pb-2" aria-label="主导航">
            {NAV.map((item) => {
              const Icon = item.icon;
              const isActive = active === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
                    isActive ? "bg-foreground text-background" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <aside className="glass sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-l border-black/[0.06] md:flex">
        <div className="px-5 pb-5 pt-6">
          <Brand />
        </div>

        <nav className="flex flex-col gap-0.5 px-3" aria-label="主导航">
          {NAV.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] transition-colors",
                  isActive
                    ? "bg-white/80 font-medium text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.06)] ring-1 ring-black/[0.04]"
                    : "text-muted-foreground hover:bg-black/[0.03] hover:text-foreground",
                )}
              >
                <Icon className={cn("size-4", isActive ? "text-foreground" : "text-muted-foreground")} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto space-y-3 px-5 py-5">
          <ModelStatus />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            信息辅助工具，不替代专业法律意见，不承诺处理结果，不代你提交。
          </p>
        </div>
      </aside>
    </div>
  );
}
