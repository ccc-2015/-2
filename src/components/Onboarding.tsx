import { useEffect, useState } from "react";
import { CalendarClock, FileSearch, Scale, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ViewId } from "./AppShell";

const SEEN_KEY = "zzyj.onboarding.seen.v1";

const STEPS: { view: ViewId; title: string; detail: string; icon: typeof FileSearch; tone: string }[] = [
  {
    view: "contract",
    title: "合同审查",
    detail: "上传或粘贴合同，自动对照所选城市的审核资料给出风险与依据，可继续追问、起草修订。",
    icon: FileSearch,
    tone: "text-stage-living",
  },
  {
    view: "evidence",
    title: "证据画布",
    detail: "按签约、入住、居住中、退租记录材料；入住清单帮你拍全，退租时自动对照。",
    icon: CalendarClock,
    tone: "text-stage-move-in",
  },
  {
    view: "dispute",
    title: "争议处理",
    detail: "整理事实、匹配处理方向，按已选证据生成可编辑话术；系统不代你提交。",
    icon: Scale,
    tone: "text-stage-dispute",
  },
];

export function Onboarding({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(SEEN_KEY) !== "1") setOpen(true);
    } catch {
      // 存储不可用时默认不打扰。
    }
    const reopen = () => setOpen(true);
    window.addEventListener("zzyj:onboarding", reopen);
    return () => window.removeEventListener("zzyj:onboarding", reopen);
  }, []);

  function close() {
    setOpen(false);
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // 忽略。
    }
  }

  function go(view: ViewId) {
    onNavigate(view);
    close();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="flex size-7 items-center justify-center rounded-lg bg-foreground text-background">
              <ShieldCheck className="size-4" />
            </span>
            租住有据怎么用
          </DialogTitle>
          <DialogDescription className="text-[12px] leading-relaxed">
            三个模块围绕同一份租住材料：先看合同，再攒证据，有争议时直接生成话术。全部在本机处理，不上传合同与对话。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <button
                key={step.view}
                type="button"
                onClick={() => go(step.view)}
                className="flex w-full items-start gap-3 rounded-xl border border-border/70 bg-background p-3 text-left transition-colors hover:border-foreground/20 hover:bg-secondary/40"
              >
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary">
                  <Icon className={`size-3.5 ${step.tone}`} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium">
                    <span className="text-[11px] text-muted-foreground">{index + 1}</span>
                    {step.title}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{step.detail}</span>
                </span>
              </button>
            );
          })}
        </div>

        <p className="rounded-lg bg-secondary/50 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          提示：合同页空状态里有「试用示例合同」，可以直接看完整流程；证据页的「入住必拍清单」建议入住当天就拍。
        </p>

        <DialogFooter>
          <Button size="sm" onClick={close}>
            开始使用
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function openOnboarding() {
  try {
    window.localStorage.removeItem(SEEN_KEY);
  } catch {
    // 忽略。
  }
  window.dispatchEvent(new Event("zzyj:onboarding"));
}
