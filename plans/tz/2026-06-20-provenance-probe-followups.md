---
type: tz
status: ready-to-implement
feature: provenance-probe-followups
date: 2026-06-20
owner: Сергей (владелец)
relates_to:
  - plans/tz/2026-06-20-provenance-source-traceability-tz.md
  - plans/tz/2026-06-20-probe-smart-questions-module.md
  - plans/analysis/2026-06-20-provenance-source-traceability/
  - plans/analysis/2026-06-08-manual-document-upload-and-import.md
  - second-brain/05_история/2026-06-20-provenance-and-probe-smart-questions.md
  - second-brain/04_не-сделано/README.md
supersedes_partially:
  - "vNext-ТЗ provenance-source-traceability-wave2 (этот файл его материализует)"
---

# ТЗ — Доводка провенанса и probe: остатки v1 + вторая волна

> **Зачем этот документ.** Провенанс v1 (`provenance-source-traceability-tz`, 6 фаз Ф0–Ф5) и умный probe (`probe-smart-questions-module`, 6 фаз) РЕАЛИЗОВАНЫ и в `dev` (10 коммитов `fab510be`..`aa0a0310`, сессия 2026-06-20). При приёмке вскрылись **остаточные куски в коде**, которые не вошли в v1 — частью технический долг (быстро закрыть), частью «вторая волна», которую владелец сам отложил из v1 (решение Р-1). Этот файл собирает ВСЁ доделываемое в один контракт-first план, чтобы его без доработки взял другой агент (скилл `tz-orchestrator`).

> **Что НЕ переоткрываем.** Сам выбор архитектуры провенанса (единый `ProvenanceService` + компонент «Откуда это»), решения владельца Р-1…Р-4 из v1-ТЗ, выбор «прозрачного гейта ценности» probe — закрыты, доказаны в анализе. Здесь только ДОВОДКА.

---

## Карта блоков и приоритетов

| Блок | Фаза | Что | Тип | Оценка | Видимый эффект |
|---|---|---|---|---|---|
| **A — быстрые доводки** | A1 | Снимок цитаты в СПИСКАХ (preview в list-DTO + фронт) | долг | ~2-4 ч | цитата-источник видна прямо на карточке без клика |
| | A2 | chat-v2 → единый `ProvenanceService` (убрать копию резолва) | долг (архитектурный) | ~2-3 ч | ничего видимого; единый источник правды |
| | A3 | `specialist-3-4` (card) кладёт чистый `objectName` | долг | ~30 мин | вопросы по карточкам называют объект чисто |
| | A4 | email-ingest: `text`→`fullText` (не туда положили) | баг | ~1 ч | знания из почты перестают зашумляться |
| **B — вторая волна** | B1 | Deep-link к сообщению чата (chatbox `externalId`) | фича | ~4-6 ч | кнопка «к первоисточнику» из переписки ведёт в сообщение |
| | B2 | Block-линк задач из встреч (fast-путь) | фича | ~3-6 ч | у задач из встреч появляется прыжок к моменту |
| | B3 | Аудио голосовых `free_note` в S3 + проигрывание | фича | ~4-6 ч | «послушать оригинал» голосового источника |
| | B4 | Якорь к странице документа (page-aware парсинг) | фича | ~1-2 дня | прыжок к странице/месту в загруженном документе |
| | B5 | `phone_call` адаптер ingest | фича | ~1 день | звонки наполняют граф знаний + провенанс |

**Порядок реализации:** Блок A целиком (независимые фазы, можно параллельно A1/A3/A4, A2 отдельно) → Блок B по приоритету владельца (B1, B2 — на готовой v1-инфре; B3, B5 — есть заготовки S3; B4 — самый большой, требует решения по библиотеке).

**Что можно делать СРАЗУ без решений владельца:** A1, A2, A3, A4, B1, B2 (graceful), B3 (с дефолтным retention). **Требуют решения владельца перед стартом:** B4 (подход к парсингу), B5 (приоритет + провайдер), retention для B3 — см. раздел «Решения владельца».

---

## REALITY-CHECK (факты по коду 2026-06-20, verified картографией)

| # | Файл · якорь | Факт |
|---|---|---|
| RC-1 | `frontend/src/domain/decision.ts:57` / `:107` | `DecisionListItem` УЖЕ несёт `provenancePreview?: ProvenanceRef \| null`; маппер `mapDecisionListItem` ставит `null` (заглушка). У `RegulationListItem`/`Issue` поля НЕТ. |
| RC-2 | `backend/.../decisions/dto/decisions.dto.ts:90` (`DecisionListItemDto`), `decisions.service.ts:478` (`toListItem`), `:81-110` (`list`) | List-DTO решений НЕ содержит preview; `select`/маппер их не тянут. Аналогично `regulations.service.ts` (`regulationToListItem:952`, `processToListItem:976`, `policyToListItem:1000`, `instructionToListItem:1024`), `tracker/dto/issues/issue-response.dto.ts` (`IssueResponseDto`, у него уже есть `sourceBlockIds`). |
| RC-3 | `backend/.../knowledge-core/services/chat-v2.service.ts:556-584` | `ChatV2Service` НЕ инжектит `ProvenanceService`; `loadContextBlocks:984-1117` сам резолвит `RawEvent.sourceExternalId`→meetingId (`:1057`) + `meeting.findMany` title (`:1062`); `loadDocumentSources:1127-1198` — doc-источники. 8 spec-файлов конструируют `new ChatV2Service(`. |
| RC-4 | `backend/.../specialist-3-4-probe.service.ts:263` | `emit()` кладёт `contextCardTitle: args.message.slice(0, 100)` (обрезок), `objectName` НЕ кладёт. Эталон-как-надо — `specialist-3-3-probe.service.ts:58` (`objectName: stmt`). У 3-4 в `emit` доступен `args.cardId`/`args.message`, чистого имени карточки в emit НЕТ — нужно прокинуть от вызывающих методов. |
| RC-5 | `backend/.../ingest/adapters/email/email-fetch.service.ts:138` vs `knowledge-core/services/segment-builder.service.ts:191` | email-payload кладёт тело под ключ `text`; `SegmentBuilder.tryGetFullText` ищет `fullText` → промах → `buildFallback` `JSON.stringify`-ит весь payload (from/to/cc/subject) → письмо = один зашумлённый сегмент. |
| RC-6 | `backend/.../chatbox/chatbox-ingest.service.ts:296` / `:329` | таймкоды чата синтетические (`startSec: i`, `endSec: i+0.9`); `sourceExternalId: sessionId` (без messageId). `ChatboxMessage.externalId` ЕСТЬ (`schema.prisma:11730`). `IdeaBlockEvidence` (`:3525`) НЕ имеет поля под messageId/sourceExternalId. |
| RC-7 | `backend/.../workers/meeting-report-fast.worker.ts` (метод writeTasks, `evidenceBlockIds: []` хардкод) | fast-воркер создаёт `Task` с пустым `evidenceBlockIds`; **IdeaBlock в fast-пути НЕ создаётся** (греп пуст); `MeetingReportFastTaskSchema` (`meeting-report-fast.prompt.ts:35`) несёт только `title/assigneeRaw/dueDateIso/sourceQuote/confidence`. Task — legacy-сущность, маппинга Task→Issue нет. |
| RC-8 | `backend/.../document-parser.service.ts:81-144` (PDF через `pdf-parse`); `document.adapter.ts:202` (`sourceExternalId: 'doc:'+id`) | PDF/DOCX уплощаются в один blob; `pageCount` сохраняется в `metadata`, позиции внутри — нет. `Document` (`schema.prisma:5150`) без page/anchor-полей. doc-evidence: `startMs/endMs=null`, резолв по `quote` в `parsedText`. **Память:** `pdf-parse` заброшен, рекомендация `unpdf`/`officeParser` (см. analysis manual-document-upload). |
| RC-9 | `backend/.../telegram-bot.adapter.ts:650-689` (ASR), `:738` (free_note) | голосовое: download buffer → Vox ASR → текст → `free_note`; **аудио buffer выбрасывается** после ASR, в payload только текст. `S3Service` доступен (используется для документов в этом же адаптере). |
| RC-10 | `backend/.../ingest/adapters/phone-call/mango.service.ts:69-86` | `SourceType.phone_call` есть в enum (`schema.prisma:254`); `MangoAdapterService.downloadRecording` УЖЕ качает запись в S3 (`phone-calls/<tenantId>/<callId>.mp3`); **вебхук-контроллера и ingest-адаптера НЕТ** — RawEvent из звонка не создаётся. Эталоны адаптеров: `meeting.adapter.ts`, `report.adapter.ts`, `tracker.adapter.ts`. |

---

## Решения владельца (нужны ПЕРЕД фазами Блока B; для Блока A не нужны)

| # | Вопрос | Варианты | Рекомендую |
|---|---|---|---|
| Р-1 | **B4 (документы): подход к якорю на страницу** | (а) заменить `pdf-parse` на page-aware (`unpdf`) — хранить page-offset, прыжок к странице; (б) дешёвый компромисс — НЕ прыгать в страницу, кликом открывать документ целиком + подсветка quote поиском; (в) отложить B4 совсем | **(б) сейчас**, (а) — отдельным vNext. Page-aware парсинг — это 1-2 дня + смена библиотеки + миграция; «открыть документ + найти цитату» закрывает 80% ценности за часы. |
| Р-2 | **B3 (голос): хранение аудио** | retention аудио в S3: 30 / 90 / 365 дней / бессрочно | **90 дней** дефолтом, как крутилка `AdminSetting` `provenance.voiceNoteAudioRetentionDays` (getDynamic). Аудио тяжёлое — бессрочно дорого; 90 дней покрывает «вернуться к голосовухе». |
| Р-3 | **B5 (звонки): приоритет и провайдер** | делать сейчас / отложить; провайдер — Mango (заготовка есть) / другой | Делать **после B1-B3** (Mango-заготовка `downloadRecording` есть, но это полноценная фича на день). Если звонки сейчас не источник знаний для компании — отложить, оставив строку в `04_не-сделано`. |
| Р-4 | **B2 (задачи из встреч): глубина** | (а) graceful — оставить как в v1 (показываем `sourceQuote` без прыжка); (б) матчить задачу к IdeaBlock структурного пути; (в) создавать IdeaBlock в fast-пути | **(б)**: structured-путь (`meeting-analyze-v2`) уже создаёт блоки по той же встрече — сматчить задачу к блоку по `sourceQuote`/семантике дешевле, чем дублировать извлечение в fast. Если матчинг ненадёжен — (а) остаётся валидным fallback. |

---

# БЛОК A — быстрые доводки (технический долг v1)

## Фаза A1 — Снимок цитаты в списках (preview доезжает на карточку)

**Откуда.** v1 добавил колонки `previewQuote`/`previewSourceRef` (миграция `20260620113751`, backfill `backfill-provenance-preview.ts`) и фронт-поле `provenancePreview`, НО эндпоинты списков их не отдают → на карточке в списке нет цитаты без клика; колонки заполняются backfill'ом, но **никем не читаются** (мёртвый груз). См. v1-ТЗ К-1, RC-1/RC-2 здесь.

**Цель.** Список решений/задач/регламентов отдаёт `previewQuote`+`previewSourceRef`; карточка показывает короткий сниппет-цитату inline; полный дровер «Откуда это» — по клику как сейчас.

**Файлы (verified):**
- Backend Decisions: `decisions.service.ts` (`list:81`, `toListItem:478`), `decisions.dto.ts` (`DecisionListItemDto:90`).
- Backend Regulations: `regulations.service.ts` (`regulationToListItem:952`/`processToListItem:976`/`policyToListItem:1000`/`instructionToListItem:1024`), `regulations.dto.ts` (`RegulationListItemDto`).
- Backend Issues: `tracker/services/issues.service.ts` (`findAllAcrossProjects:500`), `tracker/dto/issues/issue-response.dto.ts` (`IssueResponseDto`).
- Frontend API: `decisions.api.ts` (`DecisionListItemApi:17`), `regulations.api.ts` (`RegulationListItemApi:20`), `tracker/issues.api.ts` (`IssueApi:9`).
- Frontend domain: `domain/decision.ts` (`DecisionListItem:46`, `mapDecisionListItem:93` — уже есть `provenancePreview`, ставит null `:107`), `domain/regulation.ts` (`RegulationListItem:60`, маппер `:112`), `domain/tracker/issue.ts`.
- Frontend UI: `DecisionsListClient.tsx` (рендер списка `:243-290`; чип/дровер уже в detail `:454`), `RegulationsListClient.tsx`, список задач.

**Что входит:**
1. В Prisma-`select` списков добавить `previewQuote: true, previewSourceRef: true` (для regulation — на всех 4 kind-ветках; для Issue — рядом с уже выбираемым `sourceBlockIds`).
2. В list-DTO (Decision/Regulation/Issue) добавить поля `previewQuote: string | null`, `previewSourceRef: <ProvenanceSourceRef-shape> | null` (Zod-схема + Swagger). Форма `previewSourceRef` = тот объект, что пишет `ProvenanceService.computePreviewSnapshot`: `{ evidenceId, blockId, sourceType, refId, startMs, deepLink, attribution, label }`.
3. Мапперы `toListItem`/`regulationToListItem`/… прокидывают поля в DTO.
4. Фронт `*.api.ts` — добавить поля в `*ListItemApi`. Фронт domain — добавить `provenancePreview?: ProvenanceRef | null` в `RegulationListItem`/`Issue` (у Decision уже есть); мапперы заполняют из `previewQuote`/`previewSourceRef` (а не null). Маппинг ApiDto→ProvenanceRef: переиспользовать существующий маппер из `domain/provenance.ts` (привести `previewSourceRef`+`previewQuote` к форме `ProvenanceRef`).
5. UI: на карточке списка под заголовком показать сниппет `provenancePreview.quote` (1-2 строки, `text-fg-tertiary`, italic, метка 〔цитата〕/〔вывод〕 из `attribution`); при `deepLink` — кликабельно ведёт на `/meetings/:id?t=<sec>`; при пустом preview — ничего (карточка создана вручную). Полный дровер «Откуда это» (`ProvenanceChip`→`ProvenanceDrawer`) остаётся как сейчас.

**Граница доступа (важно):** preview хранится денормализованно, БЕЗ фильтра прав на запись. Безопасность держится на том, что **списки уже отфильтрованы по правам** (`gateProjections`/`partitionProjectionsByAccess` — если сущность в списке зрителя, все её source-блоки ему доступны). Ревью: убедиться, что list-эндпоинты решений/задач/регламентов действительно проходят access-gating ДО отдачи preview (для regulations — да, `gateProjections`; для decisions/issues — проверить и при отсутствии гейта НЕ показывать previewQuote либо догейтить).

**Acceptance:**
- `bun run typecheck && lint && build` (backend+frontend) зелёные.
- `GET /api/v1/decisions` → элементы несут `previewQuote`/`previewSourceRef` (Swagger smoke); то же для `/regulations`, `/issues`.
- Карточка решения с источником показывает сниппет-цитату inline (qa); карточка без источника — без сниппета.
- Грер `provenancePreview: null` в `mapDecisionListItem` → заменён реальным маппингом.
- Тест маппера: ApiDto с `previewQuote`+`previewSourceRef` → `provenancePreview` непустой.

---

## Фаза A2 — chat-v2 на единый `ProvenanceService` (убрать 3-й дубль)

**Откуда.** v1 свёл к `ProvenanceService` 2 из 3 дублей резолва (tables, regulations); `chat-v2.loadContextBlocks` оставлен как «эталон последней мили» (acceptance v1 «≥2 из 3» выполнен). Остаётся параллельная копия логики «rawEvent→meeting→title» — при смене формата deep-link разъедется. См. v1-ТЗ RC-2, RC-3 здесь.

**Цель.** chat-v2 резолвит источник через `ProvenanceService`, без своей копии, без регрессии ответа чата.

**Файлы (verified):** `chat-v2.service.ts` (конструктор `:556`, `loadContextBlocks:984-1117`, `loadDocumentSources:1127-1198`, интерфейс `ContextBlock.primaryMeetingEvidence:179`); 8 spec-файлов `new ChatV2Service(`.

**Что входит:**
1. Инжектнуть `ProvenanceService` в конструктор `ChatV2Service` (он в том же `KnowledgeCoreModule`, цикла нет; можно `@Optional()` для безопасности старых тестов).
2. В `loadContextBlocks` заменить ручной блок (`rawEvent.findMany` `:1052-1059` + сборку `rawIdToMeetingId`) на `this.provenance.resolveByRawEventIds(tenantId, rawEventIds)`; из результата брать `refId` (=meetingId) для meeting-типа.
3. Для `ContextBlock.primaryMeetingEvidence` нужен **bare meetingTitle** (а сервис отдаёт `label`="Встреча «X»"). Решение (выбрать одно): (а) добавить в `ProvenanceSourceRef` опц. поле `title?: string` (bare) — чище всего, пригодится и другим; (б) chat-v2 оставляет свой `meeting.findMany` для title, но meetingId берёт из сервиса. Рекомендую (а).
4. `loadDocumentSources` — аналогично можно перевести на `resolveByRawEventIds` (тип `document`, `refId`=documentId); либо оставить (это не «дубль резолва meeting», а doc-специфика). Минимум — meeting-путь.
5. Обновить 8 chat-v2 spec'ов: добавить мок/реальный `ProvenanceService` в конструктор, БЕЗ изменения проверяемого поведения (ответ чата идентичен).

**Acceptance:**
- Грер ручного `prisma.rawEvent.findMany` в `loadContextBlocks` → удалён (резолв через `provenance`).
- Все chat-v2 spec'ы зелёные без изменения ожиданий; `bunx vitest run src/modules/knowledge-core/services` зелёный.
- typecheck/lint/build зелёные. Ручная проверка: ответ AI-чата по встрече по-прежнему несёт корректную цитату+таймкод.

---

## Фаза A3 — `specialist-3-4` (card) кладёт чистый objectName

**Откуда.** v1 Ф3 научил структурные probe-эмиттеры (3-1/3-3/3-6/3-9, block-ingest, process-template) класть чистое `objectName`. Эмиттер карточек знаний (`specialist-3-4`) не был в scope ТЗ → берёт имя обрезком сообщения. См. RC-4 здесь, probe-ТЗ R7.

**Цель.** Вопросы по карточкам (`card.*`) называют объект чистым именем.

**Файлы (verified):** `specialist-3-4-probe.service.ts` (`emit:243`, `contextCardTitle: args.message.slice(0,100):263`); эталон `specialist-3-3-probe.service.ts:58`.

**Что входит:**
1. В `emit()`-сигнатуру `specialist-3-4` добавить опц. `objectName?: string` (+ `objectKindRu?: string`), класть в payload `objectName` + `objectKindRu: 'карточка'`, `contextCardTitle` оставить (back-compat).
2. В публичных методах эмиттера (card.missing_owner / card.missing_deadline / card.outdated_summary / card.merge_suggestion) прокинуть чистое имя карточки. **Откуда брать имя:** в emit доступен `cardId`, но не имя — вызывающие методы имеют сущность card; передать `card.name`/`card.title`/`statement` (что есть у card; проверить модель). Если в точке вызова имени нет — сделать lightweight lookup по `cardId` ИЛИ оставить `objectName` пустым (промпт спросит по сути — это допустимо, как для «размытых» 3-2/3-5).

**Acceptance:**
- Грер `objectName` в `specialist-3-4-probe.service.ts` → присутствует.
- `bunx vitest run src/modules/knowledge-core` зелёный; typecheck/lint.

---

## Фаза A4 — email-ingest: тело письма доходит до сборщика (баг «не тот ключ»)

**Откуда.** Вскрыто при research провенанса (RC-5). email-payload кладёт тело под `text`, а `SegmentBuilder` ждёт `fullText` → промах → весь JSON письма уходит в LLM как шум → цитаты из почты ненадёжны, знания зашумлены. Влияет на КАЧЕСТВО графа из почты (не только провенанс).

**Цель.** Тело письма (subject + body) корректно доходит до `SegmentBuilder` как чистый текст.

**Файлы (verified):** `ingest/adapters/email/email-fetch.service.ts:138` (`text: parsed.text`), `knowledge-core/services/segment-builder.service.ts:191` (`tryGetFullText` ждёт `fullText`).

**Что входит (выбрать минимально-инвазивный путь):**
- **Рекомендуемый:** в `email-fetch.service.ts` payload дополнить `fullText: [subject, parsed.text].filter(Boolean).join('\n\n')` (subject в тело — улучшает извлечение). Ключ `text` оставить (back-compat для других потребителей). Тогда `SegmentBuilder.tryGetFullText` ловит `fullText` → один чистый текстовый сегмент вместо JSON-шума.
- Альтернатива: научить `SegmentBuilder` для `sourceType==='email'` читать `payload.text` — но это размазывает email-специфику в общий сборщик; хуже.

**Acceptance:**
- Грер `fullText` в `email-fetch.service.ts` payload → присутствует.
- Unit `segment-builder.service.spec`: email-payload `{subject, text}` → один сегмент с телом письма (НЕ `JSON.stringify` от всего payload). Добавить кейс.
- typecheck/lint/build.

---

# БЛОК B — вторая волна провенанса (фичи; владелец Р-1 отложил из v1)

> Общий принцип: каждый новый тип источника подключается аддитивно поверх готовой v1-инфры (`ProvenanceService.classify`/`buildDeepLink`/`resolveByRawEventIds` уже различают типы по `(sourceType, sourceExternalId)`).

## Фаза B1 — Deep-link к сообщению чата (chatbox)

**Откуда.** RC-6: знания из переписки имеют синтетические таймкоды (`startSec:i`) и `sourceExternalId=sessionId` без messageId → кнопка «к первоисточнику» из чата либо отсутствует, либо неточная. `ChatboxMessage.externalId` есть в БД, но не прокинут в evidence.

**Цель.** Клик по источнику-чату ведёт к конкретному сообщению переписки.

**Файлы:** `chatbox-ingest.service.ts:296` (turns), `:329` (sourceExternalId); `schema.prisma` `ChatboxMessage:11725` / `IdeaBlockEvidence:3525`; `ProvenanceService.classify`/`buildProvenanceDeepLink`; фронт-роут чата.

**Что входит:**
1. Прокинуть идентификатор сообщения в evidence: либо в `transcriptTurns` добавить `messageExternalId` и протащить в `IdeaBlockEvidence` (нужно новое поле `sourceMessageExternalId String?` в `IdeaBlockEvidence` + миграция), либо составной `sourceExternalId` в RawEvent (`chatbox` doc-стиль: `chat:<sessionId>:<messageId>`) — но RawEvent один на сессию, так не выйдет → **нужно поле в evidence**.
2. `ProvenanceService.classify`/`buildDeepLink`: для `sourceType==='chatbox'`/`chat` строить deep-link на сообщение, напр. `/chats/<sessionId>?m=<messageExternalId>` (согласовать с реальным фронт-роутом чата — найти, есть ли страница переписки; если нет — это часть фазы или graceful «открыть сессию»).
3. Заполнять `startMs` реальным временем сообщения (`ChatboxMessage.externalCreatedAt` относительно начала сессии) вместо синтетического индекса — опц. улучшение.

**Решение по объёму:** если фронт-страницы переписки с якорем на сообщение нет — B1 распадается на (B1a) прокинуть messageId в evidence + (B1b) сделать страницу/якорь чата. Минимум ценности: deep-link на сессию переписки.

**Acceptance:** evidence из chatbox несёт messageId; `ProvenanceService.resolve` для блока из чата отдаёт `source.deepLink` на сообщение; миграция аддитивна; дровер «Откуда это» ведёт в переписку.

## Фаза B2 — Block-линк задач из встреч (fast-путь)

**Откуда.** RC-7 / v1-RC-5: задачи из быстрого отчёта (`meeting-report-fast.worker`) несут только `sourceQuote`, `evidenceBlockIds:[]`, IdeaBlock в fast-пути не создаётся → у задач из встреч нет прыжка к моменту (в v1 — graceful: показываем цитату).

**Цель.** У задачи из встречи появляется привязка к блоку-источнику → кнопка «к моменту».

**Зависит от Р-4** (подход). Рекомендуемый (б):
1. Structured-путь (`meeting-analyze-v2`) создаёт IdeaBlock по той же встрече. Добавить шаг матчинга: для задачи с `sourceQuote` найти IdeaBlock этой встречи с наибольшим совпадением цитаты (точное вхождение / эмбеддинг-близость) → записать `Task.evidenceBlockIds=[blockId]`.
2. Где задача показывается с провенансом (`ProvenanceService.resolve('task', ...)` уже читает `Task.evidenceBlockIds`) — прыжок заработает автоматически.

**Acceptance:** для задачи с матчем `evidenceBlockIds` непустой; `/provenance/task/:id` отдаёт deep-link к моменту; при отсутствии матча — graceful (как сейчас, `sourceQuote` без прыжка). Идемпотентность матчинга.

## Фаза B3 — Аудио голосовых `free_note` в S3 + проигрывание

**Откуда.** RC-9: аудио голосового сообщения выбрасывается после ASR; голосовой источник показывает только текст. Зависит от Р-2 (retention).

**Цель.** Аудио сохраняется в S3, у голосового источника есть «послушать оригинал».

**Файлы:** `telegram-bot.adapter.ts:650-689` (download+ASR), `:738` (free_note payload); `S3Service`; `IdeaBlockEvidence`; conversational ingest free_note.

**Что входит:**
1. Перед ASR (или параллельно) сохранить buffer в S3 (`voice-notes/<tenantId>/<id>.ogg`) — паттерн как `mango.downloadRecording`.
2. В free_note payload добавить `audioS3Key`; протащить в RawEvent → доступно при резолве провенанса голосового источника.
3. Эндпоинт проигрывания: presigned GET по `audioS3Key` (под `CookieAuthGuard+TenantGuard` + проверка доступа к блоку, как ослабленный `/raw-events/:id`); фронт — кнопка «Послушать» в дровере для `source.type==='voice_note'`.
4. Retention — крутилка `AdminSetting` `provenance.voiceNoteAudioRetentionDays` (default 90, Р-2) + cron-уборка старых аудио.

**Acceptance:** голосовое сохраняет аудио в S3; дровер для voice_note показывает плеер; presigned-эндпоинт уважает права; retention-крутилка в registry.

## Фаза B4 — Якорь к странице документа

**Откуда.** RC-8: PDF/DOCX уплощаются (`pdf-parse`), якорь к месту невозможен; клик по doc-источнику ведёт на документ целиком. Зависит от Р-1 (подход).

**Рекомендуемый компромисс Р-1(б) — без смены парсера:**
1. Deep-link документа = `/documents/<id>` (уже строит `buildProvenanceDeepLink`).
2. На странице документа — подсветка/прокрутка к `quote` (поиск текста цитаты в `parsedText`); якорь `?q=<urlencoded quote prefix>`.
3. `ProvenanceService.buildDeepLink` для документа добавляет `?q=` из первой части quote (если фронт-страница документа есть; если нет — она часть фазы).

**Полный путь Р-1(а) — page-aware (vNext, бо́льший объём):** заменить `pdf-parse`→`unpdf` (page-aware; память: pdf-parse заброшен), хранить page+offset в evidence (новые поля + миграция), deep-link `?page=N`, превью страницы в S3. Это отдельная большая под-фаза — оформить как `provenance-document-page-anchor` если владелец выберет (а).

**Acceptance (для б):** клик по doc-источнику открывает документ с подсветкой/прокруткой к цитате; для PDF без фронт-вьюера — открытие документа + видимая цитата.

## Фаза B5 — `phone_call` адаптер ingest

**Откуда.** RC-10: enum `phone_call` есть, `mango.service.downloadRecording`→S3 есть, но **вебхук+ingest-адаптера нет** → звонки не наполняют граф. Зависит от Р-3 (приоритет).

**Что входит (по эталону `meeting.adapter`/`report.adapter`):**
1. Вебхук-контроллер приёма событий звонка (Mango) с валидацией подписи (`mango.service.verifySignature`).
2. `phone-call.adapter.ts`: `downloadRecording`→S3 (есть) → ASR записи (Vox, как голос/встречи) → payload `{ kind:'phone_call', callId, participants, recordingS3Key, fullText: transcript, startedAt, endedAt }` → `IngestService.ingest` с `Source(type='phone_call', name='Звонки')`, `sourceExternalId=callId`.
3. `ProvenanceService.classify` уже даёт тип `phone_call`; deep-link — `null` в v1 (или `/calls/<id>` если будет страница) — graceful.

**Acceptance:** вебхук создаёт RawEvent звонка; транскрипт уходит в граф; провенанс блока из звонка отдаёт label «Звонок» + цитату; запись в S3.

---

## Сквозные правила (для всех фаз)

- **Ship-On:** всё выкатывается включённым; новые крутилки (retention B3, порог если появится) — `AdminSetting` через `getDynamic` + строка в `docs/operations/feature-flags.md` + seed. Прямой `process.env.*` мимо `env.schema.ts` запрещён.
- **Без комментариев в коде** (CLAUDE.md): самодокументируемо; знания — в `docs/`/second-brain.
- **Prisma:** любое изменение БД (B1 поле в evidence, B4(а) page-поля, B3 при необходимости) — файл-миграция `prisma:migrate -- --name ...`, аддитивно; на прод авто через `migrate deploy`. Скрипты — `createPrismaClient()` из `_lib/prisma`, импорты из `../src`.
- **Безопасность провенанса (инвариант v1):** любой новый путь `quote`/аудио/файла наружу проходит фильтр прав зрителя (`partitionProjectionsByAccess` / проверка доступа к блоку-владельцу); закрытый блок → маскировка (как в `ProvenanceService.resolve`). Ревью каждой B-фазы — этим гейтом.
- **Кэш промптов:** A3/A4 промпты не трогают; если B5 ASR-постобработка добавит промпт — стабильный SYSTEM, данные в конце USER.
- **Тесты:** каждая фаза — поведенческий тест + негативный путь (нет источника/нет доступа) + идемпотентность где применимо. Синтетический харнесс-образец — `backend/src/modules/probe/probe-provenance-synthetic.spec.ts`.

## Prod-deploy (накопить в `docs/operations/prod-deploy-log.md` по факту реализации)

- A1 — без миграций (поля БД уже есть; только DTO/select/фронт). Backfill `backfill-provenance-preview.ts` уже в STEPS — прогнать, чтобы preview заполнился (иначе списки покажут пусто до новых сущностей).
- A2/A3/A4 — без миграций/seed (код). Выкат сборкой.
- B1 — миграция (поле в `IdeaBlockEvidence`) + возможен backfill старых chatbox-evidence.
- B3 — крутилка retention (seed AdminSetting) + cron-уборка.
- B4(а) — миграция page-полей (если выбран полный путь).
- B5 — Source(type='phone_call') seed/lazy-upsert + вебхук-роут (Swagger smoke).

## DoD (для каждой завершённой фазы)

- `typecheck` (вкл. `.spec`) / `lint` / `build` зелёные (backend+frontend), vitest по затронутому.
- second-brain обновлён (data-model при новых полях, module-map при новых сервисах/адаптерах, api-layer при новых эндпоинтах, 03_processes/raw-event-to-graph при новых источниках); `04_не-сделано` — строка закрыта/перенесена; prod-deploy-log; рефлексия.
- Инвариант доступа провенанса соблюдён (ревью `strict-production-review-gate`).

## Итог

**К выполнению (рекомендуемый порядок):** Блок A (A1, A3, A4 — параллельно; A2 — отдельно) → Блок B по решениям владельца Р-1…Р-4. Блок A и B1/B2 можно делать без новых решений; B3 — с дефолтным retention; B4/B5 — после Р-1/Р-3. Брать скиллом `tz-orchestrator` по парному orchestrator-prompt.

**Реализовано (Блок A + Блок B).**
- **A1:** list-DTO решений/регламентов/задач несут `previewQuote`/`previewSourceRef`; фронт-сниппет цитаты на карточках (`ProvenancePreviewSnippet`).
- **A2:** chat-v2 резолвит источник через `ProvenanceService` (убран дубль резолва).
- **A3:** specialist-3-4 кладёт чистый `objectName` карточки.
- **A4:** email-payload несёт `fullText` (не зашумляет граф).
- **B1:** новая колонка `IdeaBlockEvidence.sourceMessageExternalId` (миграция `20260620181013_add_evidence_source_message`, аддитивно); chatbox deep-link `/chats/<chatId>?m=<msg>`.
- **B2:** `TaskEvidenceLinkerService` — матчит fast-задачу встречи к `IdeaBlock` по цитате.
- **B3:** аудио голосовых (Telegram/MAX) в S3 (`voice-notes/`); эндпоинт `GET /api/v1/provenance/voice-note/:rawEventId/audio` (presigned, 404/403); cron `VoiceNoteAudioRetentionCron`; крутилки `provenance.voiceNoteAudioRetentionDays`(90)/`voiceNoteAudioPresignTtlSeconds`(600); плеер в `ProvenanceDrawer`.
- **B4:** deep-link документа `/documents/<id>?q=<цитата>` + подсветка на странице документа — **вариант (б)**. **B4(а) page-aware** (`unpdf`, page+offset в evidence, `?page=N`, превью страницы) — остаётся **vNext** (отдельная под-фаза `provenance-document-page-anchor`).
- **B5:** `PhoneCallIngestAdapter` (Mango): запись из S3 → Vox ASR → структурный payload; починен Mango-вебхук (был сырой JSON-шум).

**Прод-операции:** миграция (авто), сиды AdminSetting (в STEPS), backfill `backfill-provenance-preview.ts` (в STEPS). Применение — `apply-prod-deploy.ts --mode update`. Smoke — эндпоинт аудио, cron, `phone_call`-вебхук (см. `docs/operations/prod-deploy-log.md`).
**Осталось (vNext):** B4(а) page-aware document anchor.
