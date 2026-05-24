---
type: sprint-plan
status: draft
feature: Sprint Plan Wave 1 (2026-05-26 — 2026-07-06, 6 нед) — оркестрация единого продуктового рывка Z/Кора
date: 2026-05-24
author: claude (роль — оркестратор разработки)
umbrella: plans/tz/2026-05-23-coo-and-tracker-umbrella.md
realityCheck: plans/analysis/2026-05-22-code-reality-deltas.md
horizon: Wave 1 — детально (3 спринта × 2 нед); Wave 2-3 — обзор + критический путь
---

# Wave 1 Sprint Plan — единый продуктовый рывок Z/Кора

## TL;DR

**Что:** старт единого рывка «бесплатный таск-трекер как точка входа + AI-операционный директор + второй мозг». Wave 1 закрывает фундамент: backend трекера + расширение слоя сигналов + bootstrap нативной мобилки + параллельная утилизация бэклога Кора v2.

**Когда:** Sprint 1 — 2026-05-26 → 2026-06-08, Sprint 2 — 2026-06-09 → 2026-06-22, Sprint 3 — 2026-06-23 → 2026-07-06. Всего 6 календарных недель. Старт Wave 2 — 2026-07-07.

**Кто (минимальная команда — 4.6 fte):** 2 backend (B1, B2), 1 frontend (F1 — подключается к концу Wave 1 для подготовки Wave 2), 1 React Native (R1), 0.3 DevOps (D), 0.3 дизайн (Des).

**Кто (идеальная команда — 8.5 fte):** 3 backend, 2 frontend, 2 RN, 1 DevOps, 0.5 дизайн. Параллелит D-поток (Кора v2) и сокращает Wave 2 на ~2 недели.

**Главный риск Wave 1:** Фаза 1 трекера — критический путь. Любая просрочка тянет Wave 2 и публичную бету.

**Главные blocking-решения от владельца:** 6 ключевых вопросов закрыты 2026-05-24, см. [Принятые решения владельца](#принятые-решения-владельца-2026-05-24). Цены не зафиксированы — отдельная тема, не блокирует Wave 1.

---

## Принятые решения владельца 2026-05-24

Зафиксировано в чате 2026-05-24 (получены ответы на 6 ключевых вопросов перед стартом Sprint 1).

### Решение 1. Чек-лист 14 пунктов из обзора продукта — все по моим рекомендациям
| # | Пункт | Решение |
|---|---|---|
| 1 | Time-tracking | `estimatePoints` в Phase 1; фактический учёт времени — Phase 6+ опционально |
| 2 | Бюджет проекта | Не делаем |
| 3 | Roadmap отдельной сущностью | Не делаем — закрывают cycles + Goals |
| 4 | OKR отдельной сущностью | Не делаем — Goals + IssueGoalLink |
| 5 | Шумодав на встречах | **Активировать сразу** через LiveKit RNNoise |
| 6 | Дашборд сотрудника «мой день» | `/me/dashboard` в Phase 2 трекера |
| 7 | HR-агент отдельным | Не делаем сейчас — частично закрывается Specialist 3.8 (Helpfulness) |
| 8 | Финансовый агент | Не делаем |
| 9 | Sales-агент / CRM | Не делаем (шаблон команды «продажи» закрывает базу) |
| 10 | Аудитор (read-only) | Через RBAC права, не отдельная роль |
| 11 | Apple Watch / Wear OS | Не делаем сейчас (v2 мобилки) |
| 12 | VK Teams / Mattermost / WhatsApp | Не делаем сейчас (после реестра Минцифры) |
| 13 | ФСТЭК / СОРМ | Архитектуру закладываем; сертификацию НЕ запускаем в первой волне |
| 14 | Контур.Диадок (ЭДО) | Не делаем сейчас (Phase 6+) |
| 15 | Двусторонний календарь (Я.Календарь / Outlook) | Фаза 4-5 трекера |

→ Действие: всё «не делаем» вписано в раздел [Что НЕ делаем в Wave 1](#что-не-делаем-в-wave-1-явно-откладываем). Шумодав активировать — отдельный мелкий тикет добавлен в D-поток Sprint 1.

### Решение 2. 10 шаблонов команд — по моему списку
Активируем 10 шаблонов (контент шаблонов — Phase 4 трекера, Wave 3, Sprint 9-10):
1. `sales` — Команда продаж
2. `development` — Команда разработки
3. `installation` — Команда монтажа и сервиса
4. `marketing` — Команда маркетинга
5. `management` — Управленческая команда
6. `customer_support` — Команда поддержки клиентов
7. `hr` — Команда HR
8. `finance` — Финансовая команда
9. `operations` — Операционная команда
10. `product` — Продуктовая команда

→ Действие: модель `TeamTemplate` создаётся в Phase 1 (Sprint 1), seed контента — Sprint 9 (Phase 4).

### Решение 3. Ценовая модель — отложена
Цены пока не фиксируем — отдельная тема. Sprint 1-3 этого не касаются. К Wave 3 (Stripe / ЮMoney / Tinkoff интеграция) — придётся вернуться.

→ Действие: убираю упоминания конкретных тарифов из Sprint Plan. Архитектура `Org.tier` / `Entitlement` уже есть в коде — продолжаем использовать.

### Решение 4. Магазины мобилки — все три
App Store + Google Play + RuStore.
- Apple Developer Account — нужен к Sprint 1 (R1-1.4, 2026-06-08).
- Google Developer Account — $25 единоразово.
- RuStore — бесплатно, требует регистрации юрлица в РФ.

→ Действие: D-поток в Sprint 1 включает регистрацию accounts. Один и тот же `eas build` обслуживает все три магазина (Android `.apk` + `.aab` идут в Google Play и RuStore с минимальными отличиями).

### Решение 5. Приоритет — параллельно (трекер + Кора v2), 4 разработчика минимум
Команда Wave 1 — 4 разработчика (минимум). Состав:
- **B1 (1.0 fte backend lead)** — Поток A (Phase 1 трекера, критический путь).
- **B2 (1.0 fte backend)** — Поток B (α-2 в Sprint 1) + Поток D (бэклог Кора v2 непрерывно).
- **R1 (1.0 fte React Native)** — Поток C (мобилка).
- **F1 (1.0 fte frontend)** — подключается с Sprint 3 (warm-up под Phase 2 в Wave 2). В Sprint 1-2 — поддержка дизайна Des + ревью DTO.
- **D (0.3 fte DevOps)** — инфра, ENV, EAS pipeline, Prometheus.
- **Des (0.3 fte дизайн)** — design tokens + wireframes Phase 2.

Итого ~4.6 fte. Идеальная команда (+1 backend +1 frontend +1 RN) сокращает Wave 2 на 2 нед — обсуждаемо позже.

Приоритизация первых 4-6 нед (по списку владельца):
1. Phase 1 трекера (модели/API/Ingest) — B1.
2. α-2 signalType расширение — B2 (нужно для ingest задач в knowledge-core).
3. β-8 COO Dashboard + DailyCheckIn — Wave 3 (Sprint 12), требует фундамент Phase 1.
4. α-5 DialogService — Wave 2 (Sprint 4-6), большой scope.
5. γ-2 Concierge Agent — Wave 3 (Sprint 12), зависит от α-5.

### Решение 7. Sentiment чек-инов — без ручных кнопок, только AI из текста
- **Никаких 🟢🟡🔴 кнопок.** Сотрудник пишет/говорит свободно в чек-ине, AI определяет sentiment (зелёный/жёлтый/красный) автоматически из транскрипта.
- Утренний чек-ин: «Что главное сегодня / Что планирую» (свободный голос/текст).
- Вечерний чек-ин: «Что сделано / Что не сделано / Что помешало / Предложения» (свободный голос/текст; AI разбирает на 4 структурных слота).
- Видимость: сотрудник видит свой; руководитель — только агрегаты команды (доля красных/жёлтых/зелёных); индивидуальные сигналы руководитель получает через probe от COO Agent, а не на дашборде.
- → Действие: убрать `<MoodSelector>` из мобилки и web; `DailyCheckIn.sentimentInferred String?` заполняется только worker'ом `checkin-parse` в β-8.

### Решение 8. Helpfulness Spotlights — всегда ручное одобрение руководителем
Никакой авто-публикации. AI готовит текст → руководитель команды одобряет/скрывает.

### Решение 9. Приватные негативные сигналы Helpfulness — узко
`question_unanswered` / `question_acknowledged_no_action` видят только главный администратор + руководитель команды цепочки. Сам адресат — НЕ видит. Никогда публично.

### Решение 10. Принцип «трекер = источник для второго мозга» — подтверждён
Каждое событие в трекере (Issue created/updated, status_change, comment, mention) → RawEvent → knowledge-core pipeline → IdeaBlock с правильным `signalType` (8 task_* типов из Решения B2-1.2).

→ Действие: тикет B1-3.1 (Sprint 3) реализует адаптер `tracker.adapter.ts` в `modules/ingest/adapters/tracker/`.

Этический момент про приватность переписки коллег в задачах: будет закрыт через RBAC + visibility-scope. Содержимое чата-в-задаче доступно тому же кругу что и сама задача (assignees + project members + admins). knowledge-core читает только то, на что у tenant есть `entitlement` на `ingest_from_tracker`. Это уже паттерн в коде — расширяем на новый source.

---

## Reality Check — что РЕАЛЬНО уже в коде (источник: [code-reality-deltas](../analysis/2026-05-22-code-reality-deltas.md))

> **Главный вывод аудитов:** код опережает план Кора v2 на ~60-70%. Из 24 sub-ТЗ Кора v2 — **13 крупных блоков практически готовы**, ещё 4 нужны мелкие доделки. Реальная оставшаяся работа — **~25-30% от заявленного объёма**.

### Готово целиком — НЕ трогаем
- α-1 Conversational Channels Foundation (channels, linking, in_app/email/telegram/max)
- α-6 Specialist 3.4 (Project/Customer Context) — эталон card-rollup-v2
- β-2 Knowledge Clone (Specialist 3.2)
- 5 competitor-parity (PromptRegistry, Behavior Metrics, Quality Score, Transcript Cleaning, Multi Reports)
- knowledge-core pipeline (RawEvent → IdeaBlock → Entity → Theme → Card → Curation → Probe) — работает

### Готово на 90-95% — мелкие доделки (распределяем в Sprint 1-2 в D-потоке)
| Sub-ТЗ | Что осталось | Часов |
|---|---|---|
| α-4 Curation Layer (90%) | CompletenessSlot + ConsistencyCheckerCron + расширить CurationDecisionType (merge_categories, escalate) | ~16 |
| β-3 Decisions Registry (95%) | Decision.appliedPolicyId FK после α-8 — отложить до Wave 2 | — |
| β-4 Insights Radar (90%) | causeCategory поле + EntityTransitionCron | ~12 |
| β-5 Ideas + Probe Agent (90%) | closing-loop (RawEvent от ответа) + удаление slash-команд (после β-1) | ~8 |
| γ-1 SkillProfile + Persona (95%) | SkillTraitCategory отдельная модель + гибрид-версионирование ExecutablePersona | ~16 |

### Готово на 60-75% — средние доделки (D-поток Wave 1-2)
| Sub-ТЗ | Что осталось |
|---|---|
| α-2 Layer 1 Marking (65%) | 19 новых signalType из sba-alpha-2-19 + ENTITY_TYPE_VALUES bug-fix (вроде уже сделан) + **8 task_** + 7 help_/thanks_** из нового рывка (наш Поток B) |
| α-3 Layer 2 Ontology + Routing (75%) | Market/OrgUnit модели + AxisClassifierService + LLM-fallback router + 5 EntityLink.relationType |
| α-7 Specialist 3.1 Regulations (60%) | ProcessTemplate + ProcessTemplateVersion + DecisionPoint + ProcessHandoff (4 модели) |
| β-1 Telegram/MAX zero-button (60%) | Rip-out command-handler + добавить voice/document |

### Целиком новое — большие куски (Wave 2-3)
α-5 (DialogService, 30%) · α-8 (Role Map, 35%) · α-9 (Company Foundation, 25%) · α-10 (Admin LLM + Economics, 5%) · β-6 (Experiment Tracker) · β-7 (Brand Voice) · β-8 (PersonalRelation + COO + CheckIn, 15%) · γ-2 (Concierge) · γ-3 (CrossFunctional Process) · δ-1 (Orchestrator) · δ-2 (ProactiveWatcher, 10%) · δ-3 (Voice Channel, 30%)

### Tracker сейчас
Legacy `tasks/` модуль — 5-10% полноценного трекера. action-items из встреч с `assigneeRaw` строкой (без FK на User). Это **фундамент**, но не трекер. Расширяется в Фазе 1 — наш главный Поток A.

### Критические pre-Wave-1 баги (закрыть в Sprint 1 как параллельные тикеты)
- **CRIT-1** `ENTITY_TYPE_VALUES` синхронизация в `block-ingest.prompt.ts:30-38` — по delta уже сделано, **верифицировать в Sprint 1 за 30 минут**.
- **CRIT-2** `MeetingType.review/retrospective` без промпт-шаблонов — проверить `backend/src/modules/ai/services/prompts/type-*.ts`.
- **CRIT-3** `Meeting.tenantId` nullable — backfill + миграция на NOT NULL. Поручить D-потоку в Sprint 1.

---

## Wave 1 — потоки и команды

### Поток A — Трекер фундамент (критический путь)
- **Кто:** B1 (1.0 fte backend lead).
- **Что:** [Фаза 1 трекера](../tz/2026-05-23-tracker-phase-1-models-api.md) — модели Prisma (Project/Issue/Cycle/Intake/Comment/Activity/Webhook + 12 связанных) + REST API + WebSocket + Webhooks (HMAC + retry + WebhookLog) + Ingest в knowledge-core + миграция legacy Task → Issue.
- **Срок:** 6 нед (вся Wave 1).
- **Блокирует:** Фазу 2 трекера (frontend), Фазу 3 (AI), Activity Feeds, Фазу 6 (COO/CheckIn), всю Wave 2.
- **DoD:** см. Фаза 1 sub-ТЗ + миграция legacy Task без потерь данных.

### Поток B — α-2 расширение signalType (разблокировщик A)
- **Кто:** B2 (0.3 fte backend, точечно в Sprint 1).
- **Что:** доделка [sba-alpha-2-19](../tz/2026-05-23-sba-alpha-2-19-signal-types.md) + **дополнительно из нового рывка**: 8 task_** типов из Фазы 1 трекера + 7 help_/thanks_ типов из Specialist 3.8 / Gamification. Всего 19 + 8 + 7 = 34 новых signalType.
- **Срок:** 1.5 нед (Sprint 1, первые 8 рабочих дней).
- **Блокирует:** ingest tracker в knowledge-core (последняя задача A в Sprint 3), Specialist 3.8, Recognition Agent.
- **DoD:** schema.prisma enum SignalType содержит 38 (19 wave 1 + 8 task + 7 help/thanks + старые 14 + 5 reasoning) + SIGNAL_TYPE_VALUES в `block-ingest.prompt.ts` синхронизирован + SYSTEM_PROMPT обновлён + `bun run prisma:push` + `bun run prisma:generate` + `bun run typecheck` зелёные.

### Поток C — Нативная мобилка bootstrap
- **Кто:** R1 (1.0 fte React Native + Expo).
- **Что:** [Mobile Native](../tz/2026-05-23-tracker-mobile-native.md) подготовка: монорепо `kora-mobile/` или новый репо, Expo SDK 51+, Expo Router, auth через JWT (тот же `/api/v1/auth/login`), expo-secure-store, базовая нижняя навигация, заглушки 5 табов, локализация ru, Sentry-expo, EAS Build pipeline, тестовый билд в TestFlight + Internal Testing Track.
- **Срок:** 3 нед (Sprint 1 + Sprint 2).
- **Не блокирует никого** — полностью параллельный поток. Использует тот же backend API.
- **DoD Wave 1:** Tap+SignIn работают, нижние табы видны, демо-сборка прилетает в TestFlight + Google Play Internal Testing.

### Поток D — Бэклог Кора v2 (доделки готовых sub-ТЗ)
- **Кто:** B2 (0.7 fte после α-2 в Sprint 1; 1.0 fte в Sprint 2-3) + при возможности подключается B1 в окнах между Фазой 1.
- **Что:** мелкие и средние доделки из готовых-почти-готовых sub-ТЗ Кора v2 (см. таблицу выше). Раздаём по 1-2 на спринт.
- **Не блокирует никого** (если только не подходит фундамент Wave 2).
- **DoD:** каждое sub-ТЗ закрывается полностью с зелёным `bun run typecheck` + integration tests + патч-скрипт (если миграция данных).

### Поток E (Sprint 3 only) — Frontend подготовка к Wave 2
- **Кто:** F1 (0.5 fte в Sprint 3 как warm-up; 1.0 fte с начала Wave 2).
- **Что:** ревью дизайн-системы (Tailwind + Radix + Geist + mint), создание заглушек 20 страниц трекера (`app/(authenticated)/projects/`, `/issues/`, `/me/`, `/feed/`) с typecheck-проходящими TS-типами по DTO из Фазы 1, подключение SWR + контрактов API; разработка переиспользуемых mobile-first компонентов (`<IssueCard>`, `<KanbanColumn>`, `<QuickAdd>`).
- **Не блокирует никого** в Wave 1, готовится к Wave 2 (Фаза 2 трекера).

---

## Sprint 1 (2026-05-26 → 2026-06-08, 2 нед, 10 рабочих дней)

### Цель спринта
1. Закрыть Поток B (α-2 расширение) к концу 1-й недели — разблокировать ingest в knowledge-core.
2. Запустить и закрыть в моделях Prisma Фазу 1 трекера (без REST/UI ещё).
3. Bootstrap мобилки до момента «пустое приложение с логином на телефон собирается через EAS».
4. Закрыть 1 sub-ТЗ Кора v2 из готовых-почти-готовых (γ-1 SkillTraitCategory).

### Демо-сценарий (что показать заказчику в конце Sprint 1)
- На прод-копии БД (или dev) `bun run prisma:push` накатил все новые модели трекера без ошибок.
- В админке БД (Adminer / Prisma Studio) показать модели Issue, Project, Cycle, Intake, IssueComment, IssueActivity, IssueWebhook.
- Через `bun run` запустить тестовый JS-скрипт, который создаёт RawEvent с одним из новых signalType — IdeaBlock корректно создаётся в knowledge-core (через block-ingest worker).
- На телефоне разработчика открывается экран логина мобилки Z/Кора, magic-link приходит, попадаешь в пустой инбокс.
- На странице `/persons/[id]/skill-profile` появилась группировка trait'ов по новой `SkillTraitCategory`.

### Тикеты Sprint 1

#### B1 (backend lead, 10 дней)

**[B1-1.1] Создать новые модели Prisma из Фазы 1 трекера — часть 1 (Project, ProjectMember, IssueState, Cycle, Label).** День 1-2.
- Открыть `backend/prisma/schema.prisma`, добавить 5 моделей по [Фаза 1 sub-ТЗ](../tz/2026-05-23-tracker-phase-1-models-api.md) разделы 4.1-4.4.
- `bun run prisma:push` (НЕ `migrate`).
- `bun run prisma:generate`.
- `bun run typecheck` зелёный.
- DoD: модели существуют в БД, Prisma Client типизирован, нет circular deps.

**[B1-1.2] Создать оставшиеся модели Issue + связанные.** День 3-4.
- `Issue`, `IssueAssignee`, `IssueLabel`, `IssueSubscriber`, `IssueMention`, `IssueComment`, `IssueAttachment`, `IssueLink`, `IssueRelation`, `IssueActivity`, `IssueVersion`, `IntakeIssue`, `IssueWebhook`, `IssueWebhookLog`, `TeamTemplate`.
- Расширения: `Goal.linkedIssues[]`, `Meeting.linkedIssueId`.
- НЕ забыть `tenantId` + soft-delete + `entityId?`.
- DoD: `bun run prisma:push` + `bun run typecheck` зелёные.

**[B1-1.3] Скаффолд модуля `backend/src/modules/tracker/`.** День 5.
- `tracker.module.ts`, `services/{projects,issues,cycles,intake,comments,labels,webhooks}.service.ts`, `controllers/*.controller.ts` (пустые с TODO).
- Подключить модуль в `app.module.ts`.
- DTO-папка `dto/` с базовыми `nestjs-zod` схемами для CreateProject/CreateIssue (10-15 DTO в Sprint 2 добьём).
- Регистрация RBAC ResourceType `project, issue, cycle, intake_issue, team_template, issue_webhook` в `common/rbac/policy.csv`.
- DoD: модуль грузится, `bun run dev` поднимается без ошибок.

**[B1-1.4] Базовые сервисы Projects + Issues + базовый REST.** День 6-9.
- `ProjectsService.create/findAll/findById/update/archive`.
- `IssuesService.create/findAll/findById/update/transitionState/assign/comment`.
- Контроллеры `GET/POST/PATCH/DELETE /api/v1/projects`, `/projects/:id/issues`, `/issues/:id`.
- Каждая мутация → `IssueActivity` через `ActivityRecorderService`.
- `Idempotency-Key` middleware на POST `/issues`, `/comments`.
- TenantGuard + RbacGuard на каждом контроллере.
- DoD: Swagger открывается на `/api/docs`, ручной curl создаёт Project + Issue, в БД корректно создались + Activity записалась.

**[B1-1.5] Code review B2 по моделям + знакомство с тикетами Sprint 2.** День 10.

#### B2 (backend, 10 дней)

**[B2-1.1] α-2 расширение signalType — 19 типов из sba-alpha-2.** День 1-3. Параллельно с B1-1.1/1.2.
- Открыть `backend/prisma/schema.prisma` enum `SignalType`. Добавить 19 типов из [sba-alpha-2-19](../tz/2026-05-23-sba-alpha-2-19-signal-types.md) (если ещё не добавлены — `expertise, experience, competence, methodology_step, hypothesis, result, lesson, brand_principle, content_artifact, commitment_status, plan_item, done_item, blocker, team_friction, process_friction, resource_gap, suggestion, client_request, question`).
- Обновить `SIGNAL_TYPE_VALUES` + SYSTEM_PROMPT в `backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts`.
- Снести TODO «согласовать описания».
- `bun run prisma:push` + `bun run prisma:generate` + `bun run typecheck`.
- DoD из sba-alpha-2-19 (см. файл).

**[B2-1.2] α-2 wave-2 — 8 task_* signalType из Фазы 1 трекера + 7 help_/thanks_ из Specialist 3.8 + Gamification.** День 4-5.
- Добавить 15 типов: `task_created, task_status_changed, task_blocked, task_completed, task_overdue, task_reassigned, task_comment, task_mention` (8 task_*); `help_provided, proactive_hint, mentoring, emotional_support, constructive_feedback, question_unanswered, question_acknowledged_no_action` (7 help_*); и опционально `helped_by, helped_to, thanks_explicit` для gamification (3 для Recognition).
- ВНИМАНИЕ: `question_unanswered, question_acknowledged_no_action` помечать в SYSTEM_PROMPT с пометкой «only-private-to-admin» (для будущей этической фильтрации в Specialist 3.8).
- Обновить `block-ingest.prompt.ts` SIGNAL_TYPE_VALUES + описания.
- DoD: `bun run typecheck` зелёный, ручной тест с PromptEvalService (или новый jest-spec): подать transcript с фразой «спасибо, что подсказал» — LLM должна вернуть signalType=`thanks_explicit` (или близкий, проверить fallback).

**[B2-1.3] CRIT-1 верификация + CRIT-2 проверка + CRIT-3 backfill план.** День 6.
- Проверить `block-ingest.prompt.ts:30-38` ENTITY_TYPE_VALUES → 14 типов синхронизированы с Prisma enum.
- Найти `backend/src/modules/ai/services/prompts/type-review.ts` и `type-retrospective.ts`. Если нет — создать stub-промпты по образцу `type-default.ts`.
- Написать `backend/scripts/backfill-meeting-tenant-id.ts` (один-к-одному: ищет meeting.tenantId IS NULL, берёт hostUserId.tenantId, обновляет). Запустить на dev, верифицировать.
- DoD: 3 верификационных PR-описания + лог скрипта backfill.

**[B2-1.4] γ-1 доделка — SkillTraitCategory модель + гибрид-версионирование ExecutablePersona.** День 7-10.
- Открыть [sba-gamma-1-finishing-skilltraitcategory-persona-versioning](../tz/2026-05-23-sba-gamma-1-finishing-skilltraitcategory-persona-versioning.md).
- Добавить модель `SkillTraitCategory` (отдельная сущность, не enum) + `SkillTrait.categoryId? FK`.
- Patch-script для миграции существующих traits в категории (по embeddings cosine).
- Расширить `ExecutablePersona` гибрид-версионированием (еженедельный snapshot + внеочередной по триггерам — расширение `executable-persona-build.cron`).
- Обновить UI компонент `<SkillTraitsList>` на `/persons/[id]/skill-profile` — группировка по `SkillTraitCategory`.
- DoD из sub-ТЗ файла + Playwright e2e тест.

#### R1 (React Native, 10 дней)

**[R1-1.1] Bootstrap проекта `kora-mobile/`.** День 1-3.
- Новый репозиторий (либо `kora-mobile/` в существующем монорепо — **требует подтверждения владельца, вопрос №7 ниже**).
- `expo init` + SDK 51, TypeScript template.
- Expo Router (`app/` directory).
- Зависимости: TanStack Query, NativeWind, expo-notifications, expo-secure-store, react-native-mmkv, Sentry-expo, `@livekit/react-native`, expo-camera, expo-audio.
- `app.config.ts` с EAS slug + bundle identifiers (iOS `app.kora.mobile`, Android `app.kora.mobile`).
- DoD: `npx expo start` запускается, экран по умолчанию открывается на iOS + Android симуляторах.

**[R1-1.2] Auth flow + JWT через тот же backend.** День 4-6.
- Экран `app/(auth)/login.tsx` — поле email + кнопка «Войти», magic-link через тот же `/api/v1/auth/login`.
- `src/api/apiClient.ts` — axios + interceptor для JWT.
- `src/contexts/AuthContext.tsx` — состояние user, login, logout, refresh.
- Хранение JWT в `expo-secure-store`.
- DoD: на симуляторе iOS вход проходит, JWT приходит, AuthContext знает user.

**[R1-1.3] Bottom navigation + 5 заглушек-табов.** День 7-9.
- `app/(tabs)/_layout.tsx` — Expo Router tabs.
- Табы: Инбокс / Проекты / Лента / Чек-ин / Профиль. Каждый экран — `<Text>` заглушка «Скоро».
- NativeWind + базовый дизайн (mint accent, dark-first).
- Локализация ru — все строки на русском.
- DoD: 5 табов переключаются, все экраны показывают заглушки на русском.

**[R1-1.4] EAS Build pipeline + первый билд в TestFlight + Internal Testing.** День 10.
- `eas.json` profiles (development, preview, production).
- `eas build --platform ios --profile preview` → submission в App Store Connect TestFlight (требует Apple Developer account — **подтверждение владельца, вопрос №4**).
- `eas build --platform android --profile preview` → Google Play Internal Testing.
- DoD: разработчик получает builds на свой телефон, может открыть и пройти логин.

#### D (DevOps, 0.3 fte, ~3 дня)

**[D-1.1] Подготовить ENV-схему для tracker модуля.** День 2.
- Расширить `backend/src/common/config/env.schema.ts` новыми переменными: `WEBHOOK_HMAC_PREFIX=kora_wh_`, `TRACKER_INGEST_QUEUE=core.raw-events`, `IDEMPOTENCY_KEY_TTL_SECONDS=86400`.
- Обновить `.env.example` + `.env.production.example`.
- DoD: typecheck зелёный, документация в `backend/README.md`.

**[D-1.2] Добавить новые Prometheus метрики в `metrics.module.ts`.** День 5.
- `issues_created_total, issues_completed_total, issues_by_state_count, issues_overdue_count, intake_pending_count, intake_triaged_total, webhook_delivery_total, webhook_retry_count, tracker_events_to_knowledge_core_total`.
- DoD: `/metrics` отвечает с новыми именами (значения 0 пока).

**[D-1.3] EAS Build secrets + публикация ENV для мобилки.** День 9.
- `eas secret:create EXPO_PUBLIC_API_BASE_URL=https://api.kora.app/api/v1` (или dev-stable URL).
- `eas secret:create SENTRY_DSN=...`.
- DoD: R1 видит правильные значения в `app.config.ts`.

#### Des (Дизайн, 0.3 fte, ~3 дня)

**[Des-1.1] Mobile-first design tokens для трекера.** День 1-3.
- Подтвердить и зафиксировать палитру: dark `#0F1115`, mint accent `#5EEAD4`, текст `#E2E8F0`, secondary `#94A3B8`.
- Spacing scale (Tailwind defaults), типографика Geist + system fallback.
- Иконки — Lucide React (web) + Lucide React Native (mobile).
- DoD: Figma-файл «Z/Кора Tracker design tokens v1» + ссылка в команду.

**[Des-1.2] Wireframes 5 главных страниц трекера mobile + desktop.** День 4-6 (фоном весь Sprint).
- `/projects/[slug]/board` (канбан + inline create)
- `/issues/[id]` (страница задачи + чат)
- `/me/inbox` (мой инбокс)
- `/feed` (единая лента)
- Cmd+K модал
- DoD: Figma-прототип, доступен F1 для Wave 2.

### Зависимости между тикетами Sprint 1
```
B1-1.1 → B1-1.2 → B1-1.3 → B1-1.4 → B1-1.5
B2-1.1 (день 1-3) → B2-1.2 (день 4-5) → B2-1.3 (день 6) → B2-1.4 (день 7-10)
R1 поток полностью независим
D-1.1 нужно к B1-1.4 (день 6 → к 8-9 D готов)
D-1.3 нужно к R1-1.4 (день 10)
```

### Sprint 1 риски и митигация
| Риск | Митигация |
|---|---|
| `bun run prisma:push` валит существующие данные при добавлении NOT NULL колонок | Все новые колонки — `?` (nullable). Backfill — отдельным шагом в Sprint 2. |
| α-2 SignalType добавление ломает существующий block-ingest | Запустить existing ingest-tests до и после, сравнить. Новые типы — backward-compat (enum расширение). |
| Apple Developer Account не готов → EAS submit падает | Подготовить Account ДО Sprint 1 (вопрос №4 владельцу). Иначе R1-1.4 переносится в Sprint 2. |
| Изменения в schema конфликтуют с pgvector HNSW индексами | `bun run apply-postgres-init` после каждого push. См. CLAUDE.md. |

---

## Sprint 2 (2026-06-09 → 2026-06-22, 2 нед)

### Цель спринта
1. Закрыть REST API + WebSocket + Webhooks Фазы 1 трекера (без Ingest пока).
2. Мобилка — рабочий список задач из реального API.
3. Закрыть 2 sub-ТЗ Кора v2 из доделок: α-4 (CompletenessSlot + ConsistencyCheckerCron) + β-5 (closing-loop).

### Демо-сценарий
- Через Swagger создаём проект «Демо команда» из шаблона `sales`, создаём 3 задачи, меняем статусы, оставляем комментарии. В БД корректно: Issue, Comment, Activity.
- Регистрируем тестовый webhook на `https://webhook.site/<токен>` через POST `/webhooks`. Меняем статус задачи → webhook прилетает с HMAC-подписью, верифицируем подпись.
- На мобилке: открываем приложение, видим список задач (наш `/me/inbox`), тап на задачу — экран с описанием.
- На странице `/curation/completeness-slots` (admin) показаны 2-3 «незаполненных слота» — например, role без responsibility_element.
- Из probe-вопроса от Probe Agent (на dev данных) сотрудник отвечает → закрывается петля, в `ProbeEvent.status='responded'`.

### Тикеты Sprint 2

#### B1 (10 дней)

**[B1-2.1] REST endpoints Фазы 1 — полный набор.** День 1-5.
- Закрыть все endpoints из Фазы 1 sub-ТЗ раздел 5.1-5.7: Projects, Issues, Cycles, Intake, Webhooks, Templates.
- Каждый — Zod DTO + Swagger + RBAC + ActivityRecorder.
- POST `/issues/:id/start-meeting` — создаёт Meeting с `linkedIssueId`, новый MeetingType `task_discussion` (расширить enum в Prisma + добавить промпт-шаблон).
- POST `/issues/:id/link-goal` / DELETE — связь с Goal.
- DoD: все endpoints работают через curl/Swagger, integration tests (vitest) покрывают golden path.

**[B1-2.2] WebSocket events + Webhooks delivery.** День 6-9.
- `tracker.gateway.ts` (NestJS WebSocket) — канал per-tenant. События `issue.*, comment.*, cycle.*, intake.*, activity_feed.*`.
- WebhookDeliveryService с HMAC-SHA256 + retry policy (5 попыток, exp backoff) + WebhookLog.
- BullMQ очередь `webhook.delivery`.
- Endpoint POST `/webhooks/:id/test` для тестовой отправки.
- DoD: webhook.site принимает POST, подпись `X-Kora-Signature` валидируется внешним инструментом. WebSocket — открыть на frontend WS-инспекторе, увидеть события при изменениях.

**[B1-2.3] Code review B2 — α-4 + интеграция с tracker.** День 10.

#### B2 (10 дней)

**[B2-2.1] α-4 доделка — CompletenessSlot модель + ConsistencyCheckerCron + расширение CurationDecisionType.** День 1-6.
- Открыть [sba-alpha-4-wave2-completeness-consistency](../tz/2026-05-23-sba-alpha-4-wave2-completeness-consistency.md).
- Модель `CompletenessSlot` (FK на Card / Entity, тип слота, требуется/опц, заполнен ли).
- `CompletenessScannerCron` (раз в 6 часов): для каждой Card/Entity ищет незаполненные обязательные слоты согласно kind.
- `ConsistencyCheckerCron` (раз в 4 часа): 6 структурных правил (role без responsibility, шаг без owner, ...) → эмитит probe-events.
- Endpoint `GET /api/v1/curation/completeness-slots` + UI master-detail на `/curation`.
- Расширить enum `CurationDecisionType`: добавить `merge_categories`, `escalate`.
- DoD из sub-ТЗ + integration tests.

**[B2-2.2] β-5 closing-loop + удаление slash-команд из ProbeService.** День 7-9.
- Открыть [sba-beta-5-closing-loop-respond-to-probe](../tz/2026-05-23-sba-beta-5-closing-loop-respond-to-probe.md).
- В `conversational/probe-response.handler.ts` добавить создание `RawEvent` из ответа пользователя → стандартный pipeline knowledge-core.
- В Probe Agent — статус `responded` + `respondedAt` + `responseRawEventId`.
- Удалить упоминания slash-команд `/status, /myideas, /help` из dispatch (это подготовка β-1).
- DoD из sub-ТЗ + integration test (probe → answer → RawEvent → IdeaBlock существует).

**[B2-2.3] β-4 доделка — Insight.causeCategory.** День 10.
- Поле `causeCategory ∈ {process | people | resources | task_setup}` в `Insight` модели.
- Расширить промпт `insight-extract` (knowledge-core/prompts/) — добавить classification step.
- Расширить виджет «Топ-5 проблем» на `/dashboard` фильтром по causeCategory.
- DoD: при следующем запуске insights worker'а у новых insights есть `causeCategory` (старые — null, заполняются bulk reprocess опционально).

#### R1 (10 дней)

**[R1-2.1] Реальный список задач из `/me/inbox`.** День 1-5.
- Экран `app/(tabs)/inbox.tsx` — `useInboxIssues` хук с TanStack Query → `GET /api/v1/me/inbox`.
- Backend endpoint существует с Sprint 2 (B1-2.1).
- Компонент `<IssueCard>` (mobile): приоритет, заголовок, исполнитель, срок.
- Pull-to-refresh.
- Offline-cache в `react-native-mmkv` (топ-50 задач).
- DoD: список грузится, при offline берётся из cache, pull-to-refresh обновляет.

**[R1-2.2] Push-notifications регистрация + первый push.** День 6-9.
- `expo-notifications` registration → FCM token (Android) + APNs token (iOS) → POST `/api/v1/me/push-tokens` (новый endpoint в backend? — добавить в B1 backlog Sprint 2).
- Backend: `push.service.ts` использует Firebase Admin SDK + APNs HTTP/2 — отправляет push при `notification.created` (через α-1 NotificationDelivery с новым channel `mobile_push`).
- Inline actions: «Принял», «Отложить +1 день».
- DoD: при создании задачи на меня — push приходит на телефон, тап «Принял» обновляет статус задачи через backend.

**[R1-2.3] Экран задачи (read-only).** День 10.
- `app/issue/[id].tsx` — заголовок, описание, исполнитель, статус, комментарии (read-only).
- DoD: открывается из инбокса.

#### F1 (Frontend, подключается с конца Sprint 2, 0.5 fte = 5 дней)

**[F1-2.1] Скаффолд страниц трекера + DTO-контракты.** День 6-10.
- `frontend/src/api/projects.api.ts, issues.api.ts, cycles.api.ts, intake.api.ts, team-templates.api.ts` — типизация ApiDto по Swagger из Фазы 1 + первые мапперы DomainModel.
- Заглушки страниц `app/(authenticated)/projects/`, `/issues/`, `/me/`, `/feed/` — `<TODO>` компоненты с правильными layout-ами.
- DoD: `bun run typecheck` + `bun run lint` зелёные. Перейти на `/projects` — открывается пустая страница «Скоро».

#### D (DevOps, 0.3 fte)
- **[D-2.1]** Обновить `docker-compose.yml` (корневой) — пробросить новые env-переменные. Прокинуть `metrics` scrape config для Prometheus.
- **[D-2.2]** Подготовить webhook.site / nginx test-endpoint для team-тестов webhook доставки.

### Sprint 2 риски
| Риск | Митигация |
|---|---|
| WebSocket конфликт с существующим `hulypulse`-сервисом или vidstack | Использовать существующий `@nestjs/websockets` namespace `/ws/tracker`. До коммита — code review с другой команды. |
| Push tokens на iOS/Android — разные форматы | Универсальная модель `UserPushToken { userId, platform, token, lastSeenAt }` + один endpoint, branch по platform. |
| BullMQ webhook retry на падающий endpoint удлиняет очередь | Лимит in-flight через `concurrency: 3` на воркер. Метрика `webhook_in_flight_count`. |

---

## Sprint 3 (2026-06-23 → 2026-07-06, 2 нед)

### Цель спринта
1. Закрыть Фазу 1 трекера полностью: ingest tracker_event в knowledge-core + миграция legacy Task → Issue + Goals integration.
2. Мобилка — экран задачи с возможностью написать комментарий (текст + голос).
3. F1 — подготовить дизайн-систему компонентов для Фазы 2 (warm-up).
4. Закрыть 1-2 sub-ТЗ Кора v2: α-7 доделка (4 модели) + β-1 zero-button (если успеваем).

### Демо-сценарий
- На прод-копии создаём задачу через мобилку — в knowledge-core появляется `RawEvent` (sourceType=`tracker_event`), потом `IdeaBlock` с `signalType='task_created'`. Через chat-v2 спрашиваем «что нового в задачах сегодня» — AI отвечает с цитатой.
- На страницах `/regulations` появилась возможность переключиться на новые `ProcessTemplate` + `ProcessTemplateVersion`.
- Legacy `/tasks` page работает, новые `/projects` страницы открываются с заглушками (warm-up F1).
- В Telegram-боте больше нет slash-команд (β-1 частично выполнен).

### Тикеты Sprint 3

#### B1 (10 дней)

**[B1-3.1] Ingest tracker_event → knowledge-core.** День 1-4.
- Новый адаптер `backend/src/modules/ingest/adapters/tracker/tracker.adapter.ts` — слушает `tracker.event_occurred`.
- EventEmitter в `tracker.module.ts` — эмитит на каждое создание/изменение Issue, Comment, status_change, mention.
- Создаёт `Source` (один per tenant) + `RawEvent` с `sourceType='tracker_event'` и payload + правильным signalType.
- Маппинг 8 task_* signalType → события трекера (см. таблицу в Фазе 1 sub-ТЗ).
- Регистрация в `core.raw-events` очереди.
- DoD: создаём Issue → через 10 сек видим IdeaBlock в БД с правильным signalType и `sourceRef`.

**[B1-3.2] Goals integration + strategic-alignment расширение.** День 5-6.
- Endpoint `/issues/:id/link-goal` + `/unlink-goal` — реализация (DTO уже есть с Sprint 2).
- Расширение `strategic-alignment.cron.ts` (knowledge-core) — учитывает Issue с `goalId`. Считает прогресс: задач привязано/выполнено/осталось, % времени прошло.
- Сохранение snapshot в `Goal.progressSnapshot` или новой `GoalAlignmentSnapshot`.
- Probe-trigger «80% задач не привязаны к целям» в ProbeService.
- DoD: на тестовых данных алгоритм считает alignment и пишет snapshot.

**[B1-3.3] Миграция legacy Task → Issue.** День 7-9.
- Скрипт `backend/scripts/migrate-task-to-issue.ts`.
- Для каждой Org: создать виртуальный Project `from-meetings` + перенести Task → Issue с `externalSource='meeting_legacy'`.
- DRY-RUN режим + `--apply`.
- Legacy `/api/v1/tasks/*` endpoint помечается `@deprecated`, остаётся работать.
- DoD: тест миграции на dev (100+ задач из тестовой Org), 0 потерь. Запуск на prod — Sprint 4 (Wave 2) или вручную.

**[B1-3.4] Code review F1 + R1 + B2 финальный.** День 10.

#### B2 (10 дней)

**[B2-3.1] α-7 доделка — 4 новые модели + 3 probe-trigger.** День 1-7.
- Открыть [sba-alpha-7-wave2-process-template-services](../tz/2026-05-23-sba-alpha-7-wave2-process-template-services.md).
- Модели `ProcessTemplate, ProcessTemplateVersion, DecisionPoint, ProcessHandoff`.
- Решение: переключить ProcessStep с FK на `processId` на `templateVersionId` ИЛИ сохранить совместимость (документировать в плане; **по умолчанию — сохранить совместимость** через nullable FK).
- 3 новых probe-trigger: missing_input_artifact, missing_output_artifact, step_without_owner.
- UI `/regulations/processes/[id]/template` (опц.) — отображение версионированного шаблона.
- DoD из sub-ТЗ + integration tests.

**[B2-3.2] β-1 zero-button rip-out (если успеваем — иначе перенос в Sprint 4).** День 8-10.
- Открыть [sba-beta-1-telegram-max-zero-button-ripout](../tz/2026-05-23-sba-beta-1-telegram-max-zero-button-ripout.md).
- Удалить `CommandHandlerService`, `PROBE_CALLBACK_PREFIX`, `handleCallbackQuery`, `parseSlashCommand` (полный список из reality-deltas §β-1).
- Удалить типы `TelegramInlineKeyboardButton, BotCommand, CallbackQuery`, поле `reply_markup` из `TelegramSendMessageRequest`.
- Удалить ветку `'command'` из `InboundMessage` union.
- Добавить handler `message.voice` (getFile → ASR `asr-transcribe` → free_note/chat_query).
- Handler `message.document` (getFile → document.adapter).
- Распознавание deep-link `/start <token>` и голого 6-знач кода.
- LLM-классификатор intent — отложить до α-5 (Wave 2-3, когда DialogService готов).
- Синхронизировать ТЗ-файлы (см. delta §β-1 п.3).
- DoD из sub-ТЗ. **Если не успеваем за 3 дня — переносим в Sprint 4 (Wave 2), фиксируем как «started, not done» в плане.**

#### R1 (10 дней)

**[R1-3.1] Камера + голос на странице задачи.** День 1-5.
- На `app/issue/[id].tsx` — кнопка «📷 Камера» → `expo-camera` → upload → `POST /api/v1/issues/:id/attachments`.
- Кнопка «🎤 Голосовое» → `expo-audio` запись → upload → `POST /api/v1/issues/:id/comments` с `voiceUrl + voiceDuration`. Backend async ASR заполняет `voiceTranscript`.
- DoD: с iPhone снимаем фото — оно появляется в задаче на web. Записываем голосовое — через 30 сек видна транскрипция.

**[R1-3.2] Создание задачи через голос + magic-link на email.** День 6-8.
- На табе «Создать» (или FAB) — кнопка «🎤» → запись → ASR → AI-парсинг → пред-заполненная форма с подтверждением.
- Использует endpoint `POST /api/v1/intake` с `source='mobile_voice'` и `rawContent=transcript`.
- DoD: говорим «Создай задачу для Петра завтра по объекту Тверская» — появляется IntakeIssue с suggested полями.

**[R1-3.3] Чек-ин flow (заготовка для β-8 в Wave 3).** День 9-10.
- Заглушка экрана `app/(tabs)/check-in.tsx` — **только голос/текст**, без ручного выбора настроения (Q-4 решение 2026-05-24).
- Вечерний чек-ин: 4 свободных поля «Что сделано / Что не сделано / Что помешало / Предложения» (или одно поле «Расскажи о дне» свободным голосом — AI разберёт на эти 4 секции в Wave 3).
- Утренний чек-ин: 2 свободных поля «Что главное сегодня / Что планирую».
- POST `/api/v1/me/check-ins` (endpoint появится в β-8 — пока возвращает 501; UI готов).
- DoD: UI выглядит готовым (без emoji-кнопок настроения), backend заглушки.

#### F1 (1.0 fte = 10 дней — переходит на полную ставку)

**[F1-3.1] Дизайн-система компонентов трекера (mobile-first).** День 1-7.
- `frontend/src/ui/Board/` — пустой канбан-каркас с drag-n-drop (`@atlaskit/pragmatic-drag-and-drop`).
- `frontend/src/ui/IssueCard/` — компактная карточка задачи.
- `frontend/src/ui/QuickAdd/` — inline-форма.
- `frontend/src/ui/CommandPalette/` — Cmd+K модал (без AI-парсинга пока, только UI).
- `frontend/src/ui/IssueChat/` — чат-в-задаче (без backend пока).
- Все компоненты — Tailwind responsive с 320px-2560px, dark-first.
- DoD: Storybook (если есть) или demo-page показывает все компоненты на двух размерах.

**[F1-3.2] Скаффолд страниц `/projects` и `/issues` с заглушками.** День 8-10.
- `app/(authenticated)/projects/page.tsx` — список (mock data из api/projects.api.ts).
- `app/(authenticated)/projects/[slug]/board/page.tsx` — пустая канбан с QuickAdd.
- `app/(authenticated)/issues/[id]/page.tsx` — детали задачи (mock + чат заглушка).
- DoD: на dev `/projects` открывается, видим mock-данные.

#### D (DevOps)
- **[D-3.1]** Подготовить prod-копию БД для миграции legacy Task — снапшот в dev для тестирования B1-3.3.
- **[D-3.2]** Настроить Prometheus alerts на новые метрики (issues_overdue_count > 0, webhook_delivery error rate, push delivery error rate).

### Sprint 3 риски
| Риск | Митигация |
|---|---|
| Миграция legacy Task ломает существующие /tasks pages | Сохранить `/api/v1/tasks/*` deprecated endpoints до Wave 2 Фазы 2 (когда frontend перейдёт на `/issues/*`). |
| α-7 ProcessStep миграция (templateVersionId) ломает knowledge-core | По умолчанию — nullable FK, опц. перевод существующих в template_version_id через patch-script. Документировать. |
| β-1 не закрылся за 3 дня — переносим в Sprint 4. Уведомить о rebalancing. | Сразу в начале дня 8 — daily standup, решение GO/NO-GO. |

### Метрики прогресса Wave 1
- Burndown спринтов (количество тикетов done / total).
- Velocity команды: Sprint 1 → X тикетов, Sprint 2 → Y, Sprint 3 → Z. Целевой Y, Z ≥ X.
- `bun run typecheck` всегда зелёный на main.
- Integration test coverage в `tracker/` модуле ≥ 70%.

---

## Wave 2 (обзор, 2026-07-07 → 2026-09-14, 10 нед)

### Цели Wave 2
1. Frontend трекера полностью (Фаза 2) — все ~20 страниц + Cmd+K + чат-в-задаче + PWA.
2. AI-фичи трекера (Фаза 3): автозадачи из встреч, AI-suggest, похожие задачи, AI Q&A, auto-triage Intake.
3. Activity Feeds (4 нед) — единая модель + 6 типов лент.
4. Specialist 3.8 Helpfulness Agent (4 нед) + Recognition / Gamification (3 нед).
5. Мобилка v1 — релиз в TestFlight + Internal Testing с командой пилотных клиентов.
6. D-поток: α-5 DialogService (большой scope, 30% done) + α-8 Role Map (35% done) + α-10 Admin LLM Economics (5%, P0 после унификации admin-групп).

### Команда Wave 2 (минимум 5.6 fte)
- B1 (1.0): Фаза 3 трекера AI + интеграция с knowledge-core.
- B2 (1.0): D-поток — α-5 DialogService.
- B3 (1.0, добавить): Specialist 3.8 + Activity Feeds.
- F1 (1.0): Фаза 2 трекера UI + PWA.
- F2 (0.6, добавить): Activity Feeds frontend + Gamification widgets.
- R1 (1.0): Мобилка v1 финализация + первый Store submit.
- D (0.5): EAS pipeline, observability, alerting.
- Des (0.5): дизайн Фазы 2 + Activity Feeds + COO Dashboard.

### Спринты Wave 2 (5 × 2 нед)

**Sprint 4 (2026-07-07 → 2026-07-20):** Фаза 2 трекера старт (proекты, доска, список) + α-5 DialogService начало + Activity Feeds модель + Helpfulness специалист worker.

**Sprint 5 (2026-07-21 → 2026-08-03):** Фаза 2 трекера середина (issue page + чат-в-задаче + Cmd+K) + α-5 DialogService продолжение + Activity Feeds 3 типа лент готовы + мобилка push с inline actions.

**Sprint 6 (2026-08-04 → 2026-08-17):** Фаза 3 трекера старт (автозадачи из встреч + AI-suggest) + α-5 DialogService финал (factual/synthetic mode prompts) + Specialist 3.8 spotlights + Recognition Agent.

**Sprint 7 (2026-08-18 → 2026-08-31):** Фаза 3 трекера финал (похожие задачи KNN + AI Q&A + auto-triage) + Activity Feeds finalize + α-10 Admin LLM admin-групп унификация + Gamification бейджи.

**Sprint 8 (2026-09-01 → 2026-09-14):** Wave 2 буфер, стабилизация, e2e Playwright тесты по всему трекеру + мобилка v1 RC + α-8 Role Map начало.

### Risks Wave 2
- α-5 DialogService — большой scope (5 новых сервисов, 6 LlmTaskType, AnswerCache, temporal). Может затянуть. Митигация: разбить на 3 micro-sub-ТЗ и распределить по Sprint 4-6.
- Мобилка first store submit — Apple ревью может задержать на 1-2 недели. Митигация: подавать в Sprint 6 (за 4 недели до DoD).

---

## Wave 3 (обзор, 2026-09-15 → 2026-11-09, 8 нед)

### Цели Wave 3
1. РФ must-have (Фаза 4 трекера): Telegram-бот для задач + email-to-task + 10 шаблонов команд + локализация.
2. Импорт (Фаза 5): Битрикс24 + Trello + Я.Трекер wizard.
3. COO Operations Dashboard + DailyCheckIn (Фаза 6 трекера / β-8).
4. α-9 Company Foundation (CompanyProfile + FunctionalDomain + MaturityScorerCron).
5. α-8 Role Map финал (5 моделей + Appointment миграция + KPI).
6. γ-2 Concierge Agent (реализует AI-часть Cmd+K глубоко).
7. γ-3 CrossFunctionalProcess + Handoff (зависит от α-7).
8. δ-2 ProactiveWatcher.

### Команда Wave 3 (5.6-7 fte)
То же что Wave 2, опционально +1 backend для δ-1 Orchestrator если решено в скоупе.

### Спринты Wave 3 (4 × 2 нед)
**Sprint 9-10:** Фаза 4 + α-8 Role Map финал.
**Sprint 11:** Фаза 5 импорт + α-9 Company Foundation + γ-3.
**Sprint 12:** Фаза 6 трекера / β-8 PersonalRelation + COO Dashboard + DailyCheckIn + γ-2 Concierge AI-парсинг.

### Wave 3 → publication beta
В конце Wave 3 трекер + AI-COO + второй мозг в состоянии **публичной беты** для пилотных клиентов. δ-1, δ-2, δ-3 + β-6/β-7 могут идти в Wave 4 (стабилизация + добор фич) и не блокируют публичный запуск.

---

## Граф зависимостей всех 31 sub-ТЗ

### Wave 1 dependencies
```
α-2 (signal types, B2-1.1+1.2) ─┐
                                ├─→ B1-3.1 (ingest tracker → knowledge-core)
B1-1.1..1.4 (модели + REST) ────┘                ↓
                                          Phase 2-3 трекера (Wave 2)
γ-1 (SkillTraitCategory) — отдельный, не блокирует никого

α-4 (CompletenessSlot, B2-2.1) — отдельный, не блокирует
β-5 (closing-loop, B2-2.2) ──→ β-1 (β-5 удаляет slash-команды, β-1 — финальный rip-out)
β-4 (causeCategory, B2-2.3) — отдельный
α-7 (ProcessTemplate, B2-3.1) ──→ γ-3 (CrossFunctionalProcess, Wave 3) + β-3 финал (appliedPolicyId)
β-1 (zero-button, B2-3.2) — отдельный (но синхронизирует ТЗ-файлы для β-5)
```

### Wave 2 dependencies
```
Phase 1 трекера (Wave 1) ──→ Phase 2 фронт ──→ Phase 3 AI
                          ├─→ Activity Feeds (нужна Issue/Comment модели)
                          ├─→ Specialist 3.8 (нужна α-2 wave-2 sigtypes + Phase 1 события)
                          └─→ Recognition Agent (нужны Issue Comment thanks)

α-5 DialogService — не зависит от трекера, но **разблокирует NL-парсинг концьержа** (плавающий значок + опц. Cmd+K) в Фазе 2

α-10 admin унификация (Sprint 7) — независимо

α-3 wave3 axis classifier ──→ Specialist 3.8 routing + Helpfulness fan-out
```

### Wave 3 dependencies
```
α-7 (Wave 1) ──→ α-8 Role Map (5 нормализованных таблиц) ──→ α-9 Company Foundation
α-8 ──→ β-3 финал (Decision.appliedPolicyId)
α-8 ──→ Phase 6 трекера β-8 (опц., для Goal.assigneeAppointmentId)

α-9 CompanyProfile ──→ CEO Dashboard виджеты
γ-3 CrossFunctionalProcess ──→ зависит от α-7
γ-2 Concierge ──→ зависит от α-5 DialogService (для NL-парсинга концьержа в плавающем значке и опц. Cmd+K)
δ-2 ProactiveWatcher ──→ паттерн уже есть (skill-manager-digest.cron)
δ-1 Orchestrator ──→ опц., расширяет chat-v2 CardSpecialistRegistry
δ-3 Voice Channel TTS ──→ опц., для AI-звонков
```

### Критический путь (longest chain)
```
α-2 wave-1 → α-2 wave-2 (8 task_*) → Фаза 1 трекера ingest → Фаза 2 (UI + чат + концьерж) → Фаза 3 (AI) → Фаза 4 РФ → Фаза 5 импорт → Фаза 6 / β-8 COO
~1.5 нед   +   1 нед              +   6 нед             +   7 нед                    +   4 нед   +   4 нед     +   3 нед     +   5 нед

ИТОГО CRITICAL PATH: ~31.5 нед = ~8 месяцев непрерывной работы 1 backend.
С параллелизацией Wave 1-3 ужимается до ~22-24 календарных недель.
```

### Топ-3 рискованных sub-ТЗ (начинать как можно раньше)
1. **α-5 DialogService** (30% done, большой scope, 5 сервисов + 6 LlmTaskType + AnswerCache + temporal validAt) — **разблокирует NL-парсинг концьержа (плавающий значок + опц. Cmd+K) и AI-чат компании**. Start: Sprint 4.
2. **α-10 Admin LLM + Economics** (5% done, требует ДО старта унификации двух admin-групп `(admin)/admin/*` vs `(authenticated)/admin/*`). Start: Sprint 7. Без унификации в Wave 2 — плодим третью группу.
3. **α-8 Role Map нормализация** (35% done, миграция `PersonRole → Appointment` + `Metric → KPI` + 5 новых моделей, требует осторожности из-за PersonsService + EntityLink `executes_role`). Start: Sprint 8 (Wave 2 буфер) или Sprint 9 (Wave 3 первый).

---

## Открытые вопросы — оставшиеся (можно отвечать по ходу Wave 1-2)

> 6 главных вопросов закрыты владельцем 2026-05-24 — см. [Принятые решения](#принятые-решения-владельца-2026-05-24). Ниже — оставшиеся, не блокирующие старт Sprint 1.

### Нужно к Sprint 1 (2026-05-26)

**Q-1. Где живёт kora-mobile репозиторий?**
- Вариант А (моё предложение): отдельный `kora-mobile/` репозиторий — стек RN не смешивается с web Next.js, EAS Build пайплайн чище.
- Вариант Б: папка `mobile/` в существующем монорепо — единая история коммитов, но конфликты в `package.json` и больший CI.
- **Default до ответа:** Вариант А (R1 стартует с отдельным репо).

**Q-2. Кто отвечает за регистрацию Apple Developer Account + Google Play Console + RuStore Кабинет.**
- Apple Developer: Individual $99/год ИЛИ Organization $299/год (последнее — рекомендую, юрлицо ИП/ООО на Z). Срок до **2026-06-08** (Sprint 1 R1-1.4), иначе R1-1.4 переносится в Sprint 2.
- Google Play: $25 единоразово.
- RuStore: бесплатно, но юрлицо РФ + KYC.
- **Default до ответа:** D-поток в Sprint 1 регистрирует Individual Apple ($99) и Google ($25). RuStore оформляет владелец (нужен корпоративный аккаунт).

### Нужно к Wave 2 (2026-07 — 2026-09)

**Q-3. Ценовая модель Free / Pro / Business / Enterprise + границы Free (количество юзеров + AI-квота).**
- К **Sprint 7** (2026-08-18) интеграция платёжных провайдеров стартует.
- Владелец сказал «пока вообще не ставим». Возвращаемся к этой теме в начале Wave 3.

**Q-4. Sentiment чек-инов — закрыт 2026-05-24. ✅**
- Решение: **никаких ручных кнопок 🟢🟡🔴.** Sentiment определяется AI-агентом автоматически из свободного ответа вечернего чек-ина (текст или голос → транскрипт). Сотрудник пишет/говорит свободно: «что сделано», «что не сделано», «что помешало», «нужна ли помощь», «предложения» — AI извлекает sentiment + структуру.
- Видимость: сотрудник видит свой; руководитель — только агрегаты команды (доля красных/жёлтых/зелёных), без индивидуальных оценок; админ — агрегаты org-уровня. Сигнал «у Иванова неделя красная» руководитель получает отдельным приватным probe-сообщением от COO Agent (не на дашборде, не в ленте).
- Действие: убрать `<MoodSelector>` из UX мобилки R1-3.3 + web `/me/check-ins`. LlmTaskType `checkin-sentiment` (β-8) становится единственным источником sentiment'а. Поле `DailyCheckIn.sentimentInferred String?` (`green | yellow | red`) — заполняется только worker'ом, не пользователем.

**Q-5. Recognition Agent — от имени AI или руководителя?**
- К Sprint 6 (Recognition Agent + Gamification).
- **Default:** от имени AI; опционально руководитель может одобрить и переслать от своего имени.

**Q-6. Helpfulness Spotlights — закрыт 2026-05-24. ✅**
- Решение: **всегда ручное одобрение руководителем команды.** Никакой авто-публикации. AI готовит текст → отправляет руководителю → тот публикует/скрывает.
- Действие: в Sprint 6 (Specialist 3.8) — `HelpfulnessSpotlight.status` стартует в `pending`, переход в `approved → published` только через ручное действие. Без cron-автопубликации.

**Q-7. Приватные негативные сигналы Helpfulness — закрыт 2026-05-24. ✅**
- Решение: видят **только главный администратор + руководитель той команды**, к которой относится цепочка вопросов. Сам адресат сигнала НЕ видит. Никогда публично.
- Действие: в Sprint 6 — RBAC ResourceType `helpfulness_trait` для `question_unanswered` / `question_acknowledged_no_action` имеет фильтр `visibility='private_admin_and_team_lead'`. Опт-аут в `/me/settings/privacy` отключает сбор этих сигналов полностью для сотрудника.

**Q-8. Двусторонний календарь Я.Календарь vs Google Calendar vs Outlook — что приоритетнее?**
- К Sprint 9-10 (Phase 4).
- **Default:** Я.Календарь двусторонне (РФ-приоритет) + Google Calendar двусторонне + Outlook через ICS feed (read-only).

---

## Промпты-тикеты для разработчиков Sprint 1 (короткие, готовые к раздаче)

### Тикет B1-1.1 — Создать модели Project, ProjectMember, IssueState, Cycle, Label
**Заголовок:** [Tracker Phase 1] Часть 1 моделей Prisma — Project + IssueState + Cycle + Label
**Контекст:** Начинаем фундамент трекера Z/Кора. Это критический путь всего рывка. После моделей идут REST + WebSocket + Webhooks + Ingest в knowledge-core. Sub-ТЗ полностью описывает поля.
**Что нужно сделать:**
1. Открыть [Phase 1 sub-ТЗ](../tz/2026-05-23-tracker-phase-1-models-api.md) раздел «Модели Prisma», скопировать модели Project, ProjectMember, IssueState, Cycle, Label в `backend/prisma/schema.prisma`.
2. Запустить `bun run prisma:push` (НЕ `migrate`). Проверить что pgvector HNSW индексы остались — если упали, запустить `bun run apply-postgres-init`.
3. `bun run prisma:generate` — обновить Prisma Client.
4. `bun run typecheck` — должен пройти зелёным (могут быть ошибки в существующих сервисах из-за reverse-relation `Goal.linkedIssues[]` — пропустить пока, фиксим в B1-1.2).
5. Создать Pull Request с описанием каждой модели в commit message.

**Definition of Done:**
- 5 моделей в schema.prisma + БД синхронизирована.
- `bun run prisma:generate` без ошибок.
- `bun run typecheck` зелёный (или PR помечен как «WIP, depends on B1-1.2»).
- В PR description перечислены добавленные RBAC ResourceType (пока не регистрируем — это B1-1.3).

**Skills:** `prisma-db-push-rules`, `nestjs-rules`.
**Срок:** 2 дня.

---

### Тикет B2-1.1 — α-2 расширение signalType (19 типов)
**Заголовок:** [α-2 wave-1] Добавить 19 новых SignalType для β-6/β-7/β-8/γ-1/γ-3/δ-2
**Контекст:** Расширение разметки Layer 1 для будущих специалистов (Experiment Tracker, Brand Voice, PersonalRelation, SkillProfile, CrossFunctional, ProactiveWatcher). Без этого block-ingest не размечает новые типы блоков, и Φuture-агенты получают пустоту. Sub-ТЗ описывает каждый тип с маркер-фразами.
**Что нужно сделать:**
1. Открыть [sba-alpha-2-19-signal-types](../tz/2026-05-23-sba-alpha-2-19-signal-types.md), скопировать 19 значений в `SignalType` enum в `backend/prisma/schema.prisma`.
2. Расширить `SIGNAL_TYPE_VALUES` в `backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts` — добавить 19 строк.
3. В SYSTEM_PROMPT того же файла — добавить описание каждого из 19 типов (из таблицы sub-ТЗ).
4. Снести TODO «согласовать описания» (см. sub-ТЗ §α-2 п.3).
5. `bun run prisma:push` + `bun run prisma:generate` + `bun run typecheck`.
6. Прогнать `bunx vitest run src/modules/knowledge-core/prompts/__tests__/prompts.spec.ts` — должно пройти зелёным (signalType добавляются backward-compat).

**Definition of Done:**
- Enum SignalType содержит 38 значений (14 base + 5 reasoning + 19 wave-1).
- SIGNAL_TYPE_VALUES синхронизирован.
- SYSTEM_PROMPT обновлён.
- DoD из sub-ТЗ файла все галочки.

**Skills:** `z-ai-agent-rules`, `prisma-db-push-rules`.
**Срок:** 3 дня.

---

### Тикет R1-1.1 — Bootstrap Expo проекта kora-mobile
**Заголовок:** [Mobile] Bootstrap проекта Expo SDK 51+
**Контекст:** Нативная мобилка — параллельный поток разработки. Web и mobile используют один backend. Стек согласован: React Native + Expo, Expo Router, TanStack Query, NativeWind. EAS Build для дистрибуции. Sub-ТЗ описывает структуру проекта и архитектуру.
**Что нужно сделать:**
1. Подтвердить с владельцем — отдельный репозиторий `kora-mobile/` (вариант А) или папка в существующем монорепо (вариант Б). По умолчанию — А.
2. `npx create-expo-app kora-mobile --template tabs@latest` (SDK 51, TypeScript).
3. Установить зависимости: `@tanstack/react-query`, `nativewind`, `expo-notifications`, `expo-secure-store`, `react-native-mmkv`, `sentry-expo`, `@livekit/react-native`, `expo-camera`, `expo-audio`, `expo-image`.
4. Настроить `tailwind.config.js` с нашими токенами (dark + mint accent + Geist fallback).
5. Зарегистрировать app slug + bundle identifiers (`app.kora.mobile`).
6. Sentry-expo подключить с DSN (из ENV через EAS secrets — D-1.3).
7. Запустить `npx expo start`, открыть на iOS Simulator + Android Emulator — должен открыться default экран.

**Definition of Done:**
- Репозиторий `kora-mobile/` создан с README.md.
- `npx expo start` поднимается.
- Default экран открывается на iOS + Android.
- Sentry-expo конфигурация присутствует.

**Skills:** N/A (mobile вне списка skills проекта; ориентируемся на Expo / React Native документацию через context7).
**Срок:** 3 дня.

---

### Шаблон тикета для остальных разработчиков (используй как канву)

```
[Поток / Sub-ТЗ] [Sprint N] Краткое название

Контекст: [1-2 строки — зачем это, во что встроено, какой sub-ТЗ покрывает]

Что нужно сделать:
1. [Конкретный шаг 1 с file paths]
2. [Конкретный шаг 2]
3. [Конкретный шаг 3]
4. [Конкретный шаг 4]
5. [Команды для проверки: `bun run typecheck`, `bun run lint`, `bun run test:unit`, etc.]

Definition of Done:
- [Чек-лист 5-7 пунктов: что должно работать, какие тесты прошли, какие файлы созданы]

Ссылки на sub-ТЗ:
- plans/tz/2026-05-23-XXX.md
- second-brain/02_architecture/YYY.md (если есть архитектурная сноска)

Skills проекта применить:
- nestjs-rules / frontend-rules / prisma-db-push-rules / safe-seed-rules / z-ai-agent-rules / core-engineering-standards / domain-business-context

Срок: N дней.

Кто review: [B1 / B2 / F1 / Tech Lead]
```

---

## Метрики прогресса Wave 1

### Burndown
- Sprint 1: 11 тикетов (4 B1 + 4 B2 + 4 R1 + 3 D + 2 Des) = ~28 человеко-дней (закрыто к концу спринта = 100% capacity).
- Sprint 2: ~25 тикетов (включая F1 онбординг).
- Sprint 3: ~30 тикетов.

### Качественные критерии Wave 1 done
- [ ] `bun run typecheck` всегда зелёный на main.
- [ ] Integration test coverage в `tracker/` модуле ≥ 70%.
- [ ] Мобилка собирается через EAS, доступна в TestFlight + Internal Testing.
- [ ] Demo-сценарии 3 спринтов работают на dev-стенде.
- [ ] Один пилотный клиент (внутри команды или партнёр) может создавать задачи через web + mobile + Telegram (Telegram — пока через legacy α-1).
- [ ] knowledge-core принимает tracker_event и создаёт IdeaBlock с правильным signalType.
- [ ] AI-чат компании отвечает «что сегодня нового в задачах команды» на простой вопрос с цитатой.
- [ ] Backlog Кора v2: закрыто 4-5 sub-ТЗ полностью (γ-1, α-4, β-5, β-4 causeCategory, α-7 — частично).

### Регулярные точки синхронизации
- Daily standup 10:00 МСК (15 мин).
- End-of-Sprint demo: пятница последнего дня спринта, 15:00 МСК (30 мин).
- Mid-sprint sync: среда первой недели спринта, 14:00 МСК (15 мин) — корректировка scope если нужно.
- Кросс-команд (web + mobile) sync: каждый понедельник 11:00 МСК (20 мин) — обсуждение API-контрактов и DTO изменений.

---

## Что НЕ делаем в Wave 1 (явно откладываем)

- Frontend трекера полноценный (Фаза 2 — Wave 2).
- AI-фичи трекера (Фаза 3 — Wave 2).
- Telegram-бот для задач (Фаза 4 — Wave 3).
- Email-to-task (Фаза 4 — Wave 3).
- Импорт из Битрикс24/Trello/Я.Трекер (Фаза 5 — Wave 3).
- COO Operations Dashboard + DailyCheckIn (Фаза 6 / β-8 — Wave 3).
- Activity Feeds полноценный (модель + 6 типов — Wave 2).
- Specialist 3.8 Helpfulness (Wave 2).
- Recognition Agent + Gamification (Wave 2).
- α-5 DialogService (Wave 2).
- α-8 Role Map нормализация (Wave 3).
- α-9 Company Foundation (Wave 3).
- α-10 Admin LLM + Economics (Wave 2-3).
- β-6 / β-7 / γ-2 / γ-3 / δ-1 / δ-2 / δ-3 (Wave 3+).
- Stripe / ЮMoney / Tinkoff Касса интеграция (Wave 3, после ценовой модели подтверждённой).
- Мобилка v2 (Apple Watch, Wear OS, offline-write, QR-сканер — после Wave 3).
- 1С интеграция (Phase 6+).
- ФСТЭК сертификация (закладываем архитектуру, не запускаем).

---

## Связанные документы

- [Зонтичный план Wave 1-3](../tz/2026-05-23-coo-and-tracker-umbrella.md)
- [Reality-deltas — что в коде vs план Кора v2](../analysis/2026-05-22-code-reality-deltas.md)
- [Phase 1 трекера sub-ТЗ](../tz/2026-05-23-tracker-phase-1-models-api.md)
- [Phase 2 трекера sub-ТЗ](../tz/2026-05-23-tracker-phase-2-frontend-mobile-first.md)
- [Tracker as entry wedge — стратегический анализ](../analysis/2026-05-23-tracker-as-entry-wedge.md)
- [AI-COO readiness gap-анализ](../analysis/2026-05-23-ai-coo-readiness-analysis.md)
- [Product overview простым языком](../analysis/2026-05-23-product-overview-simple.md)
- [Mobile native sub-ТЗ](../tz/2026-05-23-tracker-mobile-native.md)
- [Specialist 3.8 Helpfulness sub-ТЗ](../tz/2026-05-23-specialist-3-8-helpfulness-agent.md)
- [Activity Feeds sub-ТЗ](../tz/2026-05-23-activity-feeds.md)
- [Gamification + Recognition sub-ТЗ](../tz/2026-05-23-gamification-and-motivation.md)

---

_2026-05-24: оркестратор сформировал план Wave 1 и обзор Wave 2-3. Sprint 1 готов к старту после ответов на 3 срочных вопроса владельца. Документ — живой, обновляется в конце каждого спринта._
