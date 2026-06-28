---
date: 2026-06-28
feature: unified-chat-kora
type: reflection
distilled: false
---

# Рефлексия — оркестрация единого чата Коры (Ф0–Ф7)

## Что было поставлено
Реализовать целиком ТЗ [plans/tz/2026-06-21-unified-chat-kora-tz.md](../../plans/tz/2026-06-21-unified-chat-kora-tz.md) (Ф0–Ф7, R1–R40) на ветке `feat/unified-chat-kora`, в режиме полной автономии (развилки решаю сам), затем локальные тесты → слияние в dev → БЕЗ push.

## Как решал
Оркестрация через `tz-orchestrator`: для каждой фазы — картография (Explore-агент/Bash, т.к. vexp free-капнут по backend и Grep/Glob заблокированы хуком), самодостаточный промпт кодеру (`general-purpose`), независимая приёмка (своя лестница typecheck/lint/build/vitest + re-Read), коммит по (под)фазам. Крупные фазы дробил: Ф1→a(данные/сервисы)+b(WS/relay/presence), Ф2.5→a(связка)+b(backfill), Ф3→a(тикет)+b(AI-логика), Ф3.5→a(ядро+relay-fix)+b(guest)+c(FE), Ф4→a(backend)+b(FE), Ф5→a(ingest/voice/meeting)+b(summary/ask/msg→task), Ф6→a(push backend)+b(RN scaffold), Ф7→a(retention/HR)+b(polls/huddles). Итого ~20 коммитов.

## Что вышло (верификация)
- **Backend:** vitest 6994 passed (+2 пре-существующих webhook-таймаута, доказано — файлы байт-идентичны dev), typecheck/lint/build зелёные.
- **Frontend:** typecheck/build зелёные, test:unit 628 passed (+4 пре-существующих Board/OrgBoard — доказано прогоном в git worktree на dev).
- **Живой запуск (главная ценность):** поднял feature-ветку локально (docker-инфра уже была). Поймал **реальный boot-баг** `RedisIoAdapter: client used before onModuleInit` — `connectToRedis()` в main.ts звался до инициализации RedisService → весь старт backend падал. Исправил (адаптер создаёт свои pub/sub ioredis из cfg.redis.url). После фикса: health 200, все messaging-эндпоинты в Swagger, экран «Сообщения» рендерится (табы/поиск/сортировка/empty-state).
- Слито в `dev` локально (`merge --no-ff`), origin/dev НЕ тронут.

## Чему научился
1. **Юнит-тесты + typecheck + build НЕ ловят порядок DI-bootstrap.** `useWebSocketAdapter`/`connectToRedis` в main.ts исполняется вне unit-покрытия и до onModuleInit провайдеров. Любой код, дергающий сервис-с-ленивым-клиентом на этапе bootstrap, надо проверять ЖИВЫМ запуском. `createApplicationContext` (которым гоняю dry-run backfill) тоже не ловит — он не вызывает WS-адаптер.
2. **Файловые миграции в этой среде:** `prisma migrate dev` падает на shadow-DB (нет AGE-расширения `ag_catalog`). Рабочий обход: schema → migration.sql вручную → `prisma db execute` → `migrate resolve --applied` → `generate`. На проде `migrate deploy` штатный. Применял так для всех 6 миграций фичи.
3. **Атрибуция «красных» тестов:** перед тем как чинить чужой провал — `git diff dev` по файлу + прогон в worktree на dev. Сэкономило время: 6 «провалов» оказались пре-существующими (webhook-таймаут, Board/OrgBoard undefined.length).
4. **Relay-утечка access:** общий `emitToRooms` слал тело в room независимо от access — для тикета ОК (клиент не член), но для external (клиент — член) утёк бы `internal`. Решил staff-под-room: `internal` эмитится только не-client членам.
5. **Транспорт-агностичность (R34):** push-каркас (APNs/FCM/RuStore) реальный, но no-op без боевых кредов — ядро не падает; FCM один из транспортов, не фундамент.

## Открытое (в [04_не-сделано](../04_не-сделано/README.md))
Captcha (owner-gated), боевые push-креды, нативная сборка/публикация kora-mobile, полная PII-анонимизация при delete, members-эндпоинт, in-memory курсор ленты, опц. дроп support-полей Issue.
