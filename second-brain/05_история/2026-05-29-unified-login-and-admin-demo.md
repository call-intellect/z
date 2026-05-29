---
type: reflection
date: 2026-05-29
distilled: false
---

# 2026-05-29 — единый логин + демо-кабинеты из админки (+ серия prod-фиксов)

## Постановка

Сессия началась с помощи по обновлению прода (влитые накануне фичи: paywall, демо-кабинет, онбординг v2) и переросла в две новые фичи:
1. Единый логин `/login` для обычных пользователей И супер-админов (было две разные формы — «убого»).
2. Создание демо-кабинета «ТехноСтрим» из Z-Admin (было только UI owner'а / CLI) + документ-инструкция.

## Что сделал

**Prod-фиксы (по ходу выкатки, отдельные коммиты пользователя):**
- GATE-скрипты `backfill-orgs-fase0` / `tighten-meeting-tenant-not-null` падали Prisma 7-валидацией `where:{tenantId:null}` на уже-мигрированной (NOT NULL) схеме. Добавил guard через `information_schema` → «обновление не требуется», exit 0.
- `frontend/bun.lock` тянул мёртвый `cdn.npmmirror.com` (404). Свап хоста на `registry.npmjs.org` (integrity-хеши те же).
- TS6059: `onboarding.service.ts` импортировал `scripts/demo-data/*` (вне rootDir `src`). Перенёс `demo-data/` в `src/modules/onboarding/`, поправил импорты в сервисе и `seed-demo-workspace.ts`.
- Аггрегатор `apply-prod-deploy.ts` вис на `seed-global-channels` и др. AppModule-скриптах: `NestFactory.createApplicationContext` без `process.exit(0)` → ioredis reconnect-шторм держит event loop. Добавил `.then(() => process.exit(0))` в 4 скрипта.
- `set-admin-password.ts` — добавил флаг `--super` (выставляет `isSuperAdmin=true`), чтобы поднимать супер-админа одной командой по email+паролю без ручного bcrypt+SQL.

**Фича 1 — единый логин (коммит `93f2e04`):**
- `backend/src/modules/accounts/unified-login.controller.ts` — `POST /api/v1/auth/login`: try standalone (`AccountsService.login`, argon2) → admin (`AdminLoginService.login`, bcrypt). Единый `LoginInvalidError`, общий cookie `z_session`, throttle 5/15.
- Фронт: `authApi.login`, `auth-context.login()`, единая форма `LoginForm.tsx` (редирект по роли), `/admin/login` → `redirect('/login?next=/admin')`.

**Фича 2 — демо из админки (коммит `ef0cd60`):**
- `backend/src/modules/admin/controllers/admin-demo.controller.ts` — `/admin/demo/*` под `SuperAdminGuard`, переиспользует `OnboardingService`. `OnboardingModule` в imports admin.module.
- Фронт: `admin-demo.api.ts`, страница `/admin/demo` (`DemoClient.tsx`), пункт навигации.

**Docs (коммит `4adc24d`):** `docs/guides/demo-workspace.md`, два плана в `plans/tz/`, second-brain (`auth-and-accounts`, `admin`, `api-layer`, `module-map`), `prod-deploy-log`.

## Что вышло

- Backend `bunx tsc --noEmit`: **0 ошибок.**
- Frontend `bun run typecheck`: мои файлы чисты; 2 пре-существующие ошибки (`SubscriptionClient`, `slider.tsx`) — Paywall-код из `b8b57d6`, `@radix-ui/react-slider` в package.json но не установлен локально.
- Запушено в `dev` (`665c2ea..4adc24d`). Ручная проверка логина на стенде — не делал (нет окружения), отметил в плане как Фаза 3.

## Чему научился

1. **Перед «починкой» уже-мигрированного прода — проверь фактическое состояние.** GATE-скрипты были не «сломаны», а просто неактуальны: схема уже NOT NULL. Урок: raw-SQL `IS NULL`-проба (как в `backfill-meeting-tenant-id`) безопаснее типизированного `where:{tenantId:null}`, который в Prisma 7 кидает валидацию на required-поле.
2. **Любой скрипт, бутающий `NestFactory.createApplicationContext(AppModule)`, ОБЯЗАН `process.exit(0)`.** BullMQ/ioredis после `app.close()` уходят в reconnect-шторм и держат event loop → процесс висит, аггрегатор виснет на `await proc.exited`. Зафиксировал правилом в `prod-deploy-log` (TL;DR агрегатора).
3. **«Две формы логина» = два разных хеша + две строки User.** Не поверхностный UI-дубль: standalone использует argon2id и `signupSource='standalone'`, admin — bcrypt и `role='admin'`; это РАЗНЫЕ строки (`@@unique([email, signupSource])`). Слияние = endpoint, пробующий оба пути, а не «одна форма к одному эндпоинту».
4. **Опечатка во флаге = тихий дефолт.** `--continue-on-fai` (без `l`) → `continueOnFail=false`, аггрегатор остановился на первом фейле. Длинные флаги легко промахнуться — проверять полностью.
5. **`bunfig.toml` registry не спасает от мёртвого CDN в lock-файле.** `bun install --frozen-lockfile` берёт URL тарбола прямо из lock; фикс должен перегенерить/переписать lock, а не только bunfig.
6. **Дев-машина с устаревшим Prisma client даёт ложные tsc-ошибки.** `sprintHint`/`tourProgress`/`board` «не существуют» — лечится `bun run prisma:generate`; на проде неактуально (образ генерит при сборке).

## Что осталось

- **Ручная проверка логина на стенде** (security): юзер, супер-админ → `/admin`, неверный пароль (единая ошибка), валидность cookie-домена для `/admin` (взял `COOKIE_STANDALONE_DOMAIN ?? COOKIE_DOMAIN`).
- **Cleanup** (Фаза 4 unified-login): удалить старые `/accounts/login`, `/auth/admin-login`, `AdminLoginForm.tsx` после стабилизации.
- second-brain `admin.md`/`api-layer`/`auth-and-accounts` обновлены; отдельного `frontend-contexts-hooks.md` в проекте нет.

## Прод-команды

Только пересборка — ENV/schema/seed нет:
```bash
git pull origin dev
docker compose up -d --build        # backend + frontend
```
Smoke и детали — `docs/operations/prod-deploy-log.md` → «🆕 2026-05-29 — единый логин + демо из админки».
