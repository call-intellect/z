import { DomainError } from '../../../common/errors/domain-errors';

export class LoginInvalidError extends DomainError {
  readonly code = 'login_invalid';
  readonly httpStatus = 401;

  constructor() {
    super('Неверный логин или пароль');
  }
}

export class DisposableEmailError extends DomainError {
  readonly code = 'email_disposable';
  readonly httpStatus = 400;

  constructor() {
    super('Этот почтовый сервис не поддерживается. Используйте основной email.');
  }
}

export class CurrentPasswordInvalidError extends DomainError {
  readonly code = 'current_password_invalid';
  readonly httpStatus = 403;

  constructor() {
    super('Текущий пароль введён неверно');
  }
}

export class ResetTokenInvalidError extends DomainError {
  readonly code = 'reset_token_invalid';
  readonly httpStatus = 410;

  constructor() {
    super('Ссылка для сброса пароля недействительна или истекла');
  }
}

export class MagicLinkInvalidError extends DomainError {
  readonly code = 'magic_link_invalid';
  readonly httpStatus = 410;

  constructor() {
    super('Ссылка для входа недействительна или истекла');
  }
}

export class MagicLinkRateLimitedError extends DomainError {
  readonly code = 'magic_link_rate_limited';
  readonly httpStatus = 429;

  constructor() {
    super('Слишком много запросов ссылки для входа. Попробуйте позже.');
  }
}
