import type { ReactNode } from "react";
import { FileSearch, CalendarClock, Scale, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfig } from "../lib/config-context";
import { Badge } from "@/components/ui/badge";

export type ViewId = "contract" | "evidence" | "dispute";

const NAV: { id: ViewId; label: string; hint: string; icon: typeof FileSearch }[] = [
  { id: "contract", label: "合同审查", hint: "导入 · 校对 · 问答 · 修订", icon: FileSearch },
  { id: "evidence", label: "证据画布", hint: "时间线 · 设施 · 水电账目", icon: CalendarClock },
  { id: "dispute", label: "争议处理", hint: "选证据 · 定方向 · 生成话术", icon: Scale },
];

function AiStatus() {
  const { config, loading } = useConfig();
  if (loading) return <Badge variant="secondary">连接中…</Badge>;
  if (!config) return <Badge variant="destructive">服务未连接</Badge>;
  return config.aiAvailable ? (
    <Badge variant="outline" className="border-primary/40 text-primary">模型已就绪</Badge>
  ) : (
    <Badge variant="secondary" title="服务端尚未配置模型密钥，分析类功能暂不可用">模型未配置</Badge>
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
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" />
          </span>
          <div className="leading-tight">
            <div className="text-base font-semibold tracking-tight">租住有据</div>
            <div className="text-xs text-muted-foreground">租房合同与证据助手</div>
          </div>
        </div>
        <nav className="flex flex-col gap-1 px-3 py-2" aria-label="主导航">
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
                  "flex items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-foreground shadow-sm ring-1 ring-border"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                <Icon className={cn("mt-0.5 size-4 shrink-0", isActive && "text-primary")} />
                <span className="leading-tight">
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">{item.hint}</span>
                </span>
              </button>
            );
          })}
        </nav>
        <div className="mt-auto space-y-3 px-5 py-4">
          <AiStatus />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            信息辅助工具，不替代专业法律意见，不承诺处理结果，不代你提交。
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur md:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <ShieldCheck className="size-4" />
              </span>
              <span className="text-sm font-semibold">租住有据</span>
            </div>
            <AiStatus />
          </div>
          <nav className="flex gap-1 px-3 pb-2" aria-label="主导航">
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={active === item.id ? "page" : undefined}
                className={cn(
                  "flex-1 rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
                  active === item.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary",
                )}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}