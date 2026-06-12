---
date: 2026-06-10
tags: [knowledge-core, conversational, telegram, ingest, orchestration]
---

# Оркестрация двух ТЗ: мост чек-ин→граф + гейт намерения Telegram

## Что было поставлено
Реализовать код по двум ready-to-implement ТЗ (скилл tz-orchestrator):
1. `plans/tz/2026-06-10-daily-checkin-to-graph-bridge.md` — мост ежедневный чек-ин → граф знаний (4 фазы).
2. `plans/tz/2026-06-10-cabinet-fixes-master.md` §2 — гейт намерения перед созданием задачи в Telegram-боте (5 фаз).
Плюс: максимально закрыть code-only хвосты из реестра «не-сделано».

## Как решал
Ветка `feature/meeting-cabinet-fixes-2026-06-10` (продолжение cabinet-fixes, парный ТЗ привязан сюда). Картография: эталон `chatbox-ingest.service.ts` прочитал сам, Telegram §2 — фоновым Explore-агентом. Doc-фазу TZ#1 делегировал фоновому агенту, верифицировал грепом.

**ТЗ#1 (коммит `de288e8a` код + доки):**
- Ф1: `enum SourceType += daily_checkin`, рукописная миграция `20260610140000_..._daily_checkin` (`ADD VALUE IF NOT EXISTS`, отдельно от использования), `prisma:generate`.
- Ф2: `CheckinIngestService` — копия паттерна chatbox (lazy `upsertSource(sensitive)`, `transcript.turns` с `authorPersonId`, идемпотентность `sourceExternalId=checkInId`). Рендер `fullText` структурой (план/сделано/блокеры) или `rawResponseText` при пустой структуре. НЕ ингестит sentiment/qualityScore. 12 unit.
- Ф3: `CheckinGraphIngestListener` `@OnEvent('checkin.created')` (рядом с sentiment-worker), kill-switch `CHECKIN_GRAPH_INGEST_ENABLED`, метрика `z_checkin_graph_ingest_total{result}`, best-effort. 4 unit.

**ТЗ#2 §2 (коммит `57793d3c`):**
- Ф1: `classify.prompt` +`task`/`show_tasks` (enum в КОНЕЦ массива, ловушки), `DialogIntent`/`mapRawIntent`/`narrowToChatIntent`.
- Ф2: `classifyIntent` вызывается ДО task-handler в text+voice путях; гейты confidence; маршрут intent→действие.
- Ф3: `tryHandle`→`tryHandleStructural` (только reply/forward — байпас убран), публичный `handleCreateTask`. Убраны мёртвые `transcribeVoice`+VoxService из handler'а (голос теперь только через `handleVoice` адаптера — единая транскрибация).
- Ф4: честный ack самой маршрутизацией; метрика `z_bot_intent_classified += task|show_tasks`.
- Ф5: `handleShowTasks` + `IssuesService.listOpenForAssignee` (открытые = `state.category` НЕ completed/cancelled, по `assignees.userId`), рендер `renderMyTasksText` zero-button + HTML-escape. 57/57 тестов (handler+adapter+classifier), включая adapter-тесты маршрутизации (расширил `makeAdapter` мок-taskHandler+confidence).

## Что вышло
- typecheck + build + lint (0 ошибок) зелёные для обеих ТЗ; vitest 16/16 (checkin) + 57/57 (telegram).
- Прод-операций для §2 нет (миграций/ENV нет). Для checkin: новая ENV (kill-switch ON) + enum-миграция (авто migrate deploy) — diff в `prod-deploy-log.md`.
- Реестр `04_не-сделано`: обе строки → «реализовано, ждёт выката» + новая строка про replace-noop.

## Чему научился
1. **`occurredAt` для идемпотентного ingest бери из СТАБИЛЬНОГО поля, не из мутирующего.** ТЗ требовал `occurredAt=completedAt` (R8), но эмпирически `completedAt = new Date()` переписывается на каждом upsert (`daily-checkin.service.ts:316`), а `IngestService.ingest` при совпадении idempotencyKey возвращает существующий RawEvent и payload НЕ обновляет. Литеральное следование R8 дало бы дубль RawEvent на replace (нарушение R3 «ровно один»). Взял `dateLocal` (входит в unique-ключ, неизменен, семантически = рабочий день). Эталон chatbox решил так же (`startedAt`, не `endedAt`). **Урок: когда два требования ТЗ конфликтуют (R3 идемпотентность vs R8 occurredAt), проверь поведение эмпирически и сохрани сильный инвариант, задокументировав отклонение.**
2. **Анти-инъекция `applyInputGuards` бессмысленна без LLM-вызова.** ТЗ K-2 шаг 5 требовал guards, но у моста нет своего LLM-вызова (block-ingest гардит downstream), а pre-wrap data-маркерами задвоил бы их в текст сегмента (`segment-builder.tryGetFullText` берёт fullText как единый сегмент). Следовал эталону chatbox (сырой payload). **Урок: guards — это пара (system,user) для LLM; нет вызова — нет места для guards.**
3. **Чинить байпас правильно = разделить ответственность, а не добавить флаг.** `tryHandle` перехватывал всё → разбил на `tryHandleStructural` (reply/forward, до классификации) + `handleCreateTask`/`handleShowTasks` (по явному намерению). Заодно убралась дублирующая транскрибация голоса.
4. **Issue-исполнитель в трекере хранится по `userId`, не `personId`.** ТЗ Ф5 упоминал personId, но `IssueAssignee.userId` — фильтр по нему (`@@index([userId])`). Bot-binding даёт userId напрямую — Person резолвить не нужно.
