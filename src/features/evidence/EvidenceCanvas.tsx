import { CalendarClock } from "lucide-react";

export function EvidenceCanvas() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <h1 className="text-2xl font-semibold tracking-tight">证据画布</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        按阶段组织的租住时间线：签约、入住、居住、退租、争议处理。
      </p>
      <div className="mt-6 flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <CalendarClock className="size-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">本模块将在后续里程碑实现</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          时间线记录、设备本地保存与删除、水电对照与争议证据选择。
        </p>
      </div>
    </div>
  );
}