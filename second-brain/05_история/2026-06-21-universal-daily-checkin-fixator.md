---
date: 2026-06-21
feature: universal-daily-checkin-fixator
distilled: false
---

# Универсальный «фиксатор» дневных чек-инов — реализация ТЗ (Ф1–Ф8)

## Что было поставлено

Реализовать ТЗ `plans/tz/2026-06-21-universal-daily-checkin-fixator-tz.md` целиком (8 фаз) как оркестратор: единый слой-детектор «дневных сигналов» поверх уже сохранённых `RawEvent`, который для каждого **связанного** сотрудника (`personId≠null`) определяет наличие плана/отчёта из любого канала (Bitrix-чаты, chatbox, почта, free_note, встречи) и пишет в `DailyCheckIn` → дашборд «сдал/не сдал» начинает учитывать переписки и планёрки.

## Как решал

Оркестрация фаза-за-фазой силами суб-агентов (картография → промпт кодеру → независимая приёмка → ревью → коммит). 7 параллельных read-only картографов сначала верифицировали все `path:line` ТЗ (они частично устарели).

Ключевые **верификации против ТЗ**:
- `RawEvent.sourceType` — это enum `SourceType`, не string; `payload` может быть `null` при `payloadStorage='s3'` → экстрактор резолвит через `S3Service.getJson` (паттерн `block-ingest.worker.loadPayload`).
- `enqueueRawReceived` живёт в `core-queue.service.ts`, не `ingest.service.ts`.
- bitrix/chatbox payload **уже содержат** `transcript.turns[].authorPersonId` (предрезолв из `BitrixUser/ChatboxMember.linkedPersonId`) — экстрактору не нужно их перерезолвивать; email/free_note/meeting резолвятся через `EntityResolutionService.resolveSubjectPersonId`.
- `upsertInternal` имел узкий тип `source` (3 значения) — расширен до Prisma-enum `DailyCheckInSource`.

**Решения, принятые по ходу (не сваливал на владельца):**
- **Где живёт детектор** — НЕ второй BullMQ-Worker на `core.raw-events` (украл бы job у block-ingest, очередь отдаёт job одному consumer'у), а дневной cron, читающий БД напрямую (вариант B ТЗ).
- **conversational → только `kind==='free_note'`** (не `notification_response`), source `self_initiated` — чтобы не дублировать telegram-чек-ины (они идут `daily_checkin` RawEvent, вне окна агрегатора).
- **phone_call** — надёжной по-говорящему атрибуции нет (participants по extension/number) → экстрактор возвращает `[]`, честно, без ложных привязок.
- **DI-обвязка**: все нужные сервисы (`LlmRouterService`, `EntityResolutionService`, `S3Service`, `RedisService`) экспортируются из `@Global`-модулей → **никаких новых module-import, цикла нет** (доказано чтением `@Global()` + существующих инъекций в `checkin-sentiment-analyzer.worker`).
- **Размещение по фазам**: расширение `DailyCheckInDto.source` положил в Ф4 (нужно для её же теста), `extractFromMeeting` — в Ф2 (Ф6 переиспользует), метрики `incDaySignalDroppedNoPerson/incDaySignalBelowGate` — в Ф2 (первая фаза-потребитель).
- **Агрегатор — один per-tenant запрос + единый проход экстрактора** (а не per-person re-query): группировка due-сотрудников по тенанту, окно `localDayWindowUtc`, NX-дедуп `daysignal:agg:*`.
- **UI-поле крутилок** — вне утверждённого scope Ф8 (ТЗ acceptance его не требует); фича работает на code-fallback (ship-on: threshold 0.7, час 21, enabled ON), крутилки редактируются через generic admin-settings API. Зафиксировано в реестре «не-сделано» как vNext (выделенная admin-страница операций/чек-инов).

## Что вышло

8 коммитов на `feature/universal-daily-checkin-fixator` (20ebbc77…75b569ce):

| Ф | Коммит | Суть |
|---|---|---|
| Ф1 | 20ebbc77 | enum `DailyCheckInSource` +5 значений + `sourceContributions Json?` + миграция |
| Ф2 | 0d684027 | `DaySignalExtractorService` (RawEvent/meeting → связанные сотрудники) + 2 метрики |
| Ф4 | 1cdc4c0c | `upsertFromDaySignal` (merge + sourceRank, без перезатирания явного ответа) |
| Ф3 | 2266edcc | LLM-детектор `day-signal-detect` + предфильтр + промпт + seed-маршрут |
| Ф5 | 34f98b06 | `DaySignalAggregatorCron` (дневной свип, Redis NX, гейт, kill-switch) |
| Ф6 | cd5670ac | `MeetingCheckinListener` (`@OnEvent('meeting.ai_ready')`, source=meeting) |
| Ф7 | 4a0c4101 | фронт-бейдж источника (8 значений, рус.) + регресс-гард дашборда |
| Ф8 | 75b569ce | крутилки `daySignals.*` в AdminSetting + kill-switch + prod-deploy-log |

Верификация: **51 vitest-тест (7 файлов) зелёные**, `tsc --noEmit` 0 ошибок, `bun run build` (nest DI) 0 ошибок, eslint 0 errors, миграция применена локально (аддитивная, без потери данных).

## Чему научился

- **DI-поверхность доказывается чтением существующих инъекций**: вместо угадывания, нужен ли module-import, нашёл рабочий `@Inject(LlmRouterService)` в соседнем воркере operations → значит модуль `@Global`, импорт не нужен, цикла нет. Сэкономило отладку DI на build.
- **Prisma 7**: `migrate dev` больше не принимает `--skip-seed` (флаг удалён); полный `tsc` на этом репо требует `NODE_OPTIONS=--max-old-space-size=8192` (иначе V8 OOM — свойство размера проекта).
- **ESLint `no-useless-assignment`** ловит `let x = '' ; try { x = ... }` — перенос логики внутрь try убирает лишнюю инициализацию.
- **Payload-формы лучше брать из адаптеров, а не из памяти**: bitrix/chatbox кладут предрезолвленный `authorPersonId` в turns — это меняет дизайн экстрактора (не дёргать резолвер лишний раз).
- Email-входящего адаптера в коде пока нет (только outbound) — форму `email`-payload реализовал по контракту ТЗ как verified-договор.
