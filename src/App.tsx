import { useState, type ReactNode } from "react";
import { ConfigProvider, useConfig } from "./lib/config-context";
import { AppShell, type ViewId } from "./components/AppShell";
import { ContractWorkspace } from "./features/contract/ContractWorkspace";
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
  return (
    <AppShell active={view} onNavigate={setView}>
      {view === "contract" ? <ContractWorkspace /> : view === "evidence" ? <EvidenceCanvas onNavigate={setView} /> : <DisputePanel onNavigate={setView} />}
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