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
import { LOCAL_SITE } from "../lib/extractLocal";

const STEPS: { view: ViewId; title: string; detail: string; icon: typeof FileSearch; tone: string }[] = [
  {
    view: "contract",
    title: "合同审查",
    detail: "上传或粘贴合同，自动对照所选城市的审核资料指出风险、定位原文并给出依据，可继续追问。",
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
    // 首次进入改为页内简短引导，不再自动弹窗；说明仍可从「更多操作」打开。
    const reopen = () => setOpen(true);
    window.addEventListener("zzyj:onboarding", reopen);
    return () => window.removeEventListener("zzyj:onboarding", reopen);
  }, []);

  function close() {
    setOpen(false);
  }

  function go(view: ViewId) {
    onNavigate(view);
    close();
  }

  function trial(view: "contract" | "dispute") {
    onNavigate(view);
    close();
    window.setTimeout(() => {
      window.dispatchEvent(new Event(view === "contract" ? "zzyj:trial-contract" : "zzyj:trial-dispute"));
    }, 80);
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
          <DialogDescription className="text-[13px] leading-relaxed">
            三个模块围绕同一份租住材料：先看合同，再攒证据，有争议时生成话术。本机保存与 AI 分析分开进行，使用 AI 功能需要发送相关材料。
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
                  <span className="flex items-center gap-1.5 text-[14px] font-medium">
                    <span className="text-[12px] text-muted-foreground">{index + 1}</span>
                    {step.title}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">{step.detail}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="rounded-xl border border-dashed border-foreground/15 bg-secondary/40 px-3 py-2.5">
          <p className="text-[13px] font-medium">隐私：保存与发送是分开的</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            {LOCAL_SITE
              ? "含文字的 PDF、Word（DOCX）与文本文件在浏览器解析；图片会上传至服务端与模型服务识别。"
              : "上传的文件会发送至服务端提取文字。"}
            审查合同、整理争议或生成话术时，相关文本与所选材料会发送至服务端与模型服务。本机保存不代表处理过程不上传。
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" className="h-8 px-2.5 text-[12px]" onClick={() => trial("contract")}>
              <FileSearch className="size-3.5" />
              试用示例合同
            </Button>
            <Button size="sm" variant="outline" className="h-8 px-2.5 text-[12px]" onClick={() => trial("dispute")}>
              <Scale className="size-3.5" />
              试用示例争议
            </Button>
          </div>
        </div>

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
  window.dispatchEvent(new Event("zzyj:onboarding"));
}
