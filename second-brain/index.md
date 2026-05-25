# SECOND BRAIN — Z (память компании)

> Главный навигационный файл. Все разделы ведут отсюда.
>
> **Категория продукта:** «память компании» / memory layer (см. [[06_marketing/positioning]]). **Первая рабочая вертикаль:** AI-встречи на LiveKit (MVP).

## Карты верхнего уровня

- [[02_architecture/project-overview]] — что такое проект, MVP-границы, основной флоу

## Система

- [[00_system/SECOND_BRAIN_PROTOCOL]] — главный протокол
- [[00_system/SOURCE_OF_TRUTH]] — каким источникам верить
- [[00_system/STRUCTURE_RULES]] — правила файлов и папок
- [[00_system/LINKING_RULES]] — правила перелинковки
- [[00_system/INDEX_RULES]] — правила обновления этого файла
- [[00_system/TASK_WORKFLOW]] — процесс работы над задачей
- [[00_system/UPDATE_AFTER_CODE_CHANGE]] — что обновлять после изменений кода
- [[00_system/BOOTSTRAP_FROM_CODE]] — как первично заполнить second-brain

## Проекты

- [[01_projects/onboarding-wizard]] — wizard «Знакомство с компанией» (Фаза 0c): 5 шагов, owner-only, AppShell скрыт
- [[01_projects/company-framework-slots]] — слоты каркаса 5 уровней группы Б (Mission/Vision/Strategy/Process/Regulation/Policy/Tool/Metric/Decision): модели без UI до Фазы γ, наполняются автоматически
- [[01_projects/document-ingest]] — pipeline загрузки документов (Фаза 0b): PDF/DOCX/MD/TXT через document.adapter, text.adapter для /dump, extraction группы Б с провенансом
- [[01_projects/role-profile-agent]] — RoleProfileAgent (Фаза 0d): BullMQ-воркер карты должности, cron каждые 4 часа + on-demand rebuild, порог N=5
- [[01_projects/conversational-channels]] — SBA α-1 Conversational Channels Foundation: omnichannel-слой (in_app + email), Notification/Delivery, BullMQ outbound, REST `/me/channels` `/me/notifications`, free-note ingest
- [[01_projects/curation]] — SBA α-4 Layer 4 Curation Foundation: triage (auto/light/deep), CurationItem/Decision, ConflictItem (first-class) с резолюцией `evolving`, CardVersion (версии), CardStaleDetectorCron (cron 4:00), per-domain кураторы, multi-touch UI (`/curation`, inline-баннер, conversational probe, dashboard-виджет)
- [[01_projects/chat-v2]] — SBA α-5 Layer 5 Chat-v2 Omnichannel: AI-чат компании поверх knowledge-core, conversation history (TTL 90 дней + pin), 3 режима (factual/synthetic/clone_style), omnichannel inbound через α-1 (web/in_app/telegram/email), citations с timestamp, CardSpecialistRegistry заготовка под α-6+, новый модуль `chat-v2/` с legacy `chat/` помеченным @deprecated
- [[01_projects/specialist-3-4-project-customer]] — SBA α-6 Specialist 3.4 (Project/Customer Context) — **эталонный референс §5 контракта специалиста** Слоя 3: рефакторинг `card-rollup-v2.worker` под единый контракт, новый воркер consumer `core.specialist-routing` jobName=`3-4-project-customer`, расширение Card (`sourceBlockIds`, `confidence`, `currentVersionId`, `personSubjectIds`, `lastConfirmedAt`), 4 probe-trigger'а через `eventType=specialist.probe`, conflict detection (regex «закрыт ↔ активен»), регистрация в CardSpecialistRegistry, метрики `core_specialist_*{type='card'}`, vendor kind, патч backfill CardVersion(v1)
- [[01_projects/regulations]] — SBA α-7 Specialist 3.1 (Regulations) — первая видимая ценность Слоя 3: автогенерация регламентов / процессов / политик из встреч с провенансом до цитаты. Расширение existing моделей Process / Regulation / Policy (in-place, без новой таблицы Regulation.kind), новый воркер consumer `core.specialist-routing` jobName=`3-1-regulations`, 3 новых LLM-taskType (regulation-extract / regulation-dedupe / process-steps-extract) с тройной цепочкой, 4 probe-trigger'а (missing_owner / process_no_steps / stale / scope_unclear), conflict-events через ConflictService, регистрация в CardSpecialistRegistry, REST `/api/v1/regulations` + UI `/regulations` (master-detail с фильтром kind)
- [[01_projects/knowledge-clone]] — SBA β-2 Specialist 3.2 (Knowledge Clone) — что человек знает (факты, опыт, экспертиза), фундамент SkillProfile γ-1. Расширение `Person` (`knowledgeProfile Json`, `lastProfileBuildAt`, `profileBuildVersion`), новая очередь `core.knowledge-clone-rebuild` + 2 воркера (router-consumer и rebuild-consumer) + cron `0 */6 * * *`, 2 новых LLM-taskType (knowledge-clone-extract / knowledge-clone-merge) с тройной цепочкой, 2 probe-trigger'а (new_expertise_detected / contradiction_detected), регистрация в CardSpecialistRegistry, REST `/api/v1/me/knowledge-profile` + mark-wrong + `/persons/:id/knowledge-profile`, RBAC ресурс `knowledge_profile` (manager.open видит всё, manager.strict видит self), UI на `/me/knowledge-profile` и `/persons/[id]/knowledge-profile`
- [[01_projects/decisions]] — SBA β-3 Specialist 3.3 (Decisions Registry) — реестр решений компании с rationale, alternatives, supersede-цепочками и evolving-конфликтами. Расширение Decision in-place (entityId, statement, rationale, alternatives Json, decidedByPersonIds[], deadline, supersedesId, affectsEntityIds[], sourceBlockIds[], confidence Decimal(4,3), embedding vector(1536), validFrom/validUntil, actualOutcomes), DecisionStatus enum расширен (proposed/approved/rejected/implemented/cancelled/superseded + legacy active/rolled_back), 2 новых LLM-taskType (decision-extract / decision-supersede-detect) с тройной цепочкой, новый воркер consumer `core.specialist-routing` jobName=`3-3-decisions`, 5 probe-trigger'ов (2 sync — missing_decider/no_deadline_critical; 2 cron — overdue/outcome_unknown; 1 manual — competing_versions), conflict-events evolving через ConflictService, регистрация в CardSpecialistRegistry, REST `/api/v1/decisions` + supersede-chain + history + manual create (owner/admin), HNSW + tsvector + GIN индексы, UI `/decisions` master-detail (sidebar пункт «Решения»)
- [[01_projects/insights]] — SBA β-4 Specialist 3.5 (Insights Radar) — радар повторяющихся проблем / рисков / блокеров / неэффективностей с динамикой (spike/growing/stable/declining через ratio 7d/30d-avg). Новая модель Insight (kind/statement/severity/frequencyScore/dynamicScore/dynamicLabel/affectedEntityIds[]/relatedDecisionIds[]/mitigationPlan/firstObservedAt/lastObservedAt/status/sourceBlockIds[]/personSubjectIds[]/confidence Decimal(4,3)/dataClass='internal'/embedding vector(1536)), 4 enum'а (InsightKind/InsightSeverity/InsightDynamic/InsightStatus), HNSW + tsvector + GIN индексы. 2 LLM-taskType (insight-extract / insight-link-to-decisions, тройная цепочка DeepSeek-flash → OpenAI mini/nano → Ollama qwen3:30b), новый воркер consumer `core.specialist-routing` jobName=`3-5-insights` с KNN-кластеризацией повторов (threshold 0.78), новый cron `0 */6 * * *` для recalc frequency/dynamic + probe no_mitigation_plan + gauge insights_dynamic_label_count, 4 probe-trigger'а (escalation_suggested/no_mitigation_plan/linked_decision_question/recurring_after_mitigation), регистрация в CardSpecialistRegistry, REST `/api/v1/insights` + chart + top для дашборда, RBAC ресурс `insight` (owner/admin r/w/d, manager.open r/w для mitigation), UI `/insights` master-detail с SVG stacked-bar + виджет «Топ-5 повторяющихся проблем» в Director Dashboard (sidebar пункт «Сигналы»)
- [[01_projects/ideas]] — SBA β-5 Specialist 3.6 (Ideas Collector) — реестр идей сотрудников и запросов клиентов с supporter'ами, динамическим весом, кластеризацией IdeaCluster. Модель Idea (kind=internal|client_request, statement/rationale, weight Decimal(6,3), supporterCount, supporters JSON, status captured→shipped/rejected/archived, clusterId, sourceBlockIds[], personSubjectIds[], embedding vector(1536), createdByUserId). IdeaCluster (KNN cosine 0.80 + LLM `idea-cluster-merge`). Worker `3-6-ideas`, cron `IdeaClustererCron` (раз в 4 часа). REST `/api/v1/ideas` + `/me/ideas` + `/idea-clusters`. UI `/ideas` master-detail tabs Внутренние/От клиентов/Мои. Closing-loop через EventEmitter `idea.status_changed` + LLM `idea-status-summarize`. Telegram `/myideas` теперь функциональна. RBAC `idea`.
- [[01_projects/probe-agent]] — SBA β-5 Layer 6 (Probe-Agent) — новый слой поверх α-1. `ProbeService.suggest(...)` — единая входная точка для специалистов Слоя 3 (миграция 3-1/3-2/3-3/3-4/3-5 через `@Optional()` inject + fallback). Модель `ProbeEvent` (status pending|dispatched|dropped_dedup|dropped_rate_limit|dropped_cold_start|expired). Redis-дедуп по contentHash (TTL 72ч), per-user rate-limit (5/час + 20/день), priority compute. `ProbeDispatcherWorker` (consumer `core.probe-events`): LLM `probe-formulate` + `sendNotification(eventType='probe.question')`. `ProbeResponseHandler` (@OnEvent `notification.responded`). `ProbePriorityCron` (engagement_rate gauge + expiry sweep). REST `/probe/queue` (admin) + `/me/probe-history`. Глобальный `@nestjs/event-emitter`. Метрики `probe_events_total{emitted_by_service,reason,status}` + 8 других. RBAC `probe_event`.
- [[01_projects/calendar]] — **Календарь (Calendar MVP, 2026-05-25)** — расширение `Event` графа знаний до полноценного user-календаря. CRUD событий с участниками и RSVP, `visibility=company|team|personal`, `EventReminder` + cron-sweep + Telegram-доставка, 5 Concierge tools (`create_event`, `list_my_events`, `list_user_events`, `find_free_slot`, `delete_event`), UI `/me/calendar` (Day/Week/Month + drag-n-drop), замена заглушки `/projects/[slug]/calendar`, 1-way ICS-feed `GET /api/v1/calendar/:userId.ics?token=...` для подписки в Я.Календарь/Google/Outlook. LiveKit `Meeting` остаётся отдельной media-сущностью (связь `Event.relatedMeetingId`). Фаза 3 (2-way OAuth, Motion-style autoscheduler) — отложена.
- [[01_projects/tracker]] — **Tracker (задачный модуль Z/Кора)** — бесплатный таск-трекер как PLG-точка входа. 20 новых Prisma-моделей (Project/Issue/Cycle/Intake/Comment/Relation/Activity/Version/Attachment/Webhook/TeamTemplate + связанные), 8 controllers с CRUD + transitions + assignees + labels + subscriptions + goal-link, 8 services с $transaction для всех multi-мутаций + IssueActivity audit-trail + ActivityRecorderService, IssueRelation с auto-парной обратной (blocks↔blocked_by, duplicates↔duplicated_by, relates_to↔relates_to), Attachments через S3 (25 MB лимит, MIME whitelist, presigned URL), start-meeting через LiveKit (Meeting.task_discussion + JWT), 18 новых SignalType (8 task_* + 7 help_* + 3 gamification), WebSocket gateway /ws/tracker per-tenant rooms, BullMQ outgoing webhooks с HMAC SHA256 + retry 5 попыток (60s→300s→1500s→7500s→37500s) + IssueWebhookLog, 6 RBAC ResourceType (project/issue/cycle/intake_issue/team_template/issue_webhook), 9 Prometheus метрик, 5 ENV переменных. **Принцип «трекер = источник для второго мозга»** — каждое событие → RawEvent → knowledge-core (ingest адаптер в Sprint 3 / B1-3.1). Шаблоны 10 команд: sales/development/installation/marketing/management/customer_support/hr/finance/operations/product (seed контента в Phase 4 / Sprint 9-10). LiveKit RNNoise активирован по умолчанию + UI toggle. Параллельная нативная мобилка React Native + Expo (kora-mobile, отдельный репозиторий, R1 поток).
- [[01_projects/skill-and-clone]] — **SBA γ-1 Specialist 3.7 (SkillProfile) + ExecutablePersona + Clone API** — финальная фаза SBA, самый чувствительный sub-TZ. **Employee Clones**: клоны сотрудников по наблюдаемому поведению. 3 новых модели (SkillProfile / SkillTrait с эмерджентной категорией / ExecutablePersona) + 5 enum'ов, HNSW индекс на trait.embedding, GIN на sourceBlockIds. Источник — только subject-reasoning-блоки employee'ев (signalType ∈ reasoning/rationale/decision_basis). KNN-группировка → LLM `skill-trait-detect` (⚠ КРИТИЧНО, primary `gpt-5.4` capable) → KNN-merge через `skill-trait-merge` → decay. **Auto-canonical (без pre-approval)**: manager помечает trait как `mark_as_misleading` ПОСТФАКТУМ (новое значение в `CurationDecisionType`). 4 LLM-taskType (skill-trait-detect / skill-trait-merge / executable-persona-compile / clone-respond) с тройной цепочкой. Новая очередь `core.skill-profile-rebuild` + worker (debounce 60s). 3 cron'а: daily decay (`0 5 * * *`), weekly persona snapshots person+role (`0 6 * * SUN`), weekly manager digest (`0 9 * * MON`). 2 probe-trigger (`skill.profile_starved` / `skill.contradicting_traits`). Новый модуль `clones/` с REST `POST /clones/persons/:id/ask` + `/roles/:id/ask` + GET skill-profile + POST mark-misleading. Rate limit 20/сутки на пользователя через Redis. RBAC `skill_profile` + `clone_persona` (owner/admin/direct manager/self). Расширение `SynthesisService.synthesize` mode='clone_style' → делегирование `ClonesService.askPerson`. UI: **обязательная** `/me/clone` (zonтичный §3.3 C5 — без неё DoD не закрыт), `/persons/[id]/skill-profile` (manager UI с mark-misleading), `/roles/[id]/skill-profile` (агрегат + диалог с клоном роли). Кнопка «отключить наблюдение» НЕ показывается (§3.4 правило).
- [[01_projects/crossmark-integration]] — связь с Crossmark: только через API, развёртывание отдельное
- [[01_projects/meeting-types]] — 9 типов встреч MVP
- [[01_projects/ai-analysis-by-type]] — шаблоны AI-анализа по типу
- [[01_projects/ai-value-director]] — **AI-директор по ценности** (Value Director) — первый агент в будущем AI-совете директоров CEO, работает на методологии из [[06_marketing/client-value-framework]]
- [[01_projects/roles-and-permissions]] — роли host/guest и их права
- [[01_projects/recording]] — запись встречи (общая + аудиодорожки) + retention (TTL по тарифу)
- [[01_projects/meeting-result-page]] — карточка результата: что показываем после встречи
- [[01_projects/capacity-and-infra]] — мощности, метрики, deployment-правила

## Архитектура

- [[02_architecture/project-overview]] — что такое проект и основной флоу
- [[02_architecture/tech-stack]] — стек технологий
- [[02_architecture/module-map]] — карта модулей и потоков данных (включая Фазу 0: departments/roles-domain/persons/job-descriptions/skills/documents/role-profiles/structure/graph)
- [[02_architecture/data-model]] — сущности (Meeting, Participant, Recording, AI Result) и FSM статусов; Фаза 0: группа А (с UI) + группа Б (слоты каркаса) + расширения existing + Apache AGE
- [[02_architecture/age-deployment-decision]] — решение по Apache AGE (граф знаний поверх PostgreSQL)
- [[02_architecture/ai-integration]] — внутренние API компании: GigaAM Vox (ASR) + Claude Sonnet (LLM), `proxy.agent-lia.ru` для fallback

- [[02_architecture/code-pitfalls]] — копилка тех. фактов «не как кажется» (LiveKit, Egress, webhooks, ASR-биллинг)
- [[02_architecture/knowledge-core]] — единое информационное ядро Z (Фаза 4): IdeaBlock + Entity + IdeaBlockLink + EntityLink + Theme, pipeline ingest→distill→link→reframing→theme-clusterer→card-rollup-v2, гибридный поиск + граф + темы

## Решения / ADR
_пусто_

## Активные ТЗ

### Tracker Wave 1 — В РАБОТЕ (2026-05-24)
- [`plans/sprints/2026-05-24-sprint-plan-wave-1.md`](../plans/sprints/2026-05-24-sprint-plan-wave-1.md) — **Sprint Plan Wave 1: оркестрация единого продуктового рывка Z/Кора + AI-COO + второй мозг.** 3 спринта × 2 нед (2026-05-26 → 2026-07-06). 4 потока параллельно (Phase 1 трекера, α-2 расширение signalType, мобилка bootstrap, бэклог Кора v2 доделок). Sprint 1 + большая часть Sprint 2 закрыты 2026-05-24 за одну сессию через 9 параллельных subagent'ов: 20 моделей трекера + 18 новых SignalType + 38 файлов tracker модуля + WebSocket gateway + BullMQ webhook delivery + LiveKit RNNoise + γ-1 SkillTraitCategory frontend + 2 новых AI промпта (review/retrospective) + Insight.causeCategory + IssueRelation + Attachments S3 + start-meeting LiveKit. ~10 200 строк кода + тестов за сессию. 10 решений владельца зафиксированы (включая отмену кнопок 🟢🟡🔴 в чек-инах — AI определяет sentiment из текста).
- [`plans/tz/2026-05-23-coo-and-tracker-umbrella.md`](../plans/tz/2026-05-23-coo-and-tracker-umbrella.md) — **Зонтичный план единого продуктового рывка** (карта всех sub-ТЗ + 3 волны разработки + граф зависимостей + календарь). 10 новых sub-ТЗ (6 фаз трекера + мобилка + Activity Feeds + Specialist 3.8 Helpfulness + Gamification) + 21 sub-ТЗ Кора v2.
- [`plans/analysis/2026-05-23-tracker-as-entry-wedge.md`](../plans/analysis/2026-05-23-tracker-as-entry-wedge.md) — **Tracker as PLG entry wedge** — обоснование сценария C (свой трекер vs Huly/Plane), конкурентный анализ российского рынка, UX-паттерны простоты, монетизация free→paid AI, РФ must-have.

### Кора v2 — РЕАЛИЗОВАНО (2026-05-23)
- [`plans/analysis/2026-05-23-kora-v2-shipping-report.md`](../plans/analysis/2026-05-23-kora-v2-shipping-report.md) — **Shipping Report Кора v2: 19 sub-ТЗ закрыто за одну сессию через оркестрацию 14 параллельных coders.** 221 файл, 19 новых Prisma моделей, 12 frontend страниц, 25+ LlmTaskType, 17 RBAC ResourceType, 30+ метрик, 15 patch-scripts. Содержит:
  - Список всех 19 закрытых sub-ТЗ с тестовыми результатами.
  - 14 архитектурных решений принятых оркестратором автономно.
  - Технические грабли (TS2589, race conditions, prisma:push).
  - **Полная prod-инструкция: prisma:push + 5 patch-scripts + 12+ seed-scripts + ENV updates + restart.**
  - vNext TODO (Concierge native tool-use, WS voice integration, Recharts установить, real-time labeled metrics).

### Активные ТЗ (прошлая сессия — теперь deferred/legacy)
- [`plans/analysis/2026-05-22-code-reality-deltas.md`](../plans/analysis/2026-05-22-code-reality-deltas.md) — ⚠️ **REALITY CHECK** для всей Коры v2 (draft 2026-05-22, audit-проход 2026-05-23). Сводный отчёт 7 code-audit агентов: сопоставление `unified-product-architecture.md` + `final-roadmap.md` с **реальным состоянием кода**. **Главный вывод:** ~60-70% продуктового scope **уже реализовано**, реальная оставшаяся работа — **~30% от заявленного** (≈14 sub-ТЗ вместо 24, ~22 новых Prisma-моделей вместо 37, ~12 новых страниц вместо 21). Сводная таблица фактической готовности по каждому sub-ТЗ (Часть 1). **6 критических багов CRIT-1..CRIT-6** для исправления в первую очередь (включая bug-fix `ENTITY_TYPE_VALUES` в `block-ingest.prompt.ts:30-38`). Конкретные правки к каждому sub-ТЗ (Часть 3). Точки конфликта с реальным кодом: PersonRole→Appointment, Metric→KPI, Mission/Vision/Strategy→CompanyProfile, Process→ProcessTemplate, унификация двух admin-групп ДО α-10. **Перед стартом любой реализации Коры v2 — читать этот файл.**
- [`plans/analysis/2026-05-22-unified-product-architecture.md`](../plans/analysis/2026-05-22-unified-product-architecture.md) — **Кора v2 — единая финальная архитектура продукта** (главный документ, **status=approved** владельцем 2026-05-23, 11 частей + 3 приложения). Синтез 5 analysis-документов сессии 2026-05-22 + зонтичного ТЗ от 2026-05-21 + новых требований владельца (концьерж-агент, юнит-экономика, zero-button каналы). **Ответы на 50+ открытых вопросов — все приняты.** 8 принципов продукта (Часть 2). 4 оси знания (WHO × FUNCTIONAL × CONTEXTUAL × TEMPORAL) + 7 слоёв системы + 20+ агентов. Главные изменения относительно 2026-05-21: 4 оси вместо 2, 12 специалистов вместо 7, фазы α/β/γ/δ, zero-button каналы, Concierge Agent сквозной, юнит-экономика first-class. Зонтичное ТЗ 2026-05-21 переведено в исторический режим.
- [`plans/tz/2026-05-22-final-roadmap.md`](../plans/tz/2026-05-22-final-roadmap.md) — **Финальная программистская роадмапа Коры v2** (зонтичный ТЗ для разработчиков, **status=approved** владельцем 2026-05-23, 24 sub-ТЗ в 4 фазах). Парный документ к unified-product-architecture: переводит продуктовые решения в фазы / sub-ТЗ / миграции Prisma / конкретные изменения кода. 37 новых моделей, 22 новые страницы frontend (+1 после уточнения 2026-05-23 — `/admin/llm/catalog`). **Включает 3 интегрированных отчёта subagents:** Telegram zero-button rip-out (Часть 8), Admin LLM + Unit Economics deep-dive (Часть 9 + α-10), Concierge Agent deep-dive (Часть 10 + γ-2). Уточнение 2026-05-23 (§9.6): прайс моделей — кодовый каталог `llm-models-catalog.ts` как source of truth → seed в БД → витрина в админке + manual override.
- [`docs/user-guide/index.md`](../docs/user-guide/index.md) — **Пользовательская wiki Коры** (12 файлов, простой русский язык, аудитория — конечный пользователь, не программист). Создаётся 2026-05-22 как продуктовое требование владельца. Структура: Quick Start → Встречи → Знания → Каналы → Концьерж → Роли → Клон сотрудника → Дашборды → Админка → FAQ → Глоссарий.
- [`plans/tz/2026-05-21-second-brain-agents-umbrella.md`](../plans/tz/2026-05-21-second-brain-agents-umbrella.md) — **(исторический) Второй мозг компании: архитектура 12 агентов в 6 слоях** (зонтичный ТЗ от 2026-05-21, после 2026-05-22 переходит в режим «исторический» — заменён парой unified-product-architecture + final-roadmap). Матрица прослеживаемости 78 строк. Фиксирует **7 архитектурных решений** из диалога с владельцем: двухслойная модель знания (`IdeaBlock` + карточки специалистов) / онтология категорий A/B/C (`Entity.type` 7→12) / фазовая раскатка α-β-γ по архитектурной устойчивости / Skill как рабочий артефакт компании (не персональные данные, эмерджентные категории, главный источник `signalType='reasoning'`) / двунаправленные conversational channels (InApp = равноправный канал; Telegram+MAX в β; pluggable) / Curation triage с conflict first-class и обязательным `evolving` для temporal-памяти / **LLM provider routing — трёхуровневая подстраховка** (primary/secondary/tertiary, tertiary = local Ollama) + admin-переключение per-agent без выкатки кода + ссылка на [`llm-models-playbook.md`](../llm-models-playbook.md) в каждом seed-script. Контракт специалиста §5 — сквозной для всех 7 агентов Слоя 3 (11 пунктов, включая обязательную регистрацию taskType с цепочкой из 3 provider'ов). 13 sub-TZ:
  - **α (фундамент):** [`α-1 Channels Foundation`](../plans/tz/2026-05-21-sba-alpha-1-channels-foundation.md) + [`α-2 Layer1 Marking Extension`](../plans/tz/2026-05-21-sba-alpha-2-layer1-marking-extension.md) + [`α-3 Layer2 Ontology Extension`](../plans/tz/2026-05-21-sba-alpha-3-layer2-ontology-extension.md) + [`α-4 Layer4 Curation Foundation`](../plans/tz/2026-05-21-sba-alpha-4-layer4-curation-foundation.md) + [`α-5 Layer5 Chat-v2 Omnichannel`](../plans/tz/2026-05-21-sba-alpha-5-layer5-chat-v2.md) + [`α-6 Specialist 3.4 Project/Customer`](../plans/tz/2026-05-21-sba-alpha-6-specialist-3-4-project-customer.md) + [`α-7 Specialist 3.1 Regulations`](../plans/tz/2026-05-21-sba-alpha-7-specialist-3-1-regulations.md)
  - **β (социальные специалисты + замыкание петли):** [`β-1 Telegram + MAX`](../plans/tz/2026-05-21-sba-beta-1-channels-telegram-max.md) + [`β-2 Specialist 3.2 Knowledge Clone`](../plans/tz/2026-05-21-sba-beta-2-specialist-3-2-knowledge-clone.md) + [`β-3 Specialist 3.3 Decisions`](../plans/tz/2026-05-21-sba-beta-3-specialist-3-3-decisions.md) + [`β-4 Specialist 3.5 Insights`](../plans/tz/2026-05-21-sba-beta-4-specialist-3-5-insights.md) + [`β-5 Specialist 3.6 Ideas + Layer 6 Probe`](../plans/tz/2026-05-21-sba-beta-5-specialist-3-6-ideas-and-layer6-probe.md) (выпускаются парой)
  - **γ (мышление):** [`γ-1 Specialist 3.7 Skill + Executable Persona + Clone API`](../plans/tz/2026-05-21-sba-gamma-1-specialist-3-7-skill-and-clone.md) (обязателен UI `/me/clone` для прозрачности перед носителем)
  - **Промпты — отдельный круг согласования с владельцем продукта** (§10), в коде только placeholders.
- [`plans/tz/2026-05-21-competitor-parity.md`](../plans/tz/2026-05-21-competitor-parity.md) — **Паритет с российскими конкурентами по post-meeting фичам** (зонтичный ТЗ, draft 2026-05-21, матрица 45 строк). Закрывает 5 гэпов от mymeet/FollowUp/Таймлист: конструктор шаблонов AI-отчёта в админке, метрики поведения участников, AI-оценка качества встречи, очистка транскрипта, несколько отчётов на встречу. 5 sub-TZ — все draft от 2026-05-21:
  - [`A — Prompt Registry + Admin-конструктор шаблонов`](../plans/tz/2026-05-21-phase-A-prompt-registry-admin.md) (БД-registry + UI до 30 разделов, версионирование, A/B, Org-overrides, перенос 9 системных промптов из кода)
  - [`B — Метрики поведения участников`](../plans/tz/2026-05-21-phase-B-meeting-behavior-metrics.md) (speakingTime, monologues, questions, filler words, interruptions; воркер `ai.behavior-metrics`)
  - [`C — AI-оценка качества встречи`](../plans/tz/2026-05-21-phase-C-meeting-quality-score.md) (0–100 + 5 категорий + рекомендации руководителю; видим только хосту/Org-Admin)
  - [`D — Очистка транскрипта`](../plans/tz/2026-05-21-phase-D-transcript-cleaning.md) (cleanedS3Url, не разрушающая оригинал; AI-pipeline продолжает работать с оригиналом)
  - [`E — Несколько отчётов на встречу`](../plans/tz/2026-05-21-phase-E-multi-report-per-meeting.md) (зависит от A; primary AiResult + many MeetingReport; entitlement-гейт по тарифу)
- [`plans/tz/2026-05-21-phase-0-roles-and-onboarding.md`](../plans/tz/2026-05-21-phase-0-roles-and-onboarding.md) — **Фаза 0: должности, каркас компании и знакомство** (зонтичный ТЗ, матрица прослеживаемости 83 строки). 11 открытых вопросов закрыты решениями (§6). Все 4 sub-TZ — draft от 2026-05-21:
  - [`0a — фундамент: модели + AGE + GraphService + API + RBAC`](../plans/tz/2026-05-21-phase-0a-data-model-and-graph-infra.md) (16 моделей + 17 типов рёбер + Apache AGE)
  - [`0b — document-ingest + text.adapter + extraction каркаса 5 уровней`](../plans/tz/2026-05-21-phase-0b-document-ingest.md) (PDF/DOCX/MD + дамп + сущности группы Б)
  - [`0c — мастер знакомства + личный кабинет (frontend)`](../plans/tz/2026-05-21-phase-0c-onboarding-wizard-frontend.md) (5-шаговый wizard + 5 новых страниц + ComingSoonPage)
  - [`0d — RoleProfileAgent (BullMQ + cron + rebuild)`](../plans/tz/2026-05-21-phase-0d-role-profile-agent.md) (карта должности из observed-данных, порог N=5)
  - **Аналитика ЛК (вход в 0c):** [`plans/analysis/2026-05-21-user-cabinet-design.md`](../plans/analysis/2026-05-21-user-cabinet-design.md) — draft от 2026-05-21. Дизайн навигации (3 группы Компания / Оперативка / Настройки), default landing по роли, видимость γ-разделов, `/dump` и `/me` минимальные, multi-org switcher, wizard 5 шагов.
  - **Аналитика «ЛК × роли × доступ»:** [`plans/analysis/2026-05-21-cabinet-roles-value-and-access-model.md`](../plans/analysis/2026-05-21-cabinet-roles-value-and-access-model.md) — draft от 2026-05-21. Польза ЛК для руководителя vs сотрудника vs гостя; 4 слоя текущей защиты (tenantId + RBAC + visibilityMode + dataClass); gap для финансовых/HR/стратегических встреч; целевая 5-слойная модель с `sensitivity` + `FactAcl` (Фаза γ → Фаза β); матрица доступа по ролям.
- `plans/tz/2026-05-10-knowledge-core-tz.md` — **переустройство фундамента Z в единое информационное ядро (knowledge core)**. 12 фаз: org/multi-tenancy → universal ingest → IdeaBlock + Entity → граф связей → Theme → переписанные UX-агенты → AI-чат через ядро → админка отладки → дашборд директора → цели и стратегический согласователь → доп. источники → retention/security → tariffs. Концепции из `delivery/` и Blockify, реализация на стеке Z (NestJS/pgvector/BullMQ).
  - **Дочерние ТЗ (для агентов-исполнителей):**
    - `plans/tz/2026-05-10-phase-7-admin.md` — Z-Admin (super_admin) + Org-Admin (owner/admin): отладка, аналитика стоимости, A/B моделей, прайс-карта, тумблеры воркеров, отладка ядра.
    - `plans/tz/2026-05-10-phase-8-director-dashboard.md` — Дашборд директора: 5 виджетов поверх ядра + AI-чат (org-scope chat-v2), role-based split на `/dashboard`.
    - `plans/tz/2026-05-10-phase-9-goals-strategic-alignment.md` — Цели компании + воркер strategic-alignment (alignment 0-100 + history snapshots) + индикатор «Согласованность стратегии» на дашборде.
- `plans/architecture/2026-05-08-z-architecture.md` — целевая архитектура MVP (полное полотно: модули, FSM, контракты API, ENV, безопасность, decisions log)
- `plans/tz/2026-05-08-mvp-fullstack-tz.md` — основное ТЗ MVP по фазам 0–9 (frontend + backend + AI + admin + observability) ✅ закрыт
- `plans/tz/2026-05-06-infrastructure-deployment-tz.md` — фаза 0 (инфра): развёртывание серверов, LiveKit, Egress, БД, мониторинг, Selectel S3
- `plans/tz/2026-05-09-standalone-product.md` — Z как самостоятельный продукт ✅ реализован (2026-05-09): accounts/mail backend + signup/login/forgot/reset/onboarding + AppShell + master-detail журнал
- `plans/tz/2026-05-09-ai-meeting-workspace.md` — расширенный AI Meeting Workspace ✅ реализован (2026-05-09): 9 backend cross-cutting модулей (security/audit/quotas/api-keys/webhooks-out/destinations/exports/chat/public-api), 6 domain (tasks/chapters/highlights/shares/tags/templates), AI-pipeline (LlmRouter + Embeddings + 4 новых worker'а), 3-колоночная страница встречи + AI-чат + Vidstack + clips + public share, /tasks /settings/{tags,api,webhooks,exports,integrations} /admin/ai-models /dashboard
- `plans/tz/2026-05-09-cards.md` — Карточки (CRM-структура) ✅ реализован (2026-05-09): сущность Card (client/deal/project/topic/custom) с одним primary-контактом, Meeting.cardId (one-to-many), AI-сводка по карточке + AI-чат с RAG, ⌘K command palette, Public REST API, webhook events (card.created/updated/deleted, meeting.linked_to_card/unlinked), привязка только явная без LLM-угадывания
- `plans/tz/2026-05-09-meeting-room-chat.md` — In-meeting чат с persist ✅ реализован (2026-05-09): MeetingRoomMessage модель, POST/GET с идемпотентностью, ChatPanel переписан с history+dedup, 6-й таб «Чат», MeetingShare.allowChat для публичного шеринга, AI-pipeline merger подмешивает roomChat во все 9 типов промптов

## Реестры backend/frontend (living-документы, 2026-05-25)

- [[01_projects/api-layer]] — реестр всех REST endpoints по модулям (создан 2026-05-25)
- [[01_projects/frontend-pages]] — реестр Next.js App Router страниц (создан 2026-05-25)
- [[01_projects/ai-jobs]] — реестр LLM-провайдеров, taskType, prompt hardening (создан 2026-05-25)
- [[01_projects/workers-queues]] — реестр BullMQ-очередей, воркеров, @Cron заданий (создан 2026-05-25)
- [[01_projects/concierge-voice]] — Concierge + Voice Streaming WS (T4 финального handoff, создан 2026-05-25)

## Заметки по реализации (2026-05-09)
- [[01_projects/auth-and-accounts]] — standalone-аккаунты: argon2id, UserSession+jti, mail.hosting.reg.ru SMTP, forced-onboarding (+ Org-хук в register с 2026-05-10)
- [[01_projects/ai-workspace]] — карта новых модулей (tasks/chapters/highlights/shares/tags/templates/chat/api-keys/webhooks-out/destinations/exports), Public REST API
- [[01_projects/meeting-room-chat]] — in-meeting чат с persist: LiveKit DataChannel + POST в БД, history на join, 6-й таб результата, allowChat шеринг, AI-pipeline mixing
- [[01_projects/cards]] — CRM-структура встреч: Card (5 видов) + Meeting.cardId, card-rollup воркер с дебаунсом, AI-чат по карточке, ⌘K палитра, Public REST API
- [[02_architecture/security]] — SSRF-guard, AES-GCM-256 envelope-encryption webhook-секретов, ipHash, soft-delete с 30-дневным grace, retention extras
- [[02_architecture/design-system]] — dark-first + mint `#5EEAD4` + Geist + glass-cards, motion presets, AppShell

## Заметки по реализации (2026-05-10) — Фаза 0 knowledge-core
- [[01_projects/orgs-and-rbac]] — Org / Membership / OrgInvitation, RBAC через RbacService (Casbin-совместимый), super_admin, visibilityMode (open/strict)
- [[01_projects/llm-router]] — LlmRouter с обязательным tenantId, LlmModelPrice (версионируемая прайс-карта), AiUsageLog (cachedTokens/sourceRef/experimentGroup)
- [[01_projects/llm-providers-verified]] — **verified-карта LLM-провайдеров и моделей (источник правды, прогон 2026-05-21).** Какие каналы реально работают, готовые образцы вызова, что НЕ используем (Anthropic, bge-m3). Любой новый AI-агент сверяется с этим файлом.
- [[13_glossary/index|Глоссарий]] — Org, Membership, super_admin, visibilityMode, tenantId, IdeaBlock/Entity/Theme/Source/RawEvent (placeholder'ы для Фаз 1-4)

## Заметки по реализации (2026-05-10) — Фаза 1 knowledge-core
- [[01_projects/ingest-and-sources]] — Source/RawEvent + IngestService + meeting-adapter + core.raw-events очередь, hook в analyze.worker, MeetingTranscriptChunk помечен @deprecated

## Заметки по реализации (2026-05-10) — Фаза 2 knowledge-core
- [[02_architecture/knowledge-core]] — `IdeaBlock` + `Entity` + `IdeaBlockEvidence` + `IdeaBlockEntity`, pipeline `block-ingest.worker` → `block-distill.worker` → `entity-resolver.worker/cron`, гибридный поиск `cosine + BM25` (`POST /api/v1/knowledge/search`), pgvector HNSW + ts_vector GIN
- [[02_architecture/data-model]] — обновлён разделом knowledge-core (IdeaBlock + Entity + связи)
- [[02_architecture/module-map]] — добавлен раздел knowledge-core (services/workers/api)
- [[01_projects/llm-router]] — DeepSeek/Ollama адаптеры, JSON Schema strict, taskType ядра (`block-ingest`, `block-distill`, `entity-merge-arbiter`)

## Заметки по реализации (2026-05-10) — Фаза 3 knowledge-core
- [[02_architecture/knowledge-core]] — раздел «Граф (Фаза 3)»: `IdeaBlockLink` (7 типов связей: develops/contradicts/causes/consequences_of/shares_topic/shares_entity/question_answered_by) + `EntityLink` (6 типов: works_at/belongs_to/part_of/opposes/depends_on/mentions_with). `block-linker.worker` (consumer `core.block-linker`, KNN top-10 + LLM-арбитр, гейт LINKER_MIN_BLOCKS=50). `entity-graph-builder.cron` (раз в час, co-mentioned пары). `reframing.cron` (3:00, архивация слабых связей confidence<0.5, dynamicScore decay 90 дней, LLM-анализ свежих блоков)
- [[02_architecture/data-model]] — добавлены модели `IdeaBlockLink`, `EntityLink` + ER-связи
- API: `GET /api/v1/knowledge/blocks/:id/links`, `GET /api/v1/knowledge/entities/:id/links`, `GET /api/v1/knowledge/graph/neighbors?nodeType=block|entity&id=…&depth=1..3` (BFS, лимит 100 nodes, `truncated=true` при превышении)
- LlmTaskType: добавлен `entity-graph-builder` (`reframing` уже был); seed обновлён

## Заметки по реализации (2026-05-10) — Фаза 4 knowledge-core (только backend, frontend отложен)
- [[01_projects/themes]] — новая сущность `Theme` (AI-кластер блоков, embedding 1536, ветка из 12 delivery, dynamic/status/weight). `ThemeIdeaBlock` (M:M с весом) + `ThemeEntity` (denorm с mentionsCount). Pipeline: `theme-clusterer.cron` (`15 * * * *`) — KNN-greedy union-find (threshold 0.78, minSize 3, гейт `THEME_CLUSTERING_MIN_BLOCKS=100`) + LLM `theme-classify` (JSON Schema strict). Reframing `reflectOnThemes` (themeMerges = перенос связей + status='merged_into', themesToArchive, themeSplits — только лог)
- [[01_projects/cards]] — расширение `Card`: `entityId` (primary) + `relatedEntityIds[]` + `bornFromThemeId` + `cachedTopThemeIds[]`. Новый `card-rollup-v2.worker` (consumer `core.card-rollup-v2`, дебаунс 60s, 5 промптов по `Card.kind`); старый `card-rollup.worker` живёт параллельно до Фаз 5/6
- [[02_architecture/knowledge-core]] — раздел «Темы (Фаза 4)»: theme-clusterer + card-rollup-v2 + reflectOnThemes
- [[02_architecture/data-model]] — добавлены модели `Theme`, `ThemeIdeaBlock`, `ThemeEntity`, расширения `Card` + ER-связи
- API: `GET /api/v1/knowledge/themes` (фильтры branch/status, пагинация), `GET /api/v1/knowledge/themes/:id`, `POST /api/v1/knowledge/themes/:id/save-as-card`, `GET /api/v1/cards/:id/themes`
- RBAC: ResourceType расширен `'theme'` (read для всех member'ов Org, write/delete — owner/admin)
- LlmTaskType: `theme-classify` уже был в seed'е; `card-rollup-v2` тоже; обновление через `--update-existing` не обязательно

## Маркетинг

- [[06_marketing/index]] — навигация по маркетинговому разделу
- [[06_marketing/competitors]] — анализ конкурентов (Fireflies, Otter, Granola, tl;dv и др.)
- [[06_marketing/positioning]] — ценностное предложение, отличия от конкурентов
- [[06_marketing/icp]] — портрет идеального покупателя (ICP)
- [[06_marketing/messaging]] — ключевые сообщения, заголовки, tone of voice
- [[06_marketing/client-value-framework]] — методология клиентской ценности (по Гордееву) + роль Value Officer
- [[06_marketing/company-ontology]] — онтология компании (13 классов сущностей + ~40 типов рёбер, клон сотрудника как subgraph, специфика РФ) — фундамент архитектуры «второго мозга»

## Баги и инциденты (`03_bugs/`)
_пусто_

## Архив (`04_archive/`)
_пусто_

## Инфраструктура агента Claude Code

- `.claude/settings.json` — hooks (PreToolUse: блок `git push main/master`, `rm -rf /`, `DROP TABLE`; Stop: ворнинг про забытый second-brain после коммита в `backend/src` / `frontend/src` / `*.prisma`) + permissions deny для `.env` / секретов / ключей
- `.claude/skills/` — 12 скиллов (Crossmark-портированные + `bulletproof`, `skill-creator`, `frontend-design`); подробности и адаптации — в `plans/tz/2026-05-06-claude-code-infrastructure.md`
- `.mcp.json` — playwright MCP (UI-тесты)

---
_Обновлён: 2026-05-25 (финальный handoff Wave 1-3 Кора v2: 7 тикетов закрыто, 11 push-коммитов. T1 Recognition frontend + T2 Helpfulness frontend + T3 KIE/GRSAI LLM providers + T4 voice WS streaming + T5 email-to-task IMAP + T6 polish (inbox count/ChatV2Scope issue/vitest setup) + T7 prompts-hardening P1 (F1-F5) + T8 multi-user чат в задаче + T9 SPO discovery документ. Создано 5 новых заметок в second-brain (api-layer, frontend-pages, ai-jobs, workers-queues, concierge-voice)._

_Предыдущий: 2026-05-24 (Tracker Sprint 1: 20 моделей Prisma + 38 файлов tracker модуля + WebSocket gateway + BullMQ webhook delivery + LiveKit RNNoise + γ-1 frontend grouping + 18 новых SignalType + IssueRelation/Attachments/start-meeting + β-4 causeCategory; 10 коммитов, ~10 200 строк за одну сессию через 9 параллельных subagent'ов)._
