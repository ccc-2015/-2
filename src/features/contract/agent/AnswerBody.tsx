type Block =
  | { kind: "lead"; label: string; text: string }
  | { kind: "section"; label: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "note"; label: string; text: string }
  | { kind: "paragraph"; text: string };

const LEAD_LABELS = new Set(["结论", "判断"]);
const NOTE_LABELS = new Set(["下一步", "建议"]);
const SECTION_LABELS = new Set(["要点", "主要问题", "依据", "原因", "改动点", "风险点", "说明"]);

/** 去掉模型偶发的行内标记，避免把 * 或反引号原样显示。 */
function clean(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`(.+?)`/g, "$1");
}

function parse(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    if (/^[-•·]\s+/.test(line)) {
      const item = clean(line.replace(/^[-•·]\s+/, ""));
      const last = blocks[blocks.length - 1];
      if (last?.kind === "bullets") last.items.push(item);
      else blocks.push({ kind: "bullets", items: [item] });
      continue;
    }

    const match = line.match(/^([^：:]{1,8})[：:]\s*(.*)$/);
    const label = match?.[1].trim() ?? "";
    const rest = clean(match?.[2].trim() ?? "");
    if (SECTION_LABELS.has(label)) {
      blocks.push({ kind: "section", label });
      if (rest) blocks.push({ kind: "paragraph", text: rest });
      continue;
    }
    if (LEAD_LABELS.has(label)) {
      blocks.push(rest ? { kind: "lead", label, text: rest } : { kind: "section", label });
      continue;
    }
    if (NOTE_LABELS.has(label)) {
      blocks.push(rest ? { kind: "note", label, text: rest } : { kind: "section", label });
      continue;
    }

    blocks.push({ kind: "paragraph", text: clean(line) });
  }
  return blocks;
}

function Cursor() {
  return <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-foreground/60 align-middle" />;
}

export function AnswerBody({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const blocks = parse(text);

  return (
    <div className="space-y-2.5">
      {blocks.map((block, index) => {
        const last = index === blocks.length - 1;

        if (block.kind === "lead") {
          return (
            <div key={index} className="flex items-start gap-2.5 rounded-xl bg-secondary/60 px-3 py-2.5">
              <span className="mt-0.5 shrink-0 rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-medium leading-4 text-background">
                {block.label}
              </span>
              <p className="min-w-0 text-[15px] font-medium leading-6 tracking-tight">
                {block.text}
                {last && streaming && <Cursor />}
              </p>
            </div>
          );
        }

        if (block.kind === "section") {
          return (
            <p key={index} className="pt-0.5 text-[12px] font-medium leading-5 text-muted-foreground">
              {block.label}
              {last && streaming && <Cursor />}
            </p>
          );
        }

        if (block.kind === "bullets") {
          return (
            <ul key={index} className="space-y-1.5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex items-start gap-2.5 text-[14px] leading-6">
                  <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-primary/60" />
                  <span className="min-w-0">
                    {item}
                    {last && streaming && itemIndex === block.items.length - 1 && <Cursor />}
                  </span>
                </li>
              ))}
            </ul>
          );
        }

        if (block.kind === "note") {
          return (
            <p
              key={index}
              className="flex items-start gap-1.5 rounded-lg bg-secondary/40 px-3 py-2 text-[13px] leading-relaxed text-muted-foreground"
            >
              <span className="shrink-0 font-medium text-foreground/70">{block.label}：</span>
              <span className="min-w-0">
                {block.text}
                {last && streaming && <Cursor />}
              </span>
            </p>
          );
        }

        return (
          <p key={index} className="whitespace-pre-wrap text-[15px] leading-7">
            {block.text}
            {last && streaming && <Cursor />}
          </p>
        );
      })}
    </div>
  );
}