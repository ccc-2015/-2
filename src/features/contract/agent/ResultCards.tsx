import { MapPin } from "lucide-react";
import type { Excerpt, Finding } from "@/shared/api";
import { PRIORITY_LABELS } from "@/shared/api";
import { cn } from "@/lib/utils";

export function FindingCard({
  finding,
  onLocate,
}: {
  finding: Finding;
  onLocate: (excerpt: Excerpt) => void;
}) {
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
        <span className="text-sm font-medium">{finding.issue}</span>
      </div>
      {finding.impact && <p className="text-[13px] leading-relaxed text-muted-foreground">{finding.impact}</p>}
      {finding.excerpt && (
        <div className="mt-2 rounded-lg bg-secondary/70 px-3 py-2">
          <blockquote className="font-mono text-xs leading-relaxed">“{finding.excerpt.text}”</blockquote>
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
      {finding.suggestedQuestion && (
        <p className="mt-2 text-[11px] text-muted-foreground">建议确认：{finding.suggestedQuestion}</p>
      )}
      {finding.uncertainties.length > 0 && (
        <ul className="mt-1 list-inside list-disc text-[11px] text-muted-foreground">
          {finding.uncertainties.map((u, i) => (
            <li key={i}>{u}</li>
          ))}
        </ul>
      )}
    </div>
  );
}