import { useEffect, useRef, useState, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** 悬停展开、点击切换（触屏用）；鼠标移到气泡上时不会立刻消失。 */
export function HelpTip({
  label,
  children,
  side = "top",
  className,
}: {
  label: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);

  function cancel() {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }
  function closeSoon() {
    cancel();
    timer.current = window.setTimeout(() => setOpen(false), 260);
  }

  useEffect(() => {
    // 切换模块时触发器被隐藏，弹层在 portal 里不会自动收起，这里主动关掉。
    const close = () => {
      cancel();
      setOpen(false);
    };
    window.addEventListener("zzyj:navigate", close);
    return () => {
      cancel();
      window.removeEventListener("zzyj:navigate", close);
    };
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onMouseEnter={() => {
            cancel();
            setOpen(true);
          }}
          onMouseLeave={closeSoon}
          onClick={(event) => {
            // 悬停已打开时点击保持打开；触屏则靠这次点击打开，点别处收起。
            event.preventDefault();
            cancel();
            setOpen(true);
          }}
          className={cn(
            "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <HelpCircle className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align="start"
        sideOffset={6}
        onMouseEnter={cancel}
        onMouseLeave={closeSoon}
        className="w-64 p-2.5 text-[11px] leading-relaxed text-muted-foreground"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
