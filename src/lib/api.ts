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

/**
 * 接口前缀：本地开发走 /api（Vite 代理到 FastAPI）；
 * 发布到 Qoder Sites 时构建期注入 VITE_API_PREFIX=/functions/v1/app。
 */
const API_PREFIX = (import.meta.env.VITE_API_PREFIX ?? "/api").replace(/\/+$/, "");

function url(path: string): string {
  return `${API_PREFIX}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(url(path), {
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
  const streamed: string[] = [];
  let response: Response;
  try {
    response = await fetch(url("/contract/analyze/stream"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(input),
      signal,
    });
  } catch {
    if (signal?.aborted) return;
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

  const handleFrame = (frame: string): boolean => {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return false;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data);
    } catch {
      return false;
    }
    if (payload.type === "stage") {
      const stage = payload.stage as "reading" | "retrieving" | "generating";
      handlers.onStage?.({ stage, sources: payload.sources as number | undefined });
    } else if (payload.type === "delta") {
      const text = String(payload.text ?? "");
      streamed.push(text);
      handlers.onDelta?.(text);
    } else if (payload.type === "result") {
      finished = true;
      handlers.onResult?.(payload.data as ContractResult, payload.meta as ResponseMeta);
      return true;
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
      return true;
    }
    return false;
  };

  try {
    while (!finished) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        if (handleFrame(frame)) break;
      }
      if (done) {
        if (buffer) handleFrame(buffer);
        buffer = "";
        break;
      }
    }
  } catch {
    // 网关在流收尾时断开（如 HTTP/2 协议错误）：保留已收到的正文，走兜底。
  } finally {
    try {
      await reader.cancel();
    } catch {
      // 响应体已关闭。
    }
  }

  if (finished || signal?.aborted) return;

  // 兜底：流被中断但正文已到手时，用非流接口补一次结构化结果，避免用户只看到半截回答。
  if (streamed.join("").trim()) {
    try {
      const { data, meta } = await api.analyzeContract(input);
      handlers.onResult?.(data, meta);
      return;
    } catch {
      // 兜底也失败时按中断处理。
    }
  }
  handlers.onError?.(new ApiError("upstream_invalid", "分析中断，请手动重试。", true));
}

export const api = {
  config: () => request<AppConfig>("/config", { method: "GET" }),
  extract: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<ExtractResult>("/extract", { method: "POST", body: form });
  },
  extractMany: (files: File[]) => {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    return request<ExtractResult>("/extract/multi", { method: "POST", body: form });
  },
  transcribeImage: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<ExtractResult>("/extract/image", { method: "POST", body: form });
  },
  analyzeContract: (input: AnalyzeContractInput) =>
    request<ContractResult>("/contract/analyze", { method: "POST", body: JSON.stringify(input) }),
  diagnoseDispute: (input: DiagnoseDisputeInput) =>
    request<DisputeResult>("/dispute/diagnose", { method: "POST", body: JSON.stringify(input) }),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "发生未知错误，请稍后手动重试。";
}