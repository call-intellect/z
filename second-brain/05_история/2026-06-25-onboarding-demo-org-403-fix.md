---
date: 2026-06-25
feature: onboarding-demo-org-403-fix
branch: dev
commit: 40ce79bd
---

# Онбординг подвисал: опросник писал в демо-оргу → 403

## Что было поставлено
Владелец: пользователи жалуются, что онбординг («вопросы перед регистрацией») подвисает — кнопки перестают быть активными, где-то проскакивает, где-то зацикливается, в кабинет не пускает. Просьба: полная диагностика на проде (korateam.ru), воспроизведение через Playwright несколько раз, найти и устранить.

## Как решал
**Карта кода (фоновый Workflow, 5 суб-агентов):** welcome-flow + company-wizard + gate-routing + backend-contract → синтез. Вынес топ-подозреваемого: `getMe` выбирает демо-оргу как `currentOrgId`.

**Воспроизведение на проде (Playwright):** регистрация `tozixwot+kora-onb1@gmail.com` → POST `/accounts/register` 200 (пароль на почту, авто-логина нет).

**Доказательство (SSH → root → psql, read-only):**
- `ZDEMO_ORG_ID` = `cmpw9ktfd0001o8qlbgt27uwj` («Демо: ТехноСтрим», `isReferenceDemo=t`) — задан в проде.
- Свежий юзер имеет 2 membership: `owner` своей орги + `demo_observer` демо-орги.
- `getMe` ([accounts.service.ts:593](../../backend/src/modules/accounts/accounts.service.ts#L593)) считал `defaultMembership = demoMembership ?? firstOwnedMembership` → `currentOrgId` = демо, роль = `demo_observer`.
- **2 реальных аккаунта застряли** (demo-membership + `profileCompletedAt IS NULL`), вкл. клиента `callintellect24@gmail.com` (рег. 18.06, неделю не входил).

**Живой end-to-end (Playwright, выставил argon2-пароль своему тест-юзеру в проде — с явного разрешения владельца):** вход → гейт на `/onboarding/welcome/step-1`; `/accounts/me` вернул `currentOrgRole: demo_observer`, `currentOrgId: <demo>`; шаг 1 (роль, `PATCH /users/me`) прошёл; шаг 2 «Сколько вас в команде?» → `PATCH /orgs/<demo>/welcome` → **403 forbidden** «Действие доступно только владельцу» → страница не двинулась = «мёртвая кнопка». Фронт глотал 403 молча (`catch { setSaving(false) }`).

**Фикс (коммит `40ce79bd`):**
- Бэк: `getMe` → `firstOwnedMembership ?? demoMembership`. Своя орга всегда первична; согласовано с `subscription-activated.listener` (он и так отцепляет `demo_observer` при оплате). Чинит не только онбординг, но и любые записи в кабинете для затронутых юзеров; миграция БД не нужна — застрявшие разблокируются сами после редеплоя.
- Фронт: все 6 welcome-шагов показывают ошибку тостом (`humanizeApiError`) вместо молчаливой мёртвой кнопки + явное сообщение при ещё не загруженном профиле.

## Что вышло
- backend `tsc` 0 · frontend `tsc` 0 · `eslint` изменённых файлов 0.
- Баг воспроизведён живьём на проде и доказан в БД; root cause — одна строка приоритета в `getMe`.
- Запушено в `origin/dev`. Прод-операций кроме пересборки нет: `docker compose up -d --build backend frontend`.

## Чему научился
- **`getMe` — единственная точка авто-выбора `currentOrgId`** (демо-приоритет ломал любую запись, не только онбординг). `switch-org` — явный выбор юзера, не дефолт.
- **demo_observer как `currentOrgId` = яд:** все org-scoped мутации (`requireOwnerOrAdmin` + `DemoObserverGuard`) дают 403, а фронт-онбординг глотал их молча → «кнопка не активна / зацикливается».
- **SSH-helper для прода:** `docker compose exec -T` забирает stdin и съедает остаток скрипта из пайпа → запускать декодированный скрипт с `</dev/null`; пароль `su` — через pty (`ssh -tt` + printf), не через heredoc; argon2-хеш в скрипте — встраивать в node-код, а не через `process.argv` (`docker compose exec` не пробрасывает argv); psql `:'h'` интерполяция не сработала — инлайнить argon2-хеш одинарными кавычками (в нём нет `'`).
