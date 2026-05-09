---
title: Аутентификация и аккаунты
status: actual
updated: 2026-05-09
---

# Аутентификация и аккаунты

В проекте Z **три параллельных потока авторизации** — для разных сценариев. Все три используют общий `CookieAuthGuard`, но выписывают сессии по-разному.

## Поток 1 — Crossmark deep-link (legacy)

Crossmark выписывает короткоживущий JWT (см. `JWT_DEEP_LINK_SECRET`), кладёт его в URL встречи. Юзер открывает `/m/<id>?token=...`, фронт обменивает токен → backend ставит cookie `z_session` (JWT с `userId`, **без `jti`**) на `Domain=.crossmark.ru`. Cookie живёт `SESSION_TTL_SECONDS`.

**Особенность:** `CookieAuthGuard` для legacy-сессий (без `jti`) пропускает проверку `UserSession.revokedAt is null` — иначе старые токены сразу инвалидируются.

Файлы: `backend/src/modules/auth/services/jwt.service.ts`, `backend/src/modules/auth/guards/cookie-auth.guard.ts`, `frontend/app/(public)/m/[id]/ExchangeAndRender.tsx`.

## Поток 2 — Standalone-аккаунты (новое в 2026-05-09)

Lead-style: пользователь оставляет `email + name` на `/signup` → backend генерирует временный пароль (12 символов из `crypto.randomBytes(9).toString('base64url')`), хеширует через **argon2id** (OWASP defaults: 19 MiB / 2 iter / 1 par), отправляет письмом через SMTP `mail.hosting.reg.ru:465 SSL`.

Логин `/login` (стандартный) → создаёт `UserSession` с `jti = nanoid(32)`, выдаёт cookie `z_session` (JWT с `userId + jti`) на `Domain=COOKIE_STANDALONE_DOMAIN` (узкий, по умолчанию равен `COOKIE_DOMAIN`). Если `mustChangePassword=true` — фронт-guard в `(authenticated)/layout.tsx` форсирует редирект на `/onboarding/change-password`.

**Восстановление пароля:** `/forgot-password` → backend создаёт `UserVerificationToken(purpose=password_reset)` (TTL 60 минут, `tokenHash = sha256(rawToken)`), шлёт ссылку. `/reset-password?token=...` сверяет, меняет пароль, **отзывает все активные `UserSession`** этого пользователя (по `revokedAt`).

**Защита от user enumeration:** `/forgot-password` всегда возвращает `{ ok: true }` независимо от существования email.

**Disposable email:** in-memory snapshot ~85 доменов (mailinator/tempmail/etc), блокировка регистрации.

**Throttling:** `@nestjs/throttler` — 5 попыток / 15 минут на IP для register/login/forgot, 3 для reset.

Файлы:
- `backend/src/modules/accounts/` — controller/service/repository/dto/exceptions/password.service/session.service
- `backend/src/modules/mail/` — MailService с handlebars-шаблонами (inline), DisposableEmailService
- `frontend/app/{signup,login,forgot-password,reset-password}/` + `(authenticated)/onboarding/change-password/`
- `frontend/src/api/accounts.api.ts`, `frontend/src/contexts/auth-context.tsx`, `frontend/src/domain/account.ts`

## Поток 3 — Admin local login

Отдельная страница `/admin/login` → `adminApi.adminLogin(email, password)` → проверяет bcrypt-хеш в `User.passwordHash` для `role='admin'`, выдаёт JWT (тоже без `jti`). Доступ к `/admin/*` через `AdminGuard`.

Файлы: `backend/src/modules/admin/local-login/`, `frontend/app/(admin)/admin/login/`.

## DB-модели

```
User {
  email, name, role: user|admin, signupSource: crossmark|standalone,
  passwordHash?, mustChangePassword: bool, deletedAt?
  @@unique([email, signupSource])
}

UserSession {
  jti UNIQUE, userId, userAgent, ip, expiresAt, revokedAt?
  @@index([userId, revokedAt])
}

UserVerificationToken {
  tokenHash UNIQUE, userId, purpose: password_reset|account_restore,
  expiresAt, usedAt?
}
```

Soft-delete юзера: `deletedAt = now`, физическое удаление через 30 дней (`SOFT_DELETE_GRACE_DAYS`) воркером `retention-extras.cron`. До этого — восстановление по email-ссылке.

## ENV

`JWT_SESSION_SECRET`, `JWT_DEEP_LINK_SECRET`, `COOKIE_DOMAIN`, `COOKIE_STANDALONE_DOMAIN` (опц), `SESSION_TTL_SECONDS`, `DEEP_LINK_TTL_SECONDS`, `ARGON_MEMORY_KB/ITERATIONS/PARALLELISM`, `MAIL_*` (host/port/ssl/username/password/from/dryRun).
