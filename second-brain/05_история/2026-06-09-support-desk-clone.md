---
date: 2026-06-09
title: Встроенная служба поддержки + закрытый контур памяти + самообучающийся клон (Ф1–Ф4)
tags: [support-desk, knowledge-core, closed-contour, clone, learning-loop, prisma-migrations, ship-on]
distilled: false
---

# Служба поддержки с AI-клоном и закрытым контуром памяти (Ф1–Ф4)

## Что было поставлено

ТЗ [`plans/tz/2026-06-09-support-desk-clone-and-closed-contour-tz.md`](../../plans/tz/2026-06-09-support-desk-clone-and-closed-contour-tz.md) — вендорская служба поддержки на существующих кирпичах Z (трекер `Issue`, граф `KnowledgeGroup`, клон `clone-respond`, каналы `Notification`). Реализованы **Ф1–Ф4**:
- **Ф1** — деск: приём обращения клиента (cross-tenant в вендор-Org) → тикет=`Issue` + support-слой (SLA-таймеры, видимость `internal/external`, CSAT) + дублирование сотруднику в Telegram+почту. Человек отвечает.
- **Ф2** — закрытый контур памяти: синглтон `KnowledgeGroup(kind='support')`, «галочка сотрудника» = членство, **изоляция позитивным pre-filter'ом** (R-INV-1), ручной засев Q&A (холодный старт, Р-4).
- **Ф3** — клон-черновик + петля обучения: `support-clone-draft` (RAG из контура + few-shot) + `support-answer-critic` (groundedness, R-INV-5) + `support-edit-classify` (тип правки) → `SupportDraftOutcome` + `LlmPreferenceSample` + CSAT-гейт промоута в контур (R-INV-2).
- **Ф4** — ночной куратор контура: `support-contour-curate` решает keep/fix/merge/archive автоматически за debate-гейтом, только soft-archive (R-INV-6).

**Ф5 (авто-отправка клиенту) и Ф6 (тон-адаптер) — отложены.** Ф5 нужен отдельный owner-go (раскрытие AI, Р-5); Ф6 — отдельное ТЗ после накопления `tone`-пар.

## Как решал

Новый модуль `backend/src/modules/support/` (10 сервисов + 3 контроллера + 2 guard + 2 cron + промпты). Фаза за фазой, back-волна (Prisma+сервис+контроллер) раньше front-волны.

- **Ф1** (`356cc032` бэк + `d8ffbdf3` фронт) — миграция `20260609120000_support_desk_phase1` (support-поля `Issue`/`IssueComment` + `SupportSlaPolicy` + `IssueRating` + `enum KnowledgeGroupKind += support`); сервисы `support-intake`/`support-desk`/`support-access`/`support-sla`; `SupportAccessGuard`/`SupportAdminGuard`; `SupportSlaCron` (`*/5`); seed `seed-support-project.ts`; фронт `SupportWidget` + `/support/my-tickets` + `/support/desk`.
- **Ф2** (`4cb444ed`) — безусловный pre-filter `contourGroupId` в `ChatV2RetrievalService.collectPool` (все ветки пула + `expandViaGraph`); `support-contour.service.ts` (галочка add/remove + засев); CI-тест `contour-isolation.spec.ts`; seed `seed-support-contour-group.ts`.
- **Ф3** (`ae0fca83` фундамент + `24bf7e0f` генерация + `9d396cd4` обучение) — `support-clone`/`support-answer-critic`/`support-edit-classify`/`support-learning` сервисы; миграция `20260609130000_support_draft_outcome`; 4 taskType в `seed-llm-task-routes-support.ts`; `seed-admin-setting-support.ts` (пороги).
- **Ф4** (`14c4e6dc`) — `support-curator.service.ts` + `SupportCuratorCron` (`0 3 * * *`); миграция `20260609140000_support_curator_action`; куратор за `MultiAgentDebateService` verdict'ом, soft-archive only.

Все 4 seed'а зарегистрированы в `apply-prod-deploy.ts` STEPS (3 `seed-base` + 1 `seed-llm-routes` через alias `'support'`).

## Что вышло

- `bun run typecheck` / `bun run build` — зелёные.
- ~50 support-тестов в 10 spec-файлах (intake cross-tenant, access-фильтр клиента negative, isAgent guard, SLA, **contour-isolation** R-INV-1, critic→исход, 3 исхода обучения + classify + гейт промоута, curator: debate-gate / soft-archive only / merge / аудит).
- **R-INV-1** (изоляция контура) — CI-негатив-тест: ретрив с `contourGroupId` возвращает только support-блоки, не зависит от `KNOWLEDGE_ACCESS_ENFORCEMENT`.
- **R23** (куратор) — destructive только после verdict `MultiAgentDebateService`; **R24** — только soft-archive (`status='archived'`/`supersededAt`), без физического `delete`.

## Чему научился

1. **Фаза-инверсия enum'а — добавлять значение в самой ранней миграции, где оно нужно.** `KnowledgeGroupKind += support` логически относится к Ф2 (контур), но перенесён в Ф1-миграцию `_phase1` — иначе Ф1-код, ссылающийся на kind, не собрался бы. `ALTER TYPE ... ADD VALUE` не-транзакционна (норма для Postgres enum), `migrate deploy` исполняет отдельным statement'ом, повтор — no-op.
2. **Pre-filter контура — отдельный безусловный параметр, не через общий `accessWhere`.** Общий access-гейт (`buildAccessWhere`) живёт за флагом `KNOWLEDGE_ACCESS_ENFORCEMENT` (off/shadow/enforce). Изоляция поддержки обязана работать ВСЕГДА → отдельный `contourGroupId`, добавляемый в пул безусловно (во всех ветках + graph-expand). Иначе при `enforcement='off'` контур протёк бы. CI-тест с `enforcement='off'` это и стережёт.
3. **У `IdeaBlock` нет `embeddingHash` — идемпотентность засева через `externalSource`.** В схеме нет поля под хэш контента, поэтому дедуп пар Q&A и промоута клон-ответов сделан через `IdeaBlock.externalSource = '<provenance>:<hash>'` (`support-seed:<hash>` / `clone-accepted:<hash>`). Повтор той же пары — no-op по уникальному ключу.
4. **`Decimal(4,3)` Prisma пишется строкой `toFixed(3)`, читается `.toString()`.** `cloneConfidence`/`groundednessScore` — `Decimal(4,3)`: на запись `clamp01(x).toFixed(3)` (строка), на чтение из коммента `comment.cloneConfidence.toString()` (Prisma отдаёт Decimal-объект, не number). Прямой `number` в Decimal-поле — ловушка.

## Связанное

- Документация обновлена: `docs/operations/feature-flags.md` (2 kill-switch + entitlement + 2 крутилки + planned Ф5), `docs/operations/prod-deploy-log.md` (блок выката: 3 миграции, 4 seed, 2 cron, smoke), `second-brain/02_architecture/{module-map,data-model}.md`, `second-brain/01_projects/{ai-jobs,workers-queues,api-layer,frontend-pages,support-desk}.md`, реестр [[../04_не-сделано/README]].
- Профильная заметка — [[../01_projects/support-desk]].
