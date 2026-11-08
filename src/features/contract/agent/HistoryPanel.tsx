import { History, MessageSquare, ShieldCheck, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatSessionTime, type HistoryConsent } from "./history";
import type { SessionSummary } from "./session";

export function HistoryPanel({
  open,
  onOpenChange,
  items,
  consent,
  notice,
  supported,
  currentId,
  onOpen,
  onDelete,
  onClear,
  onConsentChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: SessionSummary[];
  consent: HistoryConsent;
  notice: string;
  supported: boolean;
  currentId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onConsentChange: (value: "on" | "off") => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="flex w-[88%] flex-col gap-0 p-0 sm:max-w-sm">
        <SheetHeader className="border-b px-5 py-4 pr-12">
          <div className="flex items-center gap-2">
            <History className="size-4 text-muted-foreground" />
            <SheetTitle className="text-sm">历史对话</SheetTitle>
          </div>
          <SheetDescription className="text-[11px] leading-relaxed">
            仅保存在当前浏览器，不上传服务器，不是云备份。
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
          <div className="min-w-0">
            <p className="text-[12px] font-medium">保存到本机</p>
            <p className="text-[11px] text-muted-foreground">
              {consent === "on" ? "完成审查后自动保存，最多保留 20 条。" : "关闭后新会话不会写入历史。"}
            </p>
          </div>
          <Switch
            checked={consent === "on"}
            disabled={!supported}
            onCheckedChange={(checked) => onConsentChange(checked ? "on" : "off")}
            aria-label="保存历史到本机"
          />
        </div>

        {notice && <p className="border-b bg-secondary/40 px-5 py-2 text-[11px] text-muted-foreground">{notice}</p>}

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {!supported ? (
            <p className="px-2 py-8 text-center text-[12px] text-muted-foreground">
              当前浏览器不支持本机历史存储，刷新页面后对话不会保留。
            </p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-12 text-center">
              <MessageSquare className="size-7 text-muted-foreground/60" />
              <p className="mt-3 text-[12px] font-medium">还没有历史对话</p>
              <p className="mt-1 max-w-[220px] text-[11px] leading-relaxed text-muted-foreground">
                完成一次合同审查后，会话会自动出现在这里，可随时重新打开。
              </p>
            </div>
          ) : (
            <ul className="space-y-1">
              {items.map((item) => {
                const active = item.id === currentId;
                return (
                  <li key={item.id} className="group flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onOpen(item.id)}
                      className={cn(
                        "min-w-0 flex-1 rounded-xl px-3 py-2 text-left transition-colors",
                        active ? "bg-secondary" : "hover:bg-secondary/60",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{item.title}</span>
                        {active && <Badge variant="outline" className="shrink-0 text-[10px]">当前</Badge>}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {formatSessionTime(item.updatedAt)} · {item.turns} 轮
                        {item.chars > 0 ? ` · ${item.chars} 字符` : ""}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground opacity-70 hover:text-destructive md:opacity-0 md:group-hover:opacity-100"
                      onClick={() => onDelete(item.id)}
                      aria-label={`删除历史「${item.title}」`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-2 border-t px-5 py-3">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            清理浏览器数据会一并删除本机历史。
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full text-destructive hover:text-destructive"
            onClick={onClear}
            disabled={items.length === 0}
          >
            清空全部历史
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
