# 2026-06-12 — Два ТЗ одной оркестрацией: помощник-в-каналах (Ф1–Ф6) + автономизация (W0–W4)

## Что было поставлено

Реализовать два готовых ТЗ скиллом tz-orchestrator, последовательность определить самостоятельно:
1. `plans/tz/2026-06-11-assistant-channels-telegram-max.md` — единый AI-помощник, Telegram/MAX как окна (6 фаз, один прод-релиз).
2. `plans/tz/2026-06-11-autonomy-remove-manual-confirmations.md` — убрать ручные подтверждения (W0–W4).

## Как решал

Ветка `feature/assistant-channels-and-autonomy` от svdev. 5 волн, 14 коммитов (`cb285350..530c6872`):
- **Волна 1 (5 кодеров ∥):** Ф1 стоп-молчание, Ф2 рендер eventType, Ф3 native-tools, Ф4 service-auth, W0 каденция. Перед волной — 5 Explore-агентов картографии (line-номера ТЗ устаревают — всё перечитывалось по символам).
- **Волна 2:** Ф5 (мост AssistantChannelBridge, память Redis per-binding).
- **Волна 3 (∥):** Ф6 whitelist+текст-confirm ∥ W1 conflict-arbiter. Конфликт общих файлов (llm-router union) развёл якорями: W1 у debate-блока, Ф6 у concierge-блока.
- **Волна 4 (∥):** W2 probe-гейт+OwnerResolver (+миграция enum) ∥ W3 curation-дефолты.
- **Волна 5:** W4 intake.
- **Production-ревью** отдельным агентом по полному diff → 1 CRIT + 2 HIGH + 4 MED + 5 LOW → фикс-кодер закрыл всё обязательное (f8849830).

## Что вышло

- typecheck/lint/build зелёные; **полный test:unit 4839 passed**; миграция применена к dev-БД.
- Ревью спасло релиз: **C-1** — Zod-схема `chat.answer` (`messageId.min(1)`) молча убивала ВСЕ confirm/quota/error-ответы моста (тесты не ловили — мокали sendChatReply целиком); **H-1** — прод-Telegram живёт на глобальном канале `tenantId=null`, строгая проверка binding делала solicited/critical мёртвым.
- Решения по ходу: intent `task` оставлен прежней веткой (у помощника нет инструмента — intake закрыт RBAC → ТЗ-заглушка create_task); evolving/escalate конфликты не авто-резолвятся (debate_vote_v1 не передаёт даты); Card AUTO-назначение убрано (ownerId = creator/namespace, @@unique).

## Чему научился

1. **Мокающие spec'и не ловят контрактные баги слоёв.** Мост ↔ registry: тест мокал sendChatReply — реальный validateEventPayload отверг бы payload. Урок: для каждого нового продьюсера событий — тест через РЕАЛЬНУЮ схему registry (добавлен в C-1-фикс).
2. **Глобальные каналы (tenantId=null) — постоянная ловушка conversational-слоя.** Любая проверка `channel.tenantId === args.tenantId` ломает прод-Telegram. В одном файле уже жили обе версии логики. Кандидат в `code-pitfalls.md` при дистилляции.
3. **Параллельные кодеры в одном файле работают**, если развести их по разным якорям заранее (union taskType: debate-блок vs concierge-блок) и явно запретить чужие зоны в промпте.
4. **`prisma migrate deploy` вместо `migrate dev` на дрейфующей dev-БД** — применяет pending без риска reset; заодно починил чужой дрейф (idea_block_primary_source).
5. **requiresConfirm по `method !== 'GET'` ловит read-only POST'ы** (find_free_slot) — класс UX-шума, закрыт маркером `ToolSchema.readOnly`.
