export type ApiErrorPayload = {
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
};

export class ApiError extends Error {
  public readonly payload: ApiErrorPayload;

  constructor(payload: ApiErrorPayload) {
    super(payload.message);
    this.name = "ApiError";
    this.payload = payload;
  }

  get code(): string {
    return this.payload.code;
  }

  get requestId(): string | undefined {
    return this.payload.requestId;
  }
}

const ERROR_CODE_RU: Record<string, string> = {
  unauthorized: "Сессия истекла. Войдите снова.",
  forbidden: "Недостаточно прав для этого действия.",
  tenant_required: "Компания не выбрана. Обновите страницу и попробуйте снова.",
  not_found: "Не найдено.",
  validation_error: "Проверьте правильность заполнения полей.",
  rate_limited: "Слишком много запросов. Попробуйте чуть позже.",
  quota_exceeded: "Лимит исчерпан. Попробуйте позже.",
  llm_dispatch_timeout: "ИИ не успел ответить. Попробуйте ещё раз.",
};

export function httpStatusFallbackRu(status: number): string {
  if (status === 401) return "Сессия истекла. Войдите снова.";
  if (status === 403) return "Недостаточно прав для этого действия.";
  if (status === 404) return "Не найдено.";
  if (status === 408 || status === 504)
    return "Превышено время ожидания. Попробуйте ещё раз.";
  if (status === 429) return "Слишком много запросов. Попробуйте позже.";
  if (status >= 500)
    return "Ошибка на сервере. Мы уже знаем о проблеме — попробуйте позже.";
  return "Не удалось выполнить запрос. Попробуйте позже.";
}

const GENERIC_ERROR_RU = "Не удалось выполнить запрос. Попробуйте позже.";

function looksTechnical(msg: string): boolean {
  return (
    /^HTTP \d+$/.test(msg) ||
    /^[a-z][a-z0-9_]*$/.test(msg) ||
    /(Error|Exception)\b/.test(msg) ||
    msg.includes("{") ||
    msg.includes("[object")
  );
}

export function humanizeApiError(
  err: unknown,
  fallback: string = GENERIC_ERROR_RU,
): string {
  if (err instanceof ApiError) {
    const byCode = ERROR_CODE_RU[err.code];
    if (byCode) return byCode;
    const msg = err.payload.message?.trim() ?? "";
    if (!msg || looksTechnical(msg)) return fallback;
    return msg;
  }
  if (err instanceof Error) {
    const msg = err.message?.trim() ?? "";
    if (!msg || looksTechnical(msg)) return fallback;
    return msg;
  }
  return fallback;
}
