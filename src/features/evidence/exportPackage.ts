// 证据包导出：单文件 HTML（图片内嵌，可打印成 PDF）+ 机器可读 JSON。
import {
  formatCents,
  moveInChecklist,
  overviewStats,
  sortRecords,
  type EvidenceRecord,
  type UtilityAccount,
} from "./store";
import type { RentalProfile } from "../rental/profile";

const STAGE_LABELS: Record<string, string> = {
  signing: "签约",
  move_in: "入住",
  living: "居住中",
  move_out: "退租",
  dispute: "争议处理",
};

const STATUS_LABELS: Record<string, string> = {
  present: "已有",
  missing: "缺失",
  to_confirm: "待确认",
};

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function todayLocal(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

interface ExportedRecord {
  id: string;
  stage: string;
  occurredAt: string | null;
  recordedAt: string;
  description: string;
  materialName: string;
  materialType: string;
  materialStatus: string;
  amountCents: number | null;
  reading: string | null;
  contractClause: string;
  content: string;
  attachments: { name: string; bytes: number; sha256: string }[];
}

export interface EvidencePackageInput {
  profile: RentalProfile;
  records: EvidenceRecord[];
  utilities: UtilityAccount[];
}

export async function buildEvidencePackage({ profile, records, utilities }: EvidencePackageInput): Promise<{
  html: string;
  json: string;
  fileName: string;
}> {
  const exportedRecords: ExportedRecord[] = [];
  for (const record of records) {
    const attachments = [];
    for (const attachment of record.attachments ?? []) {
      attachments.push({
        name: attachment.name,
        bytes: attachment.bytes,
        sha256: await sha256(attachment.dataUrl),
      });
    }
    exportedRecords.push({
      id: record.id,
      stage: record.stage,
      occurredAt: record.occurredAt,
      recordedAt: record.recordedAt,
      description: record.description,
      materialName: record.materialName,
      materialType: record.materialType,
      materialStatus: record.materialStatus,
      amountCents: record.amountCents,
      reading: record.reading,
      contractClause: record.contractClause,
      content: record.content ?? "",
      attachments,
    });
  }

  const exportedAt = new Date();
  const stats = overviewStats(records, utilities);
  const checklist = moveInChecklist(records);
  const checklistDone = checklist.filter((item) => item.done).length;
  const sorted = sortRecords(records);
  const stages = Object.keys(STAGE_LABELS);

  const attachmentIndex = new Map<string, EvidenceRecord["attachments"]>();
  for (const record of records) attachmentIndex.set(record.id, record.attachments ?? []);

  const measure = stats.span ? `${stats.span.from} 至 ${stats.span.to}` : "未记录";

  const rows = sorted
    .map((record, index) => {
      const files = (record.attachments ?? [])
        .map((attachment) => `${escapeHtml(attachment.name)}（${Math.round(attachment.bytes / 1024)} KB）`)
        .join("<br />");
      return `<tr>
        <td>${index + 1}</td>
        <td>${STAGE_LABELS[record.stage] ?? record.stage}</td>
        <td>${escapeHtml(record.occurredAt ?? "待补")}</td>
        <td>${escapeHtml(record.description)}</td>
        <td>${escapeHtml(record.materialName || "—")}</td>
        <td>${escapeHtml(record.materialType || "—")}</td>
        <td>${STATUS_LABELS[record.materialStatus] ?? record.materialStatus}</td>
        <td>${record.amountCents != null ? formatCents(record.amountCents) : "—"}</td>
        <td>${escapeHtml(record.reading ?? "—")}</td>
        <td>${files || "—"}</td>
      </tr>`;
    })
    .join("");

  const timeline = stages
    .map((stage) => {
      const items = sorted.filter((record) => record.stage === stage);
      if (items.length === 0) return "";
      return `<section class="stage">
        <h3>${STAGE_LABELS[stage]}（${items.length}）</h3>
        <ul>
          ${items
            .map(
              (record) =>
                `<li><span class="date">${escapeHtml(record.occurredAt ?? "待补")}</span>${escapeHtml(record.description)}${
                  record.materialStatus !== "present" ? ` <em>［${STATUS_LABELS[record.materialStatus]}］</em>` : ""
                }</li>`,
            )
            .join("")}
        </ul>
      </section>`;
    })
    .join("");

  const checklistHtml = checklist
    .map(
      (item) =>
        `<li class="${item.done ? "ok" : "gap"}">${item.done ? "✓" : "○"} ${escapeHtml(item.item.label)}<span>${escapeHtml(
          item.item.detail,
        )}</span></li>`,
    )
    .join("");

  const pairs = checklist
    .map((item) => {
      const moveIn = records.find((record) => record.stage === "move_in" && record.materialType === item.item.materialType);
      const moveOut = records.find((record) => record.stage === "move_out" && record.materialType === item.item.materialType);
      if (!moveIn && !moveOut) return "";
      return `<tr>
        <td>${escapeHtml(item.item.label)}</td>
        <td>${moveIn ? escapeHtml(moveIn.description) : "未记录"}</td>
        <td>${moveOut ? escapeHtml(moveOut.description) : '<strong class="warn">未记录</strong>'}</td>
        <td>${moveOut ? "已对照" : "缺退租记录"}</td>
      </tr>`;
    })
    .join("");

  const utilityRows = utilities
    .map(
      (account) =>
        `<tr>
          <td>${escapeHtml(account.kind)}</td>
          <td>${escapeHtml(account.periodStart ?? "—")}</td>
          <td>${escapeHtml(account.startReading ?? "—")} → ${escapeHtml(account.endReading ?? "—")}</td>
          <td>${formatCents(account.billCents)}</td>
          <td>${formatCents(account.paidCents)}</td>
          <td>${formatCents(
            account.billCents != null && account.paidCents != null ? account.billCents - account.paidCents : null,
          )}</td>
        </tr>`,
    )
    .join("");

  const hashRows = exportedRecords
    .filter((record) => record.attachments.length > 0)
    .map(
      (record) =>
        `<tr><td>${escapeHtml(record.description.slice(0, 40))}</td><td>${record.attachments
          .map((attachment) => `${escapeHtml(attachment.name)}<br /><code>${attachment.sha256}</code>`)
          .join("<br />")}</td></tr>`,
    )
    .join("");

  const images = records
    .flatMap((record) => (record.attachments ?? []).map((attachment) => ({ record, attachment })))
    .map(
      ({ record, attachment }) =>
        `<figure><img src="${attachment.dataUrl}" alt="${escapeHtml(attachment.name)}" /><figcaption>${escapeHtml(
          record.description.slice(0, 40),
        )}<br />${escapeHtml(attachment.name)}</figcaption></figure>`,
    )
    .join("");

  const title = profile.addressLabel ? `租住证据包 · ${profile.addressLabel}` : "租住证据包";

  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 0; padding: 32px; color: #17181a; background: #fff; line-height: 1.65; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  h2 { font-size: 15px; margin: 28px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #e7e8ea; }
  h3 { font-size: 13px; margin: 14px 0 6px; }
  .meta { color: #6b7280; font-size: 12px; }
  .notice { margin: 14px 0 0; padding: 10px 12px; background: #f7f7f8; border-left: 3px solid #c9cbd0; font-size: 12px; color: #4b5563; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
  th, td { border: 1px solid #e7e8ea; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #fafafa; font-weight: 600; }
  ul { padding-left: 18px; margin: 6px 0; }
  li { font-size: 13px; margin: 3px 0; }
  li span { display: block; color: #6b7280; font-size: 11px; }
  li.ok { color: #146c43; }
  li.gap { color: #b45309; }
  .date { display: inline-block; min-width: 84px; color: #6b7280; font-size: 12px; }
  em { color: #b45309; font-style: normal; font-size: 11px; }
  .warn { color: #b45309; }
  figure { display: inline-block; margin: 6px; width: 180px; vertical-align: top; }
  figure img { width: 100%; border-radius: 6px; border: 1px solid #e7e8ea; }
  figcaption { font-size: 10px; color: #6b7280; margin-top: 4px; word-break: break-all; }
  code { font-size: 10px; color: #4b5563; word-break: break-all; }
  @media print { body { padding: 0; } figure { width: 30%; } h2 { break-after: avoid; } tr { break-inside: avoid; } }
</style></head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">导出时间：${exportedAt.toLocaleString("zh-CN")} · 材料 ${records.length} 条 · 费用 ${utilities.length} 条 · 覆盖 ${measure}</p>
  <p class="notice">本文件由用户在本机整理生成，用于材料留存与沟通参考；不是法律文书，不构成法律意见。原件（合同签字版、原始照片、转账凭证）请自行保存；本包内图片为压缩副本。</p>

  <h2>租住信息</h2>
  <table>
    <tr><th style="width:120px">地址标签</th><td>${escapeHtml(profile.addressLabel || "未填写")}</td></tr>
    <tr><th>起租日</th><td>${escapeHtml(profile.startDate || "未填写")}</td></tr>
    <tr><th>月租</th><td>${formatCents(profile.monthlyRentCents)}</td></tr>
    <tr><th>押金</th><td>${formatCents(profile.depositCents)}</td></tr>
  </table>

  <h2>材料清单（${records.length}）</h2>
  ${
    records.length === 0
      ? "<p class=\"meta\">暂无材料记录。</p>"
      : `<table><thead><tr><th>#</th><th>阶段</th><th>日期</th><th>描述</th><th>材料</th><th>类型</th><th>状态</th><th>金额</th><th>读数</th><th>附件</th></tr></thead><tbody>${rows}</tbody></table>`
  }

  <h2>时间线</h2>
  ${timeline || "<p class=\"meta\">暂无记录。</p>"}

  <h2>入住清单（${checklistDone}/${checklist.length}）</h2>
  <ul>${checklistHtml}</ul>

  ${pairs ? `<h2>入住 / 退租对照</h2><table><thead><tr><th>项目</th><th>入住</th><th>退租</th><th>状态</th></tr></thead><tbody>${pairs}</tbody></table>` : ""}

  ${utilities.length > 0 ? `<h2>水电与费用（${utilities.length}）</h2><table><thead><tr><th>类型</th><th>周期</th><th>起止读数</th><th>账单</th><th>已付</th><th>差额</th></tr></thead><tbody>${utilityRows}</tbody></table>` : ""}

  ${hashRows ? `<h2>附件校验（SHA-256）</h2><table><thead><tr><th>记录</th><th>文件与摘要</th></tr></thead><tbody>${hashRows}</tbody></table><p class="meta">校验方法：对导出包内同名图片文件计算 SHA-256，与上表一致即说明文件未被修改。</p>` : ""}

  ${images ? `<h2>附件原图</h2>${images}` : ""}
</body></html>`;

  const json = JSON.stringify(
    {
      generatedAt: exportedAt.toISOString(),
      notice: "本机整理件，非法律文书；原图已压缩，原件请自行保存。",
      profile,
      stats,
      checklist: checklist.map((item) => ({ label: item.item.label, done: item.done })),
      records: exportedRecords,
      utilities,
    },
    null,
    2,
  );

  const stamp = `${exportedAt.getFullYear()}${String(exportedAt.getMonth() + 1).padStart(2, "0")}${String(
    exportedAt.getDate(),
  ).padStart(2, "0")}-${String(exportedAt.getHours()).padStart(2, "0")}${String(exportedAt.getMinutes()).padStart(
    2,
    "0",
  )}`;
  const safeAddress = (profile.addressLabel || "租住").replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 24);

  return { html, json, fileName: `证据包-${safeAddress}-${stamp}` };
}

export function downloadText(content: string, fileName: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { todayLocal };
