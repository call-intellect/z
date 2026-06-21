---
type: analysis
status: research-input
feature: provenance-source-traceability
date: 2026-06-20
snapshot_date: 2026-06-20
part: internal-baseline
related:
  - 99-synthesis.md
---

# Внутренний baseline: что по провенансу уже есть в коде Z

Источник — 5 код-разведчиков по реальному коду (Grep/Read, не догадки). Все факты — с `file:line`. Backbone подтверждён чтением `backend/prisma/schema.prisma` и `second-brain/03_processes/raw-event-to-graph.md`.

## 0. Опорная цепочка (backbone) — работает в проде

```
Source(type: meeting|chat|phone_call|bot|email|web_form|external|conversational)
  → RawEvent{sourceId, sourceType, sourceExternalId, payload inline|S3, occurredAt, idempotencyKey}
    → IdeaBlockEvidence{blockId, rawEventId, sourceType, quote(NOT NULL), startMs, endMs, sourceTimestamp}
      → IdeaBlock{evidence[], propertySpans{field,evidenceId,startMs,endMs}, primarySource: transcript|report}
```

- Единственный путь к **дословной цитате+таймкоду** — `IdeaBlockEvidence` (`schema.prisma:3523`).
- Канонический drill-down УЖЕ есть: `GET /knowledge/blocks/:id` (`backend/src/modules/knowledge-core/api/blocks.controller.ts:148-177`) отдаёт `evidence[] = {quote, startMs, endMs, sourceType, sourceTimestamp, rawEventId}`.
- Значит **любая сущность с `sourceBlockIds[]` дотягивается до цитаты за 1 «прыжок»**, но саму цитату в себе не несёт.
- Эталон «последней мили» (резолв цитаты с привязкой к встрече) — `chat-v2.service.ts:1028-1116`: block → первая `IdeaBlockEvidence(sourceType='meeting')` → `RawEvent.sourceExternalId`(meetingId) → `Meeting.title`, итог `{meetingId, meetingTitle, startMs, endMs, snippet}`.

## 1. Полнота провенанса по типам сущностей (ветка A1)

Прыжки до дословной цитаты: **0** = прямо в сущности · **1** = через блок→evidence · **2+** = через промежуточную сущность · **нет**.

| Сущность | Указатель источника | Прыжков | Legacy-пустые | Серьёзность разрыва |
|---|---|---|---|---|
| **IdeaBlockEvidence** | `quote, startMs, endMs, sourceTimestamp, rawEventId` (`schema:3523`) | **0** | нет (`quote` NOT NULL) | эталон |
| **IdeaBlock** | `evidence[]` + `propertySpans` + `primarySource` (`schema:3392,3440`) | 1 | `propertySpans` best-effort; `primarySource=null`→legacy | ок |
| **TableCell** | `TableCellProvenance{sourceType, sourceId, sourceLabel, sourceLink}` (`schema:11348`) | **0-1** (`sourceLink=/meetings/:id?t=872`) | `sourceLink=NULL` без таймкода | эталон (единственный готовый deep-link) |
| **ChatV2Message** | `citations Json[{blockId, meetingId, meetingTitle, startMs, endMs, snippet}]` (`schema:7997`) | **0** (snippet+таймкод в citation) | только `sourceType='meeting'` цитируется; chat/phone — нет | хорошо, но узко |
| **Decision** | `sourceBlockIds[]` (`schema:6232`); legacy `sourceIdeaBlockId/sourceMeetingId` | 1 | legacy nullable; новые стабильны (`specialist-3-3-decisions.service.ts:175,203`) | 🟡 |
| **Issue** (трекер) | `sourceBlockIds[]` (`schema:9208`), `linkedMeetingIds[]`, `meetingId` | 1 | `createdManually=true` дефолт → ручные/email/telegram пусты | 🟡 |
| **Task** (ai-workspace) | `sourceQuote`+`sourceStartMs/EndMs` (`schema:1789`), `evidenceBlockIds[]`, `TaskSource[]{quote}` | **0** до текста | 🔴 **meeting-path: `evidenceBlockIds:[]` всегда** (`meeting-report-fast.worker.ts:410,480`) | 🔴 |
| **Regulation/Instruction/Policy/Process/ProcessTemplate** | `sourceBlockIds[]` (`schema:5996,6050,6090,5704,5772`) | 1 | дефолт `[]`; ручные/импорт пусты | 🟡 |
| **Department/Role-подэлементы/Card/SprintHint** | `sourceBlockIds[]` (`schema:4740,5358,2435,9128`) | 1 | дефолт `[]`; до rollup пусто | 🟡 |
| **Entity** | **НЕТ** sourceBlockIds; только `IdeaBlockEntity{mentionContext}` (`schema:4099`) | 2+ | вся модель без указателя | 🟠 (терпимо для сущности) |
| **Theme** (кластеры) | **НЕТ**; связь через `ThemeIdeaBlock` join (`schema:4302`) | 2 | by design | 🟠 (терпимо для кластера) |
| **Notification** (probe/curation/conflict) | колонки `contextBlockId, contextCardId` (`schema:6998`) | 1 (когда заполнен) | 🟠 payload `probe.question` НЕ несёт blockId/quote (`event-payload.registry.ts:3-10`); `contextBlockId` ставится не везде | 🔴 (до пользователя не доходит) |
| **Concierge/orchestrator-ответ** | `citations[{type:'block', id, snippet}]` (`orchestrator.types.ts:95`) | 1 | 🔴 `snippet` — вывод LLM (`base-retrieval-strategy.ts:208`), НЕ из evidence → может расходиться с дословным | 🔴 |
| **CurationItem** | `resourceType+resourceId` → наследует от ресурса (`schema:3836`) | 2 | зависит от ресурса | 🟠 |
| **ConflictItem** | `evidence Json{blockIds,links}` (`schema:3929`) | 1 | manual-конфликты со скудным evidence | 🟠 |
| **Recognition («похвала»)** | `contextEntityType+contextEntityId` (`schema:10097`) — на производную сущность, НЕ на блок | 2-3 | прямого блок-линка нет (`recognition-formulate.worker.ts:130`) | 🟠 |

**Атрибуция автора — детерминирована (плюс):** `commitmentAuthorPersonId` (`schema:3416`) и `personSubjectIds` резолвятся БЕЗ LLM через `EntityResolutionService.resolveSubjectPersonId` (`entity-resolution.service.ts:1114`): `authorPersonId → authorEmail → authorUserId → speakerParticipantId → speakerName`. Только последний fallback (`speakerName`) fuzzy. В отличие от `decidedByPersonIds[]`/`commitmentRecipientPersonId` (fuzzy от LLM).

## 2. Верность источника на входе (ingest, ветка A2)

`IdeaBlockEvidence` структурно несёт ровно 6 полей провенанса (`schema:3523`): `rawEventId, sourceType, sourceTimestamp, quote, startMs, endMs`. **Нет** `messageId`, `speakerParticipantId`, `page`, `charOffset`, `chunkId` — всё, что не уложилось, для deep-link теряется. Таймкоды цитаты **возвращает LLM** (копирует из переданных в промпт сегментов `block-ingest.prompt.ts:421-429`), а не вычисляет код → точность deep-link = точность сегмента из `SegmentBuilderService`.

| SourceType | Что сохраняется для deep-link | Что теряется | Вердикт |
|---|---|---|---|
| **meeting** | реальные `startMs/endMs` (`segment-builder.service.ts:286`), `meetingId` в `sourceExternalId`, `quote` | `speakerParticipantId` в payload есть, но в промпт/evidence не пишется → спикер цитаты не восстановим | **точная цитата восстановима**; спикер потерян |
| **chat (chatbox)** | `messages[].at`, `channelType`, `ChatboxMessage.externalId` (уникален в БД) | 🔴 таймкоды **синтетические** `startSec:i` (индекс сообщения, `chatbox-ingest.service.ts:290`); `externalId` НЕ кладётся в turn → связь блок→сообщение теряется на ровном месте | **до сессии/дня грубо; до сообщения — потеряно (хотя данные в БД есть)** |
| **free_note (текст)** | `text`, `userId`, `metadata.source`; автор атрибутируется | `startMs=endMs=0` (заметка коротка — deep-link не нужен) | **восстановимо в пределах заметки** |
| **free_note (ГОЛОС)** | только **ASR-транскрипт** как `text` | 🔴 **аудио нигде не сохраняется**: буфер из Telegram → Vox ASR → выброшен (`telegram-bot.adapter.ts:622-656`); нет word-timings | **оригинал голоса невосстановим** |
| **document** | файл в S3 (`Document.s3Key`), `documentId` в `sourceExternalId`, `pageCount` | 🔴 парсер уплощает в **один плоский `text`** без границ страниц/смещений (`document-parser.service.ts`, `document.adapter.ts:196`); нет `page`/`charOffset` | **до файла целиком; до страницы/абзаца — потеряно** |
| **email** | `messageId, from, subject, date` | 🟠 тело под ключом `text`, а SegmentBuilder ждёт `fullText` → письмо падает в `JSON.stringify(payload)` одним зашумлённым сегментом (`segment-builder.service.ts:189` vs `email-fetch.service.ts:130`) | **грубо по messageId; цитата ненадёжна (баг класса «не тот ключ»)** |
| **phone_call** | — | enum есть, **адаптера нет** (ни один источник не порождает) | **не реализовано** |

**Вывод A2:** только `meeting` несёт настоящие таймцоды; для всех текстовых источников deep-link к фрагменту на текущей схеме `IdeaBlockEvidence` **невозможен в принципе** (нет `messageId`/`charOffset`/`page`). chatbox — самый обидный пробел: данные для deep-link есть в БД, но не прокинуты.

## 3. UI-инвентарь сегодня (ветка A3)

**Главный ответ: единого виджета «провалиться к первоисточнику» НЕ существует.** Ближайший — `AiCitation` (`frontend/src/ui/components/ai/AiCitation.tsx`), но он работает ТОЛЬКО внутри страницы встречи (seek по плееру того же экрана). Сквозная стена: **`MeetingResultPageReal.tsx:174-179` читает из URL только `?tab=`/`?report=` — `?t=`/`startMs` не парсится** → любая межстраничная «ссылка на источник» открывает встречу с 0:00.

**Что работает (6 несовместимых паттернов):**
- `AiCitation` (таймкод+спикер+цитата+«Перейти к моменту») — только in-page (`AiCitation.tsx:25`, `use-video-player.ts:8`).
- Задача на странице встречи: кнопка `{fmtTime(sourceStartMs)}›`→seek (`MeetingResultPageReal.tsx:1649`).
- Транскрипт: клик по таймкоду реплики→seek (`:1414,1510`).
- Регламент: панель «Источники» — цитата `«{quote}»` + `<Link href="/meetings/{id}">` (`RegulationsListClient.tsx:1214`; API `GET /regulations/:id/sources`) — **но без таймкода** (startMs не пробрасывается).
- Smart-таблица: `ProvenanceIndicator` popover «Обновлено из:» + `sourceLink` (`RowDetail.tsx:474`) — лучший по полноте, но без таймкода.
- Лента/дашборд: `<Link href="/meetings/{id}">` с подписью cite (`CoraFeedWidget.tsx:358`, `WhatWeLearnedWidget.tsx:142`).
- Поиск по памяти `MemorySearch.tsx:195`: цитата+таймкод, но **мёртвый текст** (нет id источника — навигировать некуда).
- AI-чаты (chat-v2/IssueChat/clone): блок «Источники: {meetingTitle}[timecode]+snippet» — **некликабельный `<div>`** (`ChatPanel.tsx:159`, `IssueChat.tsx:485`); единственное исключение — клик на ДОКУМЕНТ-цитату в `ChatV2Client.tsx:657` (но meeting-цитата рядом — мёртвая).

**Где «кнопки к источнику» НЕТ (данные есть, UI-провала нет):**
- **Decision** — `DecisionsListClient.tsx:451`: «Источники: N блок(ов)» мёртвым текстом; страница `/decisions/[id]` = тот же список. Лидер по разрыву.
- **Issue/Task в трекере** — `IssueSidebar.tsx`: 0 source-аффордансов (греп `meetingId|sourceBlockIds|/meetings/` = 0), хотя DomainModel несёт `meetingId/linkedMeetingIds/sourceBlockIds`.
- **Документ** — `DocumentDetailClient.tsx:211`: показывает весь текст, но нет якоря на фрагмент (нет `?block=`, scroll-to-highlight).
- **Чат** — `ChatDetailClient.tsx:381`: тред с per-message id, но нет anchor/scroll-to-message.
- **probe-вопрос / уведомления** — `CoraFeedWidget`/`NotificationsClient.tsx:280`: только текст, `contextBlockId` не рендерится (греп = 0).

## 4. API и deep-link-примитивы (ветка A4)

**Единого provenance-API НЕТ.** Греп `ProvenanceResolver|resolveProvenance|traceProvenance|ProvenanceChain` по `backend/src` = **0 совпадений**. Каждый потребитель резолвит ad hoc:
- regulations: свой `getSources` (sourceBlockIds→evidence→meeting) — `regulations.service.ts:349-406`;
- chat-v2: свой `resolveCitations`+`resolveDocumentSources` — `chat-v2.service.ts:1031-1196`;
- tables: своя модель `TableCellProvenance` + `sourceLink` — `tables.dto.ts:423`;
- decisions/issues: отдают только `sourceBlockIds[]`, резолв перекладывают на клиент.

Ключевые факты:
- `GET /knowledge/blocks/:id` и `/knowledge/search` отдают `evidence[]` инлайн, но **не резолвят `rawEventId`→meetingId/chatId/documentId** (клиент не построит deep-link без второго запроса).
- Самый глубокий лист — `GET /ingest/:id` (RawEvent payload / presigned S3) — **только owner/admin** (`ingest.controller.ts:106`); рядовой сотрудник до первоисточника не дойдёт.
- Транскрипт `GET /meetings/:id/transcript` — `turns[]` без стабильного `id` (ссылка только на `startSec`), **только host** (`transcript-cleaning.service.ts:38`).
- Единственный DTO с явным deep-link-полем — Smart-таблицы: `CellProvenanceDto.sourceLink: string|null` (`tables.dto.ts:407`). Паттерн к обобщению.
- chat-v2 citation несёт ИЛИ meeting (id+startMs — годен), ИЛИ document (только id); **нет citation для chat/voice-источника**.
- probe-DTO: `contextBlockId` **не выведен** ни в один probe-эндпоинт (`probe.controller.ts:99-236`), хотя на модели есть.
- Канонические задачи (tracker Issue): инлайн `sourceQuote/startMs/endMs` **потеряны** при миграции с legacy `tasks` (поля в БД есть, в `IssueResponseDto` нет).

## 5. Провенанс проактивных сущностей (ветка A5) — «мост недостроен с обоих концов»

**Главный вывод:** бэкенд почти всегда ХРАНИТ указатель (id блока/карточки), но НЕ гидрирует его в цитату/ссылку; фронт почти всегда НЕ рендерит даже тот указатель, что доходит. UI-каркас провенанса (`PendingActionCite{meetingTitle,timecode,url}`, `formatPendingCite()`) **полностью построен** на фронте, но бэкенд-провайдеры не наполняют `cite`.

| Проактивная сущность | Провенанс есть? | Где обрывается |
|---|---|---|
| **probe.question** | **НЕТ до пользователя** | payload несёт только `question`+free-text `context` (`event-payload.registry.ts:3`); `contextBlockId` доходит как голый ID, но in-app/боты его не рендерят (`NotificationsClient.tsx:270`, `telegram-bot.adapter.ts:1045`) |
| **specialist.probe** | ЧАСТИЧНО | payload несёт `cardId`+`blockIds[]` (`event-payload.registry.ts:57`), но ни один канал их не рендерит |
| **PendingActions** (`/actions`) | каркас есть, бэкенд не наполняет | очередь РЕНДЕРИТ «источник:…» (`ActionsClient.tsx:100,196,315,370`), но провайдеры `probe/conflict/curation/intake` НЕ ставят `cite`; единственная реальная цитата `task_closure.evidenceQuote` (`task-closure.provider.ts:106`) **теряется в маппере** (`pending-action.ts:205` `default:undefined`) и не выводится |
| **ConflictItem** | ЧАСТИЧНО | `evidence` = текст `oldStatement/newStatement` (`decisions.service.ts:281`), к фрагменту встречи не ведёт |
| **Recognition** | ЧАСТИЧНО | `contextEntityId` доходит end-to-end как данные (`contribution.ts:116`), но ни хелпера-резолва, ни рендера ссылки — plain text |
| **checkin.prompt** | N/A | плановый промпт, первоисточника нет by design |

## Файлы-якоря (для tz-author)

- `backend/prisma/schema.prisma` — модели (строки в таблицах выше).
- `backend/src/modules/knowledge-core/api/blocks.controller.ts:148` — универсальный drill-down блока.
- `backend/src/modules/knowledge-core/services/chat-v2.service.ts:1028` — **эталон последней мили** (резолв цитаты→встреча).
- `backend/src/modules/regulations/services/regulations.service.ts:349` — второй дубль того же резолва (кандидат на унификацию).
- `backend/src/modules/tables/dto/tables.dto.ts:407` — единственный `sourceLink` (deep-link-примитив к обобщению).
- `backend/src/modules/knowledge-core/workers/meeting-report-fast.worker.ts:410` — 🔴 потеря block-линка задач.
- `backend/src/modules/conversational/types/event-payload.registry.ts:3` — 🔴 probe без источника.
- `backend/src/modules/orchestrator/strategies/base-retrieval-strategy.ts:208` — 🔴 snippet от LLM, не из evidence.
- `frontend/src/ui/components/ai/AiCitation.tsx` — ближайший существующий UI-аффорданс.
- `frontend/app/(authenticated)/meetings/.../MeetingResultPageReal.tsx:174` — 🔴 плеер не читает `?t=`.
- `frontend/src/domain/pending-action.ts:12` — готовый фронт-каркас `cite`, который бэкенд не наполняет.
- `backend/src/modules/rbac/knowledge-access-resolver.service.spec.ts` — база для теста инварианта доступа.
