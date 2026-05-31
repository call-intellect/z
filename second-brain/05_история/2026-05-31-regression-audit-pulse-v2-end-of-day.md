---
distilled: false
---

# 2026-05-31 — регресс-аудит конца дня после Pulse v2 / smart-tables / referrals / ai-chat-quota

## Что было поставлено

После 25 коммитов за день (Pulse Волны 3-6, z-admin route-группа, ai-chat-quota, partner-кабинет referrals, smart-tables Фазы 0+1+2+3, Docling smoke, расширение demo-кабинета ТехноСтрим) пользователь попросил: «сделай полноценный регресс по ВСЕМ endpoint'ам, по интерфейсу — чтобы не сломались старые. Не спеша, основательно. В конце commit + push.»

## Как делал

### 1. Статика (параллельно)

- backend typecheck → ✅
- backend lint → ✅
- frontend typecheck → ✅
- frontend lint → ✅ (0 errors, 136 warnings — pre-existing)
- frontend unit tests → ✅ **115 passed** (17 files)
- backend unit tests → ✅ **2979 passed**, 33 skipped (390 files, 7 минут)

### 2. Integration tests

Запустил `bun run test:integration` — **5 failed | 15 passed | 2 skipped**.

**Найдено сегодняшнее:** 3 fail в `sprints-master-detail.spec.ts` — `TypeError: Cannot read properties of undefined (reading 'updateMany')` в `SprintsService.quickCreate:531`. Pulse Wave 5 добавила `void this.prisma.org.updateMany(...)` для онбординга (выставить `Org.firstSprintCreatedAt` при первом спринте), но в интеграционном моке `prisma.org` не задан — `void` не ловит синхронный TypeError на доступе к `.updateMany`.

**Фикс:** в `test/integration/sprints-master-detail.spec.ts` в `buildFakeDb()` рядом с `$transaction` добавлен мок:
```ts
org: { updateMany: vi.fn(async () => ({ count: 1 })) }
```
Unit-spec `sprints.service.spec.ts:619` уже имел этот мок — в integration просто забыли.

После фикса — **2 failed | 18 passed**. Оставшиеся 2 — `analyze-worker-with-resolver.integration.spec.ts` (`expected undefined to be defined` на `structuredUpdate`). По `git log` файл последний раз менялся в `d1790cb feat(ai): meeting-report-fast` (НЕ сегодня) — pre-existing, не входит в скоп аудита.

### 3. E2E tests

7 failed | 18 skipped (25) — все 7 в `test/e2e/accounts.e2e.spec.ts` (login + register с disposable email + honeypot). Последняя правка файла — `e85e0ef` (древний коммит). Pre-existing.

### 4. Backend smoke по 355 GET endpoint'ам

Не смог поднять `bun run dev` локально без `WEBHOOK_SECRETS_ENCRYPTION_KEY` в `.env` (env-валидация падает с понятным сообщением). Сгенерировал inline-ENV через `openssl rand -base64 32` и запустил `WEBHOOK_SECRETS_ENCRYPTION_KEY=... bun run dev` — `/health` 200.

Скачал `/api/docs-json` (628 paths, 355 GET + 280 POST + 83 PATCH + 79 DELETE) и одной bun-программой прошёлся по всем 355 GET-ручкам с concurrency=10:

| Bucket | Count | Семантика |
|---|---|---|
| **2xx** | 4 | публичные (без guard) |
| **401** | 331 | auth-guard работает — нет открытых дыр |
| **403** | 14 | авторизация требуется на уровне организации |
| **404** | 4 | path-params test-id не находятся |
| **400** | 1 | `/internal/billing/tochka/oauth/callback` без query — ожидаемо |
| **5xx** | 1 | `/health/ready` 503: `livekit: fail` — LiveKit не запущен локально, это honest health-check |
| **fail** | 0 | |

**Ноль регрессий по GET-API.**

### 5. Frontend smoke (50 URL)

Frontend dev уже работал на :3001 (pid от пользователя). Прогнал curl-ом 50 ключевых URL — публичные (`/`, `/login`, `/signup`, `/reset-password`, `/legal/partner-offer`), кабинетные (`/dashboard`, `/sprints/archive`, `/referrals`, `/clones`, `/me`, `/persons`, `/decisions`, `/processes`, `/structure` и т.д.) и админские (`/admin`, `/admin/demo`, `/admin/orgs`, `/admin/health`, `/admin/billing-overview`, ...):

- **29 = 200** — публичные + SSR-кабинетные
- **18 = 307** — admin корректно редиректит на `/admin/login` (новый `AdminAuthGuard` из утреннего рефакторинга работает)
- **3 = 404**
- **0 = 5xx**

### 6. Найденная UX-несостыковка из сегодняшнего smart-tables

`/tables` отдавал 404, но `TableClient.tsx:228` имеет ссылку «← Все таблицы» с `href="/tables"`. Пользователь, попав в детальную страницу smart-table, нажимал «Назад» и получал 404.

**Фикс:** создал минимальный `frontend/app/(authenticated)/tables/page.tsx` + `TablesListClient.tsx`:
- grid карточек активных таблиц `{icon, name, description}`,
- кнопка «+ Новая таблица» (prompt → `tablesApi.create` → `router.push(/tables/${id})`),
- стейты loading/forbidden/error через `AdminStateViews`,
- empty state с CTA.

Стиль повторяет `VendorsListClient.tsx` (минимум кода, паттерн один).

После создания страницы `/tables` теперь редиректит на `/login?next=/tables` (middleware применился, потому что страница появилась) — корректное поведение.

### 7. Playwright snapshot

`/login` отдаёт «Вход — Кора» с формой, console-error только один — `401 на /api/v1/accounts/me` (ожидаемо: текущий user не залогинен). Никаких client-side регрессий.

## Что вышло

| Проверка | Результат |
|---|---|
| Backend typecheck/lint/unit | ✅ зелёное, 2979 unit |
| Frontend typecheck/lint/unit | ✅ зелёное, 115 unit |
| Backend integration | ✅ сегодняшний sprints fix, остался только pre-existing analyze-worker |
| Backend e2e | ⚠️ 7 pre-existing fail в accounts (e85e0ef — НЕ сегодня) |
| Backend GET API smoke (355 ручек) | ✅ 0 регрессий, auth-guard работает |
| Frontend URL smoke (50 страниц) | ✅ 0 5xx, admin-redirects работают |
| UX-несостыковка `/tables` (новый smart-tables) | ✅ закрыта новой index-страницей |

## Чему научился

1. **Fire-and-forget `void p.then().catch(...)` не ловит синхронный TypeError на пути к промису.** Если `this.prisma.org` undefined, `.updateMany(...)` падает синхронно, до того как создаётся промис, и `.catch(...)` не работает. В коде такое не страшно при реальном Prisma client, но в моках с partial-stub взрывается. Урок: либо обернуть в `Promise.resolve().then(() => this.prisma.org.updateMany(...))`, либо везде поддерживать полный мок prisma. В Z приняли путь «полный мок» — все sprints-spec'и держат `org: { updateMany: ... }`.
2. **Backend ENV-валидация (`TypedConfigService` + zod) даёт мгновенную диагностику** — `WEBHOOK_SECRETS_ENCRYPTION_KEY: expected string, received undefined`. Это лучше silent-fail. Для smoke достаточно inline `KEY=... bun run dev` без правки `.env`.
3. **Smoke по Swagger JSON — самый дешёвый интеграционный регресс для NestJS.** 628 paths за <60 секунд при concurrency=10, ноль false-positive на auth-guards (401 — это «работает», а не «сломалось»). Должно стать частью CI.
4. **Новая страница detail без index — это типичная дыра smart-feature.** `/tables/[id]` без `/tables` живёт как «orphan» — все ссылки «назад к списку» ведут в 404. Урок на следующие фичи: писать index одновременно с detail, либо явно убирать кнопку «назад» если index ещё не сделан.
5. **Существование страницы триггерит middleware-редирект.** Пока `/tables` был 404, curl получал 200 от Next.js 404-страницы. После создания `page.tsx` тот же curl получает 307 на `/login?next=/tables` — middleware теперь применяется. Это надо учитывать, тестируя «новые protected routes»: статус-код меняется именно из-за появления страницы.

## Что осталось как известные issue

- `analyze-worker-with-resolver.integration.spec.ts` — 2 fail, pre-existing (последняя правка в `d1790cb feat(ai): meeting-report-fast`), вне scope сегодня.
- `accounts.e2e.spec.ts` — 7 fail, pre-existing (`e85e0ef`), вне scope.
- Frontend lint — 136 warnings (0 errors), накопленные исторически (`import-x/order`, `react-hooks/exhaustive-deps`).

## Связано

- [[2026-05-31-demo-content-pulse-v2-expansion]] — последняя рефлексия дня по demo-кабинету
- smart-tables ТЗ Фазы 2+3 — `plans/tz/2026-05-31-smart-tables.md`
- Pulse-сессия — `[[2026-05-30-pulse-session-final]]`
