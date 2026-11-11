import { useEffect, useRef, useState, type ReactNode } from "react";
import { ConfigProvider, useConfig } from "./lib/config-context";
import { AppShell, type ViewId } from "./components/AppShell";
import { ContractAgent } from "./features/contract/agent/ContractAgent";
import { EvidenceCanvas } from "./features/evidence/EvidenceCanvas";
import { DisputePanel } from "./features/dispute/DisputePanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

function ConfigGate({ children }: { children: ReactNode }) {
  const { loading, error, config, reload } = useConfig();
  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        正在连接服务…
      </div>
    );
  }
  if (error || !config) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <Alert variant="destructive">
          <AlertTitle>无法连接后端服务</AlertTitle>
          <AlertDescription>
            {error ?? "未获取到配置。"} 请确认 FastAPI 后端已启动（backend 目录，端口 8000）。
          </AlertDescription>
        </Alert>
        <Button className="mt-4" onClick={reload}>重试连接</Button>
      </div>
    );
  }
  return <>{children}</>;
}

function Views() {
  const [view, setView] = useState<ViewId>("contract");
  const [currentSessionId, setCurrentSessionId] = useState("");

  // 切换模块时回到顶部，避免沿用上一个页面的滚动位置。
  const pendingReset = useRef(false);

  function navigate(next: ViewId) {
    if (next === view) return;
    pendingReset.current = true;
    // 让挂在 portal 里的浮层（帮助提示等）随模块切换收起。
    window.dispatchEvent(new Event("zzyj:navigate"));
    setView(next);
  }

  // 视图切换完成后复位滚动，避免沿用上一个页面的位置。
  useEffect(() => {
    if (!pendingReset.current) return;
    pendingReset.current = false;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    const timer = window.setTimeout(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }), 80);
    return () => window.clearTimeout(timer);
  }, [view]);
  // 三个视图常驻挂载，只切换可见性：切模块不丢失合同文本、对话、修订副本与争议表单。
  return (
    <AppShell active={view} onNavigate={navigate} currentSessionId={currentSessionId}>
      <div className={view === "contract" ? "h-full min-h-0" : "hidden"}>
        <ContractAgent onNavigate={navigate} onSessionChange={setCurrentSessionId} />
      </div>
      <div className={view === "evidence" ? undefined : "hidden"}>
        <EvidenceCanvas onNavigate={navigate} />
      </div>
      <div className={view === "dispute" ? undefined : "hidden"}>
        <DisputePanel onNavigate={navigate} />
      </div>
    </AppShell>
  );
}

export default function App() {
  return (
    <ConfigProvider>
      <ConfigGate>
        <Views />
      </ConfigGate>
    </ConfigProvider>
  );
}