import type {
  Envelope,
  ResponseMeta,
  AppConfig,
  AnalyzeContractInput,
  ContractResult,
  DiagnoseDisputeInput,
  DisputeResult,
  ExtractResult,
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
  const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers: { ...(init?.body && !isForm ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
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

export interface StreamHandlers {
  onStage?: (payload: { stage: "reading" | "retrieving" | "generating"; sources?: number }) => void;
  onDelta?: (text: string) => void;
  onResult?: (data: ContractResult, meta: ResponseMeta) => void;
  onError?: (error: ApiError) => void;
}

/** 合同分析 SSE：阶段 → 正文增量 → 最终结构化结果。 */
export async function analyzeContractStream(
  input: AnalyzeContractInput,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/contract/analyze/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(input),
      signal,
    });
  } catch {
    handlers.onError?.(new ApiError("network", "网络连接失败，请保留输入稍后手动重试。", true));
    return;
  }

  if (!response.ok || !response.body) {
    handlers.onError?.(new ApiError("service_unavailable", "服务暂时不可用，请稍后手动重试。", true));
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((item) => item.startsWith("data:"));
      if (!line) continue;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (payload.type === "stage") {
        const stage = payload.stage as "reading" | "retrieving" | "generating";
        handlers.onStage?.({ stage, sources: payload.sources as number | undefined });
      } else if (payload.type === "delta") {
        handlers.onDelta?.(String(payload.text ?? ""));
      } else if (payload.type === "result") {
        finished = true;
        handlers.onResult?.(
          payload.data as ContractResult,
          payload.meta as ResponseMeta,
        );
      } else if (payload.type === "error") {
        finished = true;
        handlers.onError?.(
          new ApiError(
            String(payload.code ?? "internal_error"),
            String(payload.message ?? "分析未完成，请稍后手动重试。"),
            (payload.code ?? "") === "rate_limited" ||
              (payload.code ?? "") === "service_unavailable" ||
              (payload.code ?? "") === "upstream_timeout",
          ),
        );
      }
    }
  }
  if (!finished) {
    handlers.onError?.(new ApiError("upstream_invalid", "分析中断，请手动重试。", true));
  }
}

export const api = {
  config: () => request<AppConfig>("/api/config", { method: "GET" }),
  extract: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<ExtractResult>("/api/extract", { method: "POST", body: form });
  },
  extractMany: (files: File[]) => {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    return request<ExtractResult>("/api/extract/multi", { method: "POST", body: form });
  },
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