import type { SourceRef } from "@/shared/api";

export function SourceList({
  sources,
  knowledgeVersion,
  warnings,
}: {
  sources: SourceRef[];
  knowledgeVersion: string | null;
  warnings: string[];
}) {
  if (sources.length === 0) return null;
  return (
    <details className="border-t border-border/60 pt-2">
      <summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground">
        依据（{sources.length}）
        {knowledgeVersion ? ` · 知识库 ${knowledgeVersion}` : ""}
      </summary>
      <ul className="mt-2 space-y-2.5">
        {sources.map((source) => (
          <li key={source.id} className="text-[11px] leading-relaxed text-muted-foreground">
            <div className="font-medium text-foreground">{source.title}</div>
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
        ))}
      </ul>
      {warnings.length > 0 && (
        <p className="mt-2 border-t border-border/60 pt-1.5 text-[10px] leading-relaxed">
          {warnings.join(" ")}
        </p>
      )}
    </details>
  );
}
