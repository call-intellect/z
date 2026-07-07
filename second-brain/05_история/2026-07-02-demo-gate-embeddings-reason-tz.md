---
title: Демо-орг LLM-гейт, поле «Причина» на эмбеддингах, ТЗ на CRUD провайдеров эмбеддингов
date: 2026-07-02
tags: [knowledge-core, worker-gate, admin-settings, embeddings, feature-flags, tz, dev-tooling]
distilled: false
---

## Что было поставлено (сессия-продолжение)

После чистого запуска (см. [[2026-07-02-fix-local-dev-preflight]] + wipe БД) владелец в dev наткнулся на три проблемы:
1. На странице `/admin/ai/embeddings` нельзя выбрать провайдер `ollama` — бэк требует «причину изменения (≥10 симв.)», а поля нет.
2. Эталонная Demo-Org «ТехноСтрим» (её ставит bootstrap `patch-create-reference-demo-org`) гоняет demo-встречи через block-ingest → жжёт токены DeepSeek в dev.
3. В админке нет CRUD провайдеров эмбеддингов (endpoint/ключи/модели/цены) — хочет как у LLM-провайдеров.

## Как решал

**#1 (`fix(admin)` d4370bdc).** Причина была UX-баг: `AdminSetting.set()` требует `reason` при `severity ∈ {high, destructive}` ([admin-settings.service.ts:163](../../backend/src/modules/admin/settings/admin-settings.service.ts#L163)); `embeddings.provider/model` = high, `dimensions` = destructive. Хук `useAdminSettingEditor` уже принимал `save(reason?)`, а страница вызывала `save()` без причины и не давала поля. Зеркалил готовый паттерн `DomainSettings.tsx` (флаг `needsReason` + `Textarea` + `isSaveBlocked`) в `EmbeddingsSettingsClient.tsx`.

**#3 (`feat(knowledge)` fcb4278a).** Нашёл готовый механизм — `WorkerOrgGate.checkOrThrow(tenantId, workerName)` ([worker-org-gate.ts](../../backend/src/modules/core-queue/worker-org-gate.ts)), который block-ingest уже зовёт до LLM. Добавил в него: демо-орг = `Org.demoWorkspaceSeededAt != null` (у Org НЕТ `externalSource`!) + крутилка `knowledge.demoOrgIngestEnabled` (default ON) через `resolveSync` (admin→ENV→code) → при OFF бросает `WorkerDisabledForOrgError` (ловит и уже стоящие задачи). ENV `KNOWLEDGE_DEMO_ORG_INGEST_ENABLED=false` в dev `.env`. Knob НЕ сидил намеренно: `resolveSync` отдаёт cache(admin) приоритетнее ENV — засеянный admin-ключ убил бы ENV-override. Очистил 7 demo-задач из `core.raw-events` (redis). Unit-тест `worker-org-gate.spec.ts` (6/6).

**#2 (`docs(tz)` 5a49f5f3).** Через скилл `tz-author` написал ТЗ `plans/tz/2026-07-02-embedding-providers-crud.md`. 4 HIGH-развилки закрыл с владельцем: новые модели `EmbeddingProvider/Model` (не переиспользовать `LlmProvider` — изоляция от chat-роутера); смена → баннер `needsReindex` + гард по dimensions (reindex-воркер = vNext); `isActive`+`priority` fallback; цены справочно (не биллинг).

## Что вышло

- Все проверки зелёные: frontend typecheck (#1), backend typecheck + boot + unit 6/6 (#3), gate-debug виден в логах теста.
- В dev demo-LLM больше не жжёт токены (0 block-ingest после гейта), реальные кабинеты и prod (default true) не затронуты.
- 3 коммита запушены `5826eec9..5a49f5f3`; docs (feature-flags + prod-deploy-log) обновлены.

## Чему научился

- **`Org` НЕ имеет `externalSource`** — демо-орг маркируется `demoWorkspaceSeededAt != null` (`externalSource='demo'` ставится на дочерние сущности через `markAllDemoEntitiesForTenant`, но не на сам Org). Проверять поля модели по факту в БД, а не по имени из соседних сущностей.
- **`resolveSync` = cache(admin) → ENV → default.** Если нужен ENV-override (dev), крутилку НЕ сидить в admin — иначе засеянный admin-ключ всегда победит ENV. Для dev-only рубильника: env.schema (чтобы `get()` вернул bool) + registry (валидация), но без seed.
- **`WorkerOrgGate.checkOrThrow` — единая точка пер-орг гейта воркеров** (`Org.workersEnabled` JSON + `deletedAt`); расширяется одним условием и покрывает все воркеры, которые его зовут.
- **Стек-факты для ТЗ отличаются от устаревшего skill-текста:** Prisma — файловые миграции (НЕ db push), воркеры in-process (НЕ отдельный процесс), embeddings уже на embeddinggemma 768 (НЕ text-embedding-3-small). Приоритет: реальный код > CLAUDE.md > текст скилла.
