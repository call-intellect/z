---
title: Bitrix24 как источник — анализ диалогов (Ф4) + страница/сопоставление (Ф5–Ф6)
date: 2026-06-17
tags: [bitrix, knowledge-core, llm, chatbox, sessions, frontend, sources]
---

# Bitrix24-источник: Ф4–Ф6 (анализ дня + UI + сопоставление)

## Что было поставлено
Продолжить ТЗ [`plans/tz/2026-06-17-bitrix24-source-sync.md`](../../plans/tz/2026-06-17-bitrix24-source-sync.md)
до закрытия всех пунктов плана:
- **Ф4** — AI-анализ диалогов по суткам: на закрытую сессию-день — ОДИН LLM-вызов
  (накопительное саммари + сообщения дня → `{daySummary, rollingSummary}`), мост в
  knowledge-core; «закрываем день» — ключевая механика владельца. То же доработать
  в ChatBox (rollingSummary).
- **Ф5** — страница источника (стекло) + визард домен→OAuth + сопоставление
  сотрудников + `ensureBitrixSource` + hardDelete-сброс + фронтовые api/domain.
- **Ф6** — статус-эндпоинт + RBAC/фича + тесты + verify.

## Как решал
**Ф4 (коммит `aa44f18a`).** Сначала выверенный разбор ChatBox-анализатора +
llm-router через Workflow (4 агента, structured-output) — он дал точную трёхслойную
схему (queue → worker → ingest) и ловушки. Реализовал по образцу:
- `bitrix/queue/bitrix-analyze.{queue,queue.service}.ts` + `bitrix-analyze.worker.ts`
  + `bitrix-analyze.cron.ts` (in-process в `WorkersModule`, дедуп jobId через `-`).
- `bitrix-ingest.service.ts`: `generateDayRollup` (1 LLM-вызов, **plain-text JSON +
  `validate`+retry** — надёжнее strict-json_schema на anthropic; переиспользовал
  seed-route `chatbox-summary`, `dataClass:sensitive`), `ingestSession` → `RawEvent
  (sourceType=bitrix)` с обязательным `fullText` + `transcript.turns[*].authorPersonId`
  из `BitrixUser.linkedPersonId`. Накопительное — на `BitrixDialog.rollingSummary`.
- `SourceType.bitrix` (миграция `20260617020000`, `ADD VALUE IF NOT EXISTS` +
  `SET search_path`). ChatBox-анализатор переведён на тот же rollup
  (`ChatboxChat.rollingSummary`).

**Ф5–Ф6 (коммит `40580414`).**
- Бэк: `ensureBitrixSource` (connect/claim) + деактивация Source в `remove`;
  `getStatus` (8 счётчиков+синки+сессии), `setAnalysisEnabled`; `listUsers`/`linkUser`
  (link/unlink/create) в `BitrixSyncService`; новые эндпоинты в контроллере;
  bitrix-каскад в `SourcesService.hardDelete`.
- Фронт: стеклянный `BitrixIntegrationClient` (зеркало одобренного ChatBox —
  `GlassCard`/`CardTitle`/`GRAD`/`STATUS_TONE`, синк по scope + поллинг + тумблер +
  счётчики), страница `company-admin/sources/bitrix/managers`, `bitrix.api.ts`+
  `domain/bitrix.ts`. OAuth-round-trip = persist (без sessionStorage-визарда).
- Тесты: `bitrix-sync.service.spec` (linkUser/listUsers), `…analysis.spec`
  (setAnalysisEnabled); починены mock'и `source` в install-спеке.

## Что вышло
- typecheck **0** (back+front), lint чисто, **142 unit-теста** (bitrix+chatbox+
  sources) зелёные. Этап 1 (Ф0–Ф6) закрыт.
- Попутно починен предсуществующий красный тест-долг (chatbox sync/cron/integration
  специ) — он маскировался багом ниже.
- **CRM посуточный дайджест вынесен в Ф4b** (отложено): нужна дельта по `DATE_MODIFY`
  + `modifiedAt`/курсор + решение владельца по глубине/периоду. Полусырой дайджест на
  «полный список каждый раз» выкатывать нельзя (Ship-On).

## Чему научился
1. **`tsc --noEmit` падает по OOM (exit 134, core dumped) и печатает 0 ошибок
   ложно-чисто** — из-за этого Ф2 «прошла чисто», а копились реальные ошибки.
   Лечится `NODE_OPTIONS=--max-old-space-size=8192`; проверять exit-код/хвост, не
   только `grep error TS`. (→ память `project-tsc-oom-false-clean`).
2. **`interface` НЕ присваивается к `Record<string, unknown>`** (нет неявной
   индекс-сигнатуры), а `type`-алиас — присваивается. Param-типы запросов Bitrix
   держим `type`-алиасами (иначе `callApi(params: Record<…>)` краснеет).
3. **Новый sensitive-taskType без seed-route уехал бы на kie/gemini** (anthropic нет
   в `DEFAULT_FALLBACK_CHAIN`) — для чат-данных переиспользовал уже засиженный
   `chatbox-summary` вместо заведения нового route. Дёшево и приватно.
4. **Сессии-сутки** («закрываем день») — единая механика для Bitrix и ChatBox: сквозной
   чат больше не висит открытым, каждый синк закрывает прошедшие сутки → сразу
   анализируем. Накопительное `rollingSummary` подмешивается в анализ следующего дня
   (никогда не гоним всю историю).
5. **`occurredAt=startedAt` стабилен** — idempotencyKey RawEvent не плывёт при
   дозаполнении сессии (дублей нет).
