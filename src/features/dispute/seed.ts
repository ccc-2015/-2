/** 从合同风险带入争议处理的初始内容；由 App 层在模块间传递。 */
export interface DisputeSeed {
  key: string;
  issue: string;
  facts: string;
  counterparty: string;
  amountCents: number | null;
  evidenceId: string | null;
}
