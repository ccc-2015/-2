import type { ContractMemory, ConversationTurn } from "@/shared/api";
import type { Exchange } from "./types";

/** 只把最近 6 轮原文带给模型，更早的轮次压成一段会话记忆，避免长对话丢上下文。 */
export const RECENT_EXCHANGES = 6;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function pushUnique(list: string[], value: string, max: number): void {
  const clean = clip(value, max);
  if (clean && !list.includes(clean)) list.push(clean);
}

export function deriveMemory(list: Exchange[]): ContractMemory | null {
  const completed = list.filter((exchange) => exchange.result);
  if (completed.length <= RECENT_EXCHANGES) return null;
  const older = completed.slice(0, completed.length - RECENT_EXCHANGES);
  const questions: string[] = [];
  const facts: string[] = [];
  const decisions: string[] = [];
  const openQuestions: string[] = [];

  older.forEach((exchange, index) => {
    const result = exchange.result!;
    questions.push(`第${index + 1}轮：${clip(exchange.question, 40)}`);
    for (const finding of result.findings) pushUnique(facts, finding.issue, 50);
    if (result.revision) pushUnique(decisions, "生成过修订草稿（协商用，未经用户确认）", 60);
    for (const question of result.followUpQuestions) pushUnique(openQuestions, question, 40);
  });

  return {
    summary: clip(`此前已完成 ${older.length} 轮分析：${questions.join("；")}`, 900),
    facts: facts.slice(0, 8),
    decisions: decisions.slice(0, 4),
    openQuestions: openQuestions.slice(0, 3),
  };
}

export function buildContext(list: Exchange[]): {
  conversation: ConversationTurn[];
  memory: ContractMemory | null;
} {
  const completed = list.filter((exchange) => exchange.result);
  const recent = completed.slice(-RECENT_EXCHANGES);
  const conversation: ConversationTurn[] = [];
  for (const exchange of recent) {
    conversation.push({ role: "user", content: exchange.question });
    conversation.push({ role: "assistant", content: exchange.result!.answer });
  }
  return { conversation, memory: deriveMemory(completed) };
}
