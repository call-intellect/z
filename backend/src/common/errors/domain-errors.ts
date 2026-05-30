/**
 * Доменные ошибки бизнес-логики Z.
 *
 * Все наследуют `DomainError`. `AllExceptionsFilter` мапит их в HTTP-ответ
 * `{ ok:false, error:{ code, message, requestId } }` со статусом `httpStatus`.
 *
 * Поле `details` не отдаётся клиенту — оно только для логов (например,
 * `meetingId`, `from/to` FSM-перехода).
 */

export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;

  /** Контекст для логов (НЕ отдаётся клиенту). */
  readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

// ─────────────────────────── 401 ──────────────────────────────────────

export class IntegrationKeyInvalidError extends DomainError {
  readonly code = 'integration_key_invalid';
  readonly httpStatus = 401;

  constructor(reason: string) {
    super(reason, { reason });
  }
}

export class DeepLinkExpiredError extends DomainError {
  readonly code = 'deep_link_expired';
  readonly httpStatus = 401;

  constructor() {
    super('Срок действия ссылки истёк');
  }
}

export class DeepLinkMismatchError extends DomainError {
  readonly code = 'deep_link_mismatch';
  readonly httpStatus = 401;

  constructor() {
    super('Ссылка не соответствует встрече');
  }
}

// ─────────────────────────── 403 ──────────────────────────────────────

export class NotAuthorizedError extends DomainError {
  readonly code = 'not_authorized';
  readonly httpStatus = 403;

  constructor(reason?: string) {
    super('Нет прав на это действие', reason !== undefined ? { reason } : undefined);
  }
}

/**
 * Хост пытается переименовать `Participant`, у которого `isRegisteredUser=true`.
 * Имя такого участника берётся из `User.name` и редактируется владельцем
 * аккаунта, а не хостом встречи.
 */
export class ParticipantRenameForbiddenError extends DomainError {
  readonly code = 'participant_rename_forbidden';
  readonly httpStatus = 403;

  constructor(participantId: string) {
    super(
      'Нельзя переименовать зарегистрированного участника — его имя берётся из аккаунта.',
      { participantId },
    );
  }
}

// ─────────────────────────── 404 ──────────────────────────────────────

export class MeetingNotFoundError extends DomainError {
  readonly code = 'meeting_not_found';
  readonly httpStatus = 404;

  constructor(meetingId: string) {
    super('Встреча не найдена', { meetingId });
  }
}

export class ParticipantNotFoundError extends DomainError {
  readonly code = 'participant_not_found';
  readonly httpStatus = 404;

  constructor(participantId: string) {
    super('Участник не найден', { participantId });
  }
}

// ─────────────────────────── 409 ──────────────────────────────────────

export class InvalidFsmTransitionError extends DomainError {
  readonly code = 'invalid_state_transition';
  readonly httpStatus = 409;

  constructor(from: string, to: string) {
    super(
      `Невозможно перевести встречу из состояния ${from} в ${to}`,
      { from, to },
    );
  }
}

export class RecordingNotReadyError extends DomainError {
  readonly code = 'recording_not_ready';
  readonly httpStatus = 409;

  constructor(meetingId: string) {
    super('Запись ещё не готова', { meetingId });
  }
}

export class RecordingNotFoundError extends DomainError {
  readonly code = 'recording_not_found';
  readonly httpStatus = 404;

  constructor(meetingId: string) {
    super('Запись для этой встречи не найдена', { meetingId });
  }
}

export class RecordingAlreadyDeletedError extends DomainError {
  readonly code = 'recording_already_deleted';
  readonly httpStatus = 409;

  constructor(meetingId: string) {
    super('Запись уже удалена', { meetingId });
  }
}

export class RecordingInvalidStateError extends DomainError {
  readonly code = 'recording_invalid_state';
  readonly httpStatus = 409;

  constructor(meetingId: string, currentStatus: string, expected: string) {
    super(`Запись в неподходящем статусе: ${currentStatus} (ожидался ${expected})`, {
      meetingId,
      currentStatus,
      expected,
    });
  }
}

export class IdempotencyConflictError extends DomainError {
  readonly code = 'idempotency_conflict';
  readonly httpStatus = 409;

  constructor(key: string) {
    super('Конфликт идемпотентности', { key });
  }
}

// ─────────────────────────── 400 ──────────────────────────────────────

export class GuestNameRequiredError extends DomainError {
  readonly code = 'guest_name_required';
  readonly httpStatus = 400;

  constructor() {
    super('Введите имя для входа в встречу');
  }
}

// ─────────────────────────── 410 ──────────────────────────────────────

export class MeetingFinishedError extends DomainError {
  readonly code = 'meeting_finished';
  readonly httpStatus = 410;

  constructor() {
    super('Встреча уже завершена');
  }
}

// ─────────────────────────── 429 ──────────────────────────────────────

export class QuotaExceededError extends DomainError {
  readonly code = 'quota_exceeded';
  readonly httpStatus = 429;

  constructor(resource: string, limit: number) {
    super(`Превышен лимит на ${resource}`, { resource, limit });
  }
}
