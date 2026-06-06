---
type: tz
status: ready-to-implement
feature: meeting-report-reliability-and-ui-honesty
date: 2026-06-06
owner: Сергей (sergrv80@gmail.com)
relates_to:
  - plans/analysis/2026-06-05-manual-qa-RESULTS.md
  - plans/tz/2026-06-05-bonus-access-and-paywall-sync.md
  - plans/tz/2026-06-05-frontend-detail-pages-and-ui-honesty.md
---
> Анализ-источник: `plans/analysis/2026-06-05-manual-qa-RESULTS.md` (разделы «ПРОГОН 2» и «🔬 ГЛУБОКИЙ РАЗБОР ОТЧЁТА»). Статус согласования: 2026-06-06.

# ТЗ. Надёжность и честность отчёта встречи

## Цель
Сделать так, чтобы страница результата встречи `/meetings/[id]/result` **не теряла данные и не вводила пользователя в заблуждение**:
1. основной отчёт по типу встречи **открывается** (сейчас 404);
2. быстрый отчёт/follow-up **сохраняется** (сейчас теряется из-за гонки записи);
3. в отчёте видны **все** извлечённые задачи (сейчас видна 1 из 6);
4. спикер подписан **именем** («Алексей»), а не «Participant»;
5. поведенческая аналитика и длительность **честны** (не «0м / 100% тишина» при реальной записи), а тайминги транскрипта восстанавливаются из ASR;
6. интерфейс отчёта **на русском, без сырых дампов и дублей** (Обзор/Заметки/Чат).

## Зачем (болезненное состояние — факт прода 2026-06-06)
Диагностика боевой встречи `01KTDHPTHS9T5YGXFANKES765J` (владелец провёл вживую, разобрано в QA-прогоне 2/2.1):
- вкладка «Отчёты» → «Открыть» основного отчёта → диалог **«Не удалось загрузить отчёт.»** (`GET /reports/<aiResultId>` → 404);
- `summaryFast`/`customOutputMd`/`followUpEmail` = `null` (быстрый отчёт потерян), `reportStatuses.reportFast='partial'`;
- вкладка «Задачи» показывает **1** задачу («Набрать команду» 45%), скрывая 5 конкретных (в БД 6 задач);
- спикер в транскрипте/дорожках — **«Participant»**, не «Алексей»;
- «Длительность 0м», «Всего речи 0 с», «Тишина 100 %», таблица поведения вся в нулях — при записи 47 с;
- Обзор показывает сырой дамп `structuredData` (англо-ключи `tasks/blockers/decisions/...` + JSON-строка задач);
- «Транскрипт · 1 **реплик**» (плюрализация), «Заметки» = дубль summary, два входа в один чат по встрече.

Бизнес-эффект: первый же реальный отчёт владельца выглядит как «AI ничего толком не извлёк и половина не открывается», хотя данные в БД есть — это вопрос **доверия к ядру продукта**.

## REALITY-CHECK (проверено чтением кода 2026-06-06)
- **S5-01 видео — УЖЕ ПОФИКШЕНО** (вне scope реализации): `frontend/src/ui/components/meeting-result-v2/MeetingPlayer.tsx` получил `load="eager"` (commit `8fab2fc2`, ветка `sergdev`). Корень был фронтовый (Vidstack дефолт `load="visible"` не инициировал загрузку), бэкенд/S3/файл исправны (presigned → 206, видео декодируется). `MeetingPlayer` — единственный плеер, его же используют `ShareMeetingClient.tsx`/`ShareClipClient.tsx`, т.е. `load="eager"` распространяется на них автоматически. **Здесь — только верификация после прод-деплоя.**
- **S6-07 (404 отчёта) — контракт list↔get рассинхронизирован.** `backend/src/modules/meeting-reports/meeting-reports.service.ts`: `list()` (якорь `kind: 'primary'`, строки ~89-107) синтезирует primary-элемент из `AiResult` c `id: aiResult.id`; `get()` (~114-135) ищет **только** `this.prisma.meetingReport.findFirst({ id: reportId })` → для `aiResult.id` → null → `NotFoundException` → 404. `ReportDetailDto extends ReportListItemDto { output: unknown|null }` (`dto/meeting-reports.dto.ts:49-50`). Фронт `ReportsTab.tsx` → `ReportDetailDialog` (стр. 432-497) зовёт `meetingReportsApi.detail(meetingId, reportId)` и при ошибке рисует «Не удалось загрузить отчёт.» (стр. 483). Рендер — `ReportOutputRenderer` (стр. 505+): дампит ключи верхнего уровня как есть (это же — корень S6-04).
- **S6-01 (потеря fast) — гонка TOCTOU, не просто create.** `backend/src/modules/knowledge-core/workers/meeting-report-fast.worker.ts`, `writeSummary` (~566-600): ветвится по `args.hasAiResult` (= `meeting.aiResult !== null`, snapshot при старте воркера ~стр. 348). Fast ждёт LLM ~52 с; параллельный `analyze.worker` за это время создаёт `aiResult` → флаг устарел → ветка `this.prisma.aiResult.create()` (~588) → `Unique constraint (meetingId)`. `AiResult.meetingId` — уникальный (подтверждено ошибкой прода).
- **S6-03 (1 из 6 задач) — `pickPrimaryTasks` отбрасывает main.** `frontend/src/domain/task.ts:55-61`: `const fast = items.filter(t => t.extractorVersion==='fast'); if (fast.length>0) return fast;` → при ≥1 fast-задаче возвращает ТОЛЬКО fast. Здесь fast=1 (conf 0.45), main=5 (conf 0.5). Рассинхрон счётчика: Обзор «Action items»=0 (читает пустой `aiResult.tasks`), `structuredData.tasks`=5, вкладка=1, таблица `Task`=6.
- **S6-08 (спикер «Participant») — дефолт затирает имя.** `backend/src/modules/recordings/recordings.service.ts:359`: `participantName: participant.name || 'Participant'`. Имя берётся из egress-события (у egress-рекордера `kind=EGRESS` имя пусто), хотя рядом (стр. 358) есть `participantRecord` (с `Participant.name`, схема `schema.prisma:1285`). Имя не резолвится.
- **S5-02 (нули) — ASR без пословных таймкодов.** `backend/src/modules/ai/services/vox.service.ts`, `parseVoxResult` (~270-296): «отсутствие `words` — допустимо (merge оставит speech одним turn)». diag: «vox: готова — 0 слов, 284 символов, 48.72с». `backend/src/modules/ai/services/merger.ts` строит turn'ы из `track.words` (якоря: интерфейс с `words` ~стр. 18, цикл ~стр. 69, агрегат `totalDurationSeconds` ~стр. 154) → пусто → один turn без таймингов → `Transcript.totalDurationSeconds=0` → `behavior-metrics.worker.ts` считает нули. Текст распознан верно (45 слов).
- **S6-02 (block-linker JSON).** `KNOWLEDGE_GRAPH/BlockLinkService` (искать `block-linker: invalid JSON LLM-арбитра` / `BlockLinkService`) — невалидный JSON арбитра, спас ретрай.
- **S6-09/10/11/12 (UX).** Транскрипт — плюрализация «1 реплик» + бейдж «0»; «Заметки» = дубль summary; вкладка «Чат» (`MeetingResultPageReal.tsx`, tablist) дублирует постоянную панель `MeetingChatPanel.tsx`; «Длительность 0м» в шапке.
- **Прог-1 находки (пэйвол, детальные страницы Next16, бренд) — НЕ здесь:** см. `relates_to` ТЗ-1/ТЗ-2.

## Принятые решения владельца
| # | Решение | Обоснование | Дата |
|---|---|---|---|
| Р1 | S5-02 ASR-разбор **входит в это ТЗ** отдельной фазой. | Слова владельца 2026-06-06 «всё в одно ТЗ, включая ASR-фазу». Фаза помечена research-tracked: сначала диагностика причины пустых `words`, затем фикс. | 2026-06-06 |
| Р2 | S6-10 «Заметки»: **убрать/переименовать дубль**, НЕ делать редактируемые заметки. | Редактируемые заметки — новая фича (хранилище+API); сейчас цель — убрать дубль summary. | 2026-06-06 |
| Р3 | S6-11 чат: **оставить правую панель `MeetingChatPanel`, убрать вкладку «Чат»**. | Панель всегда под рукой (сворачиваемая), вкладка — дубль с теми же кнопками. | 2026-06-06 |
| Р4 | S6-07 чинить на **бэкенде** (`get()` отдаёт synthesized primary из `AiResult`), а не прятать «Открыть» на фронте. | Честный контракт `list↔get`: раз `list` отдаёт primary с id, `get` обязан его отдавать. Фронт не трогаем — меньше риск. | 2026-06-06 |
| Р5 | S6-01 чинить **атомарным `upsert`** по `meetingId`, убрав флаг `hasAiResult`. | Убирает гонку целиком (не зависит от порядка воркеров); класс-фикс «любой второй писатель `aiResult`». | 2026-06-06 |

## Доказательство выбора (challenge-loop, кратко)
| Решение | A | B | Выбор · почему |
|---|---|---|---|
| S6-01 запись fast | флаг `hasAiResult` + create/update | **атомарный `upsert` по meetingId** | **B** — A оставляет окно гонки (TOCTOU), B чинит корень (класс) |
| S6-07 открытие primary | фронт: для `kind='primary'` не звать `/reports/:id`, показывать инлайн | **бэк: `get()` синтезирует primary из AiResult** | **B (Р4)** — честный контракт, фронт уже корректен (`list` отдаёт primary) |
| S6-03 задачи | фронт: `pickPrimaryTasks` — fast приоритетнее, **но дополняется** main по дедупу заголовков | мерж на бэке | **A** — потеря только в показе; дедуп в `pickPrimaryTasks` минимален и локален |
| S5-02 поведение | только UX-честность (скрыть нули) | **UX-честность + ASR-фикс word-ts** | **B (Р1)** — без таймингов поведение бессмысленно; чиним и корень, и симптом |

Challenge-loop по выбранным: (1) корень, не симптом — да (upsert убирает гонку; get-primary чинит контракт; ASR-фаза чинит источник нулей). (2) эффективнее — да (upsert вместо флага; дедуп вместо нового бэкенд-эндпоинта). (3) кода ради кода нет (переиспользуем `AiResult`, `Participant.name`, существующий `ReportOutputRenderer`).

## Scope
**Входит:** Фаза 0 (верификация видео-фикса) · Ф1 бэкенд-надёжность (S6-07, S6-01, S6-08) · Ф2 показ задач (S6-03) · Ф3 ASR word-timestamps (S5-02, research-tracked) · Ф4 честность поведения/длительности (S5-02-UX, S6-12) · Ф5 UX-чистка отчёта (S6-04, S6-09, S6-10, S6-11) · Ф6 устойчивость block-linker (S6-02).
**Не входит:** пэйвол/бонус (ТЗ-1), детальные страницы Next16/бренд «Z» (ТЗ-2), редактируемые личные заметки (Р2 — отложено), мульти-отчёты по доп.шаблонам (уже есть, не трогаем).

## Граничные контракты
- `AiResult` (Prisma): `meetingId @unique`; поля `summary`, `summaryFast`, `summaryFastModel`, `summaryFastGeneratedAt`, `customOutputMd`, `followUpEmail`, `structuredData Json`, `meetingType`. **Не менять схему AiResult.**
- `ReportDetailDto` = `ReportListItemDto & { output: unknown|null; promptTemplateVersionId?: string|null }` (`dto/meeting-reports.dto.ts:49-50`). Для primary `output` = объект из `aiResult.structuredData` (как есть), `promptTemplateVersionId` = null.
- `Participant.name: String` (`schema.prisma:1285`) — источник имени для S6-08.
- Никаких изменений FSM встречи, billing, RBAC/tenant-границ. Все ручки уже под `TenantGuard`/RBAC — не ослаблять.

---

## Фаза 0 — Верификация задеплоенного видео-фикса (S5-01) `[x]` (код-часть)
> 2026-06-06: `load="eager"` подтверждён грепом в `MeetingPlayer.tsx:101` (единственный плеер, наследуется в Share-клиенты). Боевую проверку «запись проигрывается на проде» делает владелец после деплоя фронта (вне возможностей агента).
**Цель:** подтвердить, что после прод-деплоя фронта запись играет.
**Что входит:** НИКАКОГО кода. После выката `sergdev`: открыть `/meetings/<любая готовая>/result`, убедиться — `<video>` получает `src`, видео воспроизводится; проверить и `ShareMeetingClient` (публичная ссылка).
**Что НЕ входит:** правки плеера (уже сделаны).
**Acceptance:** на проде запись проигрывается (не «вечная крутилка»); в `MeetingPlayer.tsx` присутствует `load="eager"` (греп).
**Закрывает:** S5-01 (верификация).

## Фаза 1 — Бэкенд-надёжность отчёта `[x]`
Три независимых фикса; можно одной волной (разные файлы), каждый самодостаточен.
> Реализовано 2026-06-06 (ветка `sergdev`). Класс-фикс S6-01 расширен: атомарным `upsert` стал и `analyze.worker.upsertEmptyAiResult` (был TOCTOU `findUnique`+`create` — тот же класс гонки). Тесты: get-primary→200 + unknown→404 (1A), writeSummary-upsert ×3 (1B). 42 теста зелёные, build/typecheck/lint ок.

### 1A. Открытие основного отчёта — `get()` отдаёт primary из AiResult (S6-07, Р4)
**Мини-картография:** `backend/src/modules/meeting-reports/meeting-reports.service.ts` — `list()` (~89-107, ветка `kind:'primary'`), `get()` (~114-135). Перед правкой перечитать (строки дрейфуют), якорь — `meeting_report_not_found`.
**Что входит:** в `get(meetingId, reportId, userId)` ПЕРЕД запросом `meetingReport.findFirst` добавить ветку primary: если у встречи есть `AiResult` и `reportId === aiResult.id` — вернуть synthesized `ReportDetailDto`, зеркалящий primary-ветку `list()`, с `output` = `aiResult.structuredData` (если null → объект `{ summary: aiResult.summary }`), `promptTemplateVersionId: null`. Иначе — текущая логика (additional reports).
**Контракт (дословно, образец — НЕ копипастить вслепую, перечитать актуальные имена полей):**
```ts
// get(): после RBAC, до meetingReport.findFirst
const aiResult = await this.prisma.aiResult.findUnique({
  where: { meetingId: meeting.id },
  include: { promptTemplateVersion: { include: { template: true } } },
});
if (aiResult && reportId === aiResult.id) {
  const output =
    aiResult.structuredData ??
    (aiResult.summary ? { summary: aiResult.summary } : null);
  return {
    kind: 'primary',
    id: aiResult.id,
    meetingId: meeting.id,
    templateId: aiResult.promptTemplateVersion?.templateId ?? null,
    templateName:
      aiResult.promptTemplateVersion?.template.name ??
      `Системный шаблон ${meeting.type}`,
    status: 'ready',
    outputPreview: makePreview(aiResult.summary),
    createdAt: aiResult.createdAt.toISOString(),
    completedAt: aiResult.updatedAt.toISOString(),
    llmCostUsd: null,
    llmDurationMs: null,
    errorMessage: null,
    output,
    promptTemplateVersionId: null,
  };
}
```
**Что НЕ входит:** изменение `list()`, фронта, схемы.
**Acceptance:** `GET /api/v1/meetings/<id>/reports/<aiResultId>` → **200** с `output` (не 404); на проде «Открыть» основного отчёта показывает контент, не «Не удалось загрузить отчёт.»; `bunx vitest run` для meeting-reports зелёный (добавить кейс: get primary by aiResult.id → 200).
**Закрывает:** S6-07.

### 1B. Сохранение fast-отчёта — атомарный upsert (S6-01, Р5)
**Мини-картография:** `backend/src/modules/knowledge-core/workers/meeting-report-fast.worker.ts`, `writeSummary` (~566-600). Якорь — `summaryFast:`. Перед правкой перечитать.
**Что входит:** заменить ветвление по `hasAiResult` на один атомарный `aiResult.upsert` по `{ meetingId }`. `hasAiResult` из сигнатуры/вызова убрать (или игнорировать). `create`-ветка пишет минимально-валидный `aiResult` (`summary: ''`), `update`-ветка — только fast-поля.
**Контракт (образец):**
```ts
await this.prisma.aiResult.upsert({
  where: { meetingId: args.meetingId },
  update: {
    summaryFast: text,
    summaryFastModel: args.modelUsed,
    summaryFastGeneratedAt: nowAt,
  },
  create: {
    meetingId: args.meetingId,
    meetingType: args.meetingType,
    summary: '',
    modelUsed: args.modelUsed,
    summaryFast: text,
    summaryFastModel: args.modelUsed,
    summaryFastGeneratedAt: nowAt,
  } as Prisma.AiResultUncheckedCreateInput,
});
```
**Что НЕ входит:** изменение порядка воркеров, схемы AiResult, других writer'ов fast (quality-score/tasks остаются как есть — но проверить, нет ли там такого же create/флага: если есть — это тот же КЛАСС, починить аналогично upsert'ом; см. Риски).
**Acceptance:** на повторно проведённой тест-встрече `reportStatuses.reportFast='ready'` (не `partial`), `summaryFast` не null, в логах нет `Unique constraint failed ... aiResult` для meetingId; греп: в `writeSummary` есть `aiResult.upsert`, нет `aiResult.create(` в паре с веткой по `hasAiResult`.
**Закрывает:** S6-01.

### 1C. Имя спикера вместо «Participant» (S6-08)
**Мини-картография:** `backend/src/modules/recordings/recordings.service.ts:359` (`participantName: participant.name || 'Participant'`), рядом `participantRecord` (~358). Якорь — `'Participant'`.
**Что входит:** резолвить имя из `participantRecord?.name` ПЕРЕД дефолтом; русский дефолт «Участник» как последний fallback. Если в окружении исполнения нет `participantRecord` — fallback на `participant.name`, затем «Участник».
**Контракт:** `participantName: participant.name || participantRecord?.name || 'Участник'` (порядок: имя из события → имя из записи участника → русский дефолт).
**Что НЕ входит:** ретро-бэкфилл уже записанных дорожек со «Participant» (отдельный backfill, vNext — см. «Вне scope»); изменение merge/transcribe (имя пробрасывается оттуда дальше само).
**Acceptance:** на новой записи `RecordingAudioTrack.participantName` = имя участника (не «Participant»); в UI «Транскрипт» спикер подписан именем; греп: в recordings.service.ts нет `|| 'Participant'`.
**Закрывает:** S6-08.

**Граф фазы 1:** 1A, 1B, 1C независимы (3 разных файла) → одна волна.

## Фаза 2 — Показ всех задач (S6-03) `[x]`
> Реализовано 2026-06-06. `pickPrimaryTasks` → merge fast+main с дедупом по trim+lowercase. Журнал-превью (`MeetingDetailPane`) переведён с устаревшего `aiResult.tasks` на `useMeetingTasks`+`pickPrimaryTasks`. Бейдж вкладки и стат-карта уже читали `primaryTasks` — теперь показывают 6. Тест `domain/__tests__/task.test.ts` (6 кейсов). typecheck/lint/build/тест зелёные.
**Мини-картография:** `frontend/src/domain/task.ts:55-61` (`pickPrimaryTasks`). Поверхности счётчика: `MeetingResultPageReal.tsx` (вкладка «Задачи» — бейдж `e359`; стат-карта «Задачи»; блок «Action items» в превью списка встреч). Перед правкой перечитать.
**Цель:** показывать ВСЕ извлечённые задачи; счётчик задач одинаков во всех поверхностях и равен числу реальных `Task`.
**Что входит:**
- `pickPrimaryTasks`: вместо «есть fast → только fast» — **объединять** fast и main с дедупом по нормализованному заголовку (fast приоритетнее при дубле). Образец:
```ts
export function pickPrimaryTasks(items: TaskDomain[]): TaskDomain[] {
  const norm = (t: TaskDomain) => t.title.trim().toLowerCase();
  const fast = items.filter((t) => t.extractorVersion === 'fast');
  const seen = new Set(fast.map(norm));
  const rest = items.filter(
    (t) =>
      (t.extractorVersion === 'v2' || t.extractorVersion === null) &&
      !seen.has(norm(t)),
  );
  return [...fast, ...rest];
}
```
- Счётчик задач (бейдж вкладки, стат-карта, «Action items») — из `pickPrimaryTasks(tasks).length` (таблица `Task`), а НЕ из `aiResult.tasks` (он пуст). Найти места, читающие `aiResult.tasks` для счётчика, и переключить на тот же источник.
**Что НЕ входит:** изменение извлечения задач на бэке; дедуп на бэке.
**Acceptance:** на тест-встрече с fast=1+main=5 вкладка «Задачи» и стат-карта показывают **6** (объединение, без дублей); «Action items»/«Задач не найдено» не показывает 0 при наличии задач; греп: в `pickPrimaryTasks` нет `if (fast.length > 0) return fast`; `bun run typecheck && bun run lint && bun run build` (frontend) зелёные.
**Закрывает:** S6-03.

## Фаза 3 — ASR word-timestamps: диагностика и фикс (S5-02, research-tracked) `[x]`
> **Вывод диагностики 3.0 (по чтению кода, без сырого прод-ответа):**
> - **(в) подтверждено:** `vox.submit` отправляет только `file/model/punctuationMode/diarizationEnabled` — **нет параметра запроса пословных таймингов**. Угадывать имя параметра НЕ стал (риск 400, как было с `language: «property language should not exist»`) — это решение владельца/нужны доки Vox.
> - **(б) закрыто кодом:** `parseVoxResult` покрывал words только под плоскими `words/wordsTimestamps` (top-level и `result`/`data`), но НЕ `segments[].words` (почти универсальная ASR-форма Whisper/Google/Deepgram). **Добавлено:** при отсутствии плоских words собираем из `segments[].words` тем же word-mapper'ом (единицы не менял). Если Vox отдаёт так — тайминги теперь извлекутся, merger построит turn'ы, `totalDurationSeconds>0`, метрики ненулевые.
> - **(а) не доказуемо без сырого ответа:** модель `v3_e2e_rnnt` может не возвращать word-ts by design. **Инструментировано:** новый лог `vox.no_words` (WARN, dbLog) при «текст есть, words=0» пишет ТОЛЬКО форму ответа (`rawKeys/nestedKeys/hasSegments/segmentsCount/firstSegmentKeys`, без текста — PII-safe). Следующая реальная встреча покажет точную форму → тогда решение: (б) расширить ещё / (в) добавить submit-param по докам / сменить модель (владелец).
> - **Фаза 4 (честный UX) — основной ответ ПОКА** корень не подтверждён на проде: нули скрыты, длительность из записи.
> - Тесты (golden, через `poll`+fetch-mock): `segments[].words` → извлечены; `result.segments[].words` (text/start_ms/end_ms) → извлечены; текст без words/segments → пусто без падения. 10 тестов зелёные. typecheck/lint/build ок.
> - **TODO-реестр:** строку в `second-brain/04_не-сделано/` про «корень word-ts не подтверждён на проде» добавить, когда файл освободится от незакоммиченной правки параллельной сессии (на момент сдачи был занят).
**Мини-картография:** `backend/src/modules/ai/services/vox.service.ts` (`parseVoxResult` ~270-296, `pollResult` ~191-234, лог `vox.completed`), `backend/src/modules/ai/services/merger.ts` (turn-builder), `backend/src/modules/ai/workers/transcribe.worker.ts`, `behavior-metrics.worker.ts`.
**Цель:** восстановить пословные тайминги, чтобы `Transcript.totalDurationSeconds` и поведенческие метрики были ненулевыми на нормальной записи.
**Шаг 3.0 — диагностика (обязательно ДО фикса, research):** определить, ПОЧЕМУ `words` пуст. Гипотезы и проверки:
- (а) модель `v3_e2e_rnnt` в принципе не возвращает word-level timestamps на этом endpoint → проверить сырой ответ Vox на тестовом аудио (залогировать raw payload-ключи; в `vox.empty`/`vox.completed` уже есть приватный лог сырых ключей — использовать);
- (б) ответ содержит слова под другим ключом/формой, а `parseVoxResult` их не распознаёт (есть поддержка `words:[{word,startMs,endMs}]` и `{text,start_ms,end_ms}` — проверить, нет ли `segments[].words`, `result.words`, `timestamps`);
- (в) endpoint требует флага «вернуть word timestamps» в запросе — проверить параметры submit.
**Шаг 3.1 — фикс по итогам 3.0:** одно из — расширить парс `parseVoxResult` под реальную форму; ИЛИ добавить параметр запроса к Vox; ИЛИ (если модель не умеет) — задокументировать ограничение и оставить честный UX (Фаза 4) как основной ответ, зафиксировав в `second-brain/04_не-сделано/`.
**Что НЕ входит:** смена ASR-провайдера/модели на другой движок (это отдельное решение владельца + ТЗ); правка UX-честности (Фаза 4).
**Acceptance:** на повторно проведённой тест-встрече (нормальная речь ≥30 с) `Transcript.totalDurationSeconds > 0` и turn'ы имеют ненулевые `startMs/endMs`, поведенческие метрики ненулевые; ЛИБО (если 3.0 доказал, что модель не отдаёт word-ts) — в `second-brain/04_не-сделано/README.md` есть строка с причиной и Фаза 4 закрывает UX. Решение 3.0 (a/б/в) зафиксировать в `plans/analysis/` или в теле фазы при сдаче.
**Закрывает:** S5-02 (корень) ИЛИ явно эскалирует в Фазу 4 с зафиксированной причиной.
**Риск-флаг:** исход неизвестен заранее — это research-фаза; Фаза 4 (честный UX) от неё НЕ зависит и идёт всё равно.

## Фаза 4 — Честность поведения и длительности (S5-02-UX, S6-12) `[x]`
> Реализовано 2026-06-06. S6-12: `fmtDurationCompact` суб-минута → «<1 мин» (не «0м»); `durationMs` трактует `meeting.durationMs===0` как отсутствие → fallback на `recording.durationSeconds`. S5-02-UX: `MeetingBehaviorSection` при нулевом сигнале речи (`totalSpeechMs<=0` и все `speakingTimeMs<=0`) показывает «Поведенческая аналитика недоступна для этой записи» вместо таблицы нулей/«Тишина 100 %». Гейт строгий (`hasBehaviorSignal`) — не скрывает там, где речь есть. Тесты: `format-utils.test.ts`, `behavior-signal.test.ts` (8 кейсов). typecheck/lint/build зелёные.
**Мини-картография:** `MeetingResultPageReal.tsx` — блок «Поведение участников» (рендер таблицы/метрик из `behavior-metrics`), стат-карта «Длительность», шапка `durationMs` (~стр. 239-242, fallback на `recording.durationSeconds*1000` уже есть). Перед правкой перечитать.
**Цель:** не показывать нулевую поведенческую аналитику и «0м» как факт.
**Что входит:**
- Если `transcript.totalDurationSeconds === 0` (или поведенческие метрики пусты/все нули) — **скрывать** блок «Поведение участников» (или заменять на строку «Поведенческая аналитика недоступна для этой записи»), а не показывать таблицу нулей и «Тишина 100 %».
- Длительность (шапка + стат-карта) брать из `recording.durationSeconds` когда `meeting.durationMs`/transcript-тайминги = 0; «0м» не показывать при наличии записи (47 с → «~1 мин»).
**Что НЕ входит:** ASR-фикс (Фаза 3); удаление воркера behavior-metrics.
**Acceptance:** на встрече с `totalDurationSeconds=0` блок «Поведение» скрыт/честный (нет «100 % тишина»), длительность показана из записи (не «0м»); греп: условие скрытия по нулевым таймингам присутствует; typecheck/lint/build зелёные.
**Закрывает:** S5-02 (UX-симптом), S6-12.

## Фаза 5 — UX-чистка интерфейса отчёта (S6-04, S6-09, S6-10, S6-11) `[x]`
> Реализовано 2026-06-06. S6-04: единый модуль `structured-report.tsx` (русские заголовки + человекочитаемый `StructuredFieldValue`, задачи списком, пустые секции скрыты, ноль сырого JSON) — общий для Обзора и диалога отчёта. S6-09: плюрализация «реплик» + честная длительность хедера транскрипта (нет «0 мин»). S6-10: вкладка «Заметки» убрана (дубль summary из Обзора). **S6-11 — КОРРЕКТИРОВКА премисы:** по факту вкладка «Чат» = чат комнаты (живые сообщения встречи, с поиском/группировкой), а не дубль AI-панели (премиса устарела после мержа chatBox). Решение владельца 2026-06-06: **переименовать «Чат» → «Чат комнаты», НЕ удалять** (без потери данных; AI-панель справа остаётся). Тест `structured-report.test.ts` (5 кейсов). typecheck/lint/build зелёные.
**Мини-картография:** `frontend/src/ui/components/meeting-result-v2/` — `MeetingResultPageReal.tsx` (Обзор: блок `structuredData`; tablist с вкладками «Чат»/«Заметки»; правая панель `MeetingChatPanel`), `ReportsTab.tsx` (`ReportOutputRenderer` ~505). Перед правкой перечитать.
**Цель:** русский, человекочитаемый отчёт без сырых дампов и дублей.
**Что входит:**
- **S6-04:** маппинг ключей `structuredData`/output → русские заголовки в ЕДИНОМ месте (`ReportOutputRenderer` + блок Обзора): `tasks→Задачи`, `blockers→Блокеры`, `decisions→Решения`, `discussed→Обсудили`, `next_step→Следующий шаг`. `tasks` рендерить списком (title построчно), не JSON-строкой; `dueDate`/`assignee` скрывать когда null; пустые секции (`blockers: []`) скрывать или «—».
- **S6-09:** плюрализация «N реплика/реплики/реплик» (взять существующий plural-хелпер фронта, если есть; иначе локальный); разобраться с бейджем «0» рядом с «Транскрипт» (что считает — привести в соответствие или убрать).
- **S6-10 (Р2):** убрать вкладку «Заметки»-дубль ИЛИ переименовать в «Краткое содержание» (если остаётся — не дублировать с Обзором; рекомендуется убрать вкладку, summary уже в Обзоре).
- **S6-11 (Р3):** убрать вкладку «Чат» из tablist; оставить правую панель `MeetingChatPanel` (сворачиваемую). Убрать связанный таб-контент.
**Что НЕ входит:** изменение логики чата/ассистента; редактируемые заметки (Р2); парные токены не вводить (только текст/структура).
**Acceptance:** Обзор и диалог отчёта показывают русские заголовки и список задач (не JSON-строку, не англо-ключи); транскрипт — корректная форма мн.числа; вкладок «Чат» и «Заметки»-дубль в tablist нет; правая панель чата на месте; грепы: в `ReportOutputRenderer`/Обзоре нет вывода сырых `tasks/blockers/...` без маппинга; в tablist нет `value="chat"`/«Заметки»-дубля; typecheck/lint/build зелёные.
**Закрывает:** S6-04, S6-09, S6-10, S6-11.

## Фаза 6 — Устойчивость block-linker к JSON (S6-02) `[x]`
> Реализовано 2026-06-06. РЕВИЗИЯ: устойчивость УЖЕ была (strict `json_schema`-режим, ретрай ×2, `tryParseJson` снимает ```-обёртку/вытаскивает {…}, fallback на none + метрика на исчерпании; покрыто тестами valid/fenced/garbage×2/throw×2). Единственный пробел — нет метрики доли невалидных ответов per-attempt. Добавлен счётчик `kc_block_linker_invalid_json_total` (reason=parse|llm_error), инкремент в обеих ветках цикла; тест «грязный→валидный через ретрай → связь строится + метрика». typecheck/lint/build зелёные (8 тестов).
**Мини-картография:** `KNOWLEDGE_GRAPH/BlockLinkService` (грепнуть `block-linker: invalid JSON LLM-арбитра` / `BlockLinkService` в `backend/src/modules/knowledge-core/`). Перед правкой перечитать.
**Цель:** арбитр связей не терять при «грязном» JSON.
**Что входит:** строгий JSON-режим запроса к LLM (если провайдер поддерживает `response_format`/JSON-mode — см. правило кэш-дружественных промптов, SYSTEM не ломать) ИЛИ устойчивый парс (извлечение JSON-блока, повтор уже есть). Метрика доли невалидных ответов (по возможности).
**Что НЕ входит:** смена провайдера/модели block-linker; переписывание графа.
**Acceptance:** при искусственно «грязном» ответе арбитра связи всё равно строятся (юнит/мини-тест парсера); греп: парс не падает на не-JSON. typecheck/lint/build зелёные (backend).
**Закрывает:** S6-02.

## Граф зависимостей фаз
- **Ф0** — независима (ops, после деплоя).
- **Ф1 (1A/1B/1C)**, **Ф2**, **Ф5**, **Ф6** — взаимно независимы (разные файлы) → можно параллелить волнами.
- **Ф3** (ASR) — независима, но research; **Ф4** (честный UX) — независима и НЕ зависит от исхода Ф3 (делать в любом случае).
- Рекомендуемый порядок по приоритету: Ф1 → Ф2 → Ф5 → Ф4 → Ф3 → Ф6 (Ф0 — по факту деплоя).

## Риски / ревью-аспекты (для strict-production-review-gate)
- **S6-01 класс:** проверить, нет ли в `meeting-report-fast.worker.ts` ДРУГИХ писателей `aiResult`/`Task`/`chapters` с таким же «флаг + create» (quality-score, tasks, chapters fast-writer'ы) — если есть, это тот же КЛАСС гонки, чинить upsert'ом единообразно (`feedback_fix_the_whole_class_not_the_case`). Но каждый верифицировать отдельно (один симптом ≠ один корень).
- **S6-07:** не сломать additional-reports (id из `meetingReport`) — primary-ветка только при `reportId === aiResult.id`.
- **S6-03:** дедуп по заголовку не должен схлопывать реально разные задачи (нормализация только trim+lowercase, не fuzzy).
- **Ф4:** не скрыть поведение там, где тайминги ЕСТЬ (условие строго `totalDurationSeconds===0`/пустые метрики).
- **Ф3:** raw-логирование ответа Vox не должно писать в логи персональные данные сверх необходимого (только ключи/форму, не полный транскрипт в WARN).
- Все ручки остаются под `TenantGuard`/RBAC; tenant-границы не ослаблять.

## Idempotency / feature-flag / prod-deploy
- Изменения: backend (meeting-reports.service, meeting-report-fast.worker, recordings.service, vox.service/merger, BlockLinkService) + frontend (task.ts, meeting-result-v2/*). **Схема БД не меняется, новых ENV нет, новых seed/patch/backfill нет** → prod-deploy: обычная пересборка backend (`docker compose up -d --build backend`) + деплой фронта. Шагов в `prod-deploy-log.md` не требуется (зафиксировать явно при сдаче). Если Ф3 добавит ENV-параметр запроса к Vox — провести через `env.schema.ts`/`TypedConfigService` и добавить запись в `prod-deploy-log.md` Шаг 1.
- Feature-flag не нужен (исправление видимого поведения, не рискованное внешнее).
- Бэкфилл «Participant»→имя для уже записанных дорожек — **vNext** (см. ниже), не в этом ТЗ.

## Вне scope / отложено (vNext)
- Backfill `RecordingAudioTrack.participantName` со «Participant» на реальные имена для прошлых встреч (идемпотентный `backfill-*.ts`, регистрация в `apply-prod-deploy.ts`) — отдельная задача; здесь чиним только новые записи.
- Редактируемые личные «Заметки» по встрече (Р2) — отдельная фича (модель+API).
- Смена ASR-модели/провайдера, если Ф3.0 докажет, что `v3_e2e_rnnt` не отдаёт word-ts — решение владельца + отдельное ТЗ.

## DoD
- `bun run typecheck` (вкл. `.spec`) / `lint` / `build` зелёные (backend и frontend по затронутым).
- Юнит/мини-тесты: get-primary (1A), upsert без коллизии (1B), pickPrimaryTasks-merge (Ф2), block-linker-parse (Ф6).
- second-brain: обновить `01_projects/` по отчёту встречи (`api-layer.md` — поведение `get /reports/:id` для primary; профильная заметка по meeting-result), `02_architecture/code-pitfalls.md` (гонка aiResult / TOCTOU; vox без word-ts). prod-deploy-log — только если Ф3 добавит ENV.
- Рефлексия в `05_история/`.
- Acceptance всех фаз выполнены, факт-чек грепом (`feedback_agents_can_lie_about_edits`).

## Итог
**Реализовано целиком (ветка `sergdev`, 7 коммитов кода + 2 docs):**
- Ф1 `a76b0445` — S6-07 get-primary (404→200), S6-01 atomic upsert (+класс-фикс `analyze.worker`), S6-08 имя спикера.
- Ф2 `ccb2dd00` — S6-03 `pickPrimaryTasks` merge + журнал на `useMeetingTasks`.
- Ф5 `35b0304a` — S6-04 единый человекочитаемый рендер, S6-09 плюрализация, S6-10 убрана «Заметки», S6-11 «Чат»→«Чат комнаты» (премиса исправлена, решение владельца).
- Ф4 `b9d78afb` — S6-12 честная длительность, S5-02-UX честное поведение.
- Ф6 `f3ba3ce1` — S6-02 метрика `kc_block_linker_invalid_json_total` (устойчивость уже была).
- Ф3 `c26348df` — S5-02 `segments[].words` + диагностика `vox.no_words` (research-tracked).
- Ф0 — `load="eager"` в коде; прод-проверка проигрывания за владельцем.

**Осталось / за владельцем:**
- Ф0: боевая проверка проигрывания записи после деплоя фронта.
- Ф3: корень word-ts не подтверждён без сырого прод-ответа — лог `vox.no_words` доберёт форму на след. встрече; если модель `v3_e2e_rnnt` не отдаёт word-ts — решение по submit-параметру/смене модели за владельцем. Строку в `04_не-сделано/` добавить, когда файл освободится от правки параллельной сессии.
- Все ручки под `TenantGuard`/RBAC не ослаблены; схема БД/ENV/seed не менялись → прод = пересборка backend + деплой фронта.
