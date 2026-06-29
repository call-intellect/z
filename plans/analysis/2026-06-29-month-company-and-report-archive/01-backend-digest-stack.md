---
type: analysis
status: research-input
feature: month-company-and-report-archive
date: 2026-06-29
snapshot_date: 2026-06-29
source: vexp/code-read (carto agent backend-digest-stack)
---

# 01 — Картография backend-стека дайджестов День/Неделя/Месяц

Все факты `verified` (прямое чтение кода). Якоря — `path:line`.

## Модели

- `WeeklyOperationsDigest` — [schema.prisma:7921](../../../backend/prisma/schema.prisma): `weekStart`/`weekEnd VarChar(10)`, `bodyMarkdown Text`, `metricsJson`, `sourcesJson`, `llmTaskRouteId?`, `verdictJson?`, `letterJson?`, `goalAlignmentWeekJson?`, `dayTrendJson?`, `externalSource?`; `@@unique([tenantId, weekStart])`; `@@map weekly_operations_digests`.
- `DailyOperationsDigest` — [schema.prisma:7980](../../../backend/prisma/schema.prisma): зеркало с `dateLocal VarChar(10)`, `shortSummary?`, `deliveredAt?`, `verdictJson?`/`letterJson?`(key∈main|done|not_done|reporting|blocked|decisions|clients|ideas|reflection|actions|delta)/`goalAlignmentDayJson?`; `@@unique([tenantId, dateLocal])`.
- `ValueRecapSnapshot` — [schema.prisma:7542](../../../backend/prisma/schema.prisma): месячная **витрина пользы**. `periodYm VarChar(7)`, единый `payloadJson` (routine+team+delta+decisions+narrative+isBaseline), `deliveredAt?`/`openedAt?`; `@@unique([tenantId, periodYm])`. НЕТ verdict/letter/компаса.
- `PersonGoalContribution` — [schema.prisma:7850](../../../backend/prisma/schema.prisma): `proScore`/`contraScore`/`netScore Decimal(8,3)`, `signalsJson`, `weekStart DateTime`; `@@unique([tenantId, personId, goalId, weekStart])`. Пишет `GoalVectorTrackerCron` (weekly Mon 05:00 UTC).

## Сервисы

- `WeeklyDigestService` — [weekly-digest.service.ts:63](../../../backend/src/modules/operations/services/weekly-digest.service.ts): `getStored`/`getOrGenerate`/`generate`; один LLM-call `operations-weekly-digest` (maxTokens 4000) → upsert по `tenantId_weekStart`. verdict/letter/dayTrend пока НЕ персистятся (scope недельного ТЗ Ф2); enrichDto считает секции LIVE.
- `DailyDigestService.generate` — [daily-digest.service.ts:361](../../../backend/src/modules/operations/services/daily-digest.service.ts) — **эталон персиста**: `clampVerdict` поверх LLM (негативный клиент⇒clients≠ok, executionStrained⇒execution≠ok, любой риск⇒overall≥warn); `Prisma.JsonNull` при fallback. LLM-call [daily-digest.service.ts:304](../../../backend/src/modules/operations/services/daily-digest.service.ts): `json_schema strict` (DAY_COMPANY_JSON_SCHEMA), `reasoningEffort high`, `maxTokens 8000`, lenient-парс (toolCalls + unwrap result/data/output/response + Zod safeParse).
- `ValueRecapService.build` — [value-recap.service.ts:46](../../../backend/src/modules/operations/services/value-recap.service.ts): computeRoutine/Team/Decisions → narrative (LLM `value-recap-narrative`, maxTokens **400**, свободный текст) → `assertNoForbiddenMetricKeys` ([value-recap.scoring.ts:41](../../../backend/src/modules/operations/services/value-recap.scoring.ts), запрет ключей rubl/money/hourssaved/roiscore/alignmentscore/beforeafter…) → upsert.
- `monthBounds(periodYm)`/`shiftPeriod` — [value-recap.service.ts:490](../../../backend/src/modules/operations/services/value-recap.service.ts): готовые границы месяца (from=1-е 00:00 UTC, to=последний день 23:59 UTC) — **переиспользуемы 1:1**.
- `WeeklyPerPersonService.compute` — [weekly-per-person.service.ts:85](../../../backend/src/modules/operations/services/weekly-per-person.service.ts): окно `weekStart+6` **ЗАШИТО** (нет параметра), Redis-кэш 5 мин.

## Кроны

- `ValueRecapCron` `@Cron('0 7 1 * *')` — [value-recap.cron.ts:25](../../../backend/src/modules/operations/workers/value-recap.cron.ts): 1-е число 07:00 UTC, **глобальный** (не per-Org), `periodYm = shiftPeriod(-1)`, kill-switch `operations.value_recap.enabled`, eventType `operations.monthly_recap` → `/dashboard/operations/value-recap?period=`.
- `OperationsWeeklyDigestCron` `@Cron('0 * * * *')` — ежечасный тик, **per-Org timezone**, гейт `localHour===weeklyDigestLocalHour && localDay===weeklyDigestLocalDay`, дедуп через getStored.
- `OperationsDailyDigestCron` `@Cron('0 3 * * *')` — 06:00 МСК, глобальный, идемпотентность через `deliveredAt`.

## Вывод для месяца (gaps)

- Для героя-близнеца нужна **новая модель `MonthlyOperationsDigest`** (Р-M1) либо расширение ValueRecap — выбрана новая (см. 99/04).
- Новый промпт месяца (strict-JSON verdict, НЕ `value-recap-narrative`).
- Источник 4 недель: нет `getWeeklyDigestsForMonth` — вычислить понедельники месяца, собрать `getStored` (компресс-форма).
- `weekTrendJson` детерминированно из 4 недельных `verdictJson`.
- Таблица план/факт за месяц: `WeeklyPerPersonService` + опц. окно; «вклад в цель» = сумма 4 недельных `netScore`.
- Крутилки месяца (`monthDigestEnabled` + час) — AdminSetting/`resolveSync`.
