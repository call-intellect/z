---
type: tz
status: ready-for-code
feature: β-5 доделки — closing-loop RawEvent от ответа на probe
phase: beta-5
date: 2026-05-23
parent: plans/tz/2026-05-22-final-roadmap.md
predecessor: plans/tz/2026-05-21-sba-beta-5-specialist-3-6-ideas-and-layer6-probe.md
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md §β-5
---

# SBA β-5 доделки — closing-loop ответа на probe

## 1. Цель и контекст

Когда пользователь отвечает на probe-нотификацию (через любой канал — in-app / telegram_bot / max_bot / email), его ответ должен попасть обратно в knowledge-core как `RawEvent` с явной связью `respondsToNotificationId`. Сейчас цепочка обрывается: probe эмитится, ответ доходит до `probe-response.handler.ts`, но не создаётся `RawEvent` → следующая итерация probe-priority cron не «видит», что вопрос закрыт, и может задать его повторно.

## 2. Scope

**Входит:**
- В момент обработки `InboundMessage` типа `response` в `ConversationalIngestAdapter` (или эквивалентном handler'е): создать `RawEvent` с типом `notification_response`, поле `metaJson.respondsToNotificationId = inbound.replyToNotificationId`.
- Связать `RawEvent` с исходной `Notification` через FK или index'ируемое поле metaJson.
- Обновить `Notification.status = 'responded'` + `respondedAt = now()` (если ещё не обновлено в существующем handler'е — проверить).
- В `probe-priority.cron` (или его эквиваленте) — фильтр `WHERE Notification.status != 'responded'` для дедупа.

**Не входит:**
- Изменения схемы Notification (уже имеет `respondedAt`).
- LLM-обработка ответа — это делает downstream worker который читает `RawEvent`.
- UI изменения.

## 3. Принятые решения

1. **Поле для связи** — `RawEvent.metaJson.respondsToNotificationId` (String). Не делаем отдельный FK-столбец, т.к. RawEvent уже использует metaJson для типизированной информации; добавлять new column ради 1-к-1 связки избыточно.
   - **Почему:** RawEvent — append-only event log, расширение схемы под каждый специфический case ломает универсальность.
2. **Type для RawEvent.type** — добавить `'notification_response'` если ещё нет в enum (проверить `enum RawEventType`); иначе использовать существующий `'conversational_inbound'` с `metaJson.kind = 'notification_response'`.
   - **Почему:** минимальное вмешательство в схему. Кодеру решить по факту enum.
3. **Дедуп probe-priority cron** — добавить `WHERE n.respondedAt IS NULL` в SQL-выборку незакрытых probe-events. Не вводим новый enum-status `closed`.
   - **Почему:** `respondedAt` уже семантически = «закрыто пользователем»; повторяющийся nullable check дешевле migration на новый status.
4. **Idempotency** — если для одной Notification приходит 2 ответа, создаём 2 RawEvent (как обычные сообщения), но обновление `respondedAt` — только первое (через `WHERE respondedAt IS NULL`).
5. **Источник RawEvent.sourceType** — `'conversational'` (существующий SourceType).

## 4. Зависимости

- α-1 (готово) — ConversationalModule.
- β-5 базис (готово) — ProbeService, Notification, RawEvent.

## 5. Prisma-дельта

Изменений в `schema.prisma` НЕ требуется. Проверить через vexp:
- `enum RawEventType` — если нет `notification_response`, добавить (1 строка) ИЛИ использовать `conversational_inbound`.
- `Notification.respondedAt DateTime?` — должно существовать; если нет — добавить.

## 6. Patch / миграция данных

Нет. Существующие необработанные ответы остаются как обычные free_note без связи (deprecated). Опционально — backfill-script `backend/scripts/patch-backfill-notification-responses.ts`, который для последних 30 дней `Notification.status='delivered' + respondedAt IS NULL` ищет RawEvent от того же userId в окне ±5 минут и проставляет связь. **Не обязательно для DoD.**

## 7. REST API

Изменений нет — клиент уже отправляет `POST /api/v1/me/notifications/:id/respond` с body. Endpoint обновляет Notification и публикует `notification.responded` event (уже работает).

## 8. BullMQ worker'ы и cron'ы

- Расширить существующий `probe-priority.cron` — добавить фильтр `respondedAt IS NULL` в выборку.
- НЕ создавать новые очереди.

## 9. LlmTaskType регистрация

Нет.

## 10. RBAC ResourceType

Нет (использует существующий `notification.respond`).

## 11. Метрики Prometheus

- `probe_closed_total{tenant_top, source}` — counter, инкремент при `Notification.respondedAt` транзишн NULL→date.
- Cardinality: tenant top-100 + other, source ∈ {in_app|telegram_bot|max_bot|email|api} (фиксированный набор).

## 12. Frontend

Изменений нет.

## 13. ENV переменные

Нет.

## 14. Связь с существующим кодом

- `backend/src/modules/conversational/ingest/conversational-ingest.adapter.ts` (или эквивалент — найти через vexp по `replyToNotificationId`).
- `backend/src/modules/conversational/probe-response.handler.ts` (или эквивалент).
- `backend/src/modules/knowledge-core/workers/probe-priority.cron.ts` (или схожее имя — найти через vexp по `probe-priority`).
- `schema.prisma` поиск `enum RawEventType` и `model Notification`.

## 15. DoD

- [ ] При ответе на probe через любой канал создаётся `RawEvent` с `metaJson.respondsToNotificationId = notificationId`.
- [ ] `Notification.respondedAt` проставлен.
- [ ] `probe-priority.cron` не выбирает закрытые probe-events повторно (тест: probe → ответ → следующий запуск cron'а не эмитит тот же probe).
- [ ] Метрика `probe_closed_total` инкрементируется.
- [ ] `bun run typecheck` + `bun run lint` зелёные.
- [ ] Integration-тест проходит.

## 16. Тесты

- **unit:** `conversational-ingest.adapter.spec.ts` — мок Notification + InboundMessage{type:'response'} → RawEvent создан с правильным metaJson.
- **integration:** `probe-priority-cron.spec.ts` — создать probe → ответить → запустить cron → проверить, что probe не пере-эмитится.

## 17. Риски и mitigation

- **Race condition** при двойном ответе — решается WHERE `respondedAt IS NULL` в UPDATE.
- **Конфликт с уже существующей логикой** в probe-response.handler — кодер ОБЯЗАН прочитать существующий handler через vexp перед правками; если респ. handler уже создаёт RawEvent, изменить только metaJson-поле, не дублировать.
- **`.next/types/` кэш** — не применимо (only backend).
