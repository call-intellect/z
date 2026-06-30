export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;

  constructor(params: {
    code: string;
    message: string;
    status: number;
    requestId?: string | null;
  }) {
    super(params.message);
    this.name = "ApiError";
    this.code = params.code;
    this.status = params.status;
    this.requestId = params.requestId ?? null;
  }
}

export function statusFallbackRu(status: number): string {
  if (status === 401) return "Нужно войти заново";
  if (status === 403) return "Нет доступа";
  if (status === 404) return "Не найдено";
  if (status === 409) return "Конфликт";
  if (status === 429) return "Слишком много запросов, попробуйте позже";
  if (status === 503) return "Сервис временно недоступен";
  if (status >= 500) return "Ошибка сервера";
  return "Не удалось выполнить запрос";
}
