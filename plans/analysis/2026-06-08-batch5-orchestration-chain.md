---
date: 2026-06-08
type: analysis
status: orchestration-plan
owner: Сергей
related:
  - plans/tz/2026-06-08-agents-daily-value-engine.md
  - plans/tz/2026-06-08-dashboards-info-rework.md
  - plans/tz/2026-06-08-dashboards-redesign-modern-visual-language.md
  - plans/archive/2026-06-08-manual-document-upload-and-import-tz.md
  - plans/archive/2026-06-08-meeting-upload-diarized-speaker-mapping.md
---

# Батч из 5 ТЗ — единая цепочка реализации (оркестрация)

Документ-решение: как 5 ТЗ выстраиваются в один поток работ, что с чем объединяется,
в каком порядке и почему. Источник правды о последовательности для tz-orchestrator.

## Карта 5 ТЗ

| # | ТЗ | Суть | Тип |
|---|---|---|---|
| ТЗ-1 | agents-daily-value-engine | Бэкенд-движок ежедневной пользы: доставка, бюджет уведомлений, радар клиентов, бриф рядового, исполнение, value-recap | Backend (агенты/cron/БД) |
| ТЗ-2 | dashboards-info-rework | СОСТАВ экранов: что показывать, переносы/объединения, новые DTO-поля, 2 новых поля БД | Frontend (композиция) + 2 поля БД |
| ТЗ-3 | dashboards-redesign-modern | ВИЗУАЛ экранов: стекло/градиент/recharts, единая библиотека компонентов `modern/` | Frontend (визуал) |
| ТЗ-4 | manual-document-upload | Канал загрузки документов в граф: форматы, мультифайл, привязка, импорт Notion/Confluence | Backend+Frontend (фича) |
| ТЗ-5 | meeting-upload-diarized | Загрузка готовой записи встречи + Vox-диаризация + подпись говорящих | Backend+Frontend (фича) |

## Ключевое решение — объединение ТЗ-2 и ТЗ-3 (дашборды)

**Проблема:** ТЗ-2 (состав) и ТЗ-3 (визуал) правят ОДНИ И ТЕ ЖЕ файлы дашбордов
(`DirectorDashboardClient.tsx`, `OperationsDashboardClient.tsx`, виджеты, `/me`).
Делать двумя проходами = переписать каждый экран дважды → лишняя работа, конфликты, риск регресса.

**Решение (locked):** объединить в один дашборд-трек:
1. Сначала **ТЗ-3 Ф1** — фундамент: токены + библиотека `src/ui/components/dashboard/modern/`
   (`GlassCard`, `StatCard`, `GaugeCard`, `AreaTrend/AreaHero`, `RadarCard`, `DonutCard`, `AiCard`,
   `Heatmap`, `ModernTable`, `ChartTip`, `Legend`, палитра/градиенты) — вынести из витрины `/redesign`.
2. Затем **каждый экран перестраивается ОДИН раз**: композиция ТЗ-2 (что показывать) + визуал ТЗ-3
   (как выглядит) в одном проходе, на данных ТЗ-1 (graceful-empty пока данных нет).

Соответствие фаз при объединении:

| Экран | Композиция (ТЗ-2) | Визуал (ТЗ-3) | Бэкенд-данные (ТЗ-1) |
|---|---|---|---|
| `/dashboard` главная | Ф1 (29→7, ValueStrip, WhatWeLearned, GoalVectorVerdict) | Ф2 (флагман) | Ф4.A идеи, Ф5 чат, ValueStrip из существующих |
| `/dashboard/operations` COO | Ф2 (capacity, «закрыли», блокеры, переносы) | Ф2 | Ф4.D capacity, Ф3.A блокеры |
| daily / weekly дайджесты | Ф3 (idea-секция, ось динамики) | Ф2 | Ф0 доставка, Ф3.A, Ф4.A |
| per-person план-факт | Ф4 («без ответа», дедуп, self-view) | Ф3 | Ф3.D фикс вектора |
| `/me` рядовой | Ф5 (5→9 виджетов) | Ф3 | Ф2 бриф, Ф5 чат, Ф4.A идеи |
| `/dashboard/portfolio` (новый) | Ф6.A (здоровье+MoSCoW) | Ф3-стиль | самодостаточен (Goal) |
| `/dashboard/value-recap` (новый) | Ф6.B (экран) | Ф3-стиль | Ф5 агрегатор |
| `/goals`, `/actions`, `/maturity` | — (визуал) | Ф3 | — |
| `/admin/*` | — (визуал) | Ф4 | — |
| светлая тема, a11y, perf, QA | — | Ф5 | — |

## Зависимости между ТЗ

- **ТЗ-2 → ТЗ-1:** мягкие (graceful-empty/fallback). Экраны рендерятся пустыми до выката данных.
- **ТЗ-2 → ТЗ-3:** жёсткая. Нужна библиотека `modern/` (ТЗ-3 Ф1) до перестройки экранов.
- **ТЗ-4, ТЗ-5:** независимы от дашбордов и ТЗ-1. Их UI (формы/списки/мастер) использует токены ТЗ-3 Ф1,
  но это не дашборды — могут идти параллельно. Внутри себя строго по фазам.
- **ТЗ-1 внутренние:** Ф0 (доставка/бюджет/привязка) — блокер Ф1–Ф5; Ф2 после gate ≥70% привязки;
  Ф5 (value-recap) последней — агрегирует Ф1–Ф4.

## Итоговая цепочка (волны)

### STAGE 0 — Фундаменты (блокеры всего)
- **S0.1** ТЗ-1 Ф0 — доставка (Telegram ON) + единый бюджет уведомлений + кампания привязки + gate.
- **S0.2** ТЗ-1 Ф3.D — фиксы достоверности (recipient→author + покрытие, «без ответа»/min-denominator, 3 probe-триггера).
- **S0.3** ТЗ-3 Ф1 — визуальный фундамент: токены + библиотека `modern/` из витрины `/redesign`.
  > S0.1/S0.2 (backend) и S0.3 (frontend) независимы — параллельны.

### STAGE 1 — Бэкенд-движок ТЗ-1 (наполняет дашборды данными)
- **S1.1** ТЗ-1 Ф1 — радар клиентов/сделок под риском (деньги).
- **S1.2** ТЗ-1 Ф2 — движок рядового: «Твой день» + «кто знает X» (после gate привязки).
- **S1.3** ТЗ-1 Ф3.A/B/C — исполнение: синтез блокеров + контролёр решений + каскад обещаний.
- **S1.4** ТЗ-1 Ф4 — знания/улучшения: idea getTop, инсайты re-check, знание-под-риском, capacity, онбординг.
- **S1.5** ТЗ-1 Ф5 — value-recap + поле `ChatV2Message.helpful` + `getChatUsageStats`.

### STAGE 2 — Дашборды (ТЗ-2 состав ⊕ ТЗ-3 визуал, по одному экрану за раз)
- **S2.1** `/dashboard` главная (ТЗ-2 Ф1 + ТЗ-3 Ф2).
- **S2.2** `/dashboard/operations` COO (ТЗ-2 Ф2 + ТЗ-3 Ф2).
- **S2.3** дайджесты daily/weekly (ТЗ-2 Ф3 + ТЗ-3 Ф2).
- **S2.4** per-person план-факт (ТЗ-2 Ф4 + ТЗ-3 Ф3).
- **S2.5** `/me` рядовой (ТЗ-2 Ф5 + ТЗ-3 Ф3).
- **S2.6** новые: `/dashboard/portfolio` (ТЗ-2 Ф6.A, +миграция `Goal.priority`/`PortfolioHealthSnapshot`) + `/dashboard/value-recap` (ТЗ-2 Ф6.B).
- **S2.7** прочий кабинет визуал: `/goals`, `/actions`, `/maturity` (ТЗ-3 Ф3).
- **S2.8** админка визуал (ТЗ-3 Ф4).
- **S2.9** доводка: светлая тема, a11y, perf blur, QA-обход (ТЗ-3 Ф5).

### STAGE 3 — Независимые фичи (параллельны Stage 1–2)
- **S3.1** ТЗ-4 Волна 1 — Ф1 схема → Ф2 парсер → Ф3 backend мультифайл → Ф4 проброс в граф → Ф5 фронт → Ф6 AdminSetting.
- **S3.2** ТЗ-4 Волна 2 — Ф7 ZIP → Ф8 Notion, Ф9 Confluence → Ф10 AI-привязка → Ф11 citations.
- **S3.3** ТЗ-5 — Ф1 схема/FSM → {Ф2 upload+ingest, Ф3 diarized transcribe} → Ф4 speakers API → Ф5 фронт → Ф6 флаги/квота.
- ТЗ-4 Волна 3 (OCR/docling) — opt, Ф14 docling требует URL владельца → реестр не-сделанного.

## Инварианты (все стадии)
- Ship-On: все флаги ON по умолчанию (kill-switch ON), каждый флаг → строка в `docs/operations/feature-flags.md`.
- Миграции Prisma — файлами (`prisma:migrate --name`), не `db push`; non-destructive.
- Крутилки → AdminSetting через `getDynamic`, не ENV-only/хардкод.
- Скрипты → `createPrismaClient()`, регистрация в `apply-prod-deploy.ts` STEPS.
- LLM-промпты cache-friendly (стабильный SYSTEM, переменные в конце user).
- UI только русский, парные цвет-токены, цепочка ApiDto→DomainModel→UiModel.
- Каждая фаза: typecheck (вкл .spec) → lint → build → тесты → acceptance построчно → strict-review → commit.

## Порядок исполнения (что за чем)
1. STAGE 0 (S0.1+S0.2 backend ∥ S0.3 frontend).
2. STAGE 1 (S1.1→S1.5) ∥ STAGE 3 (S3.1, S3.3 — независимы).
3. STAGE 2 (S2.1→S2.9) — после S0.3 (библиотека) и по мере готовности данных STAGE 1.
4. Финал: docs (second-brain, prod-deploy-log, реестр), рефлексия, отчёт, push по подтверждению.
