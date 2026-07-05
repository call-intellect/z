---
title: Карта способностей AI Chief of Staff (C1–C12) — фактическое состояние
type: architecture / coverage-map
status: living — фактическое состояние на 2026-07-05 (обновлять при закрытии способности)
date: 2026-07-05
source: замер кода (105 модулей, 313 моделей) — оркестрация 20 суб-агентов
related:
  - "[[../01_projects/ai-coo-layers-blueprint]]"
  - "[[../01_projects/director-dashboard]]"
  - "[[proactive-and-pending-actions]]"
  - "[[orchestrator-and-prompt-evolution]]"
  - "[[../06_marketing/2026-06-29-strategy-session-aicoo-smb-pricing]]"
  - "../../plans/analysis/2026-07-05-chief-of-staff-gap-map.md"
---

# Карта способностей AI Chief of Staff (C1–C12)

> **Что это.** После разворота 2026-06-29 Кора = «AI операционный директор / Chief of Staff» (память компании — под капотом). Эта карта фиксирует **фактическое** покрытие 12 способностей «правой руки руководителя» из целевого видения. Полный анализ, дорожная карта и предложения новых агентов — в `plans/analysis/2026-07-05-chief-of-staff-gap-map.md` (это идеи/план; здесь — только текущее состояние).
>
> Легенда: **DONE** — реально доставляется · **PARTIAL** — частично · **MISSING** — нет. Общая готовность к видению ≈ **55–60%**.

## Матрица

| # | Способность | Статус | Где живёт (модуль/модель/cron) |
|---|---|---|---|
| C1 | Утренний фокус сотруднику | 🟢 DONE | `operations` `PersonalDailyBrief` + `personal-daily-brief.cron`; `tracker` `MorningTasksDigestCron`; `conversational` `TelegramDigestCron` |
| C2 | Утренний фокус руководителю | 🟡 PARTIAL | `operations` `DailyOperationsDigest` («День компании»); `exec-morning-push.cron` («Требует тебя: N») — см. [[director-dashboard]] |
| C3 | Слежение за движением | 🟡 PARTIAL (1/5) | Только `rulePlanItemOverdue` (proactive) + tracker overdue-detector. Нет детекта застоя по `lastActivity`, «решили — задачу не создали», «срок близко без прогресса», циклов `blocked_by` |
| C4 | Очередь решений | 🟡 PARTIAL | `decisions` (`Decision`, UI `/decisions`) — реестр есть; проактивной очереди нет (`decision_no_owner` объявлен в FE, backend не эмитит) |
| C5 | Блокеры + эскалация | 🟡 PARTIAL | `operations` `BlockerSynthesisService` (22:00 МСК); `curation` `conflict-arbiter`. Рекомендации владельца+срока и жёсткой эскалации нет (`recommendedAction`=null) |
| C6 | Извлечение опыта | 🟡 PARTIAL | `practice-skills` (`PracticeSkill`→`ExecutablePersona`); `clones`. Конвейер включён, но без UI и доставка pull — см. [[skill-and-clone]] |
| C7 | Вечерний разбор | 🟡 PARTIAL | Вечерний `DailyCheckIn`; свод руководителю в «День компании» (но доставляется УТРОМ). Персонального вечернего резюме сотруднику нет |
| C8 | Идеи снизу | 🟡 PARTIAL | `ideas` (`Idea`/`IdeaCluster`); `RecurringTopic`. Нет недельного дайджеста идей с рекомендацией владельца |
| C9 | Подготовка к встрече | 🔴 MISSING | Только `EventRemindersWorker` («событие через N минут»). Пред-митингового брифа нет |
| C10 | После встречи → движение | 🟡 PARTIAL | `meetings` `getResult` + `postMeetingClosedToLinkedChats`. Нет назначения владельца/срока из встречи, `followUpEmail` не отправляется |
| C11 | Характер/тон | 🟡 PARTIAL | `proactive` `proactive-message-craft` (тон спокойного оператора) + анти-спам. Жёсткой эскалации по severity нет |
| C12 | Единый экран/чат | 🟡 PARTIAL | Чат-мозг боевой (`/chat` concierge); текст-сводка «День компании» есть; единого ЭКРАНА «что важно сегодня» с 5 панелями + лентой приоритетов нет — сигналы в ~10 роутах |

## Мёртвый груз (построено, не доставляется) — детали

Запас, который оживить дёшево (полный список — в analysis-документе):
- `WeeklyGoalsPulseDigest` — генерируется, доставка за тумблером OFF, нет UI.
- `decision_no_owner` — правило в FE (`assistant-signals.ts`), backend-эмиттера нет.
- `BlockerSynthesisService.listOpenForPerson` — метод построен, 0 потребителей.
- `SprintHint.due_date_at_risk` — генерится только on-demand (pull), не пушится.
- `PracticeSkill` — конвейер включён, но без единого frontend-UI.
- `CrossFunctionalFrictionReport.recommendedAction` — поле всегда null.
- `Orchestrator` — движок multi-agent reasoning построен, `ORCHESTRATOR_ENABLED=false` — см. [[orchestrator-and-prompt-evolution]].
- GEPA / AutoRule / PromptFeedback / Concierge-PRM — построены, все флаги OFF.

## Ключевой структурный пробел (инфраструктура)

В `LlmRouter` нет тира «умной модели»: `primary/secondary/tertiary` — это fallback-цепочка, а не уровень интеллекта. Все подсказки руководителю упираются в потолок `deepseek-v4-pro`. Умная модель нужна точечно — в **суждении/приоритизации** (ранжирование «начни с X», рекомендация владельца блокера), не в извлечении. Развилка dataClass: smart (kie/gemini) отфильтровывается на `sensitive/private` → COS-агенты должны работать на `internal`-агрегатах. Детали — [[orchestrator-and-prompt-evolution]] и [[ai-integration]].
