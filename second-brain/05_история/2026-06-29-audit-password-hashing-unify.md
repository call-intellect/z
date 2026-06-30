---
date: 2026-06-29
tags: [auth, security, password-hashing, argon2, bcrypt, refactor]
---

# Аудит и унификация хэширования паролей

## Что было поставлено
Провести аудит: правильно ли хэшируется пароль при регистрации, смене пароля и приглашении/создании пользователя; сопоставить алгоритм записи и проверки при входе. Затем — исправить найденное «в лучшем виде», **не сломав уже сохранённые в БД пароли** (без принудительной смены для пользователей и админа), и опубликовать отдельной веткой. Дополнительно — проверить реальную отправку письма через прод-SMTP.

## Аудит — что нашли
- Регистрация / смена / начальный / сброс пароля / приглашения — все на **argon2id** через `PasswordService` (или дубль argon2 в `org-invitations`), запись и `verify` при логине сопоставлены корректно.
- **admin-login жил на отдельной схеме bcrypt** (`AdminLoginService` + `set-admin-password.ts`), пиша в ту же колонку `User.passwordHash`. Две несовместимые схемы на одной колонке → риск локаута: `/accounts/me/change-password` (под `CookieAuthGuard`, без фильтра по роли) перезаписывал admin-хэш в argon2 → `bcrypt.compare` ломался.
- Дубль argon2-логики в 3 местах (`org-invitations`, два patch-скрипта).
- `patch-rehash-pending-invitations.ts` подтвердил исторический баг: когда-то `tempPasswordHash` писался простым sha256 (уже мигрирован).

## Как решал
- `PasswordService.verify` — **format-aware**: `$argon2*` → `argon2.verify`, `$2*` → `bcrypt.compare`. `needsRehash` — true для bcrypt/битых/устаревших argon2-параметров.
- Вынес `PasswordService` в общий `PasswordModule` (`backend/src/modules/accounts/password.module.ts`), импортнул в accounts/auth/orgs — без циклов (AuthModule `@Global`, PasswordModule ни от кого не зависит, кроме глобального config).
- `admin-login.service.ts`: убрал прямой bcrypt → `PasswordService.verify` (принимает оба формата) + **ленивая миграция** bcrypt→argon2 на успешном входе (best-effort, в try/catch, не валит логин). Dummy-hash для timing-защиты заменил на argon2.
- `accounts.service.login`: ленивая миграция при `needsRehash` (например, при усилении argon2-параметров), с сохранением `mustChangePassword`.
- `org-invitations.service.ts`: убрал локальный `hashPasswordArgon2` → `PasswordService`.
- `set-admin-password.ts`: новые админ-пароли — argon2id (bcrypt только как fallback чтения старых).
- Обновил specs: новые сигнатуры конструкторов + мок `needsRehash`; добавил тесты на bcrypt-verify и needsRehash в `password.service.spec`.

**Ключевая гарантия совместимости:** ни один существующий хэш не инвалидируется — bcrypt-админы и argon2-пользователи входят как раньше, миграция на argon2id происходит прозрачно при следующем логине.

## Что вышло
- typecheck: мои файлы чисто (полный `tsc` после `prisma:generate` оставил только «Cannot find module» для недоустановленных опциональных пакетов — exceljs/unpdf/fflate/pptxgenjs/@socket.io/redis-adapter, не мои файлы).
- lint: 0 ошибок.
- unit: 66/66 (`password`, `admin-login`, `org-invitations`, `accounts`).
- SMTP-smoke: реальное письмо на tozixwot@gmail.com через `mail.hosting.reg.ru:465 SSL` (no-reply@korateam.ru) — `250 OK`, accepted, 0 rejected. Креды рабочие.
- Ветка `fix/password-hashing-unify`.

## Чему научился
- Перед полным `tsc` в этом репо нужен свежий `prisma:generate` — иначе сыплется фантомный дрейф (несуществующие делегаты/поля). Сам `tsc --noEmit` на дефолтной куче падает по OOM → `NODE_OPTIONS=--max-old-space-size=8192`.
- `argon2.needsRehash` парсит дайджест как argon2 и бросает на чужом формате — обязательно гейтить по префиксу `$argon2id$` до вызова.
- Паттерн безопасной смены алгоритма хэширования без форс-ресета: format-aware verify + needsRehash + ленивый rehash на успешном входе.
