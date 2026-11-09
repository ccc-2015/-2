import { useEffect, useState } from "react";
import { MessageSquare, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatSessionTime, historySupported } from "./history";
import { historyBus, useHistoryConsent, useHistoryItems } from "./historyBus";
import type { SessionSummary } from "./session";

function groupByDay(items: SessionSummary[]): { label: string; rows: SessionSummary[] }[] {
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const day = 86400000;
  const groups: { label: string; rows: SessionSummary[] }[] = [
    { label: "今天", rows: [] },
    { label: "昨天", rows: [] },
    { label: "更早", rows: [] },
  ];
  for (const item of items) {
    const time = new Date(item.updatedAt).getTime();
    const index = time >= startOfToday ? 0 : time >= startOfToday - day ? 1 : 2;
    groups[index].rows.push(item);
  }
  return groups.filter((group) => group.rows.length > 0);
}

export function HistoryList({
  currentId,
  onNavigate,
}: {
  currentId: string;
  onNavigate?: () => void;
}) {
  const items = useHistoryItems();
  const consent = useHistoryConsent();
  const [supported] = useState(() => historySupported());
  const [pending, setPending] = useState<{ kind: "delete" | "clear"; id?: string; title?: string } | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void historyBus.refresh();
  }, []);

  const groups = groupByDay(items);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-1">
        <span className="text-[11px] font-medium text-muted-foreground">历史对话</span>
        <div className="flex items-center gap-1">
          {items.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-destructive"
              onClick={() => setPending({ kind: "clear" })}
              aria-label="清空全部历史"
            >
              <Trash2 className="size-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px]"
            onClick={() => {
              historyBus.request({ kind: "new" });
              onNavigate?.();
            }}
          >
            <Plus className="size-3" />
            新对话
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {!supported ? (
          <p className="px-2 py-6 text-center text-[11px] leading-relaxed text-muted-foreground">
            当前浏览器不支持本机历史存储。
          </p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center px-3 py-8 text-center">
            <MessageSquare className="size-6 text-muted-foreground/50" />
            <p className="mt-2 text-[11px] text-muted-foreground">还没有历史对话</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground/80">
              完成一次合同审查后会自动出现在这里
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="px-2 pb-1 text-[10px] text-muted-foreground/70">{group.label}</p>
                <ul className="space-y-0.5">
                  {group.rows.map((item) => {
                    const active = item.id === currentId;
                    return (
                      <li key={item.id} className="group flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (!active) historyBus.request({ kind: "open", id: item.id });
                            onNavigate?.();
                          }}
                          className={cn(
                            "min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors",
                            active
                              ? "bg-black/[0.055] font-medium text-foreground"
                              : "text-muted-foreground hover:bg-black/[0.03] hover:text-foreground",
                          )}
                          title={item.title}
                        >
                          <span className="block truncate">{item.title}</span>
                          <span className="mt-0.5 block text-[10px] text-muted-foreground/80">
                            {formatSessionTime(item.updatedAt)} · {item.turns} 轮
                          </span>
                        </button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 shrink-0 text-muted-foreground/70 hover:text-destructive md:opacity-0 md:group-hover:opacity-100"
                          onClick={() => setPending({ kind: "delete", id: item.id, title: item.title })}
                          aria-label={`删除历史「${item.title}」`}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-black/[0.05] px-3 py-2">
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground" title="仅保存在本浏览器">
          <ShieldCheck className="size-3" />
          本机保存
        </span>
        <div className="flex items-center gap-1.5">
          <Switch
            checked={consent === "on"}
            disabled={!supported}
            onCheckedChange={(checked) => {
              historyBus.setConsent(checked ? "on" : "off");
              setNotice(checked ? "" : "已关闭自动保存");
            }}
            aria-label="保存历史到本机"
            size="sm"
          />
          <Badge variant="outline" className="text-[9px] font-normal">
            {consent === "on" ? "开" : "关"}
          </Badge>
        </div>
      </div>
      {notice && <p className="px-3 pb-2 text-[10px] text-muted-foreground">{notice}</p>}

      <AlertDialog open={pending != null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.kind === "clear" ? "清空全部历史？" : "删除这条历史？"}</AlertDialogTitle>
            <AlertDialogDescription>
              只删除本机记录，无法恢复；已存为证据的内容不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (pending?.kind === "clear") await historyBus.clear();
                else if (pending?.id) await historyBus.remove(pending.id);
                setPending(null);
              }}
            >
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
