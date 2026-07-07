---
type: reflection
date: 2026-07-07
feature: task-stand cycle 2 — chat/telegram/bitrix task creation + embedding + tracker_event gate
distilled: false
---

# Стенд трекинга, цикл 2: почему задачи создавались только из встреч

## Что было поставлено
Владелец: «точно нужно починить дубли, эмбеддинг и всё; чтобы было стабильно; должно заходить из чатов,
видео-встреч, внутреннего/загружаемого чата, битрикса; чини и ещё раз прогоняй стенд; текст скорректировать».
И: «нахожу баги → сразу чиню → проверяю → коммит и пуш». Полный автономный цикл до идеального результата.

## Как решал (файлы, коммиты)
- **ef29da5d** — Ф1: регистрация `IssueEmbedWorker` + `IssueEmbedQueueService` (`ai/workers.module.ts`,
  `tracker.module.ts`). Были осиротевшими → `IssuesService.embedQueue`=undefined → `enqueueEmbed` no-op →
  `Issue.embedding` никогда не считался → дедуп/автозакрытие против AI-задач не работали.
- **dfcbbe35** — главный баг + сопутствующее:
  - `core-queue.service.ts`: **санитизация jobId** (`:`→`_`) в `enqueueSpecialistsCombined`. Корень: jobId
    строился из `externalId` источника; реальный chat-ingest кладёт `msg:<id>`, tracker — `tracker:issue:...`,
    bitrix — своё, все с `:`. **BullMQ отвергает custom jobId с `:`** → стадия specialists-combined (блок→задача)
    не запускалась → задачи из чата/telegram/bitrix/tracker НЕ создавались. Встречи работали, т.к. externalId=
    ULID без `:`. Вот почему «заходило только из встреч».
  - `block-distill.worker.ts`: **гейт tracker_event** из specialists-combined (события жизненного цикла задач
    issue.created/status_changed не должны переизвлекаться в новые задачи; до фикса jobId это де-факто держалось
    на падении enqueue — мой фикс открыл шум, гейт восстановил намеренное поведение).
  - `openai-chat.adapter.ts`: **откат форса tool_choice** на `'auto'` — прокси на thinking-моделях отвечает
    400 «Thinking mode does not support this tool_choice». Мой же Ф2 из ef29da5d был контрпродуктивен.
  - `conversational-ingest.adapter.ts`: `ingestFreeNote` принимает опц. `sourceExternalId` (default null).
  - `task-stand/inject.ts`: атрибуция задач по **родословной** `rawEvent→IdeaBlockEvidence→sourceBlockIds`
    (замена хрупкого content-match, который матчил setup-задачи); conversational ingest с реалистичным
    непустым sourceExternalId (иначе стенд не воспроизводил реальный чат).

## Что вышло (верификация — 3 прогона стенда на свежих тенантах)
- **Прогон 1** (до фиксов): 7/11 сценариев чата/telegram/email дали блок `action_item`, но 0 задач.
  Диагностика по логам → `enqueueSpecialistsCombined упал: Custom Id cannot contain :` ×38.
- **Прогон 2** (после jobId+revert+stand): **все 7 conversational-задач создались** (было 0); 0 ошибок jobId;
  AI-Issue получают embedding (2/2); tracker_event-дубль пойман `suggestedDuplicateOfIssueId` (дедуп ожил).
  Побочка: tracker-события setup-задач начали плодить intake (A-01 окно=14).
- **Прогон 3** (после гейта tracker_event): tracker_event-шум = **0**; 6 conversational-задач со структурным
  текстом; A-01=1; AI-Issue embedding 2/2; 0 ошибок jobId. Чисто.
- Текст описаний структурный, факты целы (Т11 держится): «Диме необходимо выполнить проверку бэкапов в течение
  недели. Поручение от Сергея.», «Срок — пятница, 10 июля 2026».
- typecheck/lint green; 22 юнита в 4 затронутых spec; build (DI) green.

## Чему научился (грабли — кандидаты в дистилляцию)
1. **BullMQ custom jobId НЕ может содержать `:`.** Любой jobId, собранный из внешнего id (`msg:`, `tracker:`,
   `resp:`), падает `Custom Id cannot contain :` и enqueue тихо теряется в `.catch(warn)`. Санитизировать jobId,
   настоящий id — в payload. Класс бага: «работает только там, где id без `:`» (встречи=ULID).
2. **Прокси на thinking-моделях (deepseek-v4-pro/flash) отвергает форсированный `tool_choice: {function}`**
   (400 «Thinking mode does not support this tool_choice»). Для json_schema→tool на thinking — только `'auto'`.
   `DeepSeekService` это уже ловит и откатывает; форсить не надо.
3. **Извлечение задач УЖЕ на deepseek-v4-pro** (block-ingest + knowledge-specialists-combined), не flash.
   «flash→pro» для стабильности было мимо — реальная нестабильность в другом (jobId, tool_choice).
4. **`resolveSourceDescriptorForBlock` возвращает null при пустом `sourceExternalId`** → block-distill не ставит
   specialists-combined. `ingestFreeNote` кладёт `sourceExternalId: null` → чистые free-notes (без канала) задач
   не создают. Реальные каналы (chat/bitrix) кладут непустой → у них другой баг (jobId `:`).
5. **Стенд обязан ingest'ить как реальный канал.** freeNote с `sourceExternalId=null` не воспроизводил ни путь
   реального чата, ни баг jobId. Репрезентативность ingest = часть валидности замера.
6. **Два конкурентных консюмера очередей портят замер дедупа** (block-distill concurrency=1 × 2 инстанса =
   гонка). На время прогона dev-backend останавливать, стенд сам поднимает конвейер через `withApp`.
7. **Атрибуция по родословной `IdeaBlockEvidence.rawEventId → sourceBlockIds` детерминирована** для всех каналов;
   content-match ложно цеплял setup-задачи.

## Не доведено (честно) → follow-up ТЗ (решение владельца)
- **Дедуп по title+description размывается описанием**: две «Обновить прайс на сайте» с разными описаниями дают
  cosine 0.60 < порога 0.88 → не ловятся как дубль. Механизм работает как настроено; менять вес заголовка/порог —
  риск over-merge → [[plans/tz/2026-07-07-dedup-title-embedding-tuning]].
- **Чистые free-notes (`sourceExternalId=null`) не создают задач** — нужно решение, должны ли; →
  [[plans/tz/2026-07-07-freenote-null-source-no-tasks]].
- Полный прогон 110 + петля — не делался (последовательный конвейер = часы).
