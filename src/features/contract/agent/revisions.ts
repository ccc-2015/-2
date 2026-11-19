import type { ContractResult, Revision } from "@/shared/api";

function normalize(item: Partial<Revision>): Revision {
  const targetExcerpt = item.targetExcerpt ?? null;
  const rawKind = item.kind === "add" || item.kind === "modify" ? item.kind : targetExcerpt ? "modify" : "add";
  const kind: Revision["kind"] = rawKind === "modify" && targetExcerpt ? "modify" : "add";
  return {
    kind,
    clauseLabel: item.clauseLabel?.trim() || (kind === "add" ? "新增条款" : "相关条款"),
    title: item.title?.trim() || "",
    text: item.text ?? "",
    targetExcerpt,
    reason: item.reason?.trim() || "",
  };
}

/** 兼容旧数据：新结果读 revisions，旧结果回退到单条 revision。 */
export function resultRevisions(result: ContractResult | null | undefined): Revision[] {
  if (!result) return [];
  const list =
    Array.isArray(result.revisions) && result.revisions.length > 0
      ? result.revisions
      : result.revision
        ? [result.revision]
        : [];
  return list.filter((item) => item && (item.text ?? "").trim()).map(normalize);
}