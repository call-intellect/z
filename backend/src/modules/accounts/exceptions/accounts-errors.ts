import { DomainError } from '../../../common/errors/domain-errors';

/**
 * Доменные ошибки модуля accounts (standalone-логин/онбординг).
 *
 * Универсальный принцип: во внешних ответах не палим существование
 * пользователя. `LoginInvalidError` единый и для «нет такого юзера»,
 * и для «неверный пароль» — защита от user enumeration.
 *
 * `AllExceptionsFilter` мапит все DomainError в `{ ok:false, error:{ code, message } }`
 * со статусом `httpStatus`.
 */

// ─────────────────────────── 401 ──────────────────────────────────

export class LoginInvalidError extends DomainError {
  readonly code = 'login_invalid';
  readonly httpStatus = 401;

  constructor() {
    super('Неверный логин или пароль');
  }
}

export class SessionRevokedError extends DomainError {
  readonly code = 'session_revoked';
  readonly httpStatus = 401;

  constructor() {
    super('Сессия больше недействительна');
  }
}

// ─────────────────────────── 400 ──────────────────────────────────

export class DisposableEmailError extends DomainError {
  readonly code = 'email_disposable';
  readonly httpStatus = 400;

  constructor() {
    super('Этот почтовый сервис не поддерживается. Используйте основной email.');
  }
}

export class WeakPasswordError extends DomainError {
  readonly code = 'password_too_weak';
  readonly httpStatus = 400;

  constructor() {
    super('Пароль должен содержать минимум 8 символов, букву и цифру');
  }
}

// ─────────────────────────── 403 ──────────────────────────────────

export class CurrentPasswordInvalidError extends DomainError {
  readonly code = 'current_password_invalid';
  readonly httpStatus = 403;

  constructor() {
    super('Текущий пароль введён неверно');
  }
}

// ─────────────────────────── 410 ──────────────────────────────────

export class ResetTokenInvalidError extends DomainError {
  readonly code = 'reset_token_invalid';
  readonly httpStatus = 410;

  constructor() {
    super('Ссылка для сброса пароля недействительна или истекла');
  }
}

/** β-9 (2026-05-25) — magic-link недействителен / истёк / уже использован. */
export class MagicLinkInvalidError extends DomainError {
  readonly code = 'magic_link_invalid';
  readonly httpStatus = 410;

  constructor() {
    super('Ссылка для входа недействительна или истекла');
  }
}

// ─────────────────────────── 429 ──────────────────────────────────

/** β-9 (2026-05-25) — превышен лимит запросов magic-link на одну почту. */
export class MagicLinkRateLimitedError extends DomainError {
  readonly code = 'magic_link_rate_limited';
  readonly httpStatus = 429;

  constructor() {
    super('Слишком много запросов ссылки для входа. Попробуйте позже.');
  }
}
