import { useState, type ReactNode } from "react";
import { FileSearch, CalendarClock, Scale, ShieldCheck, X, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfig } from "../lib/config-context";
import { HistoryList } from "../features/contract/agent/HistoryList";

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

function Brand({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-[10px] bg-foreground text-background">
          <ShieldCheck className="size-4" />
        </span>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">租住有据</div>
          <div className="text-[11px] text-muted-foreground">合同与证据助手</div>
        </div>
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 text-muted-foreground hover:bg-black/[0.04]"
          aria-label="关闭导航"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

function NavList({
  active,
  onNavigate,
}: {
  active: ViewId;
  onNavigate: (view: ViewId) => void;
}) {
  return (
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
  );
}

export function AppShell({
  active,
  onNavigate,
  currentSessionId,
  children,
}: {
  active: ViewId;
  onNavigate: (view: ViewId) => void;
  currentSessionId: string;
  children: ReactNode;
}) {
  const [mobileHistory, setMobileHistory] = useState(false);

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <aside className="glass sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col border-r border-black/[0.06] md:flex">
        <div className="px-5 pb-4 pt-6">
          <Brand />
        </div>

        <NavList active={active} onNavigate={onNavigate} />

        <div className="mt-4 flex min-h-0 flex-1 flex-col border-t border-black/[0.06] pt-3">
          <HistoryList currentId={currentSessionId} onNavigate={() => onNavigate("contract")} />
        </div>

        <div className="space-y-2 border-t border-black/[0.05] px-5 py-4">
          <ModelStatus />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            信息辅助工具，不替代专业法律意见，不承诺处理结果，不代你提交。
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-20 border-b border-black/[0.06] md:hidden">
          <div className="flex items-start justify-between gap-2 px-5 py-3">
            <Brand />
            <div className="flex items-center gap-2">
              <ModelStatus />
              <button
                type="button"
                onClick={() => setMobileHistory((open) => !open)}
                className="flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground"
                aria-expanded={mobileHistory}
              >
                <History className="size-3" />
                历史
              </button>
            </div>
          </div>
          <div className="pb-2">
            <NavList active={active} onNavigate={onNavigate} />
          </div>
          {mobileHistory && (
            <div className="flex max-h-64 flex-col overflow-hidden border-t border-black/[0.05]">
              <HistoryList
                currentId={currentSessionId}
                onNavigate={() => {
                  setMobileHistory(false);
                  onNavigate("contract");
                }}
              />
            </div>
          )}
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
