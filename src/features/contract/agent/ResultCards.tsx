import { useState } from "react";
import {
  Check,
  ClipboardCopy,
  Loader2,
  MapPin,
  RefreshCw,
  Save,
  ShieldAlert,
  Undo2,
} from "lucide-react";
import type { ContractResult, Excerpt, Finding } from "@/shared/api";
import { PRIORITY_LABELS } from "@/shared/api";
import { api, ApiError, errorMessage } from "../../../lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { newId, saveRecordChecked, type EvidenceRecord } from "../../evidence/store";
import type { RevisionSuggestion } from "./types";

export function FindingCard({
  finding,
  signingDate,
  onLocate,
}: {
  finding: Finding;
  signingDate: string;
  onLocate: (excerpt: Excerpt) => void;
}) {
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState("");
  const tone =
    finding.priority === "confirm_first"
      ? "text-amber-600"
      : finding.priority === "needs_attention"
        ? "text-primary"
        : "text-muted-foreground";

  function saveFinding() {
    if (saved) return;
    const excerpt = finding.excerpt?.text.trim() ?? "";
    const description = [
      `风险提示（${PRIORITY_LABELS[finding.priority]}）：${finding.issue}`,
      finding.impact,
      excerpt ? `原文：「${excerpt}」` : "",
      finding.suggestedQuestion ? `建议确认：${finding.suggestedQuestion}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const record: EvidenceRecord = {
      id: newId(),
      stage: "signing",
      occurredAt: signingDate || null,
      recordedAt: new Date().toISOString(),
      description,
      contractClause: excerpt,
      materialName: finding.issue.slice(0, 40),
      materialType: "合同审查风险",
      materialStatus: "to_confirm",
      amountCents: null,
      reading: null,
    };
    if (!saveRecordChecked(record)) {
      setNotice("本地存储空间不足，未能保存。");
      return;
    }
    setSaved(true);
    setNotice("已存为签约证据。");
  }

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
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {notice && <p className="mr-auto text-[11px] text-primary">{notice}</p>}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px] text-muted-foreground"
          onClick={saveFinding}
          disabled={saved}
        >
          <Save className="size-3" />
          {saved ? "已存为证据" : "存为证据"}
        </Button>
      </div>
    </div>
  );
}

export function RevisionCopyPanel({
  originalText,
  sourceName,
  signingDate,
  suggestions,
  aiAvailable,
  originalFindingCount,
}: {
  originalText: string;
  sourceName: string;
  signingDate: string;
  suggestions: RevisionSuggestion[];
  aiAvailable: boolean;
  originalFindingCount: number | null;
}) {
  const [copy, setCopy] = useState(originalText);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<ContractResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [copied, setCopied] = useState(false);
  const [archivedId, setArchivedId] = useState<string | null>(null);
  const [archiveNotice, setArchiveNotice] = useState("");

  const dirty = copy !== originalText;
  const pendingCount = suggestions.filter((s) => !applied.has(s.id)).length;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyOne(suggestion: RevisionSuggestion) {
    if (applied.has(suggestion.id)) return;
    let next: string;
    if (suggestion.targetExcerpt) {
      const target = suggestion.targetExcerpt.text;
      const index = copy.indexOf(target);
      if (index === -1) {
        setNotice(`未找到目标原文「${target.slice(0, 18)}${target.length > 18 ? "…" : ""}」，可能已被修改，请手动编辑副本。`);
        return;
      }
      next = copy.slice(0, index) + suggestion.text + copy.slice(index + target.length);
    } else {
      next = `${copy}\n\n【新增条款草稿】\n${suggestion.text}`;
    }
    setCopy(next);
    setApplied((prev) => new Set(prev).add(suggestion.id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(suggestion.id);
      return next;
    });
    setNotice("已应用 1 条建议到副本（原文不变）。");
    setResult(null);
  }

  function applySelected() {
    const items = suggestions.filter((s) => selected.has(s.id) && !applied.has(s.id));
    if (items.length === 0) return;
    let next = copy;
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
        next = next.slice(0, index) + suggestion.text + next.slice(index + target.length);
      } else {
        next = `${next}\n\n【新增条款草稿】\n${suggestion.text}`;
      }
      done.push(suggestion.id);
    }
    setCopy(next);
    setApplied((prev) => {
      const nextApplied = new Set(prev);
      done.forEach((id) => nextApplied.add(id));
      return nextApplied;
    });
    setSelected(new Set());
    setNotice(`已应用 ${done.length} 条建议到副本${skipped ? `；${skipped} 条未找到目标原文，请手动编辑` : ""}（原文不变）。`);
    setResult(null);
  }

  function discard() {
    setCopy(originalText);
    setApplied(new Set());
    setSelected(new Set());
    setResult(null);
    setError(null);
    setNotice("已放弃修改，副本恢复为原文。");
  }

  async function copyClipboard() {
    try {
      await navigator.clipboard.writeText(copy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice("复制失败，请手动选择副本文本复制。");
    }
  }

  function saveCopy() {
    if (!copy.trim()) return;
    const existing = archivedId != null;
    const record: EvidenceRecord = {
      id: archivedId ?? newId(),
      stage: "signing",
      occurredAt: signingDate || null,
      recordedAt: new Date().toISOString(),
      description: `合同修订副本（${copy.length} 字符，含原文对比）`,
      contractClause: "",
      materialName: `${sourceName} · 修订副本`,
      materialType: "合同修订副本",
      materialStatus: "present",
      amountCents: null,
      reading: null,
      content: copy,
      originalText,
    };
    if (!saveRecordChecked(record, existing)) {
      setArchiveNotice("本地存储空间不足，未能保存。");
      return;
    }
    setArchivedId(record.id);
    setArchiveNotice(existing ? "已更新证据画布中的修订副本。" : "修订副本已存为签约证据，含原文对比。");
  }

  async function reReview() {
    if (loading || !aiAvailable || !copy.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.analyzeContract({
        text: copy,
        textScope: "full",
        question: "请复查这份修订副本，指出仍存在的风险。",
        conversation: [],
        intent: "review",
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError("internal_error", errorMessage(err), false));
    } finally {
      setLoading(false);
    }
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
                    <p className="mb-1 font-mono text-[11px] text-muted-foreground">目标原文：「{suggestion.targetExcerpt.text}」</p>
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

      {notice && <p className="mb-2 text-xs text-primary">{notice}</p>}

      <Label htmlFor="copy-editor" className="text-xs">副本全文（可编辑）</Label>
      <Textarea
        id="copy-editor"
        value={copy}
        onChange={(e) => {
          setCopy(e.target.value);
          setResult(null);
        }}
        className="mt-1 min-h-56 font-mono text-sm"
        aria-label="修订副本全文"
      />
      <div className="mt-1 text-xs text-muted-foreground">{copy.length} 字符</div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={copyClipboard}>
          <ClipboardCopy className="size-4" />
          {copied ? "已复制" : "复制副本"}
        </Button>
        <Button size="sm" variant="outline" onClick={saveCopy} disabled={!copy.trim()}>
          <Save className="size-4" />
          {archivedId ? "更新证据存档" : "存为签约证据"}
        </Button>
        <Button size="sm" variant="outline" onClick={discard} disabled={!dirty && applied.size === 0}>
          <Undo2 className="size-4" />
          放弃修改
        </Button>
        <Button size="sm" onClick={reReview} disabled={loading || !aiAvailable || !copy.trim()}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {loading ? "复查中…" : "复查副本"}
        </Button>
      </div>

      {archiveNotice && <p className="mt-2 text-xs text-primary">{archiveNotice}</p>}

      {!aiAvailable && <p className="mt-2 text-xs text-muted-foreground">服务端未配置模型密钥，复查暂不可用。</p>}

      {error && (
        <Alert variant="destructive" className="mt-3">
          <ShieldAlert className="size-4" />
          <AlertTitle>复查未完成</AlertTitle>
          <AlertDescription>
            {error.message}
            {error.retryable && " 可稍后手动重试。"}
          </AlertDescription>
        </Alert>
      )}

      {result && (
        <div className="mt-3 space-y-2 rounded-md border bg-secondary/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold">副本复查结果</h4>
            {originalFindingCount != null && (
              <Badge variant="outline">原文 {originalFindingCount} 条 → 副本 {result.findings.length} 条</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">AI 辅助意见，仅供协商参考；请对比修改前后发现。</p>
          {result.answer && <p className="whitespace-pre-wrap text-sm">{result.answer}</p>}
          {result.findings.length > 0 ? (
            <ul className="space-y-1">
              {result.findings.map((finding, i) => (
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
