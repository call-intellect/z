import { nanoid } from "nanoid";
import { ApiError, httpStatusFallbackRu } from "./api-error";

type GetOpts = { signal?: AbortSignal; headers?: Record<string, string> };
type PostOpts = {
  idempotencyKey?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
};
type PatchOpts = { signal?: AbortSignal; headers?: Record<string, string> };
type PutOpts = { signal?: AbortSignal; headers?: Record<string, string> };
type DelOpts = {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  body?: unknown;
};

type BackendErrorPayload = {
  ok?: false;
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
    details?: unknown;
  };
};

const AUTH_EXPIRED_EVENT = "auth:expired";

export const ACTIVE_ORG_LS_KEY = "z.activeOrgId";

let defaultOrgId: string | null = null;

export function setApiClientOrgId(orgId: string | null): void {
  defaultOrgId = orgId;
}

export function getApiClientOrgId(): string | null {
  return defaultOrgId;
}

function emitAuthExpired(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseError(res: Response, requestId: string): Promise<ApiError> {
  let body: BackendErrorPayload | null = null;
  try {
    body = (await res.json()) as BackendErrorPayload;
  } catch {
    body = null;
  }
  const err = body?.error;
  return new ApiError({
    code: err?.code ?? `http_${res.status}`,
    message: err?.message ?? httpStatusFallbackRu(res.status),
    requestId: err?.requestId ?? requestId,
    details: err?.details,
  });
}

export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  async get<T>(path: string, opts?: GetOpts): Promise<T> {
    return this.request<T>("GET", path, undefined, {
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts?.headers !== undefined ? { headers: opts.headers } : {}),
    });
  }

  async post<T>(path: string, body?: unknown, opts?: PostOpts): Promise<T> {
    return this.request<T>("POST", path, body, {
      ...(opts?.idempotencyKey !== undefined
        ? { idempotencyKey: opts.idempotencyKey }
        : {}),
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts?.headers !== undefined ? { headers: opts.headers } : {}),
    });
  }

  async patch<T>(path: string, body?: unknown, opts?: PatchOpts): Promise<T> {
    return this.request<T>("PATCH", path, body, {
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts?.headers !== undefined ? { headers: opts.headers } : {}),
    });
  }

  async put<T>(path: string, body?: unknown, opts?: PutOpts): Promise<T> {
    return this.request<T>("PUT", path, body, {
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts?.headers !== undefined ? { headers: opts.headers } : {}),
    });
  }

  async del<T>(path: string, opts?: DelOpts): Promise<T> {
    return this.request<T>("DELETE", path, opts?.body, {
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts?.headers !== undefined ? { headers: opts.headers } : {}),
    });
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    opts?: {
      idempotencyKey?: string;
      signal?: AbortSignal;
      headers?: Record<string, string>;
    },
  ): Promise<T> {
    const url = this.baseUrl.replace(/\/+$/, "") + path;
    const requestId = nanoid(12);
    const headers: Record<string, string> = {
      "X-Request-Id": requestId,
      Accept: "application/json",
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (opts?.idempotencyKey) {
      headers["Idempotency-Key"] = opts.idempotencyKey;
    }
    if (opts?.headers) {
      for (const [k, v] of Object.entries(opts.headers)) {
        headers[k] = v;
      }
    }

    const hasExplicitOrg = Object.keys(headers).some(
      (k) => k.toLowerCase() === "x-org-id",
    );
    if (!hasExplicitOrg && defaultOrgId) {
      headers["X-Org-Id"] = defaultOrgId;
    }

    const init: RequestInit = {
      method,
      credentials: "include",
      headers,
      signal: opts?.signal,
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const maxAttempts = method === "GET" ? 3 : 1;
    const backoffs = [1000, 3000];

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(url, init);

        if (res.status === 401) {
          emitAuthExpired();
          throw new ApiError({
            code: "unauthorized",
            message: "Сессия истекла. Войдите снова.",
            requestId,
          });
        }
        if (res.status === 403) {
          const parsed = await parseError(res, requestId);
          if (
            parsed.code === "subscription_required" ||
            parsed.code === "subscription_demo" ||
            parsed.code === "subscription_expired"
          ) {
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("subscription:required"));
            }
          }
          throw parsed;
        }

        if (res.status >= 500 && method === "GET" && attempt < maxAttempts) {
          await sleep(backoffs[attempt - 1] ?? 3000);
          continue;
        }

        if (!res.ok) {
          throw await parseError(res, requestId);
        }

        if (res.status === 204) {
          return undefined as T;
        }

        const text = await res.text();
        if (!text) {
          return undefined as T;
        }
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new ApiError({
            code: "invalid_response",
            message: "Сервер вернул некорректный JSON.",
            requestId,
          });
        }
      } catch (e) {
        lastError = e;
        if (e instanceof ApiError) throw e;
        if (method === "GET" && attempt < maxAttempts) {
          await sleep(backoffs[attempt - 1] ?? 3000);
          continue;
        }
        if (e instanceof Error && e.name === "AbortError") {
          throw e;
        }
        throw new ApiError({
          code: "network_error",
          message: "Ошибка сети. Проверьте подключение.",
          requestId,
        });
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new ApiError({
          code: "unknown",
          message: "Неизвестная ошибка.",
          requestId,
        });
  }
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
export const apiClient = new ApiClient(baseUrl);
