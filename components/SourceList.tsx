import type { SourceRef } from "@/shared/api";

export function SourceList({
  sources,
  retrieved = [],
  knowledgeVersion,
  warnings,
}: {
  sources: SourceRef[];
  /** 本次检索召回的全部资料；未传时退化为只显示引用项。 */
  retrieved?: SourceRef[];
  knowledgeVersion: string | null;
  warnings: string[];
}) {
  const citedIds = new Set(sources.map((source) => source.id));
  const all = retrieved.length > 0 ? retrieved : sources;
  if (all.length === 0) return null;
  const citedCount = all.filter((source) => citedIds.has(source.id)).length;

  return (
    <details className="border-t border-border/60 pt-2">
      <summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground">
        依据（{all.length}）
        {all.length > 0 ? ` · 引用 ${citedCount}` : ""}
        {knowledgeVersion ? ` · 知识库 ${knowledgeVersion}` : ""}
      </summary>
      <ul className="mt-2 space-y-2.5">
        {all.map((source) => {
          const cited = citedIds.has(source.id);
          return (
            <li
              key={source.id}
              className={
                cited
                  ? "text-[11px] leading-relaxed text-muted-foreground"
                  : "text-[11px] leading-relaxed text-muted-foreground/70"
              }
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={cited ? "font-medium text-foreground" : "font-medium"}>{source.title}</span>
                <span
                  className={
                    cited
                      ? "rounded-full border border-primary/30 bg-primary/5 px-1.5 text-[10px] text-primary"
                      : "rounded-full border border-border px-1.5 text-[10px]"
                  }
                >
                  {cited ? "已引用" : "已检索"}
                </span>
              </div>
              <div>
                {source.publisher}
                {source.effectiveFrom ? ` · 生效 ${source.effectiveFrom}` : ""}
                {source.version ? ` · 版本 ${source.version}` : ""}
                {source.checkedAt ? ` · 核验 ${source.checkedAt}` : ""}
              </div>
              {source.excerpt && (
                <blockquote className="mt-1 border-l-2 border-border pl-2 font-mono text-[11px]">
                  {source.excerpt}
                </blockquote>
              )}
              {source.url && (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-primary underline-offset-2 hover:underline"
                >
                  官方来源
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {warnings.length > 0 && (
        <p className="mt-2 border-t border-border/60 pt-1.5 text-[10px] leading-relaxed">
          {warnings.join(" ")}
        </p>
      )}
    </details>
  );
}
