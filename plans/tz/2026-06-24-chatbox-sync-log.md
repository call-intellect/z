---
type: tz
status: ready-to-implement
feature: chatbox-sync-log
date: 2026-06-24
owner: Tozix
relates_to:
  - backend/src/modules/chatbox/chatbox-sync.worker.ts
  - backend/src/modules/integrations-observability/integration-sync-log.service.ts
---

# Журнал синхронизаций ChatBox (видимый владельцу)

## Принцип
На странице интеграции ChatBox владелец видит **журнал запусков синхронизации**: когда запускалась (ручная / по расписанию-крон раз в сутки), статус, длительность, и что собрано (новых чатов, сообщений, клиентов, менеджеров, каналов, поставлено в граф), ошибка если упала. Данные уже пишутся — `chatbox-sync.worker` на каждый прогон вызывает `IntegrationSyncLogService.begin()/succeed(run, result)/fail()` → строка в `IntegrationSyncRun` (provider='chatbox', kind='sync', counts=result). Не хватает: счётчика сообщений в counts + read-эндпоинта истории + FE-панели.

## REALITY-CHECK
- `IntegrationSyncRun{ tenantId, provider, kind, scope, refId(jobId), startedAt, finishedAt, durationMs, status, counts:Json, error }` — есть ([schema.prisma:10702](backend/prisma/schema.prisma#L10702)).
- `chatbox-sync.worker.ts` пишет runs: incremental → scope='incremental' (это КРОН, раз в сутки, `chatbox-sync.cron`), иначе scope = all/customers/managers/chats (РУЧНАЯ). counts = результат sync (`{channels,customers,channelClients,members,chats,analysisEnqueued}`).
- counts НЕ содержит `messages` (число синканутых сообщений). `syncChats` возвращает `number` (число чатов), `syncMessages` возвращает число сообщений, но не агрегируется.
- `GET /chatbox/integration/sync/status` — только текущее состояние+тоталы, НЕ история. Нужен отдельный лог-эндпоинт.
- Без миграций/ENV (модель уже есть).

## Решения автора
| # | Решение | Почему |
|---|---|---|
| L1 | Триггер в DTO выводим из scope: `incremental` → 'auto' (по расписанию), иначе 'manual' | крон шлёт incremental, ручной — конкретный scope |
| L2 | Лог = только `kind='sync'` (запуски синхры). analyze-прогоны (per-session граф) не показываем — их вклад виден как `analysisEnqueued` в counts | «запуск синхры» = sync; analyze шумный |
| L3 | Добавляем `messages` в counts: `syncChats` начинает возвращать `{ chats, messages }`; callers складывают в result | владелец явно просил «новых сообщений» |

## Фаза 1 — counts.messages + read-эндпоинт + FE-панель `[ ]`
**Файлы:** chatbox-sync.service.ts (+spec), chatbox-integration.controller.ts (+ service/dto), frontend/src/api/chatbox.api.ts, frontend/app/(authenticated)/chats/integrations/chatbox/ChatboxIntegrationClient.tsx.

1. **BE counts.messages:** `syncChats(tenantId, opts?)` → возвращать `{ chats: number; messages: number }`; внутри `let messages = 0; messages += await this.syncMessages(...)`. Обновить вызовы в `fullSync`/`incrementalSync`/`syncByScope` (там `const chats = await this.syncChats(...)` → `const { chats, messages } = await this.syncChats(...)`), добавить `messages` в возвращаемый result-объект (рядом с `chats`). Обновить регресс-тест в chatbox-sync.service.spec.ts (`syncChats(since)` — теперь `const r = await service.syncChats(...); expect(r.chats).toBe(2)`).

2. **BE эндпоинт** `GET /api/v1/chatbox/integration/sync-log?limit=` (default 20, max 50), RBAC chatbox:read: `prisma.integrationSyncRun.findMany({ where: { tenantId, provider: 'chatbox', kind: 'sync' }, orderBy: { startedAt: 'desc' }, take: limit })`. DTO-элемент: `{ id, scope: string|null, trigger: 'auto'|'manual', startedAt, finishedAt: string|null, durationMs: number|null, status, counts: Record<string,unknown>|null, error: string|null }` (trigger = scope==='incremental'?'auto':'manual'). Реализуй в контроллере по образцу `sync/status` (inline) или вынеси в integration.service.

3. **FE:** `chatboxApi.syncLog()` (+типы `ChatboxSyncRunApi`). В `ChatboxIntegrationClient` — карточка «Журнал синхронизаций» (SWR): список последних прогонов — строка: дата-время (`startedAt`, ru-RU), тип (`trigger==='auto'?'По расписанию':'Ручная'`), бейдж статуса (success=ок/failed=ошибка/running=идёт/skipped=пропуск), длительность (`durationMs`→`N с`), собрано: «чатов {counts.chats} · сообщений {counts.messages} · клиентов {counts.customers} · менеджеров {counts.members} · в граф {counts.analysisEnqueued}» (показывать только присутствующие ключи), при failed — `error`. Пустое состояние «Синхронизаций ещё не было».

**Acceptance:** backend typecheck+build=0; FE lint+build=0; `GET /chatbox/integration/sync-log` в Swagger; counts новых sync-прогонов содержит `messages`; регресс-тест синка обновлён и зелёный; FE-панель рендерит лог (тип/статус/счётчики). Идемпотентность не применима (read). Без миграций.

## DoD
typecheck/lint/build зелёные; spec'и зелёные; second-brain api-layer (+sync-log эндпоинт) и frontend-pages (+панель) отметить; prod-операций нет (код). Рефлексия.

## Итог
(оркестратор)
