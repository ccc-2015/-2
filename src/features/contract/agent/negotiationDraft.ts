import type { RevisionDraft, RevisionSuggestion } from "./types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 40) || "合同";
}

export function buildNegotiationDraft({
  draft,
  suggestions,
  sourceName,
  signingDate,
}: {
  draft: RevisionDraft;
  suggestions: RevisionSuggestion[];
  sourceName: string;
  signingDate: string;
}): { html: string; fileName: string } {
  const adopted = new Set(draft.applied);
  const items = suggestions
    .map((item, index) => {
      const isAdopted = adopted.has(item.id);
      const label = item.kind === "add" ? "新增条款" : `修改 ${escapeHtml(item.clauseLabel)}`;
      return `<article class="item">
        <h3><span class="idx">${index + 1}</span>${label}${item.title ? ` · ${escapeHtml(item.title)}` : ""}
          <span class="state ${isAdopted ? "on" : "off"}">${isAdopted ? "已采纳" : "未采纳"}</span>
        </h3>
        ${item.targetExcerpt ? `<p class="label">原条款</p><blockquote>“${escapeHtml(item.targetExcerpt.text)}”</blockquote>` : ""}
        <p class="label">建议条款</p><pre>${escapeHtml(item.text)}</pre>
        ${item.reason ? `<p class="reason">修改理由：${escapeHtml(item.reason)}</p>` : ""}
        ${
          item.uncertainties.length > 0
            ? `<p class="pending">待确认：${item.uncertainties.map((u) => escapeHtml(u)).join("；")}</p>`
            : ""
        }
      </article>`;
    })
    .join("");

  const now = new Date();
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<title>合同协商稿（未签署） · ${escapeHtml(sourceName)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #1d1d1f; margin: 28px auto; max-width: 760px; padding: 0 24px; line-height: 1.65; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { color: #6e6e73; font-size: 12px; }
  .notice { border: 1px solid #ff950066; background: #fff8ee; padding: 10px 12px; border-radius: 8px; font-size: 12px; margin: 14px 0 18px; }
  h2 { font-size: 15px; margin: 22px 0 8px; }
  .item { border: 1px solid #e8e8ed; border-radius: 8px; padding: 10px 12px; margin: 10px 0; break-inside: avoid; }
  .item h3 { font-size: 13px; margin: 0 0 6px; }
  .idx { color: #9ca3af; margin-right: 6px; }
  .state { float: right; font-size: 11px; border-radius: 999px; padding: 1px 8px; }
  .state.on { background: #e8f8ee; color: #1a7f37; }
  .state.off { background: #f3f4f6; color: #4b5563; }
  .label { color: #6e6e73; font-size: 11px; margin: 8px 0 2px; }
  blockquote { margin: 0 0 4px; padding: 6px 10px; background: #f5f5f7; border-left: 3px solid #d4d4d8; font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
  pre { white-space: pre-wrap; font-family: ui-monospace, Consolas, monospace; font-size: 12px; margin: 0; }
  .reason, .pending { font-size: 11px; color: #6b7280; margin: 6px 0 0; }
  .copy { border: 1px solid #e8e8ed; border-radius: 8px; padding: 12px; white-space: pre-wrap; font-size: 12px; }
  @media print { body { padding: 0; margin: 12px; } .item { break-inside: avoid; } }
</style></head>
<body>
  <h1>合同协商稿（未签署）</h1>
  <p class="meta">${escapeHtml(sourceName)} · 基于 ${escapeHtml(draft.versionLabel || "合同版本")} · 导出 ${now.toLocaleString("zh-CN")} · 签约/起租 ${escapeHtml(signingDate || "未填")}</p>
  <p class="notice">这是我方协商稿，<strong>不代表双方已经同意</strong>，也不是签署版本。文中〔待补：…〕需与对方确认后填写；请勿把“已采纳”当作对方已接受。</p>

  <h2>修改清单（${suggestions.length} 条，已采纳 ${draft.applied.length} 条）</h2>
  ${items || "<p class=\"meta\">本次没有生成修改建议。</p>"}

  <h2>协商副本全文</h2>
  <div class="copy">${escapeHtml(draft.copy)}</div>
</body></html>`;

  const stamp = now.toISOString().slice(0, 10);
  return { html, fileName: `合同协商稿-${safeName(sourceName)}-${stamp}.html` };
}