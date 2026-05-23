---
date: 2026-05-23
title: Закрытие 6 критических багов CRIT-1..CRIT-6 из delta-аудита
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md (источник списка)
  - second-brain/01_projects/conversational-channels.md (CRIT-5)
  - second-brain/02_architecture/age-deployment-decision.md (CRIT-6)
distilled: false
---

# Закрытие 6 критических багов CRIT-1..CRIT-6

## Что было поставлено

Владелец направил «Начни с CRIT-1 — 5 минут работы, мгновенная отдача». Из контекста (Шаг 1 в инструкции оркестратора) — закрыть все 6 критических багов CRIT-1..CRIT-6 из `plans/analysis/2026-05-22-code-reality-deltas.md` §Часть 2.

## Как решал

### CRIT-1 — `ENTITY_TYPE_VALUES` синхронизация
- **Файл:** `backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts`.
- Расширил массив с 7 до 14 типов: добавил `customer, vendor, document, goal, event, technology, metric`. Deprecated `client`/`custom` оставил для backward-compat (zod-валидация в worker'е, чтобы LLM-ответы со старыми типами не отбрасывались).
- Обновил текст системного промпта: явное описание каждого из 12 актуальных типов + явный запрет на возврат deprecated.

### CRIT-2 — fallback для `MeetingType.review`/`retrospective`
- Реальное состояние оказалось **лучше**, чем в delta: fallback `review/retrospective → team.buildPrompt` уже существовал в [index.ts:91-92](backend/src/modules/ai/services/prompts/index.ts#L91-L92).
- Корень проблемы — отсутствие test guard'а: в `prompts.spec.ts` перечислены только 9 из 11 значений `MeetingType`.
- Добавил `satisfies Record<MeetingType, true>` map → при будущем расширении enum TypeScript заставит обновить guard.
- Тесты: 27 → 36 passed.

### CRIT-3 — `Meeting.tenantId` NOT NULL
- Backfill **уже был написан** в `backfill-orgs-fase0.ts:103-110` и применялся.
- Создал `tighten-meeting-tenant-not-null.ts` — defensive guard перед prisma:push: повторный backfill + проверка 0 NULL-строк + отказ с диагностикой, если есть orphans.
- Schema.prisma: `Meeting.tenantId String? → String`, relation тоже NOT NULL.
- Repository.create: добавил обязательный `tenantId: string` в типы.
- Service.ts: helper `resolveDefaultTenant(userId, tx)` → owned Org → first Membership → throw. Применён в 2 местах создания (`createFromCrossmark`, `createForUser`).
- E2E тест `admin.e2e.spec.ts` обновлён: создаёт personal Org для тестового owner'а перед `meeting.create`.
- prisma:generate + typecheck + 53/53 unit-test'а — зелёные.

### CRIT-4 — Memory про Anthropic
- Memory `project_z_infra_and_ai.md` уже содержал ⅔ правильной формулировки («AnthropicService остаётся в коде, но не должен быть в default routes»).
- Уточнил: добавил явное упоминание `LlmProviderName.anthropic` и `PROVIDER_CAPABILITY.anthropic = sensitive` как кодовых артефактов + явный термин `DEFAULT_FALLBACK_CHAIN`.

### CRIT-5 — Два пути Telegram
- Создан раздел «⚠ Telegram — два независимых пути (CRIT-5)» в `second-brain/01_projects/conversational-channels.md`.
- Таблица различий: webhook URL, persistence model, tenant resolve, RBAC, наличие LinkCode flow.
- Явное правило выбора пути для будущих фич.
- Указаны зависимости в δ-2/δ-3.

### CRIT-6 — Apache AGE deploy checklist
- `CREATE EXTENSION IF NOT EXISTS age` уже был в `backend/scripts/postgres-init.sql:16`.
- Реальный пробел — отсутствие предусловия для managed Postgres (включение `shared_preload_libraries='age'` через UI кластера до запуска init-скрипта).
- Добавил предупредительный блок в `README.md` (раздел «1. Backend + Frontend»).
- Добавил пошаговый «Deploy checklist» в `second-brain/02_architecture/age-deployment-decision.md` + SQL-проверка.

## Что вышло (верификация)

- `bun run typecheck`: ✅ 0 errors.
- `bun run lint` по изменённым файлам: 0 errors, 12 warnings (все — pre-existing import-x/order и unused-disable, соответствующие конвенции существующих скриптов).
- `bunx vitest run` для затронутых модулей: 3 test files / 53 tests passed.

## Чему научился

1. **Delta-документы устаревают между аудитом и реализацией.** CRIT-2 уже был частично решён в коде (fallback есть), но без test guard'а. CRIT-3 backfill уже был, нужна только finalize-миграция. CRIT-6 SQL уже был, не хватало предусловия в docs. **Правило:** при работе по delta всегда сначала проверь актуальное состояние кода — не доверяй описанию «что не сделано», доверяй grep.
2. **Smart compile-time guards > runtime checks.** Для CRIT-2 `satisfies Record<MeetingType, true>` — нулевой runtime overhead, проверка на этапе TS. При добавлении нового MeetingType разработчик ОБЯЗАН обновить guard.
3. **Schema-tightening миграция стоит дорого.** `Meeting.tenantId String? → String` потребовала helper-метод в service, обновление repository типов, e2e-тест fix, верификацию dead-code branches. Минимум 4 файла на одно schema-изменение. Для CRIT-3 patch-script + tighten-script — разделены сознательно (backfill вызывается до и после deploy для гарантии).

## Prod-инструкция (если применять на prod)

1. Применить новый код (через docker compose up -d --build backend). Schema.prisma уже NOT NULL — но `prisma db push` пока **НЕ** запускать.
2. Запустить `cd backend && bun run scripts/tighten-meeting-tenant-not-null.ts`. Скрипт идемпотентен — он сначала делает defensive backfill, потом проверяет, что NULL-строк не осталось. При ошибке (есть orphan-meetings) — печатает их id+owner+title; нужно вручную решить (deletedAt=now() или вручную проставить tenantId).
3. После выхода скрипта с кодом 0 — запустить `bun run prisma:push` (применит NOT NULL constraint в БД).
4. Проверка: `SELECT COUNT(*) FROM "Meeting" WHERE "tenantId" IS NULL` → должно быть 0.
5. Для Yandex Managed Postgres — проверить `shared_preload_libraries` (если ставится впервые), см. новый чеклист в `age-deployment-decision.md`.

## Что НЕ сделано (для будущих заходов)

- Очистка dead-code веток `if (!meeting.tenantId) { ... }` (~10 мест в коде). TypeScript narrowing считает их unreachable, но визуальный шум остаётся. Отдельный мелкий sub-ТЗ или просто авточистка при следующем рефакторинге.
- E2E unification: `(admin)/admin/*` и `(authenticated)/admin/*` — это Шаг 2 в инструкции оркестратора, делается следующим до запуска α-10.

## Ссылки

- diff backend: `block-ingest.prompt.ts`, `prompts.spec.ts`, `meetings.repository.ts`, `meetings.service.ts`, `admin.e2e.spec.ts`, `tighten-meeting-tenant-not-null.ts`, `schema.prisma`.
- diff docs: `README.md`, `second-brain/01_projects/conversational-channels.md`, `second-brain/02_architecture/age-deployment-decision.md`.
- diff memory: `~/.claude/projects/c--work-z/memory/project_z_infra_and_ai.md`.
