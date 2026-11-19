import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import type { Excerpt, Finding } from "@/shared/api";
import { PRIORITY_LABELS } from "@/shared/api";
import { cn } from "@/lib/utils";

/** 逐字展示：约 45 帧内显示完整段文字。 */
function useTypeCount(total: number, enabled: boolean): number {
  const [count, setCount] = useState(enabled ? 0 : total);

  useEffect(() => {
    if (!enabled) {
      setCount(total);
      return;
    }
    setCount(0);
    if (total <= 0) return;
    let current = 0;
    const step = Math.max(1, Math.ceil(total / 45));
    const timer = window.setInterval(() => {
      current = Math.min(total, current + step);
      setCount(current);
      if (current >= total) window.clearInterval(timer);
    }, 16);
    return () => window.clearInterval(timer);
  }, [total, enabled]);

  return count;
}

export function FindingCard({
  finding,
  onLocate,
  typing = false,
}: {
  finding: Finding;
  onLocate: (excerpt: Excerpt) => void;
  typing?: boolean;
}) {
  const excerptText = finding.excerpt?.text ?? "";
  const parts = [finding.issue, finding.impact, excerptText, finding.suggestedQuestion, ...finding.uncertainties];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const shownTotal = useTypeCount(total, typing && total > 0);
  let remaining = shownTotal;
  const shown = parts.map((part) => {
    const length = Math.max(0, Math.min(part.length, remaining));
    remaining -= part.length;
    return part.slice(0, length);
  });
  const [issueShown, impactShown, excerptShown, suggestionShown, ...uncertaintyShown] = shown;
  const tone =
    finding.priority === "confirm_first"
      ? "text-amber-600"
      : finding.priority === "needs_attention"
        ? "text-primary"
        : "text-muted-foreground";

  return (
    <div className="rounded-xl border border-border/70 bg-background p-3">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <span className={cn("text-[11px] font-medium", tone)}>{PRIORITY_LABELS[finding.priority]}</span>
        {issueShown && <span className="text-sm font-medium">{issueShown}</span>}
      </div>
      {finding.impact && impactShown && (
        <p className="text-[13px] leading-relaxed text-muted-foreground">{impactShown}</p>
      )}
      {finding.excerpt && excerptShown && (
        <div className="mt-2 rounded-lg bg-secondary/70 px-3 py-2">
          <blockquote className="font-mono text-xs leading-relaxed">“{excerptShown}”</blockquote>
          <button
            type="button"
            className="mt-1 flex items-center gap-1 text-[11px] text-primary underline-offset-2 hover:underline"
            onClick={() => onLocate(finding.excerpt!)}
          >
            <MapPin className="size-3" />
            定位原文
          </button>
        </div>
      )}
      {finding.suggestedQuestion && suggestionShown && (
        <p className="mt-2 text-[11px] text-muted-foreground">建议确认：{suggestionShown}</p>
      )}
      {finding.uncertainties.some((_, index) => uncertaintyShown[index]) && (
        <ul className="mt-1 list-inside list-disc text-[11px] text-muted-foreground">
          {finding.uncertainties.map((_, index) =>
            uncertaintyShown[index] ? <li key={index}>{uncertaintyShown[index]}</li> : null,
          )}
        </ul>
      )}
    </div>
  );
}