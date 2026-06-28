import { API_URL } from "./config";
import { ApiError, statusFallbackRu } from "./error";
import {
  extractSessionCookie,
  getOrgId,
  getSessionCookie,
  setSessionCookie,
} from "./session";

type BackendErrorPayload = {
  ok?: false;
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
};

type RequestOptions = {
  signal?: AbortSignal;
  withOrg?: boolean;
  headers?: Record<string, string>;
  captureSessionCookie?: boolean;
};

const AUTH_EXPIRED_EVENT = "kora:auth-expired";

type AuthExpiredListener = () => void;
const authExpiredListeners = new Set<AuthExpiredListener>();

export function onAuthExpired(listener: AuthExpiredListener): () => void {
  authExpiredListeners.add(listener);
  return () => {
    authExpiredListeners.delete(listener);
  };
}

function emitAuthExpired(): void {
  authExpiredListeners.forEach((listener) => {
    listener();
  });
}

function buildHeaders(opts?: RequestOptions): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const cookie = getSessionCookie();
  if (cookie) headers["Cookie"] = cookie;
  if (opts?.withOrg !== false) {
    const orgId = getOrgId();
    if (orgId) headers["X-Org-Id"] = orgId;
  }
  if (opts?.headers) Object.assign(headers, opts.headers);
  return headers;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: BackendErrorPayload | null = null;
  try {
    body = (await res.json()) as BackendErrorPayload;
  } catch {
    body = null;
  }
  const err = body?.error;
  return new ApiError({
    code: err?.code ?? `http_${res.status}`,
    message: err?.message ?? statusFallbackRu(res.status),
    status: res.status,
    requestId: err?.requestId ?? null,
  });
}

async function request<T>(
  method: string,
  path: string,
  body: unknown,
  opts?: RequestOptions,
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: buildHeaders(opts),
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (opts?.signal) init.signal = opts.signal;

  const res = await fetch(`${API_URL}${path}`, init);

  if (opts?.captureSessionCookie) {
    const cookie = extractSessionCookie(res.headers.get("set-cookie"));
    if (cookie) await setSessionCookie(cookie);
  }

  if (res.status === 401) {
    emitAuthExpired();
    throw await parseError(res);
  }
  if (!res.ok) throw await parseError(res);

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const apiClient = {
  get: <T>(path: string, opts?: RequestOptions) =>
    request<T>("GET", path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>("POST", path, body, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>("PATCH", path, body, opts),
  del: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>("DELETE", path, body, opts),
};
