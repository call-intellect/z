# ТЗ: единый логин для супер-админов и пользователей (`/login`)

**Дата:** 2026-05-29
**Статус:** реализовано (Фазы 1–2). Фаза 3 — ручная проверка на стенде. Фаза 4 (cleanup) — позже.
**Решения:** единый бэкенд-эндпоинт `/auth/login`; приоритет standalone→admin; cookie domain = `cookieStandaloneDomain ?? cookieDomain`.

## Проблема

Сейчас **две разные формы и два разных бэкенд-флоу**:

| | User | Super-admin |
|---|---|---|
| Фронт | `frontend/app/login/` (`LoginForm.tsx`) | `frontend/app/(admin)/admin/login/` (`AdminLoginForm.tsx`) |
| Бэк | `POST /api/v1/accounts/login` (`AccountsService.login`) | `POST /api/v1/auth/admin-login` (`AdminLoginService.login`) |
| Хеш пароля | **argon2id** (`PasswordService.verify`) | **bcrypt** (`bcrypt.compare`) |
| Строка User | `signupSource='standalone'` | `signupSource='crossmark'`, `role='admin'` |
| Cookie | `z_session` (domain = `cookieStandaloneDomain ?? cookieDomain`) | `z_session` (domain = `cookieDomain`) |

Оба выдают один и тот же cookie `z_session`. Но `accounts.login` **намеренно** не пускает админов (ищет только standalone-строку). Админ и standalone-юзер с одним email — это потенциально **разные строки** (разный `signupSource`, `@@unique([email, signupSource])`).

Итог для юзера: «убого» — две формы. Цель: один `/login` для всех.

## Подход (предлагаемый — additive, без миграции схемы)

**Единый бэкенд-эндпоинт** `POST /api/v1/auth/login`, который:
1. Нормализует email.
2. Пробует standalone (argon2id) → если успех, выдаёт session.
3. Иначе пробует admin (`role='admin'`, bcrypt) → если успех, выдаёт session.
4. Иначе — единый `LoginInvalidError` (защита от user-enumeration: всегда тратим время на фейковый verify обоих типов).
5. Возвращает `{ user, mustChangePassword, isSuperAdmin, role }` — фронт по этим полям решает редирект.

Cookie `z_session` — общий; для domain берём логику standalone (`cookieStandaloneDomain ?? cookieDomain`) как более общую (проверить, что admin-сессия валидна на этом домене для `/admin`).

**Единый фронт** `/login`:
- Одна форма (email + пароль).
- После успеха: если `isSuperAdmin || role==='admin'` — доступен `/admin` (редирект по желанию пользователя/возврату), иначе `/dashboard`.
- `/admin/login` → редирект на `/login` (back-compat алиас).
- `auth-context` / `admin.api` — свести к одному login-вызову.

## Фазы

### Фаза 1 — Backend: единый `POST /auth/login` `[x]`
Готово: `UnifiedLoginController` (`backend/src/modules/accounts/unified-login.controller.ts`, `@Controller('api/v1/auth')`) — try standalone (`AccountsService.login`, argon2) → try admin (`AdminLoginService.login`, bcrypt). Единый `LoginInvalidError`, throttle 5/15min, общий cookie `z_session` (`cookieStandaloneDomain ?? cookieDomain`). Возвращает `{ user, role, isSuperAdmin, mustChangePassword }`. Зарегистрирован в accounts.module. Старые `accounts/login` и `auth/admin-login` оставлены (deprecated).

### Фаза 2 — Frontend: единая форма `/login` `[x]`
Готово: `auth.api.ts` (`authApi.login`), `auth-context.tsx` (метод `login`), `app/login/LoginForm.tsx` (единая форма, редирект: безопасный `?next=` → super-admin `/admin` → `/meetings`). `app/(admin)/admin/login/page.tsx` → `redirect('/login?next=/admin')`. `loginStandalone` оставлен для обратной совместимости; `AdminLoginForm.tsx` больше не используется.

### Фаза 3 — Проверка `[ ]` (ручная, на стенде)
- `bunx tsc --noEmit` backend (0) и `bun run typecheck` frontend (мои файлы чисты).
- ОСТАЛОСЬ ручной прогон: вход обычного юзера, вход супер-админа (→ `/admin`), неверный пароль (одинаковая ошибка), валидность сессии для `/admin`, cookie-домен.

### Фаза 4 — Cleanup + docs `[ ]`
- (Позже, после стабилизации) удалить старые формы/эндпоинты.
- Обновить `second-brain/01_projects/` (auth/frontend-pages/contexts-hooks), `prod-deploy-log.md` (логин супер-админа теперь через `/login`).

## Открытые решения (нужно подтверждение)

1. **Архитектура**: единый бэкенд-эндпоинт `/auth/login` (рекомендую) **или** фронт пробует оба существующих эндпоинта по очереди (быстрее, но логика на клиенте)?
2. **Конфликт одного email** (есть и admin, и standalone строка): приоритет standalone → admin (рекомендую), или наоборот?
3. **Cookie domain**: ок ли использовать `cookieStandaloneDomain ?? cookieDomain` для обоих (нужно, чтобы `/admin` видел сессию)?

## Риски

- Security: любые правки логина требуют ручной проверки user-enumeration, throttle, валидности сессии для `/admin`.
- Cookie-домен: если admin и app на разных поддоменах — единый cookie должен покрывать оба.

## Итог

Реализовано: backend `/auth/login` + единая фронт-форма `/login`, `/admin/login` редиректит сюда. Осталось: ручная проверка на стенде (Фаза 3), позже cleanup старых эндпоинтов/формы + second-brain. Старые пути живы — откат тривиален.
