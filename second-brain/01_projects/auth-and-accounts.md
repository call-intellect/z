---
title: Аутентификация и аккаунты
status: actual
updated: 2026-05-10
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

## Поток 3 — Admin local login (низкоуровневый, теперь за единым логином)

`AdminLoginService.login(email, password)` → проверяет bcrypt-хеш в `User.passwordHash` для `role='admin'`, выдаёт JWT (без `jti`). Доступ к `/admin/*` через `SuperAdminGuard` (флаг `User.isSuperAdmin`).

Файлы: `backend/src/modules/auth/services/admin-login.service.ts`, endpoint `POST /api/v1/auth/admin-login` (deprecated — оставлен для обратной совместимости).

## Поток 4 — Единый логин `/login` (2026-05-29)

Одна форма для всех — обычных пользователей И супер-админов. `POST /api/v1/auth/login` (`UnifiedLoginController`, `backend/src/modules/accounts/unified-login.controller.ts`) пробует по очереди:
1. standalone (`AccountsService.login`, argon2id);
2. admin (`AdminLoginService.login`, bcrypt, `role='admin'`).

Любой неуспех — единый `LoginInvalidError` (защита от user-enumeration: каждый путь сам тратит время на фейковый verify своего хеша). Общий cookie `z_session`, domain `COOKIE_STANDALONE_DOMAIN ?? COOKIE_DOMAIN`, throttle 5/15мин. Ответ: `{ user, role, isSuperAdmin, mustChangePassword }`.

**Фронт:** единая форма `app/login/LoginForm.tsx` → `authApi.login` → `auth-context.login()`. Редирект после входа: безопасный `?next=` → супер-админ `/admin` → обычный `/meetings`. Старая `/admin/login` теперь `redirect('/login?next=/admin')`; `AdminLoginForm.tsx` не используется.

ТЗ: [plans/tz/2026-05-29-unified-login.md](../../plans/tz/2026-05-29-unified-login.md). Старые эндпоинты `/accounts/login` и `/auth/admin-login` живы (deprecated) — откат тривиален. Cleanup и удаление старых форм — в Фазе 4 ТЗ.

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

## Org и роли (Фаза 0 knowledge-core, 2026-05-10)

После Фазы 0 каждый юзер имеет **минимум одну Org** (создаётся автоматически при регистрации). См. подробности в [orgs-and-rbac.md](./orgs-and-rbac.md).

**Регистрация теперь создаёт пару (User + Org + Membership(owner)) в одной Prisma-транзакции:**
- `companyName` опциональное поле формы. Если пусто — Org называется «Компания {name}».
- Идемпотентно: повторный register на тот же email не дублирует Org.

**Поле `User.isSuperAdmin`** — флаг владельца продукта Z (Z-Admin). Независим от `User.role` и `Membership`. Включается вручную DBA или seed'ом. На Фазе 0 — bypass всех RBAC проверок (SuperAdminAccessLog появится в Фазе 7).

**SignupForm** ([frontend/app/signup/SignupForm.tsx](../../frontend/app/signup/SignupForm.tsx)) расширена опциональным полем «Название компании». DTO `AccountsRegisterRequest.companyName` — backend-источник правды [register.dto.ts](../../backend/src/modules/accounts/dto/register.dto.ts).
