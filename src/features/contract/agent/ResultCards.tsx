import { useState } from "react";
import {
  Check,
  ClipboardCopy,
  Loader2,
  MapPin,
  RefreshCw,
  Save,
  Scale,
  ShieldAlert,
  Undo2,
} from "lucide-react";
import type { Excerpt, Finding } from "@/shared/api";
import { PRIORITY_LABELS } from "@/shared/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { newId, saveRecordChecked, type EvidenceRecord } from "../../evidence/store";
import type { RevisionDraft, RevisionSuggestion } from "./types";

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

function replaceRevisionText(copy: string, index: number, target: string, replacement: string): string {
  const before = copy.slice(0, index);
  const heading = replacement.match(/^(第[一二三四五六七八九十百千零〇两\d]+条)[ \t]*/);
  const linePrefix = before.slice(before.lastIndexOf("\n") + 1).trim();
  const text = heading && linePrefix === heading[1] ? replacement.slice(heading[0].length) : replacement;
  return before + text + copy.slice(index + target.length);
}

export function RevisionCopyPanel({
  draft,
  sourceName,
  signingDate,
  suggestions,
  aiAvailable,
  originalFindingCount,
  onDraftChange,
  onReReview,
}: {
  draft: RevisionDraft;
  sourceName: string;
  signingDate: string;
  suggestions: RevisionSuggestion[];
  aiAvailable: boolean;
  originalFindingCount: number | null;
  onDraftChange: (patch: Partial<RevisionDraft>) => void;
  onReReview: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const applied = new Set(draft.applied);
  const selected = new Set(draft.selected);
  const dirty = draft.copy !== draft.originalText;
  const pendingCount = suggestions.filter((suggestion) => !applied.has(suggestion.id)).length;

  function toggleSelect(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onDraftChange({ selected: [...next] });
  }

  function applyOne(suggestion: RevisionSuggestion) {
    if (applied.has(suggestion.id)) return;
    let next: string;
    if (suggestion.targetExcerpt) {
      const target = suggestion.targetExcerpt.text;
      const index = draft.copy.indexOf(target);
      if (index === -1) {
        onDraftChange({
          notice: `未找到目标原文「${target.slice(0, 18)}${target.length > 18 ? "…" : ""}」，可能已被修改，请手动编辑副本。`,
        });
        return;
      }
      next = replaceRevisionText(draft.copy, index, target, suggestion.text);
    } else {
      next = `${draft.copy}\n\n${suggestion.text}`;
    }
    onDraftChange({
      copy: next,
      applied: [...draft.applied, suggestion.id],
      selected: draft.selected.filter((id) => id !== suggestion.id),
      notice: "已应用 1 条建议到副本（原文不变）。",
      result: null,
    });
  }

  function applySelected() {
    const items = suggestions.filter((suggestion) => selected.has(suggestion.id) && !applied.has(suggestion.id));
    if (items.length === 0) return;
    let next = draft.copy;
    const done: string[] = [];
    let skipped = 0;
    for (const suggestion of items) {
      if (suggestion.targetExcerpt) {
        const target = suggestion.targetExcerpt.text;
        const index = next.indexOf(target);
        if (index === -1) {
          skipped++;
          continue;
        }
        next = replaceRevisionText(next, index, target, suggestion.text);
      } else {
        next = `${next}\n\n${suggestion.text}`;
      }
      done.push(suggestion.id);
    }
    onDraftChange({
      copy: next,
      applied: [...draft.applied, ...done],
      selected: [],
      notice: `已应用 ${done.length} 条建议到副本${skipped ? `；${skipped} 条未找到目标原文，请手动编辑` : ""}（原文不变）。`,
      result: null,
    });
  }

  function discard() {
    onDraftChange({
      copy: draft.originalText,
      applied: [],
      selected: [],
      result: null,
      error: null,
      notice: "已放弃修改，副本恢复为原文。",
    });
  }

  async function copyClipboard() {
    try {
      await navigator.clipboard.writeText(draft.copy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onDraftChange({ notice: "复制失败，请手动选择副本文本复制。" });
    }
  }

  function saveCopy() {
    if (!draft.copy.trim()) return;
    const existing = draft.archivedId != null;
    const record: EvidenceRecord = {
      id: draft.archivedId ?? newId(),
      stage: "signing",
      occurredAt: signingDate || null,
      recordedAt: new Date().toISOString(),
      description: `合同修订副本（${draft.copy.length} 字符，含原文对比）`,
      contractClause: "",
      materialName: `${sourceName} · 修订副本`,
      materialType: "合同修订副本",
      materialStatus: "present",
      amountCents: null,
      reading: null,
      content: draft.copy,
      originalText: draft.originalText,
    };
    if (!saveRecordChecked(record, existing)) {
      onDraftChange({ archiveNotice: "本地存储空间不足，未能保存。" });
      return;
    }
    onDraftChange({
      archivedId: record.id,
      archiveNotice: existing ? "已更新证据画布中的修订副本。" : "修订副本已存为签约证据，含原文对比。",
    });
  }

  return (
    <div className="panel p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="text-[13px]">修订副本</span>
          <span className="text-[11px] text-muted-foreground">{dirty ? "已修改" : "与原文一致"}</span>
        </div>
        <span className="text-[11px] text-muted-foreground">原文只读保留，所有修改仅发生在副本。</span>
      </div>

      <Alert className="mb-3">
        <ShieldAlert className="size-4" />
        <AlertDescription>修订内容为协商草稿，须自行检查，不代替法律审定或自动签约。</AlertDescription>
      </Alert>

      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">修订建议（{suggestions.length}）</h4>
          {pendingCount > 0 && (
            <Button size="sm" variant="outline" onClick={applySelected} disabled={selected.size === 0}>
              <Check className="size-4" />
              批量应用已选（{selected.size}）
            </Button>
          )}
        </div>
        {suggestions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            暂无修订建议。请用「修改建议」或「起草修订」生成后，在此逐条或批量应用。
          </p>
        ) : (
          suggestions.map((suggestion) => (
            <div key={suggestion.id} className="rounded-md border bg-secondary/30 p-2">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-primary"
                  checked={selected.has(suggestion.id)}
                  disabled={applied.has(suggestion.id)}
                  onChange={() => toggleSelect(suggestion.id)}
                  aria-label="选择此建议"
                />
                <div className="min-w-0 flex-1">
                  {suggestion.targetExcerpt && (
                    <p className="mb-1 font-mono text-[11px] text-muted-foreground">
                      目标原文：「{suggestion.targetExcerpt.text}」
                    </p>
                  )}
                  <p className="whitespace-pre-wrap font-mono text-xs">{suggestion.text}</p>
                </div>
                <div className="shrink-0">
                  {applied.has(suggestion.id) ? (
                    <Badge variant="secondary">
                      <Check className="size-3" /> 已应用
                    </Badge>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => applyOne(suggestion)}>
                      应用
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {draft.notice && <p className="mb-2 text-xs text-primary">{draft.notice}</p>}

      <Label htmlFor="copy-editor" className="text-xs">副本全文（可编辑）</Label>
      <Textarea
        id="copy-editor"
        value={draft.copy}
        onChange={(e) => onDraftChange({ copy: e.target.value, result: null })}
        className="mt-1 min-h-56 font-mono text-sm"
        aria-label="修订副本全文"
      />
      <div className="mt-1 text-xs text-muted-foreground">{draft.copy.length} 字符</div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={copyClipboard}>
          <ClipboardCopy className="size-4" />
          {copied ? "已复制" : "复制副本"}
        </Button>
        <Button size="sm" variant="outline" onClick={saveCopy} disabled={!draft.copy.trim()}>
          <Save className="size-4" />
          {draft.archivedId ? "更新证据存档" : "存为签约证据"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={discard}
          disabled={!dirty && draft.applied.length === 0}
        >
          <Undo2 className="size-4" />
          放弃修改
        </Button>
        <Button
          size="sm"
          onClick={onReReview}
          disabled={draft.loading || !aiAvailable || !draft.copy.trim()}
        >
          {draft.loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {draft.loading ? "复查中…" : "复查副本"}
        </Button>
      </div>

      {draft.archiveNotice && <p className="mt-2 text-xs text-primary">{draft.archiveNotice}</p>}

      {!aiAvailable && <p className="mt-2 text-xs text-muted-foreground">服务端未配置模型密钥，复查暂不可用。</p>}

      {draft.error && (
        <Alert variant="destructive" className="mt-3">
          <ShieldAlert className="size-4" />
          <AlertTitle>复查未完成</AlertTitle>
          <AlertDescription>
            {draft.error.message}
            {draft.error.retryable && " 可稍后手动重试。"}
          </AlertDescription>
        </Alert>
      )}

      {draft.result && (
        <div className="mt-3 space-y-2 rounded-md border bg-secondary/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold">副本复查结果</h4>
            {originalFindingCount != null && (
              <Badge variant="outline">
                原文 {originalFindingCount} 条 → 副本 {draft.result.findings.length} 条
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">AI 辅助意见，仅供协商参考；请对比修改前后发现。</p>
          {draft.result.answer && <p className="whitespace-pre-wrap text-sm">{draft.result.answer}</p>}
          {draft.result.findings.length > 0 ? (
            <ul className="space-y-1">
              {draft.result.findings.map((finding, i) => (
                <li key={i} className="text-xs">
                  <Badge variant="secondary">{PRIORITY_LABELS[finding.priority]}</Badge>{" "}
                  <span className="font-medium">{finding.issue}</span>
                  {finding.excerpt && (
                    <span className="font-mono text-muted-foreground"> —「{finding.excerpt.text}」</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">副本未发现明显风险项（仍建议自行核对）。</p>
          )}
        </div>
      )}
    </div>
  );
}
