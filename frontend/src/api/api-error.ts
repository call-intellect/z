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
    this.name = 'ApiError';
    this.payload = payload;
  }

  get code(): string {
    return this.payload.code;
  }

  get requestId(): string | undefined {
    return this.payload.requestId;
  }
}
