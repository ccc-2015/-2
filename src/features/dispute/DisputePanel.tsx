import { Scale } from "lucide-react";

export function DisputePanel() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <h1 className="text-2xl font-semibold tracking-tight">争议处理</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        选择争议与证据，补充必要事实，匹配少量处理方向并生成所选话术。
      </p>
      <div className="mt-6 flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <Scale className="size-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">本模块将在后续里程碑实现</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          一般处理方向、所选方向话术生成、用户编辑复制与处理结果状态。
        </p>
      </div>
    </div>
  );
}