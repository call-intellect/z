---
date: 2026-06-08
type: handoff
owner: Сергей
branch: feature/2026-06-08-daily-value-dashboards-uploads
related:
  - plans/analysis/2026-06-08-batch5-orchestration-chain.md
  - plans/tz/2026-06-08-agents-daily-value-engine.md
  - plans/tz/2026-06-08-dashboards-info-rework.md
  - plans/tz/2026-06-08-dashboards-redesign-modern-visual-language.md
  - plans/archive/2026-06-08-manual-document-upload-and-import-tz.md
  - plans/archive/2026-06-08-meeting-upload-diarized-speaker-mapping.md
---

# Передача: батч из 5 ТЗ — Stage 2 и Stage 3 (продолжить)

Ты — оркестратор-разработчик (skill `tz-orchestrator`). Продолжаешь батч из 5 ТЗ.
**Stage 0 (фундамент) и Stage 1 (весь бэкенд-движок ТЗ-1) уже сделаны, проверены и закоммичены.**
Твоя зона — **Stage 2 (дашборды) и Stage 3 (ТЗ-4 документы, ТЗ-5 встречи)**. Иди до конца, не спрашивай — решай сам, доказывай, продолжай. Push НЕ делай без явного «да» владельца.

## Ветка и контекст
- Ветка: `feature/2026-06-08-daily-value-dashboards-uploads` (от неё и работай; `git fetch` + `git log` перед стартом).
- **Цепочка и решения** — `plans/analysis/2026-06-08-batch5-orchestration-chain.md` (читай первым).
- Прочитай `CLAUDE.md` + `.claude/CLAUDE.md`. Подключи skills: `tz-orchestrator`, `frontend-rules`, `nestjs-rules`, `prisma-db-push-rules`, `strict-production-review-gate`.

## ✅ Что СДЕЛАНО (не переделывать, усиливать)
| Коммит | Что |
|---|---|
| S0.3 (0047943e, edc1893c) | **ТЗ-3 Ф1** — библиотека `frontend/src/ui/components/dashboard/modern/` (GlassCard/StatCard/CardTitle/GaugeCard/AreaTrend/BarTrend/RadarCard/DonutCard/AiCard/Heatmap/ModernTable+Avatar/ProgressBar/StatusPill/ChartTip/Legend + tokens.ts) + glass-токены в tokens.css + DESIGN.md/PRODUCT.md. Витрина `/redesign` рефакторена на библиотеку. **Это фундамент всех экранов Stage 2.** |
| S0.1 (5b6dcdb3) | **ТЗ-1 Ф0** — доставка (Telegram ON), NotificationBudgetService.tryConsume (бюджет push, тихие часы, opt-out), ChannelBindingCampaignCron, /binding-coverage, /me/notification-preferences. |
| S0.2 (26fa158c) | **ТЗ-1 Ф3.D** — фиксы достоверности (goal-vector recipient→author + coverage-fallback, reliability min-denom, 3 probe-триггера). |
| S1.1 (63797ecd) | **ТЗ-1 Ф1** — радар клиентов: CustomerRiskSnapshot, cron, /dashboard/operations/customer-risk, /me/customer-risk, секция в COO-дайджесте. |
| S1.2 (cb024f94) | **ТЗ-1 Ф2** — бриф рядового: PersonalDailyBrief, KnowsWhoService, /me/daily-brief, /me/knows-who. |
| S1.3 (7cbcb5dd) | **ТЗ-1 Ф3.A/B/C** — BlockerSynthesis, DecisionImplementation (+getDecisionThroughput, DecisionTaskLink), PromiseCascade; /operations/blockers/chronic, /decisions/throughput, /decisions/stalled. |
| S1.4 (f408e7fa) | **ТЗ-1 Ф4** — IdeasService.getTop + /ideas/top, IdeaStatusAutoAdvance, insight re-check, KnowledgeAtRisk, TeamCapacity (/team-capacity), OnboardingRamp (/onboarding-ramp). |
| S1.5 (3de31311) | **ТЗ-1 Ф5** — ValueRecap (+экспорт), ChatV2Message.helpful + POST/DELETE /chat-v2/messages/:id/feedback + GET /chat-v2/usage-stats. |

Все бэкенд-эндпоинты/агрегаторы, которые читают экраны Stage 2, **уже существуют**. typecheck+lint(0 errors)+build зелёные; 534 теста в затронутых модулях.

## 🎯 Что ОСТАЛОСЬ
### Stage 2 — Дашборды (ТЗ-2 состав ⊕ ТЗ-3 визуал, ПО ОДНОМУ ЭКРАНУ ЗА РАЗ)
**Ключевое решение (locked):** ТЗ-2 (что показывать) и ТЗ-3 (как выглядит) НЕ делаются раздельно — каждый экран перестраивается ОДИН раз: композиция ТЗ-2 + визуал ТЗ-3 (библиотека `modern/`) в одном проходе. Бэкенд-данные ТЗ-1 уже есть (где нет — graceful-empty).
- **S2.1** `/dashboard` главная: ТЗ-2 Ф1 (29→7 первый экран: Польза/Настроение/Обещания/Висящие решения/Компас(факт)/AI-сводка/Top-1 риск; ValueStrip, WhatWeLearned, единый GoalVectorVerdict, IdeasTopWidget на /ideas/top, ChatUsageWidget на /chat-v2/usage-stats, колонка «Причина») + ТЗ-3 Ф2 визуал. **НЕ удалять** QualityScoreWidget/whoShined/InsightsTopWidget/narrativeSummary (уже реализованы — поправка реестра в ТЗ-2).
- **S2.2** `/dashboard/operations` COO: ТЗ-2 Ф2 (TeamCapacityWidget на /team-capacity, «сколько закрыли», хронические блокеры на /blockers/chronic, приём переносов) + ТЗ-3 Ф2.
- **S2.3** дайджесты daily/weekly: ТЗ-2 Ф3 (idea-секция, ось динамики) + ТЗ-3 Ф2.
- **S2.4** per-person план-факт: ТЗ-2 Ф4 («без ответа» колонка, дедуп 3 источников, /me/weekly-per-person self-view) + ТЗ-3 Ф3.
- **S2.5** `/me` рядовой 5→9: ТЗ-2 Ф5 (4 виджета: память помогла/план-факт/судьба идей/признания; +/me/ideas,/me/recognitions) + ТЗ-3 Ф3.
- **S2.6** новые: `/dashboard/portfolio` (ТЗ-2 Ф6.A — **миграция `Goal.priority` enum MoSCoW + PortfolioHealthSnapshot** + cron + /operations/portfolio-health + PATCH /goals/:id/priority) и `/dashboard/value-recap` (ТЗ-2 Ф6.B — экран поверх ValueRecap из S1.5).
- **S2.7** визуал кабинета: `/goals`, `/actions`, `/maturity` (ТЗ-3 Ф3).
- **S2.8** визуал админки (ТЗ-3 Ф4).
- **S2.9** доводка: светлая тема, a11y-контраст, perf blur, QA-обход (ТЗ-3 Ф5).

### Stage 3 — независимые фичи (параллельны Stage 2, но schema.prisma — общая точка; делай последовательно)
- **S3.1** ТЗ-4 Волна 1 (Ф1 схема→Ф2 парсер officeparser+exceljs→Ф3 backend мультифайл→Ф4 проброс в граф→Ф5 фронт→Ф6 AdminSetting).
- **S3.2** ТЗ-4 Волна 2 (Ф7 ZIP→Ф8 Notion,Ф9 Confluence→Ф10 AI-привязка→Ф11 citations).
- **S3.3** ТЗ-5 (Ф0 ✅ smoke готов → Ф1 схема/FSM→{Ф2 upload+ingest,Ф3 diarized transcribe}→Ф4 speakers API→Ф5 фронт→Ф6 флаги/квота).
- ТЗ-4 Волна 3 (OCR/docling) — opt; Ф14 docling требует URL владельца → строка в `04_не-сделано`.

## Как работать (правила, проверенные на Stage 0–1)
1. **Фаза за фазой**, каждую: картография (Explore/Read) → кодер-агент (самодостаточный промпт с path:line) → **сам пройди приёмку** (НЕ верь отчёту агента: grep маркеров, re-Read критичного, `bun run typecheck` + `bun run lint` (0 errors!) + `bun run build`, прогон spec) → коммит явными путями → следующая фаза. **lint обязателен** (на Stage 1 агенты оставляли 4 ошибки — лови их).
2. **Ship-On: ВСЕ флаги ON** (kill-switch ON). Каждый флаг → строка в `docs/operations/feature-flags.md`.
3. **Миграции — файлами** (`prisma:migrate --name`), non-destructive. **Сэндбокс-БД недоступна** → миграцию пиши руками в `prisma/migrations/<TS>_<name>/migration.sql` (аддитивно; FK-имена таблиц грепай в существующих миграциях — `Org`/`persons`/`Entity`/`Issue`/`decisions` и т.п.); на проде применит `migrate deploy`.
4. **Крутилки → AdminSetting** (getDynamic), не ENV/хардкод. Скрипты → `createPrismaClient()`, регистрировать в `apply-prod-deploy.ts` STEPS.
5. **Фронт:** цепочка ApiDto→DomainModel→UiModel, единый apiClient, SWR; **только русский UI**, парные токены `bg-*`/`*-fg`, никаких text-white/hex; **используй библиотеку `modern/`** и `MODERN_PAGE_BG` для фона дашбордов. recharts: `minWidth={0}`.
6. **LLM-промпт:** тройная регистрация (union в `llm-router.service.ts` + `ALL_LLM_TASK_TYPES` + route в `seed-llm-task-routes-default.ts`), code-fallback, cache-friendly (стабильный SYSTEM, переменные в конце user).
7. **Git:** только свои пути (без `git add .`); `.gitignore` и pre-session untracked (clone-build-harness.ts, smoke-vox-diarization.ts, скриншоты, retest-доки) — НЕ трогать. **Push — только по явному «да» владельца.**
8. По завершении батча: second-brain (01_projects профильные + 02_architecture/module-map/data-model/ai-jobs/workers-queues), рефлексия в `05_история/`, prod-deploy-log дополнен, реестр `04_не-сделано` обновлён, честный отчёт «что не сделано».

## Полезные ассеты для переиспользования
- Визуал: `frontend/src/ui/components/dashboard/modern/*` (+ `index.ts`, `tokens.ts`).
- Бэкенд-данные дашбордов (готовы): `/ideas/top`, `/chat-v2/usage-stats`, `/dashboard/operations/customer-risk`, `/team-capacity`, `/blockers/chronic`, `/decisions/throughput`, `/decisions/stalled`, `/knowledge-at-risk`, `/onboarding-ramp`, `/dashboard/operations/value-recap`, `/me/daily-brief`, `/me/knows-who`, `/me/customer-risk`.
- Паттерны: seed `backend/scripts/seed-admin-setting-*.ts`, метрики `business-metrics.service.ts`, бюджет-роутинг `conversational.sendNotification`.

## Старт
S2.1 (`/dashboard` главная) — первый. Картографируй `DirectorDashboardClient.tsx` + `director-dashboard.service.ts`, затем перестрой первый экран на `modern/` с составом ТЗ-2 Ф1, данные — из готовых эндпоинтов (graceful-empty где надо). Дальше по списку до S2.9, затем Stage 3.
