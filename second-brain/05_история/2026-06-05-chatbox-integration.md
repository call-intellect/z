---
date: 2026-06-05
feature: chatbox-integration
distilled: false
---

# Рефлексия: интеграция с ChatBox (app.agent-lia.ru)

## Что было поставлено
Полная интеграция Коры с внешним сервисом ChatBox («Call Intellect: Чаты»): втянуть клиентские переписки из мессенджеров (Telegram/MAX/WhatsApp/виджет) в память компании, анализировать LLM, показывать в вебе, отвечать от имени менеджера. Меню «Чаты»→«Интеграции»→«Чат бокс», настройки синка, ручной/авто/realtime синк, мультимессенджер-объединение клиента, сегментация диалогов на сессии со связью «продолжение на следующий день».

## Как решал
ТЗ-first: изучил Public API ChatBox (OpenAPI + живые запросы с токеном), собрал факты в `plans/analysis/2026-06-05-chatbox-integration-api-facts.md`, закрыл 4 развилки с владельцем (1 воркспейс/org, зеркало+сессии, webhook+поллинг, автосвязка по email), написал ТЗ `plans/tz/2026-06-05-chatbox-integration.md` + orchestrator-prompt. Реализация — 10 фаз силами суб-агентов с независимой приёмкой каждой (картография → кодер → typecheck/lint/build/тесты + живой smoke → ревью → коммит по фазе).

Новый домен `backend/src/modules/chatbox/` (НЕ переиспользовал `conversational` — он про внутренние чек-ины сотрудников). Образец — модуль `sources` (AES-GCM шифрование токена). Поток: ChatBox API → `ChatboxSyncService` (upsert-зеркало) → `ChatboxSessionService` (сегментация по idle-gap, previousSessionId) → `ChatboxIngestService` (RawEvent sourceType=chatbox → существующий knowledge-core pipeline) → `ChatboxAnalyzeWorker` (LLM-summary). Realtime — inbound webhook (паттерн max-webhooks) + cron-поллинг фолбэк. Очереди chatbox.sync + chatbox.analyze. Фронт — слои ApiDto→DomainModel→UiModel, страницы /chats*, бейджи мессенджеров.

Коммиты: 6c817b42 (Ф1) → db576dea (Ф2) → dedfaa16 (Ф3) → 042c0bdf (Ф4) → 39c9d5d9 (Ф5) → 428dfe72 (Ф6) → ec5dc4dc (Ф7) → cad3c15e (Ф9 backend) → 5d8e37cd (Ф8) → 2f3fccf8 (Ф9 UI) + docs.

## Что вышло (верификация)
- 64 unit-теста модуля chatbox зелёные; backend typecheck/build зелёные; frontend build зелёный (роуты /chats, /chats/[id], /chats/integrations/chatbox, .../managers).
- Живые smoke против реального API + дев-БД: fullSync воркспейса (49 чатов, 1325 сообщений, 144 сессии, 44/45 client-identity склеены в customer — мультимессенджер работает), идемпотентность повторного синка, e2e очередь→воркер (job completed), webhook roundtrip create→list→delete, ingest закрытой сессии → RawEvent(chatbox, sensitive) идемпотентно, автосвязка менеджера по email (linkMode=auto).
- НЕ верифицировано живьём: LLM-summary (в dev нет LLM-ключа — best-effort, юнит-тесты), реальная отправка ответа клиенту (не шлём живым людям без разрешения владельца — юнит-тесты).

## Чему научился
- **ChatBox уже решает мультимессенджер-объединение** через `Customer(1)↔ChannelClient(N).customerId` — не изобретали склейку, переиспользовали внешний ключ. Урок: перед проектированием сложной логики проверь, не решена ли она апстримом.
- **Локальное окружение для smoke.** Корневой `.env` docker-ориентирован (хост `postgres:5432` не резолвится с хоста), backend/.env нет. Конфиг валидирует ВЕСЬ ENV при импорте — любой host-скрипт, импортирующий код приложения, требует полный набор ENV. Рабочий рецепт: dev-БД `z-dev-postgres` на `127.0.0.1:55435` (креды в `docker inspect`), Redis `127.0.0.1:56381`, собрать `/tmp/dev.env` с реальными DB/Redis + dummy для остального (URL валидные, секреты ≥32, encryption-key = base64 32 байт). Nest-bootstrap smoke (`createApplicationContext(AppModule)`) запускать ТОЛЬКО из `backend/` (иначе bun резолвит node_modules из cwd скрипта и падает на reflect-metadata/@nestjs).
- **Миграции без риска reset.** `prisma migrate dev` требует живую БД+shadow (хрупко при AGE/baseline). Безопаснее генерить миграцию schema-to-schema diff: снять «before»-копию schema.prisma → отредактировать → `prisma migrate diff --from-schema before --to-schema schema.prisma --script` (БД не нужна) → положить в папку миграции. Прод применит `migrate deploy` (уже автоматизирован). Локально проверять `--from-schema X --to-schema X` (no-op) перед использованием.
- `IngestService.ingest` сам публикует в core.raw-events и сам идемпотентен (idempotencyKey) — адаптеру не нужно звать enqueue; block-ingest подхватывает любой sourceType generic-путём, но payload лучше с `fullText` (рендер транскрипта).
- `AdminSettingsService`/`IngestModule`/`AiModule` — `@Global`, инжектятся без import в модуль.
