---
type: tz
status: ready-to-implement
feature: universal-daily-checkin-fixator
date: 2026-06-21
owner: sergrv80 (владелец продукта Кора)
relates_to:
  - plans/analysis/2026-06-21-universal-daily-checkin-fixator/99-synthesis.md
  - plans/tz/2026-06-17-bitrix24-source-sync.md
  - plans/tz/2026-06-10-daily-checkin-to-graph-bridge.md
  - docs/operations/feature-flags.md
---
> Анализ: `plans/analysis/2026-06-21-universal-daily-checkin-fixator/99-synthesis.md` (research-complete) · Статус согласования развилок: 2026-06-21 (владелец закрыл Р-1…Р-7, §8 анализа)
> Парный orchestrator-prompt: `plans/tz/2026-06-21-universal-daily-checkin-fixator-orchestrator-prompt.md`

# ТЗ — Универсальный «фиксатор» дневных чек-инов

## Принцип

Единый модуль фиксирует ежедневный **план** и **отчёт о сделанном** сотрудника из **любого** источника данных (видеовстреча, загруженная встреча, аудиозвонок, Bitrix-чаты, chatbox-переписки, личка-бот, почта, free_note) и отражает на дашборде «сдал / не сдал». Отталкиваемся **не от канала**, а от признака «в данных обозначен **связанный** сотрудник» (`personId≠null`). Связывание сотрудников уже синхронизировано — в этом ТЗ авто-связь **не достраиваем**.

## Цель + Зачем

**Болезненное состояние (по коду, verified):** сейчас `DailyCheckIn` наполняется только из лички Telegram-бота (`self_initiated`/`cron_prompted`) и веб-кабинета (`manual`). Логика «распознать план/отчёт» заперта в `telegram-bot.adapter.ts`. Переписки (Bitrix/chatbox/email/free_note) и реплики на встречах в чек-ин не превращаются → на дашборде «сдал/не сдал» сотрудник, отчитавшийся в рабочем чате или на планёрке, числится «не сдал».

**Что делаем:** общий слой-детектор «дневных сигналов» поверх уже сохранённых данных (`RawEvent`), который для каждого связанного сотрудника за день определяет наличие плана и/или отчёта и пишет в `DailyCheckIn`. Дашборд `getMissingCheckIns`/`getCheckinDiscipline` уже считает ВСЕ чек-ины без фильтра по источнику (verified, см. REALITY-CHECK) → новые чек-ины автоматически попадут в «сдал».

**Метрика «решено»:** доля дней, где факт «сотрудник дал план/отчёт» зафиксирован из источника ≠ telegram/manual — растёт с 0; число ложных «сдал» (нерабочий текст принят за план) ≈ 0 за счёт гейта (R12–R14).

## REALITY-CHECK (фактический статус по коду 2026-06-21)

| Что | Факт | Вывод для ТЗ |
|---|---|---|
| Модель `DailyCheckIn` | есть, `schema.prisma:7103-7171`, ключ `@@unique([tenantId, personId, kind, dateLocal])` | переиспользуем; merge-семантику добавляем |
| `enum DailyCheckInSource` | `schema.prisma:7076-7080`: `cron_prompted/self_initiated/manual` | расширяем (Ф1) |
| `DailyCheckInService.upsertFromParser` | `daily-checkin.service.ts:102`, **перезатирает** plans/dones | НЕ менять (используется telegram); добавляем `upsertFromDaySignal` с merge (Ф4) |
| Дашборд `getMissingCheckIns`/`getCheckinDiscipline`/`fetchTeamTemperature` | **НЕ фильтруют по `source`** (`operations-dashboard.service.ts:230,268,586`) | новые чек-ины автоматически в «сдал»; правка дашборда минимальна (Ф7 — только проброс source в DTO) |
| Общая точка ingest | `ingest.service.ts:148` `enqueueRawReceived` → очередь `core.raw-events` | **НЕ вешать второй Worker** (BullMQ отдаёт job одному consumer'у — украдёт у block-ingest, `queues.ts:20`) → детектор читает БД напрямую |
| Атрибуция автора | `resolveSubjectPersonId` (`entity-resolution.service.ts:1114`), per-turn `authorPersonId` в payload bitrix/chatbox/meeting | переиспользуем для извлечения (personId, text) |
| `Participant.personId` | гость без регистрации → `userId=null` (`participant-context.service.ts:31-42`) | мост встречи отбрасывает участников без personId |
| Классификатор интентов | `query-classifier.service.ts` (8 интентов, cache-friendly `classify.prompt.ts`) | НЕ переиспользуем напрямую (он про чат-намерение одного сообщения); делаем выделенный `taskType: day-signal-detect` под агрегат дня |
| `linkMode='auto'` (Bitrix/chatbox→Person) | в enum есть, в коде НЕ реализован | вне scope (решение владельца); фильтр `personId≠null` + метрика отброшенного |

## Принятые решения владельца (2026-06-21, не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| Р-1 | Не делим каналы по версиям — анализируем ВСЁ; фильтр = связанный сотрудник | анализ §8; единый модуль, а не «v1 канал» |
| Р-2 | Два входа одного детектора: дневной cron-агрегатор (переписки) + реактивный слушатель встреч (сразу) | анализ §6.5; дёшево + полно + своевременно для встреч |
| Р-3 | Авто-связь НЕ достраиваем; анализируем только `personId≠null`; метрика отброшенного | владелец: «связывание решено»; [ASSUMPTION] опираемся на существующую синхронизацию |
| Р-4 | Спонтанные сообщения (unsolicited) считаем; защита от ложного «сдал» обязательна | отчёт/план может прийти из нескольких каналов за день |
| Р-5 | План/итоги со встречи → чек-ин участника, приоритет ниже явного личного | закрывает «на планёрке обсудили планы» |
| Р-6 | chatbox-переписки (вкл. клиентские/групповые) считаем; фильтр по автору-сотруднику, не по каналу | сотрудники везде связаны; chatbox ≠ только клиенты |
| Р-7 | Помечаем источник: расширяем `DailyCheckInSource` | дашборд/разрешение конфликтов опираются на источник |

## Доказательство выбора (где живёт детектор)

| Критерий | A. Второй Worker на `core.raw-events` | B. Дневной cron-агрегатор + реактивный слушатель встреч (выбрано) | C. Debounce per-person-day job |
|---|---|---|---|
| Не ломает block-ingest | ✗ BullMQ отдаёт job одному consumer'у — украдёт (`queues.ts:20`, verified) | ✓ читает БД, очередь не трогает | ✓ |
| Стоимость LLM | ✗ вызов на каждый RawEvent | ✓ 1 вызов/сотрудник/день (+ встречи реактивно) | ⚠️ 1–3/сотрудник/день |
| Полнота «и план, и отчёт за день» | ✗ по событию, не агрегат | ✓ агрегирует все каналы за день | ✓ |
| Своевременность встреч | ⚠️ | ✓ реактивный слушатель сразу | ✓ |
| Сложность | низкая, но неверная | средняя | высокая (debounce-инфра) |

**Выбран B.** C (debounce-инкремент для суб-часовой задержки чат-планов) — **отложен как оптимизация** с числовым триггером: вводить, только если владелец потребует, чтобы план из чата отражался в «сдал» быстрее, чем через дневной свип (раздел «Вне scope»). A отвергнут (ломает граф). Полное доказательство — анализ §6.

## Scope

**Входит:** расширение `DailyCheckInSource`; merge-семантика чек-ина (`sourceRank`, накопление вкладов); `DaySignalExtractorService` (RawEvent → `[{personId, text}]` по связанным сотрудникам); LLM-детектор `day-signal-detect` (flash, cache-friendly) + предфильтр + гейт качества; `DaySignalAggregatorCron` (дневной свип по сотруднику); реактивный мост встреча→чек-ин; крутилки в AdminSetting; kill-switch; проброс `source` в дашборд-DTO; метрики; миграция.

**Не входит (с судьбой):**
- Авто-связь `BitrixUser/ChatboxMember→Person` (`linkMode='auto'`) — решение владельца Р-3, опираемся на существующую синхронизацию. vNext при необходимости — отдельное ТЗ.
- Debounce-инкрементальный режим (вариант C) — оптимизация, триггер «нужна суб-часовая задержка для чат-планов».
- Privacy/152-ФЗ как отдельный эпик — deprioritized ([[feedback_privacy_deprioritized_now]]); scope=связанные сотрудники держим, отдельных согласий не вводим.
- Изменение `upsertFromParser` (telegram-путь) — не трогаем.

## Граничные контракты

- **Синхронизация Bitrix/chatbox/email** (`bitrix-ingest`/`chatbox-ingest`/`email-fetch`) — считаем уже работающей; ТЗ читает их `RawEvent`, не меняет адаптеры. Формы payload (verified): `bitrix_dialog_session` (`transcript.turns[].authorPersonId`), `chatbox_chat_session` (`messages[].from ∈ {client,manager}`, атрибуция через `ChatboxMember.linkedPersonId`), `email` (from.address), free_note (`conversational`).
- **block-ingest / resolveSubjectPersonId** — переиспуем `EntityResolutionService.resolveSubjectPersonId(tenantId, {...})` как есть, не меняем сигнатуру.

---

## Фазы

Зависимости: **Ф1 → Ф2,Ф4 → Ф3 → Ф5,Ф6 → Ф7 → Ф8**. Ф2 и Ф4 независимы между собой (можно параллельно после Ф1). Ф5 и Ф6 независимы после Ф3+Ф4.

```
Ф1 (Prisma enum+merge-поля)
 ├─ Ф2 (Extractor)         ┐
 └─ Ф4 (upsertFromDaySignal)┤→ Ф3 (LLM-детектор) → ┌ Ф5 (cron-агрегатор) ┐→ Ф7 (дашборд DTO) → Ф8 (settings+flags+deploy)
                            │                       └ Ф6 (мост встречи)   ┘
```

### Ф1 — Prisma: расширить `DailyCheckInSource` + поля merge/audit

**Цель:** значения источника и поля для накопления вкладов.
**Файлы:** `backend/prisma/schema.prisma` (enum `DailyCheckInSource` `:7076-7080`; модель `DailyCheckIn` `:7103-7171`), новая миграция `prisma/migrations/*`.
**Контракт (дословно добавить):**
```prisma
enum DailyCheckInSource {
  cron_prompted
  self_initiated
  manual
  meeting
  bitrix
  chatbox
  email
  phone_call
}
```
В модель `DailyCheckIn` добавить (после `source`):
```prisma
  /// Вклады в этот чек-ин по источникам (audit + merge). Массив
  /// Array<{ source: DailyCheckInSource, at: ISOstring, rank: number }>.
  /// Победитель содержимого — максимальный rank (см. ТЗ Ф4 sourceRank).
  sourceContributions Json?
```
**Что НЕ входит:** изменение существующих значений/индексов; правка `upsertFromParser`.
**Acceptance:**
- `bun run prisma:migrate -- --name daily_checkin_universal_sources` создаёт миграцию; `bun run prisma:generate` зелёный.
- grep в `schema.prisma`: `enum DailyCheckInSource` содержит `meeting`, `bitrix`, `chatbox`, `email`, `phone_call`.
- `bun run typecheck` зелёный (тип `DailyCheckInSource` в Prisma Client расширен).
**Закрывает:** R7.

### Ф2 — `DaySignalExtractorService` (RawEvent → `[{personId, text}]`)

**Цель:** из payload любого источника извлечь реплики **связанных сотрудников** с атрибуцией к `personId`.
**Новый файл:** `backend/src/modules/operations/services/day-signal-extractor.service.ts`.
**Контракт:**
```ts
export interface DaySignalMessage {
  personId: string;
  text: string;
  source: 'meeting' | 'bitrix' | 'chatbox' | 'email' | 'phone_call' | 'self_initiated';
  occurredAt: Date;
}
extractFromRawEvent(event: RawEvent): Promise<DaySignalMessage[]>
```
**Поведение (R8):**
- По `event.sourceType` выбрать парсер payload (формы — см. «Граничные контракты»). Для каждого сообщения/turn резолвить `personId` через `this.entities.resolveSubjectPersonId(event.tenantId, {...})` (приоритет authorPersonId→email→userId→participant→speakerName).
- Сообщения с `personId===null` **отбросить** + инкремент метрики `day_signal_dropped_no_person_total{sourceType}` (R10).
- `senderType==='CLIENT'` (chatbox) и внешние email-from без резолва → personId=null → отбрасываются естественно (R6).
- Текст — оригинальная реплика (без дистилляции). Пустые/служебные (`isOutboundFromKora=true`) пропускать.
**Что НЕ входит:** запись чек-ина; LLM; группировка по дню (это Ф5).
**Acceptance:**
- Unit-тест `day-signal-extractor.service.spec.ts`: фикстуры payload `bitrix_dialog_session` (2 turn от связанного + 1 от несвязанного), `chatbox_chat_session` (1 manager связан + 1 client), `email`, free_note → возвращает только связанных; счётчик отброшенных инкрементируется.
- `bunx vitest run backend/src/modules/operations/services/day-signal-extractor.service.spec.ts` зелёный.
**Закрывает:** R3, R6, R8, R10.

### Ф3 — LLM-детектор `day-signal-detect` + предфильтр + гейт

**Цель:** по агрегату дневного текста сотрудника определить план/отчёт.
**Файлы:** новый `backend/src/modules/operations/services/day-signal-detector.service.ts`; промпт `backend/src/modules/operations/prompts/day-signal-detect.prompt.ts`; `llm-router.service.ts` (union `LlmTaskType` `:~660`, `ALL_LLM_TASK_TYPES` `:667`); `backend/scripts/seed-llm-routing.ts` (маршрут).
**Контракт детектора:**
```ts
detect(args: { tenantId: string; personId: string; dayText: string }): Promise<{
  hasPlan: boolean;
  plan: { items: Array<{ text: string; priority?: number }> };
  hasReport: boolean;
  report: { dones: Array<{ text: string }>; blockers: Array<{ text: string; severity?: 'low'|'medium'|'high' }> };
  isPersonalNonWork: boolean;
  confidence: number;
}>
```
**Поведение:**
- **Предфильтр (R13, до LLM):** если в `dayText` нет временных/рабочих маркеров (`/сегодн|завтра|план|сделал|сделаю|итог|готов|задач|встреч|созвон/i`) и длина < 15 символов → вернуть всё `false`, LLM не звать.
- `taskType: 'day-signal-detect'`, модель — `deepseek-v4-flash` (seed-маршрут primary flash; secondary openai-proxy; tertiary ollama). `responseFormat: json_object`.
- **Гейт (R12, R14):** в `DaySignalAggregatorService` (Ф5) запись только если `confidence ≥ daySignals.detectThreshold` (крутилка, Ф8) И `isPersonalNonWork===false`. Иначе drop (+ метрика `day_signal_below_gate_total`).
**Совместимость с prompt caching:** SYSTEM — стабильная константа (правила + список меток + few-shot негативные примеры «к врачу/заберу ребёнка» → personal); переменная часть (`dayText`) — в КОНЕЦ user-сообщения. Никаких tenant-данных в SYSTEM. ([[feedback_llm_prompts_cache_friendly]])
**Что НЕ входит:** upsert; группировка; чтение БД.
**Acceptance:**
- `day-signal-detector.service.spec.ts`: вход «Сегодня план: дожать договор, созвон с подрядчиком» → `hasPlan=true`, items≥1; вход «завтра поеду к врачу» → `isPersonalNonWork=true`; вход «ок 👍» → предфильтр, LLM не вызван (мок llm.call не дёрнут).
- grep `llm-router.service.ts`: `'day-signal-detect'` в `ALL_LLM_TASK_TYPES`.
- `bunx vitest run backend/src/modules/operations/services/day-signal-detector.service.spec.ts` зелёный.
**Закрывает:** R4, R12, R13, R14.

### Ф4 — `DailyCheckInService.upsertFromDaySignal` (merge + sourceRank)

**Цель:** записать чек-ин с накоплением вкладов, без перезатирания.
**Файл:** `backend/src/modules/operations/services/daily-checkin.service.ts` (добавить метод рядом с `upsertFromParser:102`, переиспуя `upsertInternal:291`).
**Контракт:**
```ts
async upsertFromDaySignal(args: {
  tenantId: string;
  personId: string;
  kind: 'morning' | 'evening';
  dateLocal: string;
  items: Array<{ text: string; priority?: number }>;        // для morning → plans
  dones: Array<{ text: string }>;                            // для evening
  blockers: Array<{ text: string; severity?: 'low'|'medium'|'high' }>;
  rawResponseText: string;
  parseConfidence: number;
  source: 'meeting' | 'bitrix' | 'chatbox' | 'email' | 'phone_call';
}): Promise<DailyCheckInDto>
```
**Поведение (R9, R11):**
- `sourceRank` (выше = главнее): `self_initiated|manual|cron_prompted = 4`, `meeting = 3`, `bitrix|chatbox = 2`, `email|phone_call = 1`.
- Прочитать существующий чек-ин по ключу `(tenantId, personId, kind, dateLocal)`. **Merge:** объединить `plansJson`/`donesJson`/`blockersJson` массивы (union, дедуп по нормализованному `text` — trim+lowercase). Поле `source` чек-ина = источник с максимальным rank среди вкладов (существующий + новый). Дописать запись в `sourceContributions` (`{source, at, rank}`).
- **Не понижать:** если у существующего чек-ина `source` ранг ≥ ранга `manual/self_initiated` (т.е. человек уже ответил явно) — items из переписки только **дописываются** в массив (накопление), но `source`/`rawResponseText` явного ответа не перезатираются.
- `dateLocal` — передаётся вызывающим (Ф5/Ф6), считается через `getLocalDate(now, person.timezone)` (консистентно с существующим кодом; [ASSUMPTION] «день» = по TZ Person, не Org — едино с `createOrUpsertManual:63`).
- Эмитить `checkin.created` (как `createOrUpsertManual:82`) — для граф-моста.
**Что НЕ входит:** правка `upsertFromParser`; новый ключ.
**Acceptance:**
- `daily-checkin.service.spec.ts` (доп. кейсы): два вызова `upsertFromDaySignal` (bitrix, затем meeting) на один (person,date,morning) → один ряд, plans объединены без дублей, `source='meeting'` (rank 3>2), `sourceContributions.length===2`. Затем `createOrUpsertManual` тем же ключом → plans дополнены, `source='manual'` (не понижен переписками).
- `bunx vitest run backend/src/modules/operations/services/daily-checkin.service.spec.ts` зелёный.
**Закрывает:** R9, R11.

### Ф5 — `DaySignalAggregatorCron` (дневной свип по сотруднику)

**Цель:** раз в сутки по TZ сотрудника собрать его дневной текст из всех каналов и зафиксировать чек-ин.
**Новые файлы:** `backend/src/modules/operations/workers/day-signal-aggregator.cron.ts` (+ сервис `day-signal-aggregator.service.ts` для тестируемости `runOnce`).
**Образец:** `telegram-digest.cron.ts:44-156` (@Cron hourly, per-person TZ, Redis NX дедуп).
**Поведение (R1, R2, R5):**
- `@Cron('0 * * * *')` ежечасно; для каждого связанного `Person` (relationship='employee', `deletedAt:null`) вычислить `localHour`; обрабатывать только в час `daySignals.processLocalHour` (крутилка, default 21).
- Redis NX дедуп: `daysignal:agg:{personId}:{tenantId}:{localDate}`, `EX = 25*3600`, `NX` — один прогон на сотрудника в день.
- Окно дня: `RawEvent.findMany({ tenantId, occurredAt ∈ [деньStart, деньEnd], sourceType ∈ ['bitrix','chatbox','email','conversational','phone_call'] })`. Для каждого → `DaySignalExtractorService.extractFromRawEvent` → собрать сообщения **этого** `personId`, склеить в `dayText` (хронологически, лимит ~6000 симв).
- `DaySignalDetectorService.detect({tenantId, personId, dayText})`. Гейт (Ф3). Если `hasPlan` → `upsertFromDaySignal(kind='morning', source=преобладающий источник дня)`; если `hasReport` → `upsertFromDaySignal(kind='evening', ...)`.
- Kill-switch `daySignals.enabled` (Ф8): выключен → cron no-op.
**Что НЕ входит:** встречи (Ф6 реактивно); изменение дашборда.
**Acceptance:**
- `day-signal-aggregator.service.spec.ts`: мок RawEvent (bitrix-сессия со связанным сотрудником, текст «сегодня план: X; сделал Y») + мок detector → ровно один `upsertFromDaySignal(morning)` и один `(evening)` для personId; повторный `runOnce` в тот же день → Redis dedup, 0 новых вызовов.
- grep: `@Cron('0 * * * *')` и `daysignal:agg:` в `day-signal-aggregator.cron.ts`.
- `bunx vitest run backend/src/modules/operations/workers/day-signal-aggregator.service.spec.ts` зелёный.
**Закрывает:** R1, R2, R5.

### Ф6 — Реактивный мост встреча → чек-ин

**Цель:** после анализа встречи сразу зафиксировать план/итоги участников.
**Файлы:** новый листенер `backend/src/modules/operations/workers/meeting-checkin.listener.ts` (`@OnEvent` на событие готовности анализа встречи — найти актуальное имя события рядом с `meeting-extract-actions.service.ts:48` `ai_ready`; перепроверить перед правкой). Переиспуёт `DaySignalExtractorService` (meeting payload) + `DaySignalDetectorService` + `upsertFromDaySignal(source='meeting')`.
**Поведение (R5):**
- На событие «анализ встречи готов» загрузить транскрипт, сгруппировать `turns` по `speakerParticipantId` → `Participant.personId` (через `resolveSubjectPersonId`); участники без `personId` (гости) — пропуск.
- Для каждого участника-сотрудника: `dayText` = его реплики встречи → detector → `upsertFromDaySignal(source='meeting')` (rank 3, не перебивает явный личный ответ — Ф4).
- Kill-switch `daySignals.enabled`.
**Что НЕ входит:** извлечение задач (это `meeting-extract-actions`, отдельный поток — не дублировать); правка существующего экстрактора задач.
**Acceptance:**
- `meeting-checkin.listener.spec.ts`: мок-встреча с 2 участниками (1 с personId сказал «сегодня займусь релизом», 1 гость) → один `upsertFromDaySignal(meeting, morning)` для участника с personId, гость пропущен.
- `bunx vitest run backend/src/modules/operations/workers/meeting-checkin.listener.spec.ts` зелёный.
**Закрывает:** R5.

### Ф7 — Дашборд: проброс `source` + проверка учёта

**Цель:** на дашборде видно, откуда пришёл чек-ин; новые чек-ины считаются в «сдал».
**Файлы:** `backend/src/modules/operations/dto/operations-dashboard.dto.ts` (+ `me/check-ins` DTO), `daily-checkin.service.ts` (маппер DTO `:348`), фронт `frontend/src/api/my-check-ins.api.ts` + домен/UI бейдж источника.
**Поведение (R15):**
- В `DailyCheckInDto` пробросить `source` (уже в модели). На фронте — короткий русский бейдж: `meeting`→«Встреча», `bitrix`→«Bitrix», `chatbox`→«Чат», `email`→«Почта», `self_initiated/manual`→«Лично», `cron_prompted`→«По запросу». Только русские подписи ([[feedback_admin_ui_russian_only]]).
- Подтвердить: `getMissingCheckIns`/`getCheckinDiscipline` НЕ фильтруют по source (REALITY-CHECK) → детектированные чек-ины засчитываются в «сдал». Тест-предикат фиксирует это.
**Что НЕ входит:** новые виджеты/счётчики дашборда (counting уже работает).
**Acceptance:**
- `operations-dashboard.service.spec.ts`: создать чек-ин `source='bitrix'` → `getMissingCheckIns` НЕ числит этого человека в `missing`; `getCheckinDiscipline` учитывает его как completed.
- Фронт `bun run typecheck` зелёный; бейджи только на русском (grep отсутствия английских литералов в новом компоненте).
**Закрывает:** R15.

### Ф8 — Крутилки AdminSetting + kill-switch + prod-deploy

**Цель:** пороги/час/рубильник — в админке; регистрация флага; прод-инструкция.
**Файлы:** `admin-setting-schema-registry.ts` (`:9`), `backend/scripts/seed-admin-settings.ts`, `docs/operations/feature-flags.md`, `docs/operations/prod-deploy-log.md` (Шаги 7, 12), `apply-prod-deploy.ts` (если новый seed).
**Контракт реестра (добавить):**
```ts
['daySignals.detectThreshold', UNIT_INTERVAL],
['daySignals.processLocalHour', z.number().int().min(0).max(23)],
['daySignals.enabled', z.boolean()],
```
Сид (`SettingSeed`): `daySignals.detectThreshold=0.7`, `daySignals.processLocalHour=21`, `daySignals.enabled=true`. Чтение — `cfg.getDynamic('daySignals.detectThreshold', undefined, 0.7)` и т.д. (admin→code-fallback, без ENV-ключа).
**Ship-On / флаг (R16):** `daySignals.enabled` — **kill-switch**, дефолт **ON** (фича выкатывается включённой); строка в `docs/operations/feature-flags.md` (тип: kill-switch · состояние: ON · что ждёт: —).
**Acceptance:**
- grep `admin-setting-schema-registry.ts`: три ключа `daySignals.*`.
- `bunx vitest run` для сервисов, читающих порог, проходит с дефолтом.
- `feature-flags.md` содержит строку `daySignals.enabled`.
- prod-deploy-log Шаг 7 (seed-admin-settings) и Шаг 12 (smoke: новый @Cron `DaySignalAggregatorCron`, новый taskType `day-signal-detect`) обновлены.
**Закрывает:** R16, R17.

---

## Требования (трассировка)

- **R1** Когда наступает `daySignals.processLocalHour` по TZ сотрудника, система shall собрать его дневной текст из RawEvent каналов и попытаться зафиксировать чек-ин. (Ф5)
- **R2** Система shall иметь два входа детектора: дневной cron (переписки) и реактивный листенер встреч. (Ф5,Ф6)
- **R3** Если в данных автор не резолвится в `personId`, then сигнал shall быть отброшен без ошибки. (Ф2)
- **R4** Когда дневной текст содержит план или отчёт с `confidence ≥ порог`, система shall записать morning/evening соответственно. (Ф3,Ф5)
- **R5** Когда анализ встречи готов, система shall зафиксировать план/итоги участников-сотрудников (source=meeting, rank ниже личного). (Ф6,Ф4)
- **R6** Сообщения внешних контактов (`CLIENT`/внешний email) shall не давать чек-ина. (Ф2)
- **R7** `DailyCheckInSource` shall включать meeting/bitrix/chatbox/email/phone_call. (Ф1)
- **R8** `DaySignalExtractorService` shall возвращать `[{personId,text,source,occurredAt}]` только для связанных сотрудников. (Ф2)
- **R9** При нескольких вкладах за день система shall накапливать (merge, дедуп), не перезатирать. (Ф4)
- **R10** Система shall инкрементировать метрику отброшенных из-за отсутствия personId. (Ф2)
- **R11** Победитель `source` чек-ина shall определяться по sourceRank; явный личный ответ не понижается перепиской. (Ф4)
- **R12** Запись shall происходить только при `confidence ≥ daySignals.detectThreshold`. (Ф3,Ф5)
- **R13** Система shall применять дешёвый предфильтр до LLM. (Ф3)
- **R14** Текст, классифицированный как личное/нерабочее, shall быть отброшен. (Ф3)
- **R15** Дашборд-DTO shall отдавать `source`; детектированные чек-ины shall засчитываться в «сдал». (Ф7)
- **R16** `daySignals.enabled` shall быть kill-switch (дефолт ON), зарегистрированным в feature-flags.md. (Ф8)
- **R17** Пороги/час shall читаться из AdminSetting через getDynamic с code-fallback. (Ф8)

## Границы фичи

- ✅ Always: фильтр `personId≠null`; merge без перезатирания явного ответа; cache-friendly промпт; русские подписи в UI.
- ⚠️ Ask first: менять `upsertFromParser`/telegram-путь; добавлять второй Worker на `core.raw-events`; менять формулу «день» (TZ Person→Org); вводить debounce-режим.
- 🚫 Never: классифицировать сообщения без `personId`; писать чек-ин при `confidence < порог`; хардкод порога/часа в коде вместо AdminSetting; `process.env.*`; `new PrismaClient()` в скриптах; OFF-флаг «понаблюдаем→включим».

## Pre-mortem / Риски + ревью-аспекты

- **Дубль с telegram-путём:** личка-бот уже пишет `self_initiated`. Cron-агрегатор НЕ читает `sourceType` telegram-лички напрямую как переписку (личка идёт через conversational free_note → если попадёт, merge по rank не понизит self_initiated). Ревью: проверить, что один ответ не даёт два чек-ина.
- **Пустой охват из-за несвязанных сотрудников (Р-3):** метрика `day_signal_dropped_no_person_total` — наблюдать на проде; если высока, поднять вопрос авто-связи (vNext).
- **Стоимость LLM:** предфильтр + 1 вызов/сотрудник/день + flash. Ревью: предфильтр реально отсекает (тест мок-llm не вызван).
- **Ревью-гейт (`strict-production-review-gate`):** идемпотентность cron (Redis NX), отсутствие перезатирания явного ответа, tenant-scope всех запросов (`tenantId` в каждом where), отсутствие утечки текста несвязанных лиц в LLM.

## Идемпотентность / флаг / prod-deploy

- Cron — Redis NX дедуп на (person,tenant,день); upsert идемпотентен по ключу; повторный прогон = no-op (acceptance Ф5).
- `daySignals.enabled` — kill-switch ON (feature-flags.md).
- prod-deploy-log: Шаг 4 (миграция enum+поле, Ф1), Шаг 7 (seed-admin-settings новые ключи), Шаг 12 (smoke: @Cron `DaySignalAggregatorCron`, taskType `day-signal-detect`, листенер встречи). Новый seed-llm-routing маршрут — Шаг 7.

## DoD

- `bun run typecheck` (вкл. `.spec`), `bun run lint`, `bun run build` — зелёные (backend и frontend).
- Все фазовые vitest зелёные.
- second-brain обновлён: `01_projects/operations.md`/`ai-jobs.md`/`workers-queues.md` (новый cron+taskType+листенер), `02_architecture/data-model.md` (enum+поле), реестр «не сделано» — строку закрыть.
- prod-deploy-log Шаги 4/7/12 + feature-flags.md обновлены.
- Рефлексия в `05_история/`.

## Итог

**Реализовано целиком (Ф1–Ф8).** Ветка `feature/universal-daily-checkin-fixator`, 8 коммитов `20ebbc77`..`75b569ce`.

- ✅ Ф1 — enum `DailyCheckInSource` +5 значений (`meeting`/`bitrix`/`chatbox`/`email`/`phone_call`) + поле `DailyCheckIn.sourceContributions Json?`; миграция `20260621104106_daily_checkin_universal_sources` (аддитивная, применена локально).
- ✅ Ф2 — `DaySignalExtractorService` (RawEvent/meeting → `[{personId,text,source,occurredAt}]`, резолв S3-payload, метрика `day_signal_dropped_no_person_total`).
- ✅ Ф3 — taskType `day-signal-detect` (flash primary, cache-friendly промпт + seed-маршрут) + предфильтр + гейт; `DaySignalDetectorService` (метрика `day_signal_below_gate_total`).
- ✅ Ф4 — `DailyCheckInService.upsertFromDaySignal` (merge с дедупом по нормализованному тексту + `sourceRank`, не понижает явный личный ответ).
- ✅ Ф5 — `DaySignalAggregatorCron` (`@Cron('0 * * * *')`, per-person TZ, Redis NX, читает БД напрямую) + `DaySignalAggregatorService`.
- ✅ Ф6 — `MeetingCheckinListener` (`@OnEvent('meeting.ai_ready')`, source=meeting, rank ниже личного).
- ✅ Ф7 — проброс `source` в дашборд-DTO; учёт детектированных чек-инов в «сдал» подтверждён.
- ✅ Ф8 — крутилки `daySignals.enabled` (kill-switch ON) / `daySignals.detectThreshold` (0.7) / `daySignals.processLocalHour` (21) в AdminSetting (без ENV) + строка в feature-flags + prod-deploy-log.

**Верификация:** 51 vitest-тест зелёные; `bun run typecheck` / `lint` / `build` зелёные (backend и frontend); миграция применена локально.

**Осталось:** прод-выкат (миграция применяется авто через `migrate deploy` на `docker compose up -d --build`; seed-маршрут `day-signal-detect` + сид крутилок через `apply-prod-deploy.ts`). **vNext:** выделенное UI-поле для крутилок `daySignals.*` (сейчас редактируются через generic admin-settings API) — строка в `second-brain/04_не-сделано/README.md`.

> Фазы в этом ТЗ оформлены заголовками `### ФN`, без `[ ]`/`[x]`-чекбоксов — отдельных чекбоксов фаз для отметки нет.
