import { nanoid } from 'nanoid';
import { ApiError } from './api-error';

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

const AUTH_EXPIRED_EVENT = 'auth:expired';

/**
 * Текущая Org пользователя — добавляется в `X-Org-Id` по умолчанию ко всем
 * запросам. Нужна глобальным `SubscriptionGuard`/`EntitlementGuard` на бэке:
 * они — global APP_GUARD и выполняются ДО controller-scoped `CookieAuthGuard`,
 * поэтому tenant резолвят ТОЛЬКО из заголовка (req.user ещё не выставлен,
 * single-org fallback недоступен). Без X-Org-Id мутирующие @RequireSubscription
 * эндпоинты (создание/завершение встречи, регенерация отчёта и т.д.) падают с
 * 403 tenant_required. Синхронизируется из auth-context (`setApiClientOrgId`).
 * Явный per-call `X-Org-Id` (admin cross-org вызовы) имеет приоритет.
 */
let defaultOrgId: string | null = null;

export function setApiClientOrgId(orgId: string | null): void {
  defaultOrgId = orgId;
}

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
    return this.request<T>('GET', path, undefined, {
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts?.headers !== undefined ? { headers: opts.headers } : {}),
    });
  }

  async post<T>(path: string, body?: unknown, opts?: PostOpts): Promise<T> {
    return this.request<T>('POST', path, body, {
      ...(opts?.idempotencyKey !== undefined
        ? { idempotencyKey: opts.idempotencyKey }
        : {}),
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts?.headers !== undefined ? { headers: opts.headers } : {}),
    });
  }

  async patch<T>(path: string, body?: unknown, opts?: PatchOpts): Promise<T> {
    return this.request<T>('PATCH', path, body, {
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts?.headers !== undefined ? { headers: opts.headers } : {}),
    });
  }

  async put<T>(path: string, body?: unknown, opts?: PutOpts): Promise<T> {
    return this.request<T>('PUT', path, body, {
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts?.headers !== undefined ? { headers: opts.headers } : {}),
    });
  }

  async del<T>(path: string, opts?: DelOpts): Promise<T> {
    return this.request<T>('DELETE', path, opts?.body, {
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts?.headers !== undefined ? { headers: opts.headers } : {}),
    });
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    opts?: {
      idempotencyKey?: string;
      signal?: AbortSignal;
      headers?: Record<string, string>;
    },
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
    if (opts?.headers) {
      for (const [k, v] of Object.entries(opts.headers)) {
        headers[k] = v;
      }
    }

    // X-Org-Id по умолчанию (текущая Org). Явный per-call заголовок не перетираем.
    const hasExplicitOrg = Object.keys(headers).some(
      (k) => k.toLowerCase() === 'x-org-id',
    );
    if (!hasExplicitOrg && defaultOrgId) {
      headers['X-Org-Id'] = defaultOrgId;
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
          const parsed = await parseError(res, requestId);
          if (parsed.code === 'subscription_required') {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('subscription:required'));
            }
          }
          throw parsed;
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
