---
date: 2026-07-09
task: ChatBox → block-ingest end-to-end + эмбеддинги 768 + UI добавления провайдера
branch: ChatBox
---

# ChatBox block-ingest E2E: MiniMax по Anthropic-протоколу, эмбеддинги 768, форма провайдера

## Что было поставлено

Довести интеграцию ChatBox до конца: 563 RawEvent из переписок должны превращаться в IdeaBlock с embedding (768). Жёсткое требование владельца: никакого хардкода, всё через админку, без ENV-фолбэков на модели; провайдеры двух типов (OpenAI-/Anthropic-совместимые), схема ответа выбирается по типу провайдера. По ходу владелец добавил: сделать в форме добавления провайдера выбор «API format» + список моделей (как в референс-скриншоте).

## Как решал

Проблема оказалась ТРЕМЯ независимыми поломками, каждая из которых давала «IdeaBlock = 0»:

1. **Union-типы в JSON-схеме** (`2fbd351d`). Strict-валидатор MiniMax отдаёт 400 на `type: ['X','null']`. Probe-скриптом установил: `anyOf` и `type:'null'` MiniMax принимает. Все union-поля → `anyOf: [{...}, {type:'null'}]`, включая ВОЗВРАТ nullability полей, сплющенных прошлой сессией (промпт требует null для неназванных сроков/имён — схема обязана позволять).

2. **MiniMax OpenAI-эндпоинт не принуждает вывод к схеме** (данные, не код). После фикса схемы probe показал: HTTP 200, но модель отвечает СВОЕЙ структурой в markdown-fence — `response_format.json_schema` у MiniMax валидируется, но не enforce'ится. Решение ровно по директиве владельца «схема по типу провайдера»: провайдер `minimax` в БД переключён на `protocolKind='anthropic-messages'` + `baseUrl=https://api.minimax.io/anthropic` (то же поле, что редактируется в Z-Admin). Anthropic-адаптер конвертирует json_schema → форсированный tool-call (`buildAnthropicToolBindings`) — smoke дал строгий JSON с качественным извлечением (commitment «к пятнице»→2026-07-10 + адресат «Марина», blocker, decision). Маршрут: primary `minimax`/MiniMax-M3, secondary `llm-kora-team`/gemma. Ноль правок кода.

3. **53 каста `::vector(1536)` в 17 файлах src + 2 prod-скриптах** (`fcc595f5`, `332f7324`). Миграция 20260709000000 перевела колонки на 768, а raw SQL остался на 1536 → каждая запись embedding падала `22000: expected 1536 dimensions`. Плюс 3 гейта `length === 1536`, молча выключавшие запись. Фикс: безразмерный `::vector` (размерность энфорсит колонка — числа в коде нет вообще), гейты → `length > 0`, `?? 1536` → `?? 768`, 12 спеков переведены на 768.

Дополнительно (`2fbd351d`, `54bf9609`, UI-коммит):
- Крутилка `knowledge.blockIngestResponseMaxTokens`=8192 (registry+typed-config+сид): дефолт 4096 MinimaxService обрезал JSON у thinking-модели (окно с outputTokens=4096 ловилось в AiUsageLog).
- Крутилка `embeddings.providerRetryAttempts`=2 + retry-цикл в `EmbeddingFallbackService`: llm.korateam.ru под нагрузкой флейкает (timeout/socket-close), одна ошибка убивала embed при единственном активном провайдере.
- `SourceEpisode` для чатов: `resolveSourceSummaryText` для kind='chat' жёстко возвращал null — дописан `tryGetChatSummary` из `payload.rollingSummary` → блок «Суть переписки» + embedding эпизода.
- Форма провайдера в Z-Admin: подписи форматов с endpoint-путём («Anthropic Messages (/v1/messages)» и т.д.) + секция «Модели» с «+ Добавить модель» (в create-режиме модели создаются вместе с провайдером; критично для anthropic-протокола, где discovery недоступен).

## Что вышло (верификация)

- Smoke minimax-anthropic: tool_use, валидный JSON по схеме, 3 блока из 3 сегментов.
- Валидационная партия 10 событий: 10/10 `ingested`, 139 IdeaBlock — **все с embedding 768**.
- Полный прогон 563 событий: запущен, на момент рефлексии 65+ ingested / 196 блоков (все с embedding) / эпизоды с embedding пошли после фикса; идёт в фоне (concurrency=2, ~2 события/мин).
- UI (Playwright): карточка ChatBox — «Забрано 330 / Проанализировано 563 / Карточки памяти 134 / Ошибки 0»; /ideas — карточки рендерятся, поиск «производительность» фильтрует, деталка с «Уверенность Коры: 45%» и evidence.
- Backend: typecheck чист, профильные юниты зелёные (router 34, block-extraction 23, embeddings 34, свип-спеки 100+). Frontend: typecheck+lint чисты.
- chatbox-summary не задет: 563 done.

## Чему научился

1. **«Совместимый» эндпоинт ≠ эквивалентный.** MiniMax OpenAI-путь синтаксически валидирует json_schema (может 400), но НЕ применяет её к генерации. Проверять structured output надо не «HTTP 200», а «вывод парсится по схеме». Anthropic-путь (форс-tool) — надёжный способ structured output для Anthropic-совместимых провайдеров.
2. **Миграция размерности вектора — это код, не только DDL.** `::vector(N)` в raw SQL и `length === N` гейты не падают на ревью и молча гасят весь embedding-слой. Правило «только `::vector`» закреплено в code-pitfalls (EMB1).
3. **`bun run dev` НЕ ватчит backend** — час дебага «почему фикс не работает» из-за старого процесса. Проверять PID/`successfully started` после правок (DEV1 в code-pitfalls).
4. **Валидационная партия перед полным прогоном** (10 событий) окупилась трижды: поймала maxTokens-обрезание, эпизоды без embedding и флейк embedding-провайдера до того, как 563 события ушли в мусор.
5. Blanket-замена `1536→768` по спекам безопасна только с последующим чтением diff'а: тест «неверная размерность» мог потерять смысл (обошлось — там 3-мерный вектор).

## Хвосты (в реестре не-сделанного)

Цена MiniMax-M3 (costUsd=0) — завести в админке; ~35 событий обработаны до chat-summary-фикса (эпизоды без embedding) — reprocess; 6 pre-existing красных спеков; dev CSP без ws://localhost:4000.
