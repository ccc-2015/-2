import { useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  Download,
  Loader2,
  PencilLine,
  RefreshCw,
  Save,
  ShieldAlert,
  Undo2,
} from "lucide-react";
import { PRIORITY_LABELS, type Finding } from "@/shared/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { copyText } from "../../../lib/clipboard";
import { AnswerBody } from "./AnswerBody";
import type { RevisionDraft, RevisionSuggestion } from "./types";

function replaceText(
  copy: string,
  index: number,
  target: string,
  replacement: string,
): { next: string; inserted: string } {
  const before = copy.slice(0, index);
  const heading = replacement.match(/^(第[一二三四五六七八九十百千零〇两\d]+条)[ \t]*/);
  const linePrefix = before.slice(before.lastIndexOf("\n") + 1).trim();
  const inserted = heading && linePrefix === heading[1] ? replacement.slice(heading[0].length) : replacement;
  return { next: before + inserted + copy.slice(index + target.length), inserted };
}

export function RevisionPanel({
  draft,
  suggestions,
  sourceFindings,
  aiAvailable,
  onDraftChange,
  onReReview,
  onExport,
  onSaveNegotiation,
  onSaveSigned,
}: {
  draft: RevisionDraft;
  suggestions: RevisionSuggestion[];
  sourceFindings: Finding[];
  aiAvailable: boolean;
  onDraftChange: (patch: Partial<RevisionDraft>) => void;
  onReReview: () => void;
  onExport: () => void;
  onSaveNegotiation: () => void;
  onSaveSigned: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [signedConfirmed, setSignedConfirmed] = useState(false);
  const adoptAllLock = useRef(false);
  const applied = new Set(draft.applied);
  const dirty = draft.copy !== draft.baseText;
  const pendingSuggestions = suggestions.filter((suggestion) => !applied.has(suggestion.id));
  const signedSame = !!draft.signedRecordId && draft.copy === draft.signedText;

  function adopt(suggestion: RevisionSuggestion) {
    if (applied.has(suggestion.id)) return;
    let next: string;
    let inserted: string;
    if (suggestion.targetExcerpt) {
      const target = suggestion.targetExcerpt.text;
      const index = draft.copy.indexOf(target);
      if (index === -1) {
        onDraftChange({
          notice: `目标原文「${target.slice(0, 18)}${target.length > 18 ? "…" : ""}」已不在副本中；可能被手动改过，请直接在副本里调整。`,
        });
        return;
      }
      const result = replaceText(draft.copy, index, target, suggestion.text);
      next = result.next;
      inserted = result.inserted;
    } else {
      inserted = suggestion.text;
      next = `${draft.copy}\n\n${inserted}`;
    }
    onDraftChange({
      copy: next,
      applied: [...draft.applied, suggestion.id],
      appliedTexts: { ...draft.appliedTexts, [suggestion.id]: inserted },
      notice: "已采纳这一条；原合同未被修改。",
      result: null,
    });
  }

  function adoptAll() {
    if (adoptAllLock.current || pendingSuggestions.length === 0) return;
    adoptAllLock.current = true;
    window.setTimeout(() => {
      adoptAllLock.current = false;
    }, 400);
    let next = draft.copy;
    const done: string[] = [];
    const texts = { ...draft.appliedTexts };
    let skipped = 0;
    for (const suggestion of suggestions) {
      if (applied.has(suggestion.id)) continue;
      if (suggestion.targetExcerpt) {
        const target = suggestion.targetExcerpt.text;
        const index = next.indexOf(target);
        if (index === -1) {
          skipped += 1;
          continue;
        }
        const replaced = replaceText(next, index, target, suggestion.text);
        next = replaced.next;
        texts[suggestion.id] = replaced.inserted;
      } else {
        texts[suggestion.id] = suggestion.text;
        next = `${next}\n\n${suggestion.text}`;
      }
      done.push(suggestion.id);
    }
    onDraftChange({
      copy: next,
      applied: [...draft.applied, ...done],
      appliedTexts: texts,
      notice: `已采纳 ${done.length} 条${skipped ? `；${skipped} 条目标原文已变化被跳过` : ""}；原合同未被修改。`,
      result: null,
    });
  }

  function undo(suggestion: RevisionSuggestion) {
    if (!applied.has(suggestion.id)) return;
    const inserted = draft.appliedTexts[suggestion.id] ?? suggestion.text;
    let next: string;
    if (suggestion.targetExcerpt) {
      const index = draft.copy.indexOf(inserted);
      if (index === -1) {
        onDraftChange({
          notice: "建议文本已被手动修改，无法自动撤销；请在副本里手动还原。",
        });
        return;
      }
      next = draft.copy.slice(0, index) + suggestion.targetExcerpt.text + draft.copy.slice(index + inserted.length);
    } else {
      const appended = `\n\n${inserted}`;
      if (!draft.copy.endsWith(appended)) {
        onDraftChange({ notice: "新增条款可能已被手动修改，无法自动撤销；请在副本里手动删除。" });
        return;
      }
      next = draft.copy.slice(0, -appended.length);
    }
    const nextAppliedTexts = { ...draft.appliedTexts };
    delete nextAppliedTexts[suggestion.id];
    onDraftChange({
      copy: next,
      applied: draft.applied.filter((id) => id !== suggestion.id),
      appliedTexts: nextAppliedTexts,
      notice: "已撤销这一条。",
      result: null,
    });
  }

  function discardAll() {
    onDraftChange({
      copy: draft.baseText,
      applied: [],
      appliedTexts: {},
      notice: "已放弃本副本内的改动，恢复为修订起点。",
      result: null,
      error: null,
    });
  }

  async function copyFull() {
    const ok = await copyText(draft.copy);
    if (!ok) {
      onDraftChange({ notice: "复制失败，请手动选择副本文本复制。" });
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  const comparisons = sourceFindings.map((finding) => {
    if (!finding.excerpt) return { finding, status: "manual" as const };
    return {
      finding,
      status: draft.copy.includes(finding.excerpt.text) ? ("present" as const) : ("changed" as const),
    };
  });
  const presentCount = comparisons.filter((item) => item.status === "present").length;
  const changedCount = comparisons.filter((item) => item.status === "changed").length;

  return (
    <div className="panel p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PencilLine className="size-4 text-primary" />
          <span className="text-[13px] font-medium">合同协商副本</span>
          <Badge variant="outline">{draft.versionLabel || "历史快照"}</Badge>
          <span className="text-[11px] text-muted-foreground">原合同未被修改</span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {dirty ? "已改动，仅存在于副本" : "与修订起点一致"}
        </span>
      </div>

      <Alert className="mb-3">
        <ShieldAlert className="size-4" />
        <AlertDescription>
          这是协商稿，不代表双方已经同意，也不是签署版本。文中〔待补：…〕需与对方确认后填写；采纳只表示你选择了这条建议。
        </AlertDescription>
      </Alert>

      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold">修改清单（{suggestions.length} 条）</h4>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              可先采纳全部，再逐条撤销或手动调整；所有改动只进入副本，原文保持不变。已采纳 {draft.applied.length} 条。
            </p>
          </div>
          {pendingSuggestions.length > 0 && (
            <Button size="sm" variant="outline" className="h-7 px-2.5 text-[11px]" onClick={adoptAll}>
              采纳全部（{pendingSuggestions.length} 条）
            </Button>
          )}
        </div>

        {suggestions.length === 0 ? (
          <p className="text-xs text-muted-foreground">本次未返回修改条款，可在对话中重新生成。</p>
        ) : (
          suggestions.map((suggestion) => {
            const isApplied = applied.has(suggestion.id);
            return (
              <div key={suggestion.id} className="rounded-lg border border-border/70 bg-background p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <Badge variant={suggestion.kind === "add" ? "outline" : "secondary"}>
                      {suggestion.kind === "add" ? "新增条款" : `修改 ${suggestion.clauseLabel}`}
                    </Badge>
                    {suggestion.title && <span className="text-[12px] font-medium">{suggestion.title}</span>}
                    {isApplied && (
                      <Badge variant="secondary">
                        <Check className="size-3" /> 已采纳
                      </Badge>
                    )}
                  </div>
                  {isApplied ? (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => undo(suggestion)}>
                      <Undo2 className="size-3.5" />
                      撤销
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7 px-2.5 text-[11px]" onClick={() => adopt(suggestion)}>
                      采纳这一条
                    </Button>
                  )}
                </div>
                {suggestion.reason && (
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">理由：{suggestion.reason}</p>
                )}
                {suggestion.targetExcerpt && (
                  <div className="mt-1.5 rounded-md bg-secondary/60 px-2.5 py-1.5">
                    <p className="text-[10px] text-muted-foreground">原条款</p>
                    <p className="font-mono text-[11px] leading-relaxed">“{suggestion.targetExcerpt.text}”</p>
                  </div>
                )}
                <p className="mt-1 text-[10px] text-muted-foreground">建议条款</p>
                <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{suggestion.text}</p>
                {suggestion.uncertainties.length > 0 && (
                  <p className="mt-1 text-[11px] leading-relaxed text-amber-700">
                    待确认：{suggestion.uncertainties.join("；")}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>

      {draft.notice && <p className="mb-2 text-xs text-primary">{draft.notice}</p>}

      <div className="mb-1 flex items-center justify-between gap-2">
        <Label htmlFor="negotiation-copy" className="text-xs">协商副本全文（可编辑）</Label>
        <span className="text-[11px] text-muted-foreground">{draft.copy.length} 字符</span>
      </div>
      <Textarea
        id="negotiation-copy"
        value={draft.copy}
        onChange={(event) => onDraftChange({ copy: event.target.value, result: null })}
        className="min-h-64 font-mono text-sm"
        aria-label="协商副本全文"
      />

      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" onClick={onReReview} disabled={draft.loading || !aiAvailable || !draft.copy.trim()}>
          {draft.loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {draft.loading ? "复查中…" : "复查副本"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onExport();
            onDraftChange({ notice: "已导出协商稿（未签署）；不代表双方已同意。" });
          }}
          disabled={!draft.copy.trim()}
        >
          <Download className="size-4" />
          导出协商稿
        </Button>
        <Button size="sm" variant="outline" onClick={copyFull}>
          <ClipboardCopy className="size-4" />
          {copied ? "已复制" : "复制全文"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={discardAll}
          disabled={!dirty && draft.applied.length === 0}
        >
          <Undo2 className="size-4" />
          放弃修改
        </Button>
      </div>

      <div className="mt-3 rounded-lg border border-border/70 bg-secondary/20 p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={onSaveNegotiation} disabled={!draft.copy.trim()}>
            <Save className="size-4" />
            {draft.archivedId ? "更新协商副本" : "存为协商副本"}
          </Button>
          <span className="text-[11px] text-muted-foreground">未签署；与签署版本分开保存。</span>
        </div>
        {draft.archiveNotice && (
          <p className={`mt-1 text-[11px] ${draft.archiveNotice.includes("未能") ? "text-destructive" : "text-primary"}`}>
            {draft.archiveNotice}
          </p>
        )}
        <label className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
          <input
            type="checkbox"
            className="mt-0.5 size-3.5 accent-primary"
            checked={signedConfirmed}
            onChange={(event) => setSignedConfirmed(event.target.checked)}
          />
          我确认这份文本是我实际签署的版本；这只代表我方确认，不代表对方已同意。
        </label>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          可带〔待补〕保存，系统会在记录中标注待补项，不会替你填写。
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onSaveSigned}
            disabled={!signedConfirmed || !draft.copy.trim() || signedSame}
          >
            <Save className="size-4" />
            {signedSame
              ? "已存签署版本"
              : draft.signedRecordId
                ? "另存签署版本快照"
                : "存为签署版本"}
          </Button>
          {!signedConfirmed && <span className="text-[11px] text-muted-foreground">勾选上方确认后才能保存</span>}
          {signedConfirmed && signedSame && (
            <span className="text-[11px] text-muted-foreground">当前文本已存为签署版本；继续修改会另存新快照。</span>
          )}
          {signedConfirmed && !signedSame && draft.signedRecordId && (
            <span className="text-[11px] text-muted-foreground">
              当前文本与已签快照不同，保存会新增快照，不覆盖旧签署版本。
            </span>
          )}
        </div>
        {draft.signedNotice && (
          <p className={`mt-1 text-[11px] ${draft.signedNotice.includes("未能") ? "text-destructive" : "text-primary"}`}>
            {draft.signedNotice}
          </p>
        )}
      </div>

      {!aiAvailable && <p className="mt-2 text-xs text-muted-foreground">服务端未配置模型密钥，复查暂不可用。</p>}

      {draft.error && (
        <Alert variant="destructive" className="mt-3">
          <ShieldAlert className="size-4" />
          <AlertTitle>复查未完成</AlertTitle>
          <AlertDescription>
            {draft.error.message}
            {draft.error.retryable && " 可稍后手动重试。"}
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={onReReview}
              disabled={draft.loading || !aiAvailable}
            >
              <RefreshCw className="size-4" />
              重试复查
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {draft.result && (
        <div className="mt-3 space-y-3 rounded-lg border border-border/70 bg-secondary/20 p-3">
          <h4 className="text-sm font-semibold">副本复查</h4>
          {draft.result.answer && <AnswerBody text={draft.result.answer} />}

          <div className="rounded-md border border-border/70 bg-background p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-medium">原问题核对</span>
              <Badge variant="outline">原文已变化 {changedCount} 条</Badge>
              <Badge variant="outline">原文仍保留 {presentCount} 条</Badge>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              这里只说明原文是否发生变化，文本变化不代表问题已解决；仍需逐条核对。
            </p>
            <ul className="mt-2 space-y-1">
              {comparisons.length === 0 ? (
                <li className="text-[11px] text-muted-foreground">没有可对照的原问题。</li>
              ) : (
                comparisons.map(({ finding, status }, index) => (
                  <li key={index} className="flex flex-wrap items-baseline gap-2 text-[11px]">
                    <Badge variant={status === "present" ? "outline" : "secondary"}>
                      {status === "present"
                        ? "原文仍在 · 仍待确认"
                        : status === "changed"
                          ? "原文已变化 · 需人工确认"
                          : "无原文定位 · 需人工确认"}
                    </Badge>
                    <span>{finding.issue}</span>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div>
            <h5 className="text-[12px] font-medium">复查发现</h5>
            {draft.result.findings.length > 0 ? (
              <ul className="mt-1 space-y-1">
                {draft.result.findings.map((finding, index) => (
                  <li key={index} className="text-[11px]">
                    <Badge variant="secondary">{PRIORITY_LABELS[finding.priority] ?? finding.priority}</Badge>{" "}
                    <span className="font-medium">{finding.issue}</span>
                    {finding.impact && <span className="text-muted-foreground"> — {finding.impact}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">副本未发现新的明显风险（仍建议自行核对）。</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}