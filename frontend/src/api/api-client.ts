import { nanoid } from 'nanoid';
import { ApiError } from './api-error';

type GetOpts = { signal?: AbortSignal };
type PostOpts = { idempotencyKey?: string; signal?: AbortSignal };
type PatchOpts = { signal?: AbortSignal };
type PutOpts = { signal?: AbortSignal };

type BackendErrorPayload = {
  ok?: false;
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
    details?: unknown;
  };
};

const AUTH_EXPIRED_EVENT = 'auth:expired';

function emitAuthExpired(): void {
  if (typeof window !== 'undefined') {
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
    message: err?.message ?? `HTTP ${res.status}`,
    requestId: err?.requestId ?? requestId,
    details: err?.details,
  });
}

export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  async get<T>(path: string, opts?: GetOpts): Promise<T> {
    return this.request<T>('GET', path, undefined, { signal: opts?.signal });
  }

  async post<T>(path: string, body?: unknown, opts?: PostOpts): Promise<T> {
    return this.request<T>('POST', path, body, {
      idempotencyKey: opts?.idempotencyKey,
      signal: opts?.signal,
    });
  }

  async patch<T>(path: string, body?: unknown, opts?: PatchOpts): Promise<T> {
    return this.request<T>('PATCH', path, body, { signal: opts?.signal });
  }

  async put<T>(path: string, body?: unknown, opts?: PutOpts): Promise<T> {
    return this.request<T>('PUT', path, body, { signal: opts?.signal });
  }

  async del<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    opts?: { idempotencyKey?: string; signal?: AbortSignal },
  ): Promise<T> {
    const url = this.baseUrl.replace(/\/+$/, '') + path;
    const requestId = nanoid(12);
    const headers: Record<string, string> = {
      'X-Request-Id': requestId,
      Accept: 'application/json',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (opts?.idempotencyKey) {
      headers['Idempotency-Key'] = opts.idempotencyKey;
    }

    const init: RequestInit = {
      method,
      credentials: 'include',
      headers,
      signal: opts?.signal,
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    // Retry для GET 5xx: 2 попытки с backoff 1s, 3s.
    const maxAttempts = method === 'GET' ? 3 : 1;
    const backoffs = [1000, 3000];

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(url, init);

        if (res.status === 401) {
          emitAuthExpired();
          throw new ApiError({
            code: 'unauthorized',
            message: 'Сессия истекла. Войдите снова.',
            requestId,
          });
        }
        if (res.status === 403) {
          throw new ApiError({
            code: 'forbidden',
            message: 'Нет прав на это действие.',
            requestId,
          });
        }

        if (res.status >= 500 && method === 'GET' && attempt < maxAttempts) {
          await sleep(backoffs[attempt - 1] ?? 3000);
          continue;
        }

        if (!res.ok) {
          throw await parseError(res, requestId);
        }

        // 204 No Content
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
            code: 'invalid_response',
            message: 'Сервер вернул некорректный JSON.',
            requestId,
          });
        }
      } catch (e) {
        lastError = e;
        // ApiError из ветки 5xx-уже-обработан или из not-ok — не ретраим (кроме того что уже сделали).
        if (e instanceof ApiError) throw e;
        // Сетевая ошибка fetch — для GET ретраим.
        if (method === 'GET' && attempt < maxAttempts) {
          await sleep(backoffs[attempt - 1] ?? 3000);
          continue;
        }
        if (e instanceof Error && e.name === 'AbortError') {
          throw e;
        }
        throw new ApiError({
          code: 'network_error',
          message: 'Ошибка сети. Проверьте подключение.',
          requestId,
        });
      }
    }
    // Сюда теоретически не доходим, но TS требует.
    throw lastError instanceof Error
      ? lastError
      : new ApiError({ code: 'unknown', message: 'Неизвестная ошибка.', requestId });
  }
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
export const apiClient = new ApiClient(baseUrl);
