import type {
  Envelope,
  ResponseMeta,
  AppConfig,
  AnalyzeContractInput,
  ContractResult,
  DiagnoseDisputeInput,
  DisputeResult,
} from "@/shared/api";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable: boolean,
    public requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiResult<T> {
  data: T;
  meta: ResponseMeta;
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError("network", "网络连接失败，请保留输入稍后手动重试。", true);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiError("service_unavailable", "服务返回了非预期内容，请稍后手动重试。", true);
  }

  let body: Envelope<T>;
  try {
    body = (await response.json()) as Envelope<T>;
  } catch {
    throw new ApiError("upstream_invalid", "服务返回了无法解析的内容。", false);
  }
  if (!body || typeof body !== "object") {
    throw new ApiError("upstream_invalid", "服务返回了无效结果。", false);
  }
  if (body.ok === true) return { data: body.data, meta: body.meta };
  if (body.ok === false) {
    throw new ApiError(body.error.code, body.error.message, body.error.retryable, body.requestId);
  }
  throw new ApiError("upstream_invalid", "服务返回了无效结果。", false);
}

export const api = {
  config: () => request<AppConfig>("/api/config", { method: "GET" }),
  analyzeContract: (input: AnalyzeContractInput) =>
    request<ContractResult>("/api/contract/analyze", { method: "POST", body: JSON.stringify(input) }),
  diagnoseDispute: (input: DiagnoseDisputeInput) =>
    request<DisputeResult>("/api/dispute/diagnose", { method: "POST", body: JSON.stringify(input) }),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "发生未知错误，请稍后手动重试。";
}