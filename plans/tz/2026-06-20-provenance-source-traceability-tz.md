---
type: tz
status: ready-to-implement
feature: provenance-source-traceability
date: 2026-06-20
owner: Сергей (владелец)
relates_to:
  - plans/analysis/2026-06-20-provenance-source-traceability/99-synthesis.md
  - plans/analysis/2026-06-20-provenance-source-traceability/10-internal-baseline.md
  - plans/tz/2026-06-11-probe-question-context-leak-fix.md
supersedes: plans/tz/2026-06-11-probe-question-context-leak-fix.md
---

> Анализ: `plans/analysis/2026-06-20-provenance-source-traceability/` (status: research-complete) · Решения владельца Р-1…Р-4 согласованы 2026-06-20.

# ТЗ — Провенанс / трассировка первоисточника (v1)

**Принцип.** У автосоздаваемых сущностей (Решение, Задача, Регламент, уведомление-probe, ответ AI-чата) появляется единый аффорданс «Откуда это» — клик ведёт к дословной цитате + переходу к моменту встречи. Провенанс-хребет уже есть в данных; строим **единый контракт резолва + один UI-компонент**, а не шестой ad-hoc паттерн. НЕ переоткрывать выбор решения (доказан в анализе, Вариант A).

## Цель + Зачем

**Болезненное состояние.** Сущность показывает «Источники: N блок(ов)» мёртвым текстом (`DecisionsListClient.tsx:451`); из трекера до встречи-первоисточника дойти нельзя (`IssueSidebar.tsx` — 0 аффордансов); probe-вопрос приходит без «по поводу чего»; ответы AI-чата показывают цитату некликабельным `<div>`. Пользователь не может проверить корректность автоизвлечения → игнорирует карточки и вопросы (прямая связь с `plans/analysis/2026-06-20-probe-smart-questions-module.md`).

**Чем решение лучше.** Единый `ProvenanceService.resolve(...)` + компонент «Откуда это» делают опору **кликабельной и проверяемой за 1 действие** (эталон Glean/Gong/МТС Линк — «клик по факту → точный момент»), уважая права зрителя (инвариант Glean «citations never grant new access»). Разметка «цитата vs вывод» — ров против РФ-рынка (только Яндекс Нейро близок). Доказательная база и источники — в анализе.

## REALITY-CHECK (факты по коду 2026-06-20 — критично, не игнорировать)

| # | Что обнаружено по факту | Следствие для ТЗ |
|---|---|---|
| RC-1 | **Провенанс-хребет работает в проде:** `Source→RawEvent→IdeaBlockEvidence{quote,startMs,endMs}→IdeaBlock`; `GET /knowledge/blocks/:id` отдаёт evidence (`blocks.controller.ts:167`). Не строим заново. | Строим резолвер + surfacing ПОВЕРХ существующего, новых таблиц провенанса не нужно. |
| RC-2 | **`ProvenanceResolver` = 0 совпадений; 3 дубля резолва:** `chat-v2.service.ts:1028-1116` (эталон последней мили), `regulations.service.ts:349-406` (`getSources`, теряет `startMs` — нет в `select`), `tables/table-enrich.service.ts:164` (единственный `sourceLink`-билдер). | Фаза 1 вводит ОДИН `ProvenanceService` и заменяет все три дубля. |
| RC-3 | **🔴 Нет «maxDataClass зрителя» в knowledge-слое.** Греп `maxDataClass`/`compareDataClass` по `rbac/` = 0. Видимость блоков для человека — только по группам (`KnowledgeAccessContext{deptGroupIds, closedGroupIds, isBypass}`); `dataClass` управляет LLM-роутингом (`llm-router.service.ts:958`) и каналами доставки, НЕ видимостью. | Инвариант доступа (Р-3) фильтрует цепочку через **группы** (`partitionProjectionsByAccess`), НЕ через сравнение dataClass зрителя. dataClass в фильтре провенанса не участвует. |
| RC-4 | **Готовый метод фильтра по правам:** `KnowledgeAccessResolver.partitionProjectionsByAccess(ctx, items: Array<{id, sourceBlockIds}>)` (`knowledge-access-resolver.service.ts:286`) + `resolveAccessibleGroups({tenantId,userId})` (`:35`). Строжайший union: любой недоступный source-блок → проекция закрыта. | Переиспользовать as-is, новый access-метод НЕ писать. Тест ложится в существующий `describe(...partitionProjectionsByAccess (Ф6))` (`...spec.ts:406`). |
| RC-5 | **🔴 Фикс задач из встреч (`evidenceBlockIds:[]` хардкод, `meeting-report-fast.worker.ts:480`) — НЕ дешёвый.** Рядом нет валидного blockId: `MeetingReportFastTaskSchema` несёт только `title/assigneeRaw/dueDateIso/sourceQuote/confidence` (`meeting-report-fast.prompt.ts:35`); IdeaBlock в fast-воркере не создаётся. | НЕ кладём в Фазу 0. В v1 задача из встречи показывает `sourceQuote` (graceful-degradation: цитата без прыжка к таймкоду). Полный block-линк — отдельной vNext-строкой. |
| RC-6 | **🔴 Ловушка единиц времени:** deep-link встречи = `/meetings/:id?t=<СЕКУНДЫ>` (`table-enrich.service.ts:164`), а `IdeaBlockEvidence.startMs/endMs` и эталон chat-v2 — **миллисекунды**. Плеер `useVideoPlayer().seekTo(ms)` принимает мс (`use-video-player.ts:8`). | `buildDeepLink` принимает таймкод ЯВНО в мс и сам делит на 1000 для `?t=`; плеер читает `?t=<sec>` и вызывает `seekTo(sec*1000)`. |
| RC-7 | **`RawEvent.sourceExternalId` уже неоднороден по типу:** meeting → голый `meetingId`; document → префикс `'doc:<id>'` (`chat-v2.service.ts:1163`). | `resolveByRawEventIds` различает тип по `(sourceType, sourceExternalId)`, документ → `slice('doc:'.length)`. |
| RC-8 | **Денорм-снимка цитаты нет ни у одной вершины, кроме Task** (`Task.sourceQuote@1789`+`sourceStartMs@1787`). Decision/Issue/Regulation несут только `sourceBlockIds: string[]`. Эталон отдельной таблицы провенанса — `model TaskSource@1817`. | Добавить `previewQuote`+`previewSourceRef` рядом с `sourceBlockIds` (образец Task), НЕ новую общую таблицу (избыточно для v1). |
| RC-9 | **Готовые фронт-кирпичи:** `AiCitation` (props `{startMs, speakerName, text, onClick}`, `AiCitation.tsx:7`) — основа компонента; `ChatV2Citation` (`domain/chat-v2.ts:18`) — самый полный тип цитаты; `RegulationSource` (`domain/regulation.ts:149`) — готовый резолв; `Popover` (`shadcn/popover.tsx`) и `Sheet`-дровер (эталон `AdminSettingHistoryDrawer.tsx`); `vaul` нет. | Компонент «Откуда это» = обобщённый `AiCitation` в `Popover`/`Sheet`; единый тип = расширенный `ChatV2Citation`. |
| RC-10 | **probe.question:** `contextBlockId` УЖЕ читается диспетчером (`probe-dispatcher.worker.ts:257`), но в `payload` не кладётся; `ProbeQuestionPayloadSchema` (`event-payload.registry.ts:3`) — `.strict()`, новые поля отбросит. `task_closure.evidenceQuote` теряется в маппере (`domain/pending-action.ts:205` `default:undefined`). Concierge snippet — из вывода LLM (`base-retrieval-strategy.ts:209`), не из `IdeaBlockEvidence.quote`. | Это дешёвые фиксы Фазы 0 (схема+payload+маппер+select из БД). |

## Принятые решения владельца (не пересматривать)

| # | Решение | Обоснование | Дата |
|---|---|---|---|
| Р-1 | v1 = (а) карточки Decision/Issue/Task/Regulation (кликабельная цитата + переход к моменту встречи); (б) AI-чат компании (ChatV2 + Concierge) — кликабельные citations со стабильной привязкой `[N]→ideaBlockId`; (в) probe-вопрос (блок «по поводу чего»). Чат-deep-link / документ-страница / аудио голоса — **вторая волна**. | Данные у (а)/(б)/(в) богаче; последняя миля к встрече (`?t=`) почти готова; ~80% боли минимумом инфры. Архитектура аддитивна — типы источника подключаются во 2-й волне без переделки. | 2026-06-20 |
| Р-2 | Разметка `attribution: 'quoted' | 'inferred'` + coverage «по N репликам из M встреч»; **БЕЗ числового % уверенности для фактов из встреч**; % допустим только для ответов из загруженных документов. Порог-гейт — крутилка `AdminSetting` (`getDynamic`, code-fallback). | Класс meeting-intelligence намеренно избегает % (ложная точность); «цитата vs вывод» — незанятый сигнал РФ-рынка (ров). | 2026-06-20 |
| Р-3 | Рядовой видит дословную цитату, но через **deny-by-default фильтр по группам доступа зрителя** (RC-3/RC-4): каждое звено цепочки → `partitionProjectionsByAccess`; недоступный source-блок → `accessFiltered:true`, `quote` заменяется на «Источник скрыт правами доступа», `deepLink=null`. Жёсткий guard `/ingest/:id` (owner/admin) ослабить до проверки доступа к блоку-владельцу. | Без доступа рядового фича бессмысленна; без фильтра — эскалация привилегий через деагрегацию. dataClass-порога зрителя в коде нет (RC-3) → фильтруем группами. | 2026-06-20 |
| Р-4 | Аудио голосовых `free_note` сохранять в S3 (retention — `AdminSetting`) — **вторая волна**; в v1 голос показывает ASR-текст + детерминированного автора (`EntityResolutionService.resolveSubjectPersonId`). | «Голосом загрузил предложение» — прямой кейс владельца; сейчас аудио выбрасывается. Не блокирует v1. | 2026-06-20 |

## Доказательство выбора

Вариант A (единый контракт + компонент) против B (только inline-сноски), C (точечные панели per-entity), D (только проводка) — состязательная матрица и ADR в `plans/analysis/2026-06-20-provenance-source-traceability/99-synthesis.md` §6. A вбирает B (inline-маркер = одна из двух точек входа компонента) и D (Фаза 0 = быстрая проводка). Три инварианта — из red-team (§8 анализа).

## Scope

**Входит (v1):**
- Единый `ProvenanceService` (резолвер цепочки + батч `resolveByRawEventIds` + `buildDeepLink`), замена 3 дублей.
- Денорм-снимок `previewQuote`/`previewSourceRef` на Decision/Issue/Regulation (+ backfill).
- Эндпоинт `GET /api/v1/provenance/:entityType/:entityId` (viewer-filtered, on-demand).
- Обогащение `GET /knowledge/blocks/:id` evidence резолвнутым источником + deepLink.
- Единый фронт-тип цитаты + компонент «Откуда это» (inline-маркер + дровер), рендер на карточках Decision/Issue/Task/Regulation, кликабельные citations AI-чата, блок «по поводу чего» у probe.
- Разметка `attribution` quoted/inferred + coverage; порог уверенности в `AdminSetting`.
- Инварианты: денорм-preview для списков · фильтр прав зрителя · graceful-degradation.
- Фаза 0 (быстрая проводка): плеер `?t=`, probe payload+рендер, pending `task_closure`, Concierge snippet из evidence.

**Не входит (вторая волна — отдельный vNext-ТЗ `provenance-source-traceability-wave2`; занесено в `second-brain/04_не-сделано/README.md`):**
- Deep-link к конкретному сообщению чата (прокинуть `ChatboxMessage.externalId` в evidence; chatbox-таймкоды сейчас синтетические `startSec:i`, `chatbox-ingest.service.ts:290`).
- Якорь к странице документа (page-aware парсинг + bbox-стиль RAGFlow + превью страницы в S3 через backend-прокси).
- Сохранение аудио голосовых `free_note` в S3 + проигрывание.
- Block-линк задач из встреч fast-пути (RC-5) — нужен матчинг IdeaBlock или расширение схемы промпта.
- `phone_call`-адаптер (мёртвый enum); email-ingest баг (тело под `payload.text`, `SegmentBuilder` ждёт `fullText`, `email-fetch.service.ts:130` vs `segment-builder.service.ts:189`).

**Граничные контракты:** ASR/word-timings (Vox/GigaAM) — для встреч уже есть `startMs/endMs`, не реализуем здесь. Knowledge-access — переиспользуем `KnowledgeAccessResolver` as-is, не меняем его логику.

## Контракт-first (единый источник правды для копипасты)

> Номера строк — на момент написания (2026-06-20); перед правкой перечитать по символу-якорю.

### К-1. Prisma: денорм-снимок провенанса на вершинах

Добавить рядом с `sourceBlockIds` в моделях **Decision** (якорь `model Decision`, рядом со `sourceBlockIds@6232`), **Issue** (`model Issue`, рядом со `sourceBlockIds@9208`), **Regulation** (`model Regulation`, рядом со `sourceBlockIds@5996`):

```prisma
  /// Денормализованный снимок провенанса для рендера СПИСКОВ без join вглубь
  /// (анти-N+1; образец Task.sourceQuote). Заполняется из первого доступного
  /// IdeaBlockEvidence при создании/обновлении сущности. Пусто = резолв on-demand или нет источника.
  previewQuote     String? @db.Text
  /// { evidenceId, blockId, sourceType, sourceExternalId, startMs?, deepLink, attribution }
  /// evidenceId — для инвалидации снимка при merge/supersede блока-источника.
  previewSourceRef Json?
```

Task (`model Task@1759`) УЖЕ несёт `sourceQuote@1789`+`sourceStartMs@1787` — НЕ дублировать, добавить только `previewSourceRef Json?` для deepLink/attribution. Миграция: `bun run prisma:migrate -- --name provenance_preview_snapshot`; затем `bun run prisma:generate`. НЕ `migrate`-прямой, НЕ `db push`.

### К-2. ProvenanceService (backend, новый сервис в `backend/src/modules/knowledge-core/services/provenance.service.ts`)

```ts
export type ProvenanceSourceType = 'meeting' | 'document' | 'chat' | 'voice_note' | 'email' | 'phone_call';
export type ProvenanceEntityType = 'decision' | 'issue' | 'task' | 'regulation' | 'instruction' | 'block' | 'notification';

export interface ProvenanceSourceRef {
  type: ProvenanceSourceType;
  refId: string | null;        // meetingId | documentId | null
  label: string;               // «Встреча «Планёрка», 14:32» | «Документ X»
  deepLink: string | null;     // /meetings/:id?t=<sec> | /documents/:id | null
}
export interface ProvenanceNode {
  blockId: string;
  rawEventId: string;
  source: ProvenanceSourceRef;
  quote: string;               // «Источник скрыт правами доступа» если accessFiltered
  attribution: 'quoted' | 'inferred';
  startMs: number | null;
  endMs: number | null;
  occurredAt: string | null;
  confidence: number | null;
  accessFiltered: boolean;     // true → quote/deepLink скрыты правами зрителя
}
export interface ViewerContext { tenantId: string; userId: string; }

// Батч: rawEventId → источник+deepLink (multi-type RC-7, tenant-scoped, ≤1 findMany на тип, без N+1)
resolveByRawEventIds(tenantId: string, rawEventIds: string[]): Promise<Map<string, ProvenanceSourceRef>>;

// Единый билдер deep-link. Таймкод ВСЕГДА в мс; внутри делит на 1000 для ?t=<sec> (RC-6).
buildDeepLink(args: { sourceType: ProvenanceSourceType; externalId: string; startMs?: number | null }): string | null;
//   meeting   → `/meetings/${externalId}?t=${Math.max(0, Math.round((startMs ?? 0) / 1000))}`
//   document  → `/documents/${externalId}`
//   иначе     → null

// Полная цепочка для сущности, отфильтрованная по правам зрителя (on-demand по клику).
resolve(entityType: ProvenanceEntityType, entityId: string, viewer: ViewerContext): Promise<ProvenanceNode[]>;
//   1. собрать sourceBlockIds/evidenceBlockIds сущности (по типу);
//   2. ctx = KnowledgeAccessResolver.resolveAccessibleGroups({tenantId, userId});
//   3. part = partitionProjectionsByAccess(ctx, blockIds.map(id => ({id, sourceBlockIds:[id]})));
//   4. для каждого блока: грузим первую IdeaBlockEvidence ([{startMs:'asc'},{createdAt:'asc'}]);
//      resolveByRawEventIds → source+deepLink; attribution = block.primarySource==='report' ? 'inferred' : 'quoted';
//      если !part.accessibleIds.has(blockId): accessFiltered=true, quote='Источник скрыт правами доступа', deepLink=null, startMs=null.
```

### К-3. Эндпоинт (Zod-DTO, nestjs-zod, Swagger)

`GET /api/v1/provenance/:entityType/:entityId` (контроллер `provenance.controller.ts`, `@UseGuards(CookieAuthGuard, TenantGuard)`):
```ts
export const ProvenanceNodeDto = z.object({
  blockId: z.string(), rawEventId: z.string(),
  source: z.object({ type: z.string(), refId: z.string().nullable(), label: z.string(), deepLink: z.string().nullable() }),
  quote: z.string(), attribution: z.enum(['quoted', 'inferred']),
  startMs: z.number().nullable(), endMs: z.number().nullable(),
  occurredAt: z.string().nullable(), confidence: z.number().nullable(), accessFiltered: z.boolean(),
});
export const ProvenanceResponseDto = z.object({ nodes: z.array(ProvenanceNodeDto), coverage: z.object({ blocks: z.number(), meetings: z.number() }) });
// Коды ошибок: entityType вне enum → 400 {code:'invalid_entity_type'}; сущность не найдена → 404 {code:'not_found'}.
```

### К-4. Deep-link на фронте: плеер читает `?t=<sec>` (RC-6)

`frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx` — добавить `useEffect` в импорт (`строка 3`, сейчас `useEffect` НЕ импортирован) и после `onSeek` (`строка 213`, якорь `const onSeek = (ms: number) =>`):
```tsx
  useEffect(() => {
    const t = searchParams.get('t');
    if (!t) return;
    const sec = Number(t);
    if (Number.isFinite(sec)) onSeek(sec * 1000); // ?t=<sec> → seekTo(ms)
  }, [searchParams /* one-shot guard через ref */]);
```

## Границы фичи

- ✅ **Always:** фильтровать цепочку по правам зрителя (`partitionProjectionsByAccess`) ДО возврата `quote`; передавать таймкод в `buildDeepLink` в мс; рендерить честное состояние при отсутствии источника.
- ⚠️ **Ask first:** менять логику `KnowledgeAccessResolver`; вводить новый `signalType`/новую общую таблицу провенанса; трогать формат уже сохранённых `TableCellProvenance.sourceLink`.
- 🚫 **Never:** показывать `quote` мимо фильтра прав; вести кнопку «к первоисточнику» в пустоту (нет якоря → кнопки нет); выдавать `primarySource='report'` за дословную цитату; числовой % уверенности на фактах из встреч (Р-2); `process.env.*` мимо `env.schema.ts`; порог уверенности хардкодом (только `AdminSetting`).

## Фазы (dependency-ordered)

Граф: **Ф0** независима (может выкатиться первой). **Ф1 → Ф2 → Ф3 → Ф4 → Ф5.** Ф1 — load-bearing (резолвер + безопасность), всё остальное зависит от неё.

### Фаза 0 — Быстрая проводка (дешёвые победы, независимы)

**Цель:** закрыть 4 точечных разрыва, где данные уже почти доходят. **Поглощает** `plans/tz/2026-06-11-probe-question-context-leak-fix.md`.

Что входит:
- **0.1 Плеер читает `?t=<sec>`** — К-4 (`MeetingResultPageReal.tsx:3,213`). Одноразовый seek через ref-флаг.
- **0.2 probe.question несёт первоисточник** — в `ProbeQuestionPayloadSchema` (`event-payload.registry.ts:3`) добавить `blockId: z.string().optional()`, `quote: z.string().optional()`; в `probe-dispatcher.worker.ts:251-255` положить `blockId: this.toStringOrUndef(payload.contextBlockId)` (+ `quote`, если эмиттер кладёт `payload.contextQuote`); фронт `NotificationsClient.tsx` для `probe.question` рендерит блок «По поводу: «{quote}»» со ссылкой на блок (вместо сырого `payload.message`).
- **0.3 PendingActions `task_closure` доходит** — в `pending-actions.api.ts:67` добавить `TaskClosureDetailApi{kind:'task_closure'; taskTitle; rationale?; evidenceQuote?; confidence?}` в union; в `domain/pending-action.ts` добавить зеркальный вариант в `PendingActionDetail` + `case 'task_closure':` перед `default` (`:205`).
- **0.4 Concierge snippet из evidence** — в `base-retrieval-strategy.ts:87-96` добавить в `select` блока `evidence: { select: { quote: true, startMs: true }, take: 1, orderBy: [{startMs:'asc'}] }`; при сборке citation (`:207-210`) брать `snippet` из `IdeaBlockEvidence.quote`, а не из `c['snippet']` (LLM-самоотчёт).

Что НЕ входит: block-линк задач из встреч (RC-5 → vNext); единый компонент (Ф4).

**Acceptance Ф0:**
- `bun run typecheck && bun run lint && bun run build` (backend и frontend) — зелёные.
- Греп `searchParams.get('t')` в `MeetingResultPageReal.tsx` → 1 совпадение; ручной/e2e: открыть `/meetings/<id>?t=90` → плеер на 1:30.
- Греп `blockId` в `ProbeQuestionPayloadSchema` → присутствует; `bunx vitest run` по probe-dispatcher — payload содержит `blockId`.
- Греп `case 'task_closure'` в `domain/pending-action.ts` → 1 совпадение; `task_closure` рендерит `evidenceQuote` (не `undefined`).
- Греп `c['snippet']` в `base-retrieval-strategy.ts` → 0 (заменён резолвом из БД).

Закрывает: R1, R2, R3, R4.

### Фаза 1 — ProvenanceService (backend core + безопасность)

**Цель:** один резолвер, заменяющий 3 дубля, с фильтром прав зрителя.

Что входит:
- К-1 (Prisma `previewQuote`/`previewSourceRef`) + миграция + `prisma:generate`.
- К-2 (`provenance.service.ts`): `resolveByRawEventIds` (батч, multi-type RC-7, tenant+`deletedAt`-scope), `buildDeepLink` (мс→сек RC-6), `resolve(...viewer)` с фильтром через `partitionProjectionsByAccess` (RC-4). Зарегистрировать в `KnowledgeCoreModule`.
- Заменить 3 дубля на вызовы сервиса: `chat-v2.service.ts:1028-1116/1127-1198`, `regulations.service.ts:349-406` (теперь возвращает `startMs` + doc-источники), `tables/table-enrich.service.ts:164` (формат `sourceLink` НЕ меняется — тот же `/meetings/:id?t=<sec>`).
- Тест инварианта доступа «агрегат виден, источник закрыт» в `knowledge-access-resolver.service.spec.ts` (`describe(...Ф6)@406`, эталон `:495-509`) — через `ProvenanceService.resolve`: блок-источник в `closed`-группе, зритель не член → `accessFiltered:true`, `quote='Источник скрыт правами доступа'`.

Что НЕ входит: эндпоинт (Ф2), наполнение `previewQuote` (Ф2), UI (Ф3-4).

**Acceptance Ф1:**
- `bun run prisma:generate` ок; миграция в `prisma/migrations/`; повторный прогон миграции = no-op.
- `bunx vitest run backend/src/modules/knowledge-core/services/provenance.service.spec.ts`: `buildDeepLink({sourceType:'meeting',externalId:'m1',startMs:90000})` === `/meetings/m1?t=90`; document → `/documents/d1`; chat → `null`.
- `bunx vitest run backend/src/modules/rbac/knowledge-access-resolver.service.spec.ts -t "источник закрыт"` — зелёный.
- Греп `loadContextBlocks`/`getSources`/`table-enrich` — вызывают `provenanceService`; ручная цепочка `sourceExternalId` удалена из ≥2 из 3 дублей (tables-формат сохранён).
- `bun run typecheck && bun run build` — зелёные.

Закрывает: R5, R6, R7, R8.

### Фаза 2 — API + наполнение снимка

Что входит:
- К-3: `GET /api/v1/provenance/:entityType/:entityId` (Zod-DTO + Swagger, viewer из `CookieAuthGuard`).
- Обогатить `GET /knowledge/blocks/:id` (`blocks.controller.ts:167`): к каждому `EvidenceItemDto` добавить `source: ProvenanceSourceRef` через `resolveByRawEventIds` (существующие поля не трогать).
- Ослабить `GET /ingest/:id` (`ingest.controller.ts:105`): вместо «только owner/admin» — проверка доступа к блоку-владельцу через `canAccessKnowledgeGroup`; рядовой получает нормализованный фрагмент (цитата+таймкод), сырой RawEvent payload остаётся owner/admin.
- Наполнение `previewQuote`/`previewSourceRef`: (а) backfill-скрипт `backend/scripts/backfill-provenance-preview.ts` (`createPrismaClient()` из `_lib/prisma`, идемпотентно, импорты из `../src`); (б) хук на создании/обновлении Decision/Issue/Regulation (там, где ставится `sourceBlockIds` — `specialist-3-3-decisions.service.ts`, `regulations.service.ts`, intake). Регистрация backfill в `apply-prod-deploy.ts` `STEPS` (phase: update, `skipBootstrap:true`).

**Acceptance Ф2:**
- Swagger smoke: `/api/v1/provenance/decision/<id>` отдаёт `{nodes[], coverage}`; `entityType=foo` → 400 `invalid_entity_type`.
- Негативный: зритель без доступа к closed-блоку → node с `accessFiltered:true`, `deepLink:null`.
- backfill повторно = no-op (acceptance-критерий); зарегистрирован в `STEPS`.
- `GET /knowledge/blocks/:id` — каждый evidence несёт `source.deepLink`.
- `prod-deploy-log.md` Шаг 4 (новые колонки) + Шаг 8 (backfill) + Шаг 12 (новый эндпоинт Swagger) обновлены.

Закрывает: R9, R10, R11.

### Фаза 3 — Frontend domain (единый тип цитаты)

Что входит:
- Единый тип `ProvenanceRef` в `frontend/src/domain/provenance.ts` (на базе `ChatV2Citation@18` — самый полный): `{ blockId; source:{type,refId,label,deepLink}; quote; attribution; startMs; endMs; confidence; accessFiltered }` + маппер из `ProvenanceNodeDto`.
- Протянуть в `domain/decision.ts`, `domain/tracker/issue.ts` (там сейчас только `sourceBlockIds: string[]`), переиспользовать в `domain/regulation.ts` (`RegulationSource`→унифицировать), `domain/pending-action.ts`, `domain/chat-v2.ts`.
- API-слой `provenance.api.ts` (`GET /provenance/:type/:id` через единый `api-client.ts`), SWR-хук `useProvenance(entityType, entityId)` (ленивый — грузит по открытию дровера).

**Acceptance Ф3:** `bun run typecheck` (frontend) зелёный; греп `ProvenanceRef` в `domain/decision.ts` и `domain/tracker/issue.ts` → присутствует; SWR-хук не вызывается до открытия дровера (ленивость).

Закрывает: R12.

### Фаза 4 — Компонент «Откуда это» + рендер

Что входит:
- Обобщить `AiCitation` (`AiCitation.tsx:7`): добавить опц. `subtitle?: string`, `href?: string`, `attribution?: 'quoted'|'inferred'`, `accessFiltered?: boolean` (5 текущих props сохранить). При `accessFiltered` — рендер «Источник скрыт правами доступа», без кнопки.
- `ProvenancePopover` (inline-маркер `[N]`, `shadcn/popover.tsx`) для текста ответов AI-чата; `ProvenanceDrawer` (`Sheet`, клон структуры `AdminSettingHistoryDrawer.tsx`) для полного списка цепочки. Кнопка «перейти к первоисточнику» строит ссылку из `source.deepLink`; при `deepLink=null` — кнопки нет (graceful-degradation).
- Рендер: карточки Decision (`DecisionsListClient.tsx:451` — заменить мёртвый «N блоков» на чип-источник + дровер), Issue/Task (`IssueSidebar.tsx`), Regulation (переиспользовать панель «Источники»); citations AI-чата (`ChatPanel.tsx:159`, `IssueChat.tsx:485`, `ChatV2Client.tsx`) — сделать `[N]` и сниппеты кликабельными (`[N]→ideaBlockId`, стабильно, Onyx-паттерн, НЕ self-report); probe-вопрос (доводит Ф0.2).

**Acceptance Ф4:**
- Греп мёртвого `Источники: ${...} блок` в `DecisionsListClient.tsx` → 0 (заменён компонентом).
- Playwright/ручная qa (skill `qa-tester`, прод korateam.ru): на карточке Решения клик «Откуда это» → дровер с цитатой → «перейти к первоисточнику» → `/meetings/:id?t=<sec>` → плеер на моменте. Карточка с пустым `sourceBlockIds` → честное «создано вручную», кнопки перехода нет.
- AI-чат: клик по `[1]` в ответе → поповер с цитатой+таймкодом, переход к моменту.
- `bun run typecheck && bun run lint && bun run build` (frontend) — зелёные.

Закрывает: R13, R14, R15, R16.

### Фаза 5 — Attribution «цитата vs вывод» + уверенность + graceful-degradation

Что входит:
- `attribution` в `ProvenanceNode`: `block.primarySource==='report' ? 'inferred' : 'quoted'` (Ф1 уже считает) → UI рендерит метку 〔цитата〕/〔вывод〕 (Р-2). Числовой % уверенности — только если `source.type==='document'`; для встреч — coverage «по N репликам из M встреч» (из `coverage`).
- Порог-гейт уверенности — крутилка `AdminSetting` (`provenance.confidence_review_threshold`, `getDynamic`, code-fallback, строка в `admin-setting-schema-registry.ts` + сид + UI-поле). Ниже порога → метка «нужна проверка», НЕ авто-действие.
- Graceful-degradation как контракт: состояния «создано вручную» (`sourceBlockIds=[]`), «по AI-выжимке отчёта, не дословно» (`attribution='inferred'`), «источник скрыт правами» (`accessFiltered`). Кнопка перехода физически отсутствует при `deepLink=null`.

**Acceptance Ф5:**
- Метка 〔вывод〕 на карточке из report-блока; 〔цитата〕 на transcript-блоке.
- Числовой % НЕ рендерится на meeting-источнике (греп компонента); рендерится на document.
- Греп `provenance.confidence_review_threshold` в `admin-setting-schema-registry.ts` → присутствует; `getDynamic` (не ENV/хардкод). Строка в `docs/operations/feature-flags.md` если вводится kill-switch.
- 3 graceful-состояния визуально проверены (qa-tester).

Закрывает: R17, R18, R19.

## Требования (трассировка)

R1 плеер читает `?t=<sec>`·R2 probe несёт blockId+quote·R3 pending task_closure доходит·R4 Concierge snippet из evidence·R5 `ProvenanceService.resolveByRawEventIds` батч multi-type·R6 `buildDeepLink` нормализует мс→сек·R7 `resolve` фильтрует по группам зрителя·R8 3 дубля заменены·R9 эндпоинт `/provenance/:type/:id`·R10 `/blocks/:id` обогащён source·R11 `/ingest/:id` ослаблен до доступа к блоку·R12 единый `ProvenanceRef` в domain·R13 компонент «Откуда это»·R14 рендер на карточках·R15 кликабельные `[N]` AI-чата·R16 probe «по поводу чего»·R17 attribution quoted/inferred·R18 уверенность без % для встреч·R19 graceful-degradation.

## Pre-mortem / Риски + ревью-аспекты (для `strict-production-review-gate`)

- **Утечка деагрегации** — главный риск. Ревью: каждый путь `quote` наружу проходит `partitionProjectionsByAccess`? Тест «источник закрыт» зелёный? Эндпоинт `/provenance` берёт viewer из guard, не из тела?
- **N+1** — `resolve` для одной сущности, списки — из `previewQuote` (без join). Ревью: нет цикла с `findMany` внутри.
- **Единица времени** (RC-6) — все вызовы `buildDeepLink` передают мс; tables-путь (`timeSec`) умножает на 1000. Ревью: грепнуть `?t=` — формат секунд везде.
- **Staleness `previewQuote`** — инвалидация при merge/supersede блока (`previewSourceRef.evidenceId`). Ревью: хук на `idea_block.updated`/merge пересчитывает снимок затронутых вершин.
- **report-блоки** — не выдать за дословное (Р-2). Ревью: `attribution='inferred'` при `primarySource='report'`.

## Идемпотентность / feature-flag / prod-deploy

- backfill `backfill-provenance-preview.ts` — повторный прогон no-op; в `apply-prod-deploy.ts` `STEPS` (phase update, skipBootstrap).
- **Ship-On:** фича выкатывается включённой. Флаг — только если нужен kill-switch на эндпоинт `/provenance` (тип «аварийный рубильник», ON по умолчанию) → строка в `docs/operations/feature-flags.md`. «На всякий случай» флаг не вводить.
- prod-deploy-log: Шаг 4 (колонки `previewQuote`/`previewSourceRef`), Шаг 8 (backfill), Шаг 12 (эндпоинт `/provenance` Swagger smoke + grep). Прямой блок prod-инструкции в чате после push.
- **Prompt caching:** ТЗ LLM-промпты не меняет (Concierge snippet берётся из БД, промпт стабилен) → раздел не релевантен. Если Ф0.4 потребует правки промпта — стабильный SYSTEM, данные в конце user.

## DoD

- `bun run typecheck` (вкл. `.spec`) / `lint` / `build` зелёные (backend+frontend); vitest по затронутым.
- second-brain обновлён: `02_architecture/data-model.md` (новые колонки), `02_architecture/module-map.md` (ProvenanceService), `01_projects/api-layer.md` (эндпоинт), `03_processes/raw-event-to-graph.md` (резолв провенанса), `04_не-сделано/README.md` (закрыть строки v1 при выкате, оставить вторую волну).
- prod-deploy-log обновлён (Шаги 4/8/12); рефлексия в `05_история/`.
- Все 19 R закрыты соответствующими фазами; инварианты red-team соблюдены.

## Итог

**Реализовано целиком (dev, 2026-06-20):** все 6 фаз Ф0–Ф5.
- Ф0 `fab510be` — плеер `?t=`, probe payload blockId/quote, pending task_closure/task_review, Concierge snippet из evidence (поглотил `2026-06-11-probe-question-context-leak-fix`).
- Ф1 `0beca91a` — `ProvenanceService` (resolveByRawEventIds/buildDeepLink/resolve с deny-by-default фильтром, маскировка quote+label+deepLink закрытого блока), миграция `20260620113751_provenance_preview_snapshot`, замена дублей tables+regulations.
- Ф2 `cadf5549` — эндпоинт `/provenance/:type/:id`, обогащение `/blocks/:id`, ослабление `/raw-events/:id`, backfill.
- Ф3 `1e35cea8` — domain ProvenanceRef + api + ленивый useProvenance.
- Ф4+Ф5 `1e5d3dbf` — компонент «Откуда это» (Drawer/Popover/Chip) + рендер (Decision/Issue/Regulation/AI-чат) + attribution/уверенность/degradation + крутилка `provenance.confidence_review_threshold`.

Верификация: typecheck/lint/build зелёные (backend+frontend); provenance.service.spec + access-resolver «источник закрыт» + синтетический харнесс `probe-provenance-synthetic.spec.ts` (7). Рефлексия — `second-brain/05_история/2026-06-20-provenance-and-probe-smart-questions.md`.

**Осталось (vNext):** chat-v2.loadContextBlocks как эталон НЕ переведён на сервис (acceptance «≥2 из 3» выполнен на tables+regulations); `provenancePreview` в domain = null (list-DTO не отдаёт preview); вторая волна (чат deep-link / документ-страница / аудио S3 / fast-task block-link / phone_call / email-ingest) — в `04_не-сделано`; визуальная qa (Playwright) — за владельцем (нет сети в песочнице).

## Что НЕ входит в v1 (вторая волна / не доделано) — для владельца

Занесено в `second-brain/04_не-сделано/README.md` (2026-06-20):
1. **Deep-link к сообщению чата** — прокинуть `ChatboxMessage.externalId` в evidence; chatbox-таймкоды сейчас синтетические (`startSec:i`, `chatbox-ingest.service.ts:290`).
2. **Якорь к странице документа** — page-aware парсинг + bbox-стиль RAGFlow + превью страницы в S3 через backend-прокси (RBAC).
3. **Аудио голосовых заметок в S3** — сейчас выбрасывается после ASR (`telegram-bot.adapter.ts:622`); + retention-крутилка.
4. **Block-линк задач из встреч fast-пути** (RC-5) — нужен матчинг IdeaBlock или расширение `MeetingReportFastTaskSchema`.
5. **`phone_call`-адаптер** — мёртвый enum без адаптера.
6. **email-ingest баг** — тело под `payload.text`, `SegmentBuilder` ждёт `fullText` (`email-fetch.service.ts:130` vs `segment-builder.service.ts:189`) → письмо зашумляется.
