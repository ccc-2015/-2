// 合同审查报告导出：自包含 HTML（可打印为 PDF）+ JSON 原文数据。
import type { ContractResult } from "@/shared/api";
import { PRIORITY_LABELS } from "@/shared/api";
import type { Exchange } from "./types";
import type { RentalProfile } from "../../rental/profile";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface ReviewReportInput {
  result: ContractResult;
  knowledgeVersion: string | null;
  warnings: string[];
  docName: string;
  docText: string;
  signingDate: string;
  profile: RentalProfile;
  exchanges: Exchange[];
}

export function buildReviewReport({
  result,
  knowledgeVersion,
  warnings,
  docName,
  docText,
  signingDate,
  profile,
  exchanges,
}: ReviewReportInput): { html: string; json: string; fileName: string } {
  const now = new Date();
  const followUps = exchanges.filter((exchange) => exchange.result && !exchange.auto);
  const coverageLabel =
    result.coverage === "supported" ? "知识库已覆盖" : result.coverage === "limited" ? "知识库覆盖有限" : "暂无本地知识库";

  const findings = result.findings
    .map(
      (finding, index) => `<article class="finding">
        <div class="finding-head">
          <span class="index">${index + 1}</span>
          <span class="priority p-${finding.priority}">${PRIORITY_LABELS[finding.priority]}</span>
          <h3>${escapeHtml(finding.issue)}</h3>
        </div>
        ${finding.impact ? `<p>${escapeHtml(finding.impact)}</p>` : ""}
        ${
          finding.excerpt
            ? `<blockquote>“${escapeHtml(finding.excerpt.text)}”</blockquote>`
            : ""
        }
        ${finding.suggestedQuestion ? `<p class="ask">建议确认：${escapeHtml(finding.suggestedQuestion)}</p>` : ""}
        ${
          finding.uncertainties.length > 0
            ? `<ul class="uncertain">${finding.uncertainties.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
            : ""
        }
        ${
          finding.sourceRefs.length > 0
            ? `<p class="refs">依据：${finding.sourceRefs.map((id) => escapeHtml(id)).join("、")}</p>`
            : ""
        }
      </article>`,
    )
    .join("");

  const references = result.references
    .map(
      (source) => `<tr>
        <td>${escapeHtml(source.title)}</td>
        <td>${escapeHtml(source.publisher)}</td>
        <td>${escapeHtml(source.version)}</td>
        <td>${escapeHtml(source.effectiveFrom ?? "—")}</td>
        <td>${escapeHtml(source.checkedAt)}</td>
      </tr>`,
    )
    .join("");

  const dialog = followUps
    .map(
      (exchange) => `<div class="qa">
        <p class="q">问：${escapeHtml(exchange.question)}</p>
        <p class="a">答：${escapeHtml(exchange.result?.answer ?? "")}</p>
      </div>`,
    )
    .join("");

  const revision = result.revision
    ? `<h2>修订建议（协商草稿）</h2>
       ${result.revision.targetExcerpt ? `<blockquote>“${escapeHtml(result.revision.targetExcerpt.text)}”</blockquote>` : ""}
       <pre>${escapeHtml(result.revision.text)}</pre>`
    : "";

  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<title>合同审查报告 · ${escapeHtml(docName)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 0; padding: 32px; color: #17181a; line-height: 1.7; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 28px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #e7e8ea; }
  h3 { font-size: 13px; margin: 0; }
  .meta { color: #6b7280; font-size: 12px; }
  .notice { margin-top: 14px; padding: 10px 12px; background: #f7f7f8; border-left: 3px solid #c9cbd0; font-size: 12px; color: #4b5563; }
  .badges { margin: 10px 0 0; font-size: 11px; color: #4b5563; }
  .badges span { display: inline-block; border: 1px solid #e0e2e6; border-radius: 999px; padding: 1px 8px; margin-right: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #e7e8ea; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #fafafa; font-weight: 600; }
  .finding { border: 1px solid #e7e8ea; border-radius: 8px; padding: 10px 12px; margin: 10px 0; break-inside: avoid; }
  .finding-head { display: flex; align-items: baseline; gap: 8px; }
  .index { color: #9ca3af; font-size: 12px; }
  .priority { font-size: 11px; padding: 1px 6px; border-radius: 4px; }
  .p-confirm_first { background: #fef3c7; color: #92400e; }
  .p-needs_attention { background: #e0e7ff; color: #3730a3; }
  .p-insufficient_info { background: #f3f4f6; color: #4b5563; }
  blockquote { margin: 8px 0; padding: 6px 10px; background: #f7f7f8; border-left: 3px solid #d4d4d8; font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
  .ask { font-size: 12px; color: #374151; }
  .uncertain { font-size: 11px; color: #6b7280; margin: 4px 0 0; padding-left: 18px; }
  .refs { font-size: 11px; color: #6b7280; margin: 4px 0 0; }
  pre { white-space: pre-wrap; background: #f7f7f8; padding: 10px; border-radius: 8px; font-size: 12px; }
  .qa { margin: 8px 0; font-size: 12px; }
  .qa .q { color: #4b5563; margin: 0; }
  .qa .a { margin: 2px 0 0; }
  @media print { body { padding: 0; } h2 { break-after: avoid; } }
</style></head>
<body>
  <h1>合同审查报告</h1>
  <p class="meta">${escapeHtml(docName)} · 签约/起租 ${escapeHtml(signingDate || "未填")} · 导出 ${now.toLocaleString("zh-CN")}</p>
  <p class="badges">
    <span>${coverageLabel}</span>
    <span>风险 ${result.findings.length} 条</span>
    <span>引用 ${result.references.length} 条</span>
    ${knowledgeVersion ? `<span>资料包版本 ${escapeHtml(knowledgeVersion)}</span>` : ""}
  </p>
  <p class="notice">AI 辅助意见，不构成法律结论，也不替代律师或主管部门判断。结论请以合同原文与当地规定为准；报告中的原文引用已逐字核对。</p>

  ${profile.addressLabel || profile.monthlyRentCents != null ? `<h2>租住信息</h2>
  <table>
    <tr><th style="width:110px">房屋</th><td>${escapeHtml(profile.addressLabel || "未填")}</td></tr>
    <tr><th>月租 / 押金</th><td>${profile.monthlyRentCents != null ? `¥${(profile.monthlyRentCents / 100).toFixed(2)}` : "未填"} / ${profile.depositCents != null ? `¥${(profile.depositCents / 100).toFixed(2)}` : "未填"}</td></tr>
  </table>` : ""}

  <h2>审查结论</h2>
  <p>${escapeHtml(result.answer)}</p>

  ${result.findings.length > 0 ? `<h2>风险提示（${result.findings.length}）</h2>${findings}` : ""}

  ${revision}

  ${result.references.length > 0 ? `<h2>依据来源（${result.references.length}）</h2>
  <table><thead><tr><th>资料</th><th>发布机关</th><th>版本</th><th>生效</th><th>核验</th></tr></thead><tbody>${references}</tbody></table>` : ""}

  ${dialog ? `<h2>追问记录</h2>${dialog}` : ""}

  ${warnings.length > 0 ? `<h2>说明</h2><ul class="uncertain">${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}

  <h2>合同原文（${docText.length} 字符）</h2>
  <pre>${escapeHtml(docText)}</pre>
</body></html>`;

  const json = JSON.stringify(
    {
      generatedAt: now.toISOString(),
      notice: "AI 辅助意见，不构成法律结论。",
      docName,
      signingDate,
      knowledgeVersion,
      coverage: result.coverage,
      answer: result.answer,
      findings: result.findings,
      references: result.references,
      revision: result.revision,
      followUpQuestions: result.followUpQuestions,
      conversation: followUps.map((exchange) => ({
        question: exchange.question,
        answer: exchange.result?.answer ?? "",
      })),
      warnings,
      profile,
      docText,
    },
    null,
    2,
  );

  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const safeName = (docName || "合同").replace(/[\\/:*?"<>|\s]+/g, "-").replace(/\.[^.]+$/, "").slice(0, 24);

  return { html, json, fileName: `合同审查报告-${safeName}-${stamp}` };
}
