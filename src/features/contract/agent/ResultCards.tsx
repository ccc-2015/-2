import { useState } from "react";
import {
  Check,
  ClipboardCopy,
  Loader2,
  MapPin,
  PencilLine,
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
import { copyText } from "../../../lib/clipboard";
import { newId, saveRecordChecked, type EvidenceRecord } from "../../evidence/store";
import { AnswerBody } from "./AnswerBody";
import type { RevisionDraft, RevisionSuggestion } from "./types";

export function FindingCard({
  finding,
  onLocate,
  onRevise,
  reviseDisabled,
}: {
  finding: Finding;
  onLocate: (excerpt: Excerpt) => void;
  onRevise?: (finding: Finding) => void;
  reviseDisabled?: boolean;
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
      {onRevise && (
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={() => onRevise(finding)}
            disabled={reviseDisabled}
          >
            <PencilLine className="size-3" />
            {finding.excerpt ? "改这一条" : "补充条款"}
          </Button>
        </div>
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
  nextFindingLabel,
  onDraftChange,
  onReReview,
  onNextFinding,
}: {
  draft: RevisionDraft;
  sourceName: string;
  signingDate: string;
  suggestions: RevisionSuggestion[];
  aiAvailable: boolean;
  originalFindingCount: number | null;
  nextFindingLabel?: string | null;
  onDraftChange: (patch: Partial<RevisionDraft>) => void;
  onReReview: () => void;
  onNextFinding?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const applied = new Set(draft.applied);
  const dirty = draft.copy !== draft.baseText;
  const carried = draft.baseText !== draft.originalText;
  const appliedCurrent = suggestions.some((suggestion) => applied.has(suggestion.id));

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
      notice: "已应用这条修改，其他条款保持不变。",
      result: null,
    });
  }

  function discard() {
    onDraftChange({
      copy: draft.baseText,
      applied: [],
      selected: [],
      result: null,
      error: null,
      notice: "已撤销本副本内的改动。",
    });
  }

  async function copyClipboard() {
    const ok = await copyText(draft.copy);
    if (!ok) {
      onDraftChange({ notice: "复制失败，请手动选择副本文本复制。" });
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
        <div className="flex items-center gap-2">
          <PencilLine className="size-4 text-primary" />
          <span className="text-[13px] font-medium">修订副本</span>
          <span className="text-[11px] text-muted-foreground">
            {dirty ? "已修改" : carried ? "含此前修改" : "与原文一致"}
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground">原文只读，修改只发生在副本。</span>
      </div>

      <Alert className="mb-3">
        <ShieldAlert className="size-4" />
        <AlertDescription>修订内容为协商草稿，须自行检查，不代替法律审定或自动签约。</AlertDescription>
      </Alert>

      <div className="mb-3 space-y-2">
        <div>
          <h4 className="text-sm font-semibold">本次修订（{suggestions.length} 条）</h4>
          <p className="mt-0.5 text-[11px] text-muted-foreground">一次只应用一条，其他条款保持原文。</p>
        </div>
        {suggestions.length === 0 ? (
          <p className="text-xs text-muted-foreground">本条暂未返回修订建议，可在对话中重试。</p>
        ) : (
          suggestions.map((suggestion) => (
            <div key={suggestion.id} className="rounded-md border bg-secondary/30 p-2">
              <div className="flex items-start gap-2">
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
                    <Button size="sm" onClick={() => applyOne(suggestion)}>
                      应用这条
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
        {onNextFinding && (
          <Button
            size="sm"
            variant="outline"
            onClick={onNextFinding}
            disabled={draft.loading || (!appliedCurrent && !dirty)}
            title={nextFindingLabel ? `下一条：${nextFindingLabel}` : "处理下一条风险"}
          >
            <PencilLine className="size-4" />
            下一条风险
          </Button>
        )}
        <Button
          size="sm"
          onClick={onReReview}
          disabled={draft.loading || !aiAvailable || !draft.copy.trim()}
        >
          {draft.loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {draft.loading ? "复查中…" : "复查副本"}
        </Button>
      </div>

      {onNextFinding && (!appliedCurrent && !dirty ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          应用本条修改后，可继续处理下一条{nextFindingLabel ? `：${nextFindingLabel}` : "风险"}。
        </p>
      ) : nextFindingLabel ? (
        <p className="mt-1.5 line-clamp-1 text-[11px] leading-relaxed text-muted-foreground">下一条：{nextFindingLabel}</p>
      ) : null)}

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
          {draft.result.answer && <AnswerBody text={draft.result.answer} />}
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
