---
date: 2026-05-27
title: Concierge → dialog-layer integration
distilled: false
---

# Concierge → dialog-layer integration (ТЗ 2026-05-27)

## Что было поставлено

Пользователь спросил, как сейчас работает главный AI-агент в кабинете (Concierge): подмешивается ли суммаризация длинного диалога, переформулируется ли вопрос, расширяется ли он в 3 query для поиска по графу, подаются ли результаты поиска в финальный ответ.

Анализ показал, что **вся инфраструктура есть, но Concierge её не использует**:
- `concierge-conversation-summarizer.cron` пишет `ConciergeConversation.summary`, но `ConciergeService.process()` это поле игнорирует.
- `DialogService` (5-шаговый pipeline: contextualize → confidence → classify → multi-query + AnswerCache) работает в Clones V2 и chat-v2, но не в Concierge.
- `MultiQueryExpansionService` расширяет 1 вопрос в 3 переформулировки — тоже не в Concierge.
- Поиск по графу запускался только если LLM сама вызывала tool `search_knowledge` (один сырой запрос, без расширения).

Пользователь утвердил план: подключить Concierge к существующему `DialogService` (не строить новый pipeline) + начать читать `summary`. Дал право оркестрировать через агентов и запросил отчёт «когда полностью написано и протестировано».

## Как решал

7 фаз последовательно, агентами через Agent tool. Каждая фаза — отдельный subagent с конкретным брифом, factчек после каждой (агенты могут лгать про [x] — поэтому grep/typecheck/тесты сам). После зелёной фазы — атомарный коммит с явным `git add` по списку (не `-A`).

### Архитектурное решение
- `DialogService` инджектируется через `@Optional()` (паттерн ClonesService). Старые тесты совместимы, флаг отключён по умолчанию.
- Один фича-флаг `CONCIERGE_DIALOG_LAYER_ENABLED` (default false) включает всё сразу: summary + dialog-layer + pre-retrieval (компоненты сильно связаны).
- Pre-retrieval использует тот же `ToolRouterService` что и обычный tool-call — RBAC от userId без bypass'а, метрики бесплатно.
- ENV не добавлял в `EnvSchema` (Zod .merge depth → TS2589), читаю через `process.env` в `TypedConfigService.concierge` — следую существующему паттерну для `CONCIERGE_*`.

### Коммиты по фазам
1. `4a6e6ee` — фаза 1: summary в контекст, K_RECENT=6, `composeUserMessageForIteration` выделен в exported pure-функцию.
2. `8523851` — фаза 2: `@Optional()` `DialogService`, cache short-circuit, debug-блок `dialogLayer` в `toolCallsJson`. Корректировка ТЗ: поле `AnswerCacheEntry.text` (не `.answer` как было в первоначальном плане).
3. `a953c60` — фаза 3: `preRetrieve()` параллельно по `queries[]` через ToolRouter + `search_knowledge`, per-query timeout 3000ms, top-K cumulative 12, дедуп по id.
4. `4d7ac6e` — фаза 4: counter `concierge_dialog_layer_used_total{intent}`, counter `concierge_cache_hit_total`, histogram `concierge_pre_retrieval_hits_count`, pino debug-логи.
5. `9483dd7` — фаза 5: `buildSystemPrompt` вынесен в exported pure-функцию, snapshot-тесты, явный guard на legacy путь.
6. `55465b8` — фаза 6: создан `concierge-agent.md`, обновлены `module-map.md` и `ai-jobs.md`.
7. `bfdc9e7` — фаза 7: ENV в `prod-deploy-log` Шаг 1 (Kill-switch'и), закрытие ТЗ.

## Что вышло

Verify-чек на каждой фазе:
- `bun run typecheck` — зелёный
- `bun run lint` — 0 errors (1 pre-existing warning в чужом `telegram-proxy-health.cron.ts`, не трогал)
- Concierge unit-тесты: 25 passed (2 файла) — было 5 (только `service-map-generator.spec.ts`), стало 5 + 11 новых (4 snapshot + 7 unit), плюс +5 от Фаз 4-5 = 11 в `concierge.service.spec.ts` + 14 в существующих.
- Dialog-layer unit-тесты: 39 passed (9 файлов) — регрессий нет.

Push не делал — пользователь обычно подтверждает отдельно. 7 коммитов готовы к push'у на dev.

## Чему научился

### 1. Агенты регулярно подмечают ошибки в ТЗ-промпте
В Фазе 2 я написал агенту `dialogResult.cachedAnswer.answer`, а агент сам сверил с `answer-cache.service.ts` и использовал корректное `.text`. Без этой инициативы был бы баг в runtime. **Урок:** в брифе агенту явно прошу «сверь сигнатуры до использования» — это даёт право поправить меня.

### 2. Pure-функции вместо мокания DI
Дважды вынес статические участки кода (`composeUserMessageForIteration`, `buildSystemPrompt`) в exported module-level pure-функции. Это дало:
- Snapshot-тесты без NestJS DI / Prisma моков (тривиальные unit-тесты).
- Прозрачную проверку формата output'а (текст промпта LLM — критическое место для регрессий).
- Никаких изменений в публичном API класса — private методы класса делегируют pure-функциям.

### 3. Один фича-флаг для связанных компонентов лучше трёх
Изначально думал про раздельные флаги `_SUMMARY`/`_DIALOG_LAYER`/`_PRE_RETRIEVAL`. Один общий `CONCIERGE_DIALOG_LAYER_ENABLED` оказался правильнее — компоненты по факту работают как единый pipeline, раздельное включение создавало бы 8 сценариев теста вместо 2.

### 4. Многоволновая оркестрация работает
7 фаз × 1 агент = 7 раундов: бриф → агент → factчек → commit → следующий. Прерываний у пользователя не возникло, спасибо чёткому ТЗ и явным инвариантам в каждой фазе («не ломай Фазы 1-N», «не трогай Фазы N+1»). Время на одну фазу — 3-8 минут агентского времени + 1-2 минуты моего factчека.

### 5. Concierge оказался самым простым из AI-агентов Z для подключения к dialog-layer
Все нужные сервисы (`DialogService`, `MultiQueryExpansionService`, `AnswerCacheService`, `ContextualizerService`) уже были `@Global` и работали в Clones V2 / chat-v2. Concierge просто игнорировал их. Это типовая «инфраструктура есть, потребитель её не подключил» — стоит проверить, не игнорируют ли другие модули свои очевидные зависимости.
