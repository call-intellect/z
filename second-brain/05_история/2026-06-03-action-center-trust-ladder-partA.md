---
type: reflection
date: 2026-06-03
distilled: false
---

# 2026-06-03 — Action Center Часть A: Лестница доверия

## Постановка

Реализовать **Часть A «Лестница доверия»** ТЗ `plans/tz/2026-06-02-action-center-pending-confirmations.md` в модуле `backend/src/modules/curation` (ветка `feature/action-center-trust-ladder`). Цель — убрать безусловную человеческую блокировку критических типов карточек (`regulation`/`process`/`decision`): вместо «всегда deep review» — пер-типовые калиброванные пороги, AI-судья для провизорной канонизации, аудит-выборка и автоподстройка порогов с kill-switch'ем. Роль — оркестрация по фазам A0-A2 (агенты) + документирование в second-brain (эта сессия).

## Что сделал

Оркестрация по трём фазам (4 коммита):

- **A0 (`f9958d2`)** — триаж сравнивает калиброванную уверенность с пер-типовыми порогами `autoThresholdByType`/`deepReviewThresholdByType` (в `Org.curationSettings` Json, fallback на глобальные). Добавлен read-model `CurationService.getOverrideStats(tenantId)` + эндпоинт `GET /api/v1/curation/override-stats` (RBAC owner/admin) — доля override `(reject+approve_with_edits)/decided` per resourceType.
- **A1 (`281403a`)** — `CardVersion.trustTier` (enum `TrustTier {auto provisional human}`, `@default(human)` + `@@index([tenantId, trustTier])`). Критические типы в провизорной полосе (`effectiveConfidence >= provisionalThreshold`) вызывают `MultiAgentDebateService.judge({taskFamily:'curation-verify'})` (3 голоса разных провайдеров): accept-консенсус → провизорная канонизация без человека (`trustTier='provisional'`); reject/split/судья недоступен → deep `CurationItem`. **Ключевая развилка:** `MultiAgentDebateService` был зашит на семейство `decision-supersede`. Обобщил полем `taskFamily` (default `decision-supersede` — обратносовместимо, специалист 3-3 не тронут) + новое семейство `curation-verify` (3 cache-friendly промпта accept|reject, taskType `debate-curation-verify-critic/supporter/neutral` + зонтичный). Seed `seed-llm-task-routes-curation.ts` (cheap-цепочка deepseek-v4-flash→gpt-5.4-mini→qwen3.5:9b, без anthropic), зарегистрирован в `apply-prod-deploy.ts` STEPS (phase `seed-llm-routes`). Аудит-выборка 5% → лёгкий `CurationItem(triageReason.reason='audit_sample')`, не блокирует.
- **A2 (последний коммит)** — `CurationAutotuneCron` (`@Cron('0 3 * * *')`, `curation/workers/curation-autotune.cron.ts`): kill-switch (всегда активен) возвращает тип к человеку при `provisionalWrongRate > maxProvisionalOverride`; автоподстройка (opt-in `autotuneEnabled`, default false) двигает `autoThresholdByType` в пределах guardrail'ов. Сдвиги — через `updateSettings` + `AuditLogService.log`.

Документирование (эта сессия, worktree `C:\work\z-action-center`, только .md):
- `second-brain/02_architecture/knowledge-core.md` — раздел «Лестница доверия в курации».
- `second-brain/02_architecture/data-model.md` — `CardVersion.trustTier` + enum `TrustTier` + новые ключи `curationSettings`.
- `second-brain/01_projects/api-layer.md` — раздел Curation с `GET /override-stats`.
- `second-brain/01_projects/workers-queues.md` — строка `curation-autotune` cron.
- `second-brain/01_projects/ai-jobs.md` — семейство debate `curation-verify`.
- `docs/operations/prod-deploy-log.md` — запись «Накоплено к выкату» (Шаги 4/7/11/12 + заметка о backfill).

## Что вышло

4 коммита, тесты зелёные: A0 — 11, A1 — 363 в curation+ai, A2 — 35 в curation. `prisma db push` отложен (изоляция dev-Postgres через worktree, чтобы не задеть параллельную сессию). Документация second-brain и prod-deploy-log обновлены по чек-листу производных заметок (новая колонка БД → data-model + prod-deploy Шаг 4; новый cron → workers-queues + Шаг 12; новый seed → ai-jobs + Шаг 7; новый эндпоинт → api-layer + Шаг 12).

## Чему научился

1. **Worktree-изоляция для параллельных сессий.** Часть A делалась в отдельном worktree `C:\work\z-action-center` с собственным dev-Postgres → можно гонять тесты и не трогать `prisma db push` в общей БД, пока идёт другая сессия в `C:\work\z`. В следующий раз для параллельной работы над схемой — сразу worktree, push схемы откладывать на момент выката.
2. **Debate-сервис обобщаем по `taskFamily`.** `MultiAgentDebateService` оказался переиспользуемым: вместо копии под curation добавлено поле `taskFamily` с обратносовместимым дефолтом (`decision-supersede`). Вариант 1 (обобщить existing, не плодить копию) выбран с доказательством, что специалист 3-3 не ломается (default сохраняет старое поведение). Урок: перед копированием сервиса проверить, не параметризуется ли он одним полем.
3. **kill-switch всегда / autotune opt-in.** Защитный механизм (возврат типа к человеку при росте ошибок) должен работать без флага — это safety, а не фича. Автоподстройка порогов вниз/вверх — наоборот, под флагом (default off), потому что двигает поведение продукта. Разводить «защиту» и «оптимизацию» по разным флагам.

## Что осталось

- `prisma db push` (enum `TrustTier` + поле + индекс) — на момент выката на прод (через `migrate`-контейнер).
- Опц. будущий backfill `CardVersion.trustTier` (existing → `auto` при `createdByUserId IS NULL`) — отложен, дефолт `human` безопасен.
- Части B+ ТЗ Action Center (если есть) — вне этой сессии.

## Прод-команды

Полная актуальная инструкция — `docs/operations/prod-deploy-log.md` → запись «🪜 2026-06-03 — Action Center Часть A». Кратко diff:
- Шаг 4: `docker compose exec backend bun run prisma:push` (enum `TrustTier` + `CardVersion.trustTier` + индекс).
- Шаг 7: `docker compose exec backend bun run scripts/seed-llm-task-routes-curation.ts` (или через агрегатор `apply-prod-deploy.ts --mode update`).
- Шаг 11: `docker compose up -d --build backend`.
- Шаг 12: smoke `GET /api/v1/curation/override-stats`, grep `CurationAutotuneCron`, count taskType `debate-curation-verify-*`.
