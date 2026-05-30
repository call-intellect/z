---
type: tz
status: draft
version: 2 (audit-driven rewrite 2026-05-30)
created: 2026-05-30
author: Claude (после серии итераций видения с владельцем + аудит 6 параллельных Explore-агентов)
analysis:
  - plans/analysis/2026-05-29-видение-для-владельца.md (главный документ — на простом языке)
  - plans/analysis/2026-05-29-dashboards-deep-analysis.md (research base, метрики)
  - plans/analysis/2026-05-29-dashboards-proof.md (адверсариальный обзор, что НЕ делаем)
  - plans/analysis/2026-05-29-dashboards-v3-expanded.md (расширенная архитектура — 9 экранов, 20 паттернов)
  - plans/archive/2026-05-23-activity-feeds.md (ActivityFeed — реализовано, переиспользуем)
related:
  - backend/src/modules/activity-feed/  (единая лента — реализована)
  - backend/src/modules/probe/  (Probe-Agent — реализован)
  - backend/src/modules/proactive/  (8 deterministic rules — реализован)
  - backend/src/modules/conversational/  (каналы доставки — реализован)
  - backend/src/modules/operations/  (sentiment, commitment-followup, personal-relation, daily/weekly digest, dashboard)
  - backend/src/modules/dashboard/services/director-dashboard.service.ts
  - backend/src/modules/concierge/  (tool-router, service-map)
  - backend/src/modules/knowledge-core/workers/sprint-helper.cron.ts
  - backend/src/modules/specialist-3-8-helpfulness/
  - backend/src/modules/recognition/
  - frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx
  - frontend/app/(authenticated)/feed/  (4 страницы лент — реализовано)
  - frontend/app/(authenticated)/sprints/[id]/SprintDashboardClient.tsx
---

# ТЗ: Пульс компании — полная реализация всех 6 волн (v2)

## 0. Карта документа

Это **полный** ТЗ на новую архитектуру дашбордов Z. Шесть волн, ~15 недель работы. Owner потребовал «всё в одном документе, не дробить».

**Структура**:
- §0.5 — **Правила работы агента-программиста по этому ТЗ** (читать ОБЯЗАТЕЛЬНО перед любой фазой).
- §1 — общие цели и принципы (применяются ко всем волнам).
- §2 — обзор всех 9 экранов с их ролями.
- §3.0 — **Реестр существующей инфраструктуры — переиспользуем, не дублируем**.
- §3.1-3.3 — каталог AI-агентов-аналитиков (существующие + 11 новых).
- §4 — изменения схемы данных (только реально новое).
- §5–§10 — Волны 1-6 (каждая с фазами, DoD, чекпоинтом перед следующей).
- §11 — общие риски и митигации.
- §12 — итог реализации (заполняется по мере).

**Stop-conditions между волнами** обязательны. Если метрики Волны N не достигнуты — Волну N+1 не начинаем.

**Версия 2** (rewrite 2026-05-30): пробежался по существующему коду 6 параллельными Explore-агентами. Найдено критическое: вся «лента вопросов» (ActivityFeed + Probe + Proactive) уже работает. Дублирующая модель `AssistantSignal` удалена. Sidebar строится поверх существующих API. MeetingParticipantBehavior уже даёт speaker-метрики. Sprint dashboard есть, но без daily/weekly разделения. Это и другие реюз-возможности явно проставлены в каждой фазе блоком «Уже существует».

---

## 0.5. Правила работы агента-программиста по этому ТЗ

Этот раздел **обязателен к прочтению** перед стартом любой фазы. Нарушения этих правил уже стоили нам дублирования архитектуры в v1 этого же ТЗ.

### 0.5.1. Перед стартом фазы — Read существующего кода

В каждой фазе ниже есть блок **«✅ Уже существует — проверь и переиспользуй»**. Это не справка — это **обязательный чек-лист**:

1. Открой каждый указанный файл **через Read** (не Grep, не Glob). Прочитай целиком если файл ≤500 строк, иначе ключевые методы.
2. Сверь сигнатуры существующих сервисов с тем, что ты собираешься создавать. Если 80% функционала уже есть — не создавай новый сервис, расширь существующий.
3. Если ТЗ требует создать модель, поле, endpoint, агент, страницу — **сначала grep по полному имени** (например, `ConsentLog`, `engagementScore`, `KpiHero`). Если уже есть — остановись и сообщи оркестратору с предложением реюза.
4. Запрещено создавать «параллельную» инфраструктуру под уже существующую систему уведомлений / ленты / каналов / RBAC. Любая такая попытка — стоп + согласование.

### 0.5.2. Если найдена коллизия с ТЗ

Если при проверке обнаружено, что ТЗ требует одного, а в коде уже другое — **не пиши код**. Сообщи оркестратору:
- Что ТЗ требует.
- Что в коде уже есть (путь к файлу + 5-10 строк сути).
- Твоё предложение: переиспользовать, расширить, заменить, оставить параллельно (с обоснованием).

Оркестратор решает и обновляет ТЗ. Только после этого ты пишешь код.

### 0.5.3. После каждого Edit — Read для верификации

Sub-агенты исторически проставляют `[x]` напротив фазы, не дописав код (см. `feedback_agents_can_lie_about_edits.md`). Правило: после **каждого** `Edit` — `Read` изменённого фрагмента (10-30 строк). Финальный отчёт оркестратору обязан содержать `git status` + по каждому изменённому файлу пометку «verified via Read».

### 0.5.4. Команды и стек

- Рантайм: **bun**, не npm.
- Prisma: только `bun run prisma:push`, **никогда** `migrate`. После правок схемы — `bun run prisma:generate`.
- ENV — через `TypedConfigService` + `env.schema.ts`, никаких `process.env.*` в коде.
- LLM — через `LlmRouterService.call({taskType, ...})`, ни одного прямого вызова провайдера.
- Промпты cache-friendly: стабильный SYSTEM, переменные данные в конце user (см. `feedback_llm_prompts_cache_friendly.md`).
- Скрипты в `backend/scripts/` — регистрировать в `apply-prod-deploy.ts` (массив `STEPS`).
- PrismaClient в скриптах — только через `createPrismaClient()` из `_lib/prisma.ts`.
- **Для frontend-фаз — обязательно skill'ы `frontend-design` + `impeccable` + `frontend-rules`** (см. §1.4.5). Никакого «дизайн будет потом» — он закладывается с первой версии страницы.

### 0.5.5. Тесты и self-check перед сдачей

Перед сдачей фазы оркестратору **обязательно**:
- `bun run typecheck && bun run lint && bun run build` (backend + frontend) — всё зелёное.
- `bun run test:unit` затронутых модулей — зелёное.
- E2E-тест для новой логики поверх HTTP — зелёный.
- Финальный отчёт: список файлов + последние 10-20 строк вывода каждой команды self-check.

Никаких коммитов / push — это делает оркестратор после ручной приёмки.

### 0.5.6. Что делать если не получилось

Если фаза не доделана — **оставь её `in_progress`, не ставь `[x]`**. В отчёте чётко: что сделано, что не сделано, что пытался и почему не получилось. Не используй destructive действия (`git reset --hard`, `--no-verify`) для обхода проблем.

---

## 1. Общие цели и принципы

### 1.1. Главная цель

Превратить Z из набора несвязанных дашбордов в **единую память компании**, где владелец / директор видит **всё что происходит** через осмысленные экраны и инсайты от AI-агентов, которые молча наполняют дашборды.

После полной реализации:
- 9 экранов (Главная / Операции / Ежедневный / Недельный / Команды список / Команды детально / Карточка сотрудника / Спринт дневной / Спринт недельный / Архив гипотез).
- Восемь новых показателей-патернов (Bus Factor, Topic Recurrence, Meeting ROI, Cross-functional Heatmap, Goal Vector, Promise Network, Knowledge Velocity, Decision Hygiene).
- Telegram weekly digest + расширенный Concierge chat + In-app sidebar.
- 11 новых AI-агентов-аналитиков сверх существующих ~90.
- 152-ФЗ opt-in flow + audit log + region flag.

### 1.2. Принципы (применяются везде)

1. **Каждый показатель — с baseline-сравнением** (с собой раньше, не с другими).
2. **Каждое утверждение AI — со ссылкой на источник** (Transparent Sourcing). Любой narrative рендерится с кликабельными цитатами на Meeting / IdeaBlock / Goal / Decision.
3. **Sparkline-данные — реальные**, не захардкоженные.
4. **На пустом tenant'е** — sample story с watermark «образец».
5. **Каждый KPI и каждая ячейка карты — кликабельны** (drill-down).
6. **Min cohort size = 3** в Волне 1-3 (для совсем маленьких команд агрегаты пропускаются), **min 5** в Волне 4+ (после 152-ФЗ flow).
7. **Прозрачность переименования**: «Индекс настроения недели» **не называется eNPS** — это другие метрики (см. proof.md §6.1).
8. **AI не двигает задачи / не принимает решения сам** — только показывает, подсказывает.
9. **Developmental framing** во всех текстах: «помочь команде расти», «обсудить нагрузку», «похвалить», **не** «уровень риска ухода», «ранжирование».
10. **Никаких индивидуальных turnover scores** для руководителя (Microsoft Productivity Score 2020 precedent).
11. **Лента вопросов — единая** (ActivityFeed + Probe). Все «вопросы AI команде/сотруднику» и их статусы (ответил / проигнорировал / истёк) идут через эту систему, а не через параллельные модели.
12. **Современный SaaS-дизайн 2026** — каждый новый экран и виджет ТЗ должен выглядеть как премиум-продукт уровня Linear / Vercel / Notion / Stripe 2026, **а не как админка из 2018**. Подробные стандарты — §1.4. Применение — обязательно во всех frontend-фазах (1.5, 1.6, 1.8, 2.1, 2.3-2.5, 3.4, 3.6, 3.8, 4.1, 4.2, 5.1-5.3, 5.6, 6.4 и далее).

### 1.3. Что НЕ делаем вообще (в любой волне)

| ❌ | Причина |
|---|---|
| Spotify-style Health Monitor Grid (ручные квартальные опросы 5-8 атрибутов) | Spotify сами признали провал (Jeremiah Lee 2020) |
| Hill Charts на главных экранах | Basecamp Appendix 4.1 — для 1+1-2 чел; не для SMB 8+ |
| Manual weekly Goal Confidence (1-10 от owner-а) | Sitzmann-Yeo 2013 — within-person ρ=0.06 + 30% → 18% response rate за 6 мес. Заменяем на AI auto-detect |
| Individual flight-risk / turnover score руководителю | Microsoft Productivity Score 2020 backlash; Cornell 2024: 4× жалоб vs human monitoring |
| Emotion-recognition по голосу / видео | EU AI Act Art.5 с 02.02.2025 запрещает, штраф до €35M |
| Ranking сотрудников «лучший — худший» | Токсично, разрушает культуру |
| Чат-бот «спроси AI про сотрудника X» (только для руководителя, без ведома сотрудника) | Поощряет surveillance-стиль |
| **Дублирование ActivityFeed / Probe / Proactive новыми моделями** | Уже работает (§3.0). Любая «нотификация / сигнал / уведомление» — через ActivityFeedItem или ProactiveNotification |
| Дашборды в стиле «таблица + StatCard + серые границы 2018» | §1.4 — современный SaaS-дизайн 2026 обязателен |

---

## 1.4. Дизайн-стандарты UI (обязательны для всех frontend-фаз)

Каждый новый экран и виджет — премиум SaaS 2026. Не админка. Не плоский Bootstrap. Не «AI-generic» (центрированные карточки в три ряда с одинаковыми тенями и тех же шрифтами что у всех).

### 1.4.1. Базовые принципы

- **Композиция важнее декора.** Иерархия (главное / поддержка / служебное), плотность, ритм, осмысленные пустоты. Сначала — что важно, потом — как выглядит.
- **Один яркий акцент на экране** (KPI, цитата, alert) + спокойный фон. Не «всё яркое», иначе ничто не яркое.
- **Типографика — основная композиционная сила.** Vary weight + size + tracking. Display-цифры для KPI 48-80px. Подписи — uppercase letter-spaced 11px. Body 14-15px.
- **Микро-взаимодействия** — обязательны (≤200ms): hover на KPI приподнимает карточку, click на цитату плавно подсвечивает источник, появление виджета — fade+rise. Без них экран кажется «мёртвым».
- **Темнота как акцент**, не как стандарт. Один dark surface как якорь в KPI-strip — остальное светлое (как сейчас StatCard variant='dark').
- **Plot-based виджеты — sparkline, mini-area, heatmap**: тонкие линии 1-1.5px, заливка с прозрачностью 0.08-0.15, без axis-меток (это виджет, не график).
- **Skeleton-loading** обязательно, не Spinner.
- **Empty state — character**, не «No data». Конкретное «появится после первой встречи и недели работы», иллюстрация / иконка-character, sample story с watermark.
- **Mobile-first для виджетов** (≥360px), даже если основной use case — desktop. SaaS 2026 = responsive из коробки.

### 1.4.2. Цветовая система (Z уже имеет paired tokens)

- Используем существующие токены: `bg-{color}` + `text-{color}-fg` (см. `feedback_paired_color_tokens.md`).
- **Никогда** не пиши `text-white` на цветных фонах, hex напрямую, slate-*. Только токены.
- Status-цвета (chip-success / chip-warning / chip-danger / chip-info) — для health-чипов Team Health Grid, для статусов probe-questions, для severity сигналов в Sidebar.
- Акценты — через `--accent` CSS-переменную (поддерживает theming).
- Sparkline / heatmap — через `var(--accent)` с прозрачностью.

### 1.4.3. Компонентные правила

- **shadcn/ui + Radix** — база. Кастомизируем через токены, не переопределяем стили.
- **Lucide icons** только (как сейчас в проекте). Размер 14-16px в карточках, 20-24px в hero.
- **Тени**: `shadow-card-soft` (двойная мягкая) — стандарт. Для hero-блоков можно более выраженную, но без обводок.
- **Border**: `border-border-subtle` или вовсе без — современный SaaS избегает жёстких рамок.
- **Скругления**: `rounded-xl` (12px) для карточек, `rounded-md` для интерактивных, `rounded-full` для аватаров и badge.
- **Sticky header** на длинных дашбордах (как сейчас в DirectorDashboardClient) — обязательно с `backdrop-blur-glass`.

### 1.4.4. Запрещено

- Плотные таблицы из 10 колонок на главной (это деталь, не главная).
- Pie charts (плохо читаются, не SaaS 2026).
- Бесконечная вертикальная прокрутка без секционирования / sticky-заголовков секций.
- «Демо-данные» без watermark на пустом tenant — это обман пользователя.
- 5+ цветов на экране без иерархии.
- Анимации >300ms (раздражают при частом использовании).
- Modal-окна для часто-используемых действий (drawer/inline лучше).
- Tooltip как единственный способ узнать что значит цифра (если важно — пиши под цифрой меленько).

### 1.4.5. Как агенту-программисту применять

Перед каждой frontend-задачей **обязательно**:
1. Запустить skill `frontend-design` — задаёт качество стиля и композиции.
2. Запустить skill `impeccable` — задаёт критерии «премиум-уровня» для аудита/полировки.
3. Запустить skill `frontend-rules` — задаёт архитектурные слои (ApiDto → DomainModel → UiModel) и единый apiClient.
4. Перед отправкой — самоаудит: открыть в браузере, проверить mobile-viewport (≥360px), сделать скриншот hover/loading/empty/error состояний, сравнить с эталоном (Linear / Vercel / Stripe dashboard).
5. Если есть `(design-preview)` route group — добавить превью-страницу для своего нового виджета (как поступают другие шаги в проекте).

### 1.4.6. Эталоны для сверки

- Linear app — иерархия, плотность, навигация.
- Vercel dashboard — KPI hero, sparkline, темы.
- Stripe dashboard — narrative AI-сводки, micro-interactions, breadcrumb.
- Notion — empty states, inline edit, type system.
- Cron (calendar) — анимации, плотность.
- Height / Mem — современная типографика, контрастный hero.

---

## 2. Все 9 экранов — обзор ролей

Подробное описание — в [видение-для-владельца.md](../analysis/2026-05-29-видение-для-владельца.md). Здесь — карта маршрутов:

| # | Маршрут | Имя | Главный вопрос | Волна |
|---|---|---|---|---|
| 1 | `/dashboard` | Пульс компании (Главная) | «Куда движемся стратегически?» | 1 (KPI hero + Team Health Grid + AI narrative + виджет probe-questions) |
| 2 | `/dashboard/operations` | Панель операций (real-time) | «Что горит сейчас?» | 2 (heatmap по людям + кто не отчитался + трекер + probe-вопросы команды) |
| 3 | `/dashboard/operations/daily` | Ежедневный отчёт | «Что произошло вчера?» | 2 (расширить narrative + срочные вопросы + кто выделился/просел) |
| 4 | `/dashboard/operations/weekly` | Недельная сводка | «Что обсудить на ретро?» | 2 (дельты, тренды, прогнозы) |
| 5 | `/teams` + `/teams/[id]` | Дашборд команд | «Какая команда просела?» | 2 (список + детальная страница с вкладкой probe-вопросы) |
| 6 | `/persons/[id]/pulse` | Карточка сотрудника (центральная) | «Что с конкретным человеком?» | 3 (12 секций в три подфазы, включая секцию «Вопросы AI этому человеку») |
| 7 | `/sprints/[id]/daily` | Дневник спринта | «Идём ли к цели спринта?» | 5 (расширение существующего SprintDashboardClient) |
| 8 | `/sprints/[id]/weekly` | Итоги недели спринта | «Гипотеза подтвердилась?» | 5 (расширение существующего SprintReview) |
| 9 | `/sprints/archive` | Архив гипотез | «Что мы вообще проверяли как компания?» | 5 |

Плюс каналы (не экраны):
- Telegram weekly digest (Волна 5, расширение `telegram-digest.cron`).
- Расширенный Concierge chat «спроси Кору про команду / сотрудника / спринт» (Волна 5, новые tools в whitelist).
- In-app sidebar «Помощник компании» (Волна 5, **поверх существующих** ActivityFeed + Proactive).
- `/me/pulse` — личная care-страница сотрудника (Волна 3, passive-only режим).
- `/me/privacy` — audit log доступа к своей карточке (Волна 4).

> **Существующие страницы лент** (`/feed`, `/feed/probe-questions`, `/feed/insights`, `/feed/spotlights`) остаются как drill-down источник. В новых дашбордах появляются **встраиваемые виджеты** поверх той же модели.

---

## 3.0. 🔧 Реестр существующей инфраструктуры — переиспользуем, не дублируем

Перед каждой фазой ниже стоит блок «✅ Уже существует — проверь и переиспользуй» со ссылками сюда. Это карта работающих систем, которые **запрещено дублировать**.

### 3.0.1. Лента и каналы уведомлений

| Что | Где | Используется в |
|---|---|---|
| **ActivityFeedItem** (модель) — 8 feedType: `probe_question`/`insight`/`decision`/`task`/`idea`/`conflict`/`knowledge_change`/`recognition`. FSM статусов: `emitted → delivered → seen → responded → actioned`, плюс `dismissed`/`expired`. Visibility: `public_org`/`team`/`role`/`private`. | `backend/prisma/schema.prisma` (поиск `model ActivityFeedItem`); `backend/src/modules/activity-feed/` | Волны 1, 2, 3, 5 |
| **ActivityFeedService** — методы `publish()`, `getFeed()`, `markDelivered/Seen/Responded/Actioned()`, `dismiss()`, `react()`, `expire()`, `listSubscriptions/upsert/patch/delete()` | `backend/src/modules/activity-feed/services/activity-feed.service.ts` | Все волны |
| **REST**: `/api/v1/feed`, `/api/v1/feed/:type`, `/api/v1/feed/:id/{react,seen,respond,dismiss}`, `/api/v1/me/feed-subscriptions/:type` | `backend/src/modules/activity-feed/controllers/` | Волны 1-5 |
| **WebSocket** `ActivityFeedGateway` — события `feed.new_item`, `feed.item_updated`, `feed.item_dismissed`, `feed.item_expired`. Rooms: `tenant:{id}`, `team:{id}`, `user:{id}` | `backend/src/modules/activity-feed/gateways/activity-feed.gateway.ts` | Sidebar (Волна 5), live-виджеты |
| **Frontend страницы**: `/feed`, `/feed/probe-questions`, `/feed/insights`, `/feed/spotlights` | `frontend/app/(authenticated)/feed/**` | Drill-down из всех виджетов |
| **Cron**: `feed-expire.cron` (15 мин), `feed-digest.cron` (daily/weekly) | `backend/src/modules/activity-feed/crons/` | — |
| **RBAC** ResourceType `activity_feed_item` (visibility-фильтр per-user) | `backend/src/modules/rbac/policies/policy.csv` | — |
| **ProbeService.suggest** + **ProbeEvent** — формулирует уточняющие вопросы (LLM `probe-formulate`), dedup (SHA256+Redis TTL 72ч), rate-limit (5/час, 20/день), cold-start gate. Статусы: `pending/dispatched/dropped_*/expired`. Уже вызывается из Curation, Goals (strategic-alignment) | `backend/src/modules/probe/` | Источник probe_question в Feed |
| **ProactiveWatcherService** — 8 deterministic rules (`decision_no_owner`, `insight_no_mitigation`, `experiment_running_too_long`, `process_stale_review`, `role_low_completeness`, `department_no_domain`, `insights_siloed_in_domain`, `plan_item_overdue`). Cron каждые 6ч. Anti-spam 1/день per (user, rule) через Redis SETNX. | `backend/src/modules/proactive/` | Sidebar Волны 5 (источник сигналов) |
| **REST**: `/api/v1/me/proactive-notifications` (list, dismiss) | `backend/src/modules/proactive/controllers/` | Sidebar |
| **ConversationalService.sendNotification** — единая точка доставки. ChannelKind: `in_app`, `email_smtp`, `email_imap`, `telegram_bot`, `max_bot`. Quiet hours, rate-limit, DataClass gate. Outbound через `ConversationalSendWorker`. | `backend/src/modules/conversational/` | Probe, Proactive, Recognition, операционные digest'ы |
| **PushModule** (Web Push, VAPID) — `/api/v1/me/push-subscriptions`, `push-sender.worker`, `PushCleanupCron`. Интегрирован в Notification-flow. | `backend/src/modules/push/` | Уведомления |

### 3.0.2. Operations dashboard (база для Волн 1-2-3)

| Что | Где |
|---|---|
| **DailyCheckIn** модель (sentiment green/yellow/red, sentimentRationale, sentimentDeterminedAt) | `backend/prisma/schema.prisma` (`model DailyCheckIn`) |
| **checkin-sentiment-analyzer.worker** — слушает `checkin.created` (только `kind='evening'`), LLM `checkin-sentiment`, обновляет DailyCheckIn. Master-flag `betaOps.sentimentEnabled` | `backend/src/modules/operations/workers/checkin-sentiment-analyzer.worker.ts` |
| **commitment-followup.cron** — почасовой, локальный час Org.timezone, два прохода: `followup` (probe автору) и `escalate` (COO/owner). Идемпотентен. Master-flag `betaOps.commitmentFollowupEnabled` | `backend/src/modules/operations/workers/commitment-followup.cron.ts` |
| **personal-relation-builder.worker** — детектит конфликты, пишет `EntityLink.relationType='conflicted_with'`. Источник для виджета «трения» | `backend/src/modules/operations/workers/personal-relation-builder.worker.ts` |
| **PersonalRelationService** + **PersonalRelationsController** (REST) | `backend/src/modules/operations/{services,controllers}/personal-relation*.ts` |
| **OperationsDashboardService** — `getTeamTemperature(tenantId, days=7)` возвращает `greenShare/yellowShare/redShare/redShareDelta` + `byPerson[]` (heatmap-данные). Redis-кэш 5 мин. | `backend/src/modules/operations/services/operations-dashboard.service.ts` |
| **operations-daily-digest.cron** (01:00 МСК) + **DailyDigestService** + промпт `daily-digest.prompt.ts` (4-6 разделов) | `backend/src/modules/operations/workers/operations-daily-digest.cron.ts`, `services/daily-digest.service.ts`, `prompts/daily-digest.prompt.ts` |
| **operations-weekly-digest.cron** (hourly, фильтр по дню/часу TZ Org) + **WeeklyDigestService** + промпт `weekly-digest.prompt.ts`. Шлёт coo/owner. Master-flag `COO_WEEKLY_DIGEST_ENABLED` | то же место |
| **issue-overdue-detector.cron** — ежедневный (09:00), эмитит `issue.overdue_detected`, дедуп `lastOverdueDetectedAt` | `backend/src/modules/tracker/workers/issue-overdue-detector.cron.ts` |
| **cross-functional-friction-aggregator.cron** (05:00 UTC) — `IdeaBlock.signalType='process_friction'` за 24ч → `CrossFunctionalFrictionReport` с severity (high≥5, medium 2-4, low 1). Идемпотент по `sourceBlockId` | `backend/src/modules/processes/workers/cross-functional-friction-aggregator.cron.ts` |
| **REST endpoints дашборда**: `/api/v1/dashboard/operations/{overview,team-temperature,team-frictions,...}` | `backend/src/modules/operations/controllers/operations-dashboard.controller.ts` |
| **DirectorDashboardService** (Phase 8 knowledge-core) + endpoint `/api/v1/dashboard/director?period=week|month`. Уже агрегирует 6 виджетов + narrativeSummary через `LlmRouterService(taskType='dashboard-summary')` + strategic-alignment | `backend/src/modules/dashboard/` |

### 3.0.3. Knowledge core (специалисты + helpfulness + recognition)

| Что | Где |
|---|---|
| **Specialists 3.1-3.6 + 3.8 Helpfulness + 3.10 Brand Voice** | `backend/src/modules/knowledge-core/workers/specialist-*.worker.ts`, `backend/src/modules/specialist-3-8-helpfulness/` |
| **specialist-3-3-decisions.worker** — извлекает Decision из встреч; **нужно расширить** инкрементом `raisedCount` (новое поле, Фаза 1.2) | `backend/src/modules/knowledge-core/workers/specialist-3-3-decisions.worker.ts` |
| **specialist-3-5-insights.worker** + **Insights Radar** | `backend/src/modules/knowledge-core/workers/specialist-3-5-insights.worker.ts`, модуль `insights/` |
| **specialist-3-8-helpfulness.worker** — 5 не-restricted трейтов: `help_provided/proactive_hint/mentoring/emotional_support/constructive_feedback`. REST `/api/v1/helpfulness/*` | `backend/src/modules/specialist-3-8-helpfulness/` |
| **recognition.service** + **recognition-formulate.worker** — 5 типов recognition: `thanks_comment/thanks_helpfulness/mention_helped/idea_shipped/streak_milestone/weekly_summary`. От AI (`fromUserId=null`). Публикует в ActivityFeed. | `backend/src/modules/recognition/` |
| **DASHBOARD_SUMMARY_SYSTEM_PROMPT** + `buildDashboardSummaryUserMessage` | `backend/src/modules/dashboard/prompts/dashboard-summary.prompt.ts` |
| **strategic-alignment.cron** — считает `Goal.cachedAlignment` per goal (взвешенное по weight) | `backend/src/modules/goals/workers/strategic-alignment.cron.ts` |
| **knowledge-clone module** (β-2) + **PersonKnowledgeCategoryEmbedding** — база для Bus Factor (Волна 6) | `backend/src/modules/knowledge-clone/` |

### 3.0.4. Tracker / Sprints (база для Волны 5)

| Что | Где |
|---|---|
| **Tracker module** (Issue / Cycle / Project / Intake / Comment / Label / Webhook) + email-to-task | `backend/src/modules/tracker/`, `backend/src/modules/mail/inbound/` |
| **Cycle модель** (`id, projectId, name, startDate, endDate, ownedById, description, progressSnapshot, timezone, completedAt, linkedMeetings, sprintHints`) | `backend/prisma/schema.prisma` (model Cycle) |
| **SprintHint** + enum **SprintHintKind** (10 типов: `no_due_date/no_description/no_assignee/due_date_at_risk/recurring_carry_over/no_recent_mentions/conflicts_with_goal/can_be_split/similar_to_past_task/generic`) | то же место |
| **sprint-helper.cron** (каждые 4ч, per-tenant cap=5, global cap=500) + **sprint-helper.worker** + **SprintHelperService.runForCycle({cycleId, tenantId, reason})** | `backend/src/modules/knowledge-core/workers/sprint-helper.*` |
| **SprintAnalystService** — вычисляет sprint-дашборд (метрики, задачи, помощник). Endpoint `GET /api/v1/cycles/:id/dashboard` (SWR 30s на фронте) | `backend/src/modules/sprints/services/sprint-analyst.service.ts` |
| **Frontend**: `/sprints` (list), `/sprints/[id]` (dashboard 5 блоков), `/sprints/[id]/review` (retro) — **переиспользуем для daily/weekly** | `frontend/app/(authenticated)/sprints/**` |
| **`POST /api/v1/cycles/:id/start-meeting`** (type='sprint_review') | то же место |

### 3.0.5. Conversational каналы — Telegram / digest

| Что | Где |
|---|---|
| **TelegramBotChannelAdapter** + handlers (inbound, message routing, dedup) | `backend/src/modules/conversational/adapters/telegram-bot/` |
| **telegram-digest.cron** (hourly, per-user TZ, default 09:00) — собирает Issue (urgentToday/inProgress/overdue), LLM `telegram-digest-formulate`, Redis dedup по дню. Отправка через `sendNotification(eventType='telegram.digest')`. **Расширяем для спринтов** в Волне 5.4 | `backend/src/modules/conversational/adapters/telegram-bot/telegram-digest.cron.ts` |
| **ChannelBinding** + **Channel** модели (per-Org, encrypted config) | `backend/prisma/schema.prisma` |
| **MaxBotChannelAdapter** (готов) + **EmailSmtpChannelAdapter** (готов) | `backend/src/modules/conversational/adapters/` |

### 3.0.6. Concierge (γ-2)

| Что | Где |
|---|---|
| **ConciergeService** + **ToolRouterService** + **ServiceMapGeneratorService** — tool-use loop поверх whitelist REST tools. RBAC на каждый tool. ~50+ tools в MVP. | `backend/src/modules/concierge/` |
| **REST**: `POST /api/v1/concierge/chat` (SSE + polling fallback), `GET /api/v1/concierge/tools`, conversations CRUD, undo, quota | то же место |
| Cron: daily/monthly quota reset, conversation summarizer | то же место |

### 3.0.7. Авторизация / Org / Onboarding

| Что | Где |
|---|---|
| **MembershipRole** enum: `owner / admin / manager / coo / super_admin` (+ члены без роли). **Нужно добавить** `hr_partner` в Волне 4 | `backend/prisma/schema.prisma`, `backend/src/modules/rbac/policies/policy.csv` |
| **RbacService** + Casbin enforce | `backend/src/modules/rbac/rbac.service.ts` |
| **TenantGuard** + регистрация на каждом контроллере. **Перевести часть резолва в TenantMiddleware** (Фаза 1.0) | `backend/src/modules/rbac/guards/tenant.guard.ts` |
| **AuthModule** (cookie / JWT / HMAC / admin guards) | `backend/src/modules/auth/` |
| **AuditLog** модель + **AuditLogService** (`tenantId, userId, action, resourceId, metadata, ipHash, userAgent, createdAt`). **Расширяем** через `KnowledgeAccessLog` в Волне 4 — не создаём параллельно | `backend/src/modules/audit/` |
| **Onboarding v2** (Org.welcomeCompletedAt, Org.setupCompletedAt, demo-data) — Блоки A (квалификатор) и B (setup-tour). **152-ФЗ opt-in добавляется как Блок C** в Волне 4.1 | `backend/src/modules/onboarding/` |
| **EntitlementGuard** + `@RequireEntitlement(...)` (используется на 17+ контроллерах). Глобальный APP_GUARD → требует TenantMiddleware выше | `backend/src/modules/entitlements/` |

### 3.0.8. Встречи и медиа (база для Волн 4-6)

| Что | Где |
|---|---|
| **Meeting** модель (поля: `reportFastQualityScore`, `linkedCycleId`, `linkedIssueId`, и др.). **Добавляем** `roiScore` в Волне 6.3 | `backend/prisma/schema.prisma` |
| **MeetingParticipantBehavior** — `speakingTimeMs, speakingTimePercent, turnsCount, avgTurnDurationMs, monologueCount, questionCount, fillerWordsCount, interruptionsMadeCount`. **Это уже Meeting-Speaker-Analyzer.** Не создаём новый — расширяем существующий в Волне 4.4 | `backend/prisma/schema.prisma` (model MeetingParticipantBehavior) |
| **Participant** + **MeetingTranscriptChunk** + **TranscriptChunk** | `backend/prisma/schema.prisma` + `backend/src/modules/ai/workers/transcript-*.worker.ts` |
| **behavior-metrics.worker** — считает MeetingBehaviorMetrics (speaking time, crosstalk, dominance) | `backend/src/modules/ai/workers/behavior-metrics.worker.ts` |
| **quality-score.worker** — качество встречи | `backend/src/modules/ai/workers/quality-score.worker.ts` |
| **tasks-extract.worker** — извлекает Task'и из встречи | `backend/src/modules/ai/workers/tasks-extract.worker.ts` |
| **VoiceModule** — ASR (Vox) + TTS, endpoints `/api/v1/voice/{transcribe,synthesize}` | `backend/src/modules/voice/` |
| **MeetingChatMessage** — сообщения внутри встреч. Для внешних чатов команды — **новая модель `ChatMessage`** в Волне 6.9 | `backend/prisma/schema.prisma` |

### 3.0.9. Frontend — компоненты для переиспользования

| Что | Где |
|---|---|
| **StatCard** (label, value, delta?, sparkline[], sparklineVariant, variant=default/dark). **Расширяем** до **KpiHero** (threshold-based coloring) в Волне 1.5 — не создаём с нуля | `frontend/src/ui/components/shared/StatCard.tsx` |
| **Sparkline** (line / bar) | `frontend/src/ui/components/shared/Sparkline.tsx` |
| **PersonDetailClient** + подстраницы (`/persons/[id]/{knowledge-profile,skill-profile,appointments,social-contribution,contributions}`). **Карточка `/pulse`** в Волне 3.4 переиспользует данные этих сервисов | `frontend/app/(authenticated)/persons/[id]/**` |
| **SprintDashboardClient** (5 блоков: Прогресс / Помощник / Подсказки / Задачи / Активные люди) + **SprintReviewClient** | `frontend/app/(authenticated)/sprints/[id]/**` |
| **/feed страницы** (4 шт) | `frontend/app/(authenticated)/feed/**` |
| **OrgChatPanel** (Concierge embed) | `frontend/src/ui/components/chat/OrgChatPanel.tsx` |
| **Layouts** `(authenticated)` — sidebar/header. **AssistantSidebar** добавляем сюда в Волне 5.6 | `frontend/app/(authenticated)/layout.tsx` |

### 3.0.10. Что **НЕ существует** и реально создаём

Это сухой остаток после аудита. Всё ниже — реально новые компоненты, не дубликаты:

- `TenantMiddleware` (Волна 1.0).
- `<KpiHero>` (расширение StatCard, Волна 1.5).
- `<TeamHealthGrid>` + `TeamHealthService` (Волна 1.6).
- `<SampleStoryBanner>` + `metadata.isEmpty` в DirectorDashboardDto (Волна 1.0).
- `<ActivityFeedWidget>` (frontend компонент-обёртка, Волна 1.8 + переиспользуется в 2, 3, 5).
- `CommitmentReliabilityService` + endpoint `/api/v1/dashboard/commitment-reliability` (Волна 1.1).
- `SentimentIndexService` + KPI hero (Волна 1.3).
- `HangingDecisionsService` + поля `Decision.raisedCount`, `Decision.lastRaisedAt` (Волна 1.2).
- `NarrativeCitationsParserService` + расширение DASHBOARD_SUMMARY_SYSTEM_PROMPT (Волна 1.4).
- Endpoint `/api/v1/dashboard/operations/missing-checkins` (Волна 2.3).
- Поле `Issue.lastActivity` + наполнение из существующих хуков (Волна 2.3).
- `<TeamsListClient>` (`/teams`) + `<TeamDetailClient>` (`/teams/[id]`) + `TeamDetailService` + endpoint (Волны 2.4-2.5).
- `Department.healthSummaryJson` (Волна 3.1).
- `Person.engagementScore`, `Person.engagementScoreAt`, `Person.hrSuggestionsJson` (Волна 3).
- `DailyCheckIn.qualityScore` (Волна 3.5).
- `Reflection-Quality-Scorer` worker (Волна 3.5).
- `Engagement-Scorer` cron (Волна 3.3).
- `HR-Recommender` cron — концептуально новый, **не путать** с `recognition-formulate` (тот про благодарности; этот — про действия руководителя) (Волна 3.7).
- `Team-Health-Analyzer` worker — кладёт `Department.healthSummaryJson` (Волна 3.1).
- `<PersonPulseClient>` + `PersonPulseService` + endpoint `/api/v1/persons/:id/pulse` (Волна 3.4-3.8).
- 152-ФЗ: модель `ConsentLog`, поля `Org.region`, `Person.analyticsOptIn`, `Person.analyticsOptInAt` (Волна 4.1). Блок C onboarding.
- `KnowledgeAccessLog` модель + middleware → `/me/privacy/access-log` (Волна 4.2). Расширяет существующую AuditLog-инфру.
- Поля для Burnout-Risk: `Person.riskFlagsJson` (Волна 4.5).
- `Burnout-Risk-Detector` cron — использует существующие сигналы (sentiment, missed check-ins, commitment broken).
- `Forecaster` cron + `ForecastSnapshot` модель (Волна 4.6).
- Расширение `MeetingParticipantBehavior` (новое поле `sentimentTextPerSpeakerJson` для Meeting-Speaker-Analyzer; саму модель не создаём) (Волна 4.4).
- Роль `hr_partner` в `MembershipRole` enum + правила в `policy.csv` (Волна 4.7).
- `Cycle.hypothesis` (опц.) + `Cycle.confidence` (Волна 5.2) — решить в фазе 5.2 совместно с оркестратором.
- Расширение `SprintDashboardClient` или новый client поверх `SprintAnalystService` → `/sprints/[id]/daily` и `/weekly` (Волны 5.1-5.2).
- Расширение `telegram-digest.cron` для спринтов или новый `sprint-strategist.worker` (Волна 5.2-5.4).
- Новые tools в Concierge `ServiceMapGeneratorService` whitelist (PersonPulse / PromiseOverdue / SprintStatus / TeamHealth / IgnoredProbeQuestions) (Волна 5.5).
- `<AssistantSidebar>` фронт-компонент — **поверх существующих** `/api/v1/me/proactive-notifications` + `ActivityFeedService.getFeed({severity:['critical','high'], status:['emitted','delivered','seen']})`. **Модель `AssistantSignal` не создаём** (Волна 5.6).
- Волна 6: `KnowledgeRiskSnapshot`, `RecurringTopic`, `PromiseNetworkSnapshot`, `PersonGoalContribution`, `KnowledgeVelocitySnapshot`, `ChatMessage` (для внешних чатов команды), `Decision.reversibility`, `Meeting.roiScore` + 7 новых агентов (см. §3.2).

---

## 3.1. Существующие AI-агенты — что используем без изменений (~90)

Полный список в [v3-expanded.md §5.1](../analysis/2026-05-29-dashboards-v3-expanded.md). Ключевые, которые кормят наши новые виджеты:

| Агент | Куда даёт данные |
|---|---|
| `checkin-sentiment-analyzer.worker` | Sentiment Index, Person Pulse, Team Health |
| `operations-daily-digest.cron` | Ежедневный отчёт (расширяем промпт в 2.1) |
| `operations-weekly-digest.cron` | Недельная сводка (расширяем в 2.2) |
| `commitment-followup.cron` | Commitment Reliability, Promise Network |
| `personal-relation-builder.worker` | Конфликты на Team Health, граф в карточке |
| `strategic-alignment.cron` | Goal Vector |
| `sprint-helper.cron` + `sprint-helper.worker` | Sprint Daily, Sprint Weekly, подсказки |
| `cross-functional-friction-aggregator.cron` | Bottleneck Heatmap |
| `specialist-3-8-helpfulness.worker` | Helper-Score в карточке сотрудника |
| `recognition-formulate.worker` | Похвала, badges, streaks (публикует в ActivityFeed) |
| `specialist-3-2-knowledge-clone.worker` | Bus Factor analyzer |
| `specialist-3-5-insights.worker` | Insights radar |
| `specialist-3-3-decisions.worker` | Decision Hygiene, Hanging Decisions (расширяем в 1.2) |
| `behavior-metrics.worker` | Meeting ROI, активность во встречах |
| `quality-score.worker` | Meeting ROI |
| `tasks-extract.worker` | Meeting ROI (количество извлечённых задач) |
| `ProbeService.suggest` | Все вопросы AI → ActivityFeedItem feedType=probe_question |
| `ProactiveWatcherService.runOnce` (8 правил) | Sidebar Волны 5 |

## 3.2. Новые AI-агенты — 11 шт по волнам

| # | Агент | Что вычисляет | Куда пишет | Волна |
|---|---|---|---|---|
| N1 | `Reflection-Quality-Scorer` | Глубина чек-ина (слов, конкретность action items, разнообразие тем) | `DailyCheckIn.qualityScore` | 3.5 |
| N2 | `Engagement-Scorer` | Сводный engagement score per person из всех сигналов | `Person.engagementScore` + history `PersonEngagementSnapshot` | 3.3 |
| N3 | `HR-Recommender` | Похвалить / ЗП-ревью / обсудить нагрузку / развитие / срочно поговорить (≠ `recognition-formulate`) | `Person.hrSuggestionsJson` | 3.7 |
| N4 | `Team-Health-Analyzer` | Аналитика команды + детект 5 Gallup factors (manager support / workload fairness / communication / time pressure / role clarity) | `Department.healthSummaryJson` | 3.1 |
| N5 | `Burnout-Risk-Detector` | Топ-10 сигналов выгорания с порогами (личные baseline). Использует существующие сигналы | `Person.riskFlagsJson` | 4.5 |
| N6 | `Forecaster` | Прогноз «что произойдёт в следующую неделю» | `ForecastSnapshot` | 4.6 |
| N7 | `Bus-Factor-Analyzer` | Для каждой knowledge-area: сколько экспертов | `KnowledgeRiskSnapshot` | 6.1 |
| N8 | `Topic-Recurrence-Detector` | Темы поднимавшиеся ≥5 раз без Decision | `RecurringTopic` | 6.2 |
| N9 | `Meeting-ROI-Scorer` | Score встречи: `(decisions×10 + commitments×5 + tasks×3) / (participants × duration)` | `Meeting.roiScore` | 6.3 |
| N10 | `Promise-Network-Analyzer` | Граф обещаний, паттерны «накопитель / донор / изолированный» | `PromiseNetworkSnapshot` | 6.5 |
| N11 | `Goal-Vector-Tracker` | Pro/contra/net score per (person, goal) — % действий «в цель» | `PersonGoalContribution` | 6.6 |

Опционально (если успеем): `Decision-Hygiene-Scorer` (Волна 6.8), `Knowledge-Velocity-Tracker` (Волна 6.7), `Chat-Helper` (Волна 6.9).

Расширения существующих агентов (не создаём новые, дописываем поля):
- `specialist-3-3-decisions.worker` → инкремент `raisedCount` + `lastRaisedAt` (Волна 1.2).
- Meeting-Speaker-Analyzer = расширение `MeetingParticipantBehavior` новым полем `sentimentTextPerSpeakerJson` + worker, дописывающий sentiment по тексту per speaker (Волна 4.4).
- `telegram-digest.cron` → расширить промпт спринт-секцией или ввести `sprint-strategist.worker` (Волна 5.4).

## 3.3. Общие требования к новым агентам

- Через единый `LlmRouterService` с регистрацией в admin (как существующие).
- Каждый агент пишет с `provenance` (какие источники использовал) — для Transparent Sourcing.
- Идемпотентность.
- `tenantId`-scoped.
- Cron через BullMQ, не on-demand.
- Метрики в Prometheus: `ai_agent_runs_total{agent}`, `ai_agent_duration_seconds{agent}`, `ai_agent_failures_total{agent, reason}`.
- Промпт cache-friendly (стабильный SYSTEM, переменные данные в конце user).

---

## 4. Изменения схемы данных (только реально новое)

Все изменения через `bun run prisma:push`, не `migrate`. После каждой правки — `bun run prisma:generate`.

**Опасные изменения** (новые модели / удаления / опасные миграции) → шаг в `prod-deploy-log.md` Шаг 4.

> Перед добавлением каждого поля — **grep по имени** в `schema.prisma`. Если уже есть — не дублируем.

### 4.1. Расширения существующих моделей

| Модель | Поле | Тип | Волна | Зачем |
|---|---|---|---|---|
| `Decision` | `raisedCount` | `Int @default(1)` | 1.2 | Hanging Decisions: счётчик «поднималось ≥N раз» |
| `Decision` | `lastRaisedAt` | `DateTime?` | 1.2 | Когда последний раз упоминалось |
| `Decision` | `reversibility` | `String?` | 6.8 | type-1 / type-2 (Bezos) для Decision Hygiene |
| `Issue` | `lastActivity` | `DateTime?` | 2.3 | Трекер-виджет «без активности >5 дней» |
| `DailyCheckIn` | `qualityScore` | `Decimal? @db.Decimal(4,3)` | 3.5 | Глубина рефлексии от Reflection-Quality-Scorer |
| `Department` | `healthSummaryJson` | `Json?` | 3.1 | От Team-Health-Analyzer (5 Gallup factors) |
| `Person` | `engagementScore` | `Decimal? @db.Decimal(4,3)` | 3.3 | Сводный engagement |
| `Person` | `engagementScoreAt` | `DateTime?` | 3.3 | Когда последний раз пересчитали |
| `Person` | `hrSuggestionsJson` | `Json?` | 3.7 | Рекомендации от HR-Recommender |
| `Person` | `riskFlagsJson` | `Json?` | 4.5 | Активные risk-сигналы от Burnout-Risk-Detector |
| `Person` | `analyticsOptIn` | `Boolean @default(false)` | 4.1 | 152-ФЗ согласие на расширенную аналитику |
| `Person` | `analyticsOptInAt` | `DateTime?` | 4.1 | Когда дано согласие |
| `Org` | `region` | `String? @default("ru")` | 4.1 | `ru` / `eu` / `other` — региональный режим |
| `MeetingParticipantBehavior` | `sentimentTextPerSpeakerJson` | `Json?` | 4.4 | Sentiment по тексту per speaker (Meeting-Speaker-Analyzer). **НЕ путать с emotion-recognition — EU AI Act запрещает** |
| `Meeting` | `roiScore` | `Decimal? @db.Decimal(4,3)` | 6.3 | Meeting ROI |
| `Goal` | `aiDetectedConfidence` | `Int?` | 6 | 1-10 от AI на основе текстов команды цели |
| `Goal` | `aiDetectedConfidenceAt` | `DateTime?` | 6 | Когда пересчитали |
| `Cycle` | `hypothesisJson` | `Json?` | 5.2 (опц.) | Структурированная гипотеза спринта — решить совместно. До этого используем `description` по конвенции |

### 4.2. Новые модели

| Модель | Назначение | Волна |
|---|---|---|
| `PersonEngagementSnapshot` | История engagementScore (для тренда в карточке) | 3.3 |
| `ConsentLog` | Записи согласий 152-ФЗ (per person × per data type × date) | 4.1 |
| `KnowledgeAccessLog` | Кто открывал чью карточку (для audit log на /me/privacy). Похоже на существующий AuditLog, но детализация под view-events карточки сотрудника | 4.2 |
| `ForecastSnapshot` | Прогноз на следующую неделю по тенденциям | 4.6 |
| `KnowledgeRiskSnapshot` | Bus Factor: per knowledge-area количество экспертов | 6.1 |
| `RecurringTopic` | Топ-N тем поднимавшихся без Decision | 6.2 |
| `PromiseNetworkSnapshot` | Снапшот графа обещаний (для динамики) | 6.5 |
| `PersonGoalContribution` | Pro/contra/net score per (person, goal, period) | 6.6 |
| `KnowledgeVelocitySnapshot` | Скорость накопления знаний (medianTime от knowledge_gap до trustedAnswer) | 6.7 |
| `ChatMessage` | Сообщения из внешних чатов команды (Telegram bot read-only). **НЕ** MeetingChatMessage (внутри встреч — уже есть) | 6.9 (опц.) |
| `ProcessEffectivenessSnapshot` | 80/20 процессов (опц., Волна 6) | 6 |

### 4.3. ❌ Удалено из v1 ТЗ (дубли)

| Что | Почему удалили |
|---|---|
| `AssistantSignal` модель | Полностью дублирует `ActivityFeedItem` (severity, status, expiresAt, targetUserId, dismissedAt). Sidebar строится поверх существующего ActivityFeed + Proactive |
| Новый `MeetingAttendee.speakingStatsJson` | Уже есть `MeetingParticipantBehavior` со всеми нужными полями (speakingTimeMs, turnsCount, monologueCount, ...) |
| Отдельный `WeeklyDigestPushService` | Расширяем существующий `telegram-digest.cron` или `operations-weekly-digest.cron` |
| Параллельная `AssistantSidebar` модель сигналов | Опираемся на `ProactiveNotification` + `ActivityFeedItem` |

### 4.4. Новая роль RBAC

| Роль | Полномочия | Волна |
|---|---|---|
| `hr_partner` | Видит карточку сотрудника при `Person.analyticsOptIn=true`; видит агрегаты по командам | 4.7 |

Добавить в `policies/policy.csv` соответствующие правила. Существующие роли: `owner / admin / manager / coo / super_admin` — **уже есть, не трогаем**.

---

## 5. Волна 1 — Фундамент (3 недели)

### 5.1. Цели

После релиза Волны 1 пользователь видит на `/dashboard`:
1. Нет красной плашки EntitlementGuard.
2. Три KPI hero (Настроение / Обещания / Висящие решения) с реальным sparkline 12 недель + drill-down.
3. AI-резюме с кликабельными цитатами на источники.
4. Цветная Team Health Grid (Department × 4 атрибута).
5. На пустом tenant — sample story с watermark.
6. Виджет «Вопросы AI команде» (новый — из существующего ActivityFeed).

### 5.2. Фазы

#### Фаза 1.0. Хотфиксы (3 дня)

✅ **Уже существует — проверь и переиспользуй**:
- `backend/src/app.module.ts` — глобальные APP_GUARD (SubscriptionGuard, EntitlementGuard, MustChangePasswordGuard) и controller-level `@UseGuards(CookieAuthGuard, TenantGuard)`. Глобальные guards выполняются раньше — корень бага.
- `backend/src/modules/rbac/guards/tenant.guard.ts` — текущий `resolveTenantId()` (X-Org-Id → :orgId → body → single-org default). **Логику резолва перенести в middleware, не дублировать.**
- `backend/src/common/middleware/request-id.middleware.ts` — паттерн middleware для копирования.
- `backend/src/common/middleware/express.d.ts` — здесь добавить `req.tenantId?: string`.
- `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx` строки 152-183 — fake sparklines.
- `frontend/src/ui/components/shared/StatCard.tsx` — sparkline пропс опциональный, удалить безопасно.

❌ **Создаём новое**:
- [ ] **1.0.1** `backend/src/modules/rbac/middleware/tenant.middleware.ts`:
  - Резолв ровно как в `TenantGuard.resolveTenantId`.
  - **НИЧЕГО НЕ БРОСАЕТ** (если резолв не удался — req.tenantId остаётся undefined). Bросать 403 — работа guard'а.
  - Без req.user — просто next() без БД-запросов.
  - Зарегистрировать в `AppModule.configure(consumer)`: `consumer.apply(TenantMiddleware).forRoutes('api/v1/*')`.
  - `TenantGuard` упростить: оставить только проверку `req.tenantId !== undefined` + `rbac.loadContext` (membership).
  - e2e тест: `/api/v1/dashboard/director` с cookie + X-Org-Id → 200 (не tenant_required).
- [ ] **1.0.2** Удалить fake sparkline из DirectorDashboardClient (5 пропсов `sparkline=...` + `sparklineVariant=...`).
- [ ] **1.0.3** Sample Story:
  - Backend: `metadata.isEmpty: boolean` в DirectorDashboardDto + synthetic-датасет в `backend/src/modules/dashboard/services/sample-story.dataset.ts` (`as const`).
  - Frontend: `<SampleStoryBanner visible={data?.isEmpty}>` + watermark на StatCard-обёртке.

#### Фаза 1.1. Commitment Reliability сервис (2 дня)

✅ **Уже существует**:
- `backend/src/modules/operations/workers/commitment-followup.cron.ts` — почасовой, master-flag `betaOps.commitmentFollowupEnabled`. **Не дублировать; читать те же данные.**
- `backend/src/modules/operations/services/commitments.service.ts` — посмотри методы.
- Поля `Commitment` в schema.prisma (через IdeaBlock `signalType='commitment'` + `commitmentStatus`).

❌ **Создаём**:
- [ ] `backend/src/modules/dashboard/services/commitment-reliability.service.ts`:
  - Метод `getReliability({tenantId, scope: 'company'|'team'|'person', scopeId?, windowDays=14})`.
  - Returns `{kept, broken, overdue, pendingActive, reliabilityPercent, delta14d, sparkline12w}`.
  - Redis-кэш 5 мин по ключу `commit_reliability:${tenantId}:${scope}:${scopeId}:${windowDays}`.
- [ ] Тесты unit + integration.

#### Фаза 1.2. Hanging Decisions counter (1 день)

✅ **Уже существует**:
- `Decision` модель (statement, status, deadline, decidedByPersonIds, alternatives, confidence). **raisedCount/lastRaisedAt нет** — добавляем.
- `backend/src/modules/knowledge-core/workers/specialist-3-3-decisions.worker.ts` — извлекает Decision из встреч. **Дописываем** инкремент.

❌ **Создаём/расширяем**:
- [ ] Schema: `Decision.raisedCount Int @default(1)` + `Decision.lastRaisedAt DateTime?`. `bun run prisma:push && bun run prisma:generate`.
- [ ] Расширить `specialist-3-3-decisions.worker.ts` — на каждом detect упоминания decision на новой встрече инкрементить `raisedCount` + обновлять `lastRaisedAt`.
- [ ] `backend/src/modules/dashboard/services/hanging-decisions.service.ts`: `count({tenantId, minAgeDays=7, minRaisedCount=2})` + sparkline 12w. Redis-кэш 5 мин.

#### Фаза 1.3. Sentiment Index (1 день)

✅ **Уже существует**:
- `backend/src/modules/operations/workers/checkin-sentiment-analyzer.worker.ts` — sentiment green/yellow/red уже считает. Master-flag `betaOps.sentimentEnabled` (default false) — **включить в проде** перед демо.
- `OperationsDashboardService.getTeamTemperature()` возвращает `greenShare/yellowShare/redShare/redShareDelta`. **Переиспользуем эти данные.**

❌ **Создаём**:
- [ ] `backend/src/modules/dashboard/services/sentiment-index.service.ts` — формула `(greenShare - redShare) * 100`. Диапазон -100..+100.
- [ ] Возвращает `{value, trend: 'up'|'flat'|'down', sparkline12w, totalCheckIns}`.
- [ ] **В UI называется «Индекс настроения недели», не «eNPS»** (см. proof.md §6.1).

#### Фаза 1.4. AI Narrative с Transparent Sourcing (2 дня)

✅ **Уже существует**:
- `backend/src/modules/dashboard/prompts/dashboard-summary.prompt.ts` — `DASHBOARD_SUMMARY_SYSTEM_PROMPT` + `buildDashboardSummaryUserMessage`. **Расширяем, не переписываем.**
- LLM-call в `DirectorDashboardService.getNarrativeSummary` уже работает, кэш 24ч в `AdminCacheService`.

❌ **Создаём**:
- [ ] Расширить `DASHBOARD_SUMMARY_SYSTEM_PROMPT`: требовать inline `[mtg:UUID]`, `[ib:UUID]`, `[goal:UUID]`, `[dec:UUID]`. **Cache-friendly**: SYSTEM-часть стабильна, список источников — в конце user message.
- [ ] `backend/src/modules/dashboard/services/narrative-citations-parser.service.ts` — парсит вывод LLM, заменяет markers на `[1]`, `[2]`..., фильтрует галлюцинированные ID (валидация по списку переданных в промпт).
- [ ] DTO: `narrativeSummary: { text, citations: Citation[] }` (заменяет `string | null`).
- [ ] Frontend `<AiNarrativeWithSources>`: superscript + список источников с deep-link на `/meetings/:id/result`, `/themes/:id`, `/goals/:id`, `/decisions/:id`.

#### Фаза 1.5. Три KPI Hero на Главной (2 дня)

✅ **Уже существует**:
- `frontend/src/ui/components/shared/StatCard.tsx` — `label, value, delta?, sparkline?[], sparklineVariant, variant=default/dark`. **Расширяем threshold-based coloring.**
- `Sparkline.tsx`.

❌ **Создаём**:
- [ ] `frontend/src/ui/components/shared/KpiHero.tsx`:
  - Props: `label, value, delta?, sparkline (number[]), threshold?: {green: number, yellow: number, inverted?: boolean}, onClick?, tooltip?`.
  - Цвет value по threshold (для inverted: ≤green=зелёный, ≤yellow=жёлтый, иначе красный).
- [ ] В `DirectorDashboardClient.tsx`: 5 старых StatCard заменить на 3 KpiHero:
  - «Индекс настроения недели» (green ≥30, yellow ≥0, red <0) → drill `/dashboard/operations` sentiment filter.
  - «Обещания» (green ≥80%, yellow ≥60%) → drill `/me/commitments`.
  - «Висящие решения» (inverted: green ≤2, yellow ≤5) → drill `/decisions?status=hanging`.
- [ ] Backend: расширить `DirectorDashboardDto` — `kpiSentimentIndex`, `kpiCommitmentReliability`, `kpiHangingDecisions`.
- [ ] Domain mapper в `frontend/src/domain/director-dashboard.ts`.

#### Фаза 1.6. Team Health Grid (3 дня)

✅ **Уже существует**:
- `Department` модель (id, tenantId, name, parentDepartmentId, headPersonId, completeness).
- `OperationsDashboardService.getTeamTemperature()` — `byPerson[]` + agg.
- `personal-relation-builder.worker` — пишет EntityLink `conflicted_with`.
- `cross-functional-friction-aggregator.cron` — пишет `CrossFunctionalFrictionReport`.
- `commitment-followup.cron` — поля статуса commitment.

❌ **Создаём**:
- [ ] `backend/src/modules/dashboard/services/team-health.service.ts`:
  - `getHealth({tenantId})` → `{teams: TeamHealthRow[]}`.
  - Для каждого Department (cohort ≥3): sentiment / promises / decisions / conflicts — каждое с цветом + trend (компонует существующие источники).
  - Redis-кэш 5 мин.
- [ ] Endpoint `GET /api/v1/dashboard/team-health`.
- [ ] Frontend `<TeamHealthGrid>`: таблица teams × 4 attrs + click handlers (заглушка → `/teams/[id]` будет в Волне 2).
- [ ] Empty state «создайте отделы».

#### Фаза 1.7. QA (2 дня)

- [ ] Smoke-тесты всех новых endpoints.
- [ ] Manual QA на tenant с данными + пустом tenant + tenant без отделов.
- [ ] Регрессия существующих виджетов (DirectorDashboard сохраняет 5 widgets, добавляет KPI hero сверху).
- [ ] `bun run typecheck && bun run lint && bun run build` (backend + frontend) — green.

#### Фаза 1.8. ⭐ NEW: Виджет «Вопросы AI команде» на главной (1 день)

✅ **Уже существует**:
- `ActivityFeedItem` модель + `ActivityFeedService.getFeed(args)` с фильтрами `feedType=probe_question`, `status`, `severity`, `teamId`.
- `/feed/probe-questions` страница — drill-down готов.

❌ **Создаём**:
- [ ] `frontend/src/ui/components/shared/ActivityFeedWidget.tsx` (универсальный, используется и в Волнах 2/3/5):
  - Props: `feedTypes: FeedType[], scope?: 'company'|'team'|'user', scopeId?, pageSize=10, liveUpdate?: boolean, emptyHint?, drillDownHref?`.
  - Подписка на WS (если `liveUpdate`).
  - Группировка статусов: «активные» / «отвечены» / «истекли/dismissed».
- [ ] В `DirectorDashboardClient.tsx` добавить `<ActivityFeedWidget feedTypes={['probe_question']} scope='company' pageSize={5} liveUpdate drillDownHref='/feed/probe-questions' />`.
- [ ] Сводные числа на виджете: «3 неотвеченных / 12 отвечено за неделю» (агрегат поверх getFeed).

### 5.3. DoD Волны 1

1. Бага EntitlementGuard нет (e2e подтверждён).
2. Все sparkline — реальные.
3. 3 KPI hero видны, кликабельны, дают drill-down.
4. AI narrative с ≥1 цитатой на каждое утверждение, ссылки работают.
5. Team Health Grid показывает все отделы (cohort ≥3).
6. На пустом tenant — sample story.
7. Виджет probe-questions на главной живой, показывает реальные probe-вопросы.
8. Все тесты зелёные.
9. `second-brain/01_projects/admin.md` обновлён.
10. `prod-deploy-log.md` — Шаг 4 (новые поля Decision), Шаг 1 (если новые ENV).

### 5.4. 🛑 Чекпоинт 1 — обязательная проверка перед Волной 2

Пилот на 3-5 founder'ов **минимум 2 недели**. Замеряем:

| Метрика | Минимум для перехода | Что делать если не достигнуто |
|---|---|---|
| Open rate `/dashboard` у COO/Founder | ≥2 раза/неделю | Пересмотр визуала / копи / времени уведомлений |
| Click rate на KPI hero | ≥20% сессий | Плохо подобраны метрики — заменяем |
| Click на цитаты в AI narrative | ≥30% когда narrative показан | Не доверяют → улучшаем промпт / источники |
| Bug reports на новые компоненты | < 3 на клиента | ≥5 — паузим, чиним |
| Subjective feedback «понятно что происходит» | ≥7/10 | < 5 — переделываем подход |
| Engagement виджета probe-questions | ≥1 клик на сессию | <0.3 — переносим вниз / переименовываем |

**Stop**: если ≥2 из 6 метрик красные → пауза, разбор, **не переходим к Волне 2 «по инерции»**.

---

## 6. Волна 2 — Усиление операционных дашбордов (3 недели)

### 6.1. Цели

После Волны 2:
1. Ежедневный отчёт — narrative «история дня» + срочные вопросы + кто выделился/просел.
2. Недельная сводка — дельты к прошлой неделе + командная динамика + прогнозы.
3. Панель операций — heatmap по людям + «кто не отчитался» + трекер + probe-вопросы команды.
4. `/teams` — список команд + `/teams/[id]` — детальная страница с вкладкой probe-вопросов.

### 6.2. Фазы

#### Фаза 2.1. Daily-Reporter — расширение narrative (3 дня)

✅ **Уже существует**:
- `operations-daily-digest.cron` (@Cron 22:00 UTC = 01:00 МСК) — двухстадийная (агрегация + LLM).
- `DailyDigestService` + `daily-digest.prompt.ts` (v1, 215 строк, 4-6 разделов).
- `DailyDigestMetricsDto` (greenShare, topRedCheckIns, newBlockers, overdueCommitments, goals, newHighInsights, decisions).
- `NarrativeCitationsParserService` из Фазы 1.4 — **переиспользуем**.

❌ **Создаём/расширяем**:
- [ ] Расширить `daily-digest.prompt.ts`: добавить структуру «история дня» (3-5 абзацев) + inline `[mtg:UUID]`, `[ib:UUID]`. SYSTEM стабильный, источники в конце user.
- [ ] DTO `DailyDigestDto` — секции `eventsToday`, `urgentItems` (просрочки + decisions с `raisedCount≥2`), `whoShined`, `whoStruggled`.
- [ ] Frontend `DailyDigestClient` — рендер новой структуры с deep-links.

#### Фаза 2.2. Weekly-Strategist — расширение (2 дня)

✅ **Уже существует**:
- `operations-weekly-digest.cron` (hourly + filter по дню/часу TZ Org) + `WeeklyDigestService` + `weekly-digest.prompt.ts`.
- Team Health Grid из 1.6 — переиспользуем для «командной динамики».

❌ **Создаём/расширяем**:
- [ ] Расширить `weekly-digest.prompt.ts`: секция «командная динамика» + «прогнозы». SYSTEM стабильный.
- [ ] Дельты vs прошлая неделя для всех 4 KPI.
- [ ] Forecaster — заглушка с TODO в коде; полный агент в Волне 4.6.

#### Фаза 2.3. Панель операций — расширение (3 дня)

✅ **Уже существует**:
- `OperationsDashboardService.getTeamTemperature` → `byPerson[]` (heatmap-данные).
- `cross-functional-friction-aggregator.cron`.
- `issue-overdue-detector.cron` (`@Cron 09:00`).
- `Issue` модель (`updatedAt, completedAt, dueDate, assigneeUserIds, ...`).

❌ **Создаём**:
- [ ] **Schema**: `Issue.lastActivity DateTime?` (наполнять из существующих хуков создания комментариев / изменения статуса; backfill scrip — `backend/scripts/backfill-issue-last-activity.ts`).
- [ ] **Heatmap по людям**: визуальный компонент 7 дней × N людей на базе `byPerson` (данные уже есть).
- [ ] **Endpoint** `GET /api/v1/dashboard/operations/missing-checkins?date=today` → frontend список с кнопкой «отправить напоминание» (через `ConversationalService.sendNotification`).
- [ ] **Трекер-виджет**: `Issue` где `lastActivity < now - 5d` + просроченные. DTO + рендер.
- [ ] **Probe-вопросы команды** (виджет): `<ActivityFeedWidget feedTypes={['probe_question']} scope='company' pageSize={10} />` на странице операций.

#### Фаза 2.4. `/teams` — список команд (3 дня)

✅ **Уже существует**:
- `backend/src/modules/departments/departments.controller.ts` — `GET/POST/PATCH/DELETE /api/v1/departments`.
- `TeamHealthService` из Фазы 1.6 + endpoint `/api/v1/dashboard/team-health`.

❌ **Создаём**:
- [ ] `frontend/app/(authenticated)/teams/page.tsx` + `TeamsListClient.tsx`.
- [ ] Таблица: Department + size + 4 health-чипа (переиспользуем `TeamHealthService`) + общий тренд.
- [ ] Сортировка по любому столбцу.
- [ ] Click → `/teams/[id]`.

#### Фаза 2.5. `/teams/[id]` — детальная страница (4 дня)

✅ **Уже существует**:
- Endpoint `/api/v1/dashboard/operations/team-frictions` — `OperationsDashboardTeamFrictionDto` (есть данные о конфликтах в команде).
- `PersonalRelationService` — данные «кто с кем».
- `Goal` модель + `strategic-alignment.cron` — данные «цели команды».

❌ **Создаём**:
- [ ] `frontend/app/(authenticated)/teams/[id]/page.tsx` + `TeamDetailClient.tsx`.
- [ ] Секции (см. v3-expanded §3.5):
  - Шапка команды (имя, руководитель, число участников, кто новый/ушёл).
  - Состав (аватары + sentiment-чип + commitment-чип, click → `/persons/[id]/pulse` заглушка пока).
  - Health-метрики команды (sentiment trend 30 дней, commitment reliability, capacity heatmap без имён).
  - Цели команды (host Goal или teammember = owner).
  - Активность (встречи / трекер / чаты — последнее заглушка).
  - Темы команды (top weights).
  - Конфликты внутри команды (EntityLink между members — из PersonalRelationService).
  - **NEW Вкладка «Вопросы команде»**: `<ActivityFeedWidget feedTypes={['probe_question']} scope='team' scopeId={teamId} />` с фильтром по status.
- [ ] Backend: новый `TeamDetailService.getDetail({tenantId, departmentId})` + endpoint `GET /api/v1/dashboard/teams/:id`.

#### Фаза 2.6. QA (2 дня)

### 6.3. DoD Волны 2

1. Ежедневный отчёт с narrative + цитатами + 4 секциями.
2. Недельная сводка с дельтами и командной динамикой.
3. Heatmap по людям виден в Операциях.
4. «Кто не отчитался» виджет работает.
5. Трекер-виджет в Операциях.
6. Probe-вопросы команды на странице Операций + на /teams/[id].
7. `/teams` список + `/teams/[id]` детально работают.
8. Все тесты зелёные.

### 6.4. 🛑 Чекпоинт 2

Те же KPI что в 1.4, плюс:
- Click rate на «срочные вопросы» в ежедневном отчёте ≥40%.
- `/teams` open rate ≥1 раз/неделю у руководителей.
- Engagement виджета probe-questions на странице команды ≥0.5 кликов/сессия.

Если < 50% от целевого — пересмотр, не двигаемся дальше.

---

## 7. Волна 3 — Карточка сотрудника + команды + первые AI-агенты (4 недели)

### 7.1. Цели

Главный экран Z — карточка сотрудника. Плюс новые AI-агенты-аналитики которые её наполняют. Плюс секция «Вопросы AI этому человеку».

### 7.2. Фазы

#### Фаза 3.1. Team-Health-Analyzer агент (2 дня)

✅ **Уже существует**:
- `Department` модель (без healthSummaryJson).
- Данные источники: `OperationsDashboardService`, `commitment-followup.cron`, `personal-relation-builder.worker`, `cross-functional-friction-aggregator.cron`.

❌ **Создаём**:
- [ ] Schema: `Department.healthSummaryJson Json?`.
- [ ] `backend/src/modules/dashboard/agents/team-health-analyzer.worker.ts` (BullMQ cron, daily).
- [ ] Для каждого Department: LLM анализ → 5 Gallup factors (manager support / workload fairness / communication / time pressure / role clarity) low/medium/high.
- [ ] Кладёт в `Department.healthSummaryJson` с provenance.

#### Фаза 3.2. Расширение Conflict-Detector (3 дня)

✅ **Уже существует**:
- `personal-relation-builder.worker.ts` — детектит конфликты, пишет `EntityLink.relationType='conflicted_with'`. **Не дублируем.**
- `personal-relation-builder.worker.spec.ts` — есть тесты.

❌ **Расширяем**:
- [ ] Дописать в worker анализ текстов чек-инов и встреч на парные конфликт-маркеры.
- [ ] Confidence threshold для записи в `EntityLink.relationType='conflicted_with'`.
- [ ] Spec — обновить.

#### Фаза 3.3. Engagement-Scorer агент (3 дня)

✅ **Уже существует**:
- Сигналы: `DailyCheckIn.sentiment`, `MeetingParticipantBehavior` (активность во встречах), commitments через `commitment-followup.cron`, helpfulness через `specialist-3-8-helpfulness`.

❌ **Создаём**:
- [ ] Schema: `Person.engagementScore Decimal(4,3)?`, `Person.engagementScoreAt DateTime?`.
- [ ] Новая модель `PersonEngagementSnapshot` (id, personId, score, snapshotAt, signalsJson).
- [ ] `backend/src/modules/dashboard/agents/engagement-scorer.cron.ts` (daily).
- [ ] Формула — weighted sum нормированных к личному baseline.

#### Фаза 3.4. Карточка сотрудника v1 — секции 1-7 (5 дней)

✅ **Уже существует**:
- `frontend/app/(authenticated)/persons/[id]/page.tsx` + 5 подстраниц (knowledge-profile, skill-profile, appointments, social-contribution, contributions). **Pulse — это 6-я подстраница.**
- `PersonsController` + `PersonsService`.
- `KnowledgeProfileService`, `SkillProfileService`, `AppointmentsService`, `Specialist38HelpfulnessService` — **источники для секций**.

❌ **Создаём**:
- [ ] `frontend/app/(authenticated)/persons/[id]/pulse/page.tsx` + `PersonPulseClient.tsx`.
- [ ] Секции:
  1. Шапка профиля + последний 1:1.
  2. **AI Resume** (заглушка — Phase 3.8 даст полноценный HR-Recommender).
  3. Mood trend 30/90 дней + baseline-relative.
  4. Energy budget / нагрузка (workload heatmap своего времени).
  5. Утренние/вечерние чек-ины (регулярность; quality — заглушка до 3.5).
  6. Обещания (взято / закрыто / просрочено / тренд).
  7. Цели и вклад в стратегию.
- [ ] Backend: `PersonPulseService` — компонует данные из существующих сервисов. Endpoint `GET /api/v1/persons/:id/pulse`.
- [ ] RBAC: пока только owner / admin / coo + сам сотрудник. HR-партнёр + opt-in — Волна 4.

#### Фаза 3.5. Reflection-Quality-Scorer агент (2 дня)

✅ **Уже существует**:
- `DailyCheckIn` модель (без qualityScore).
- `checkin-sentiment-analyzer.worker` — паттерн worker'а, можно скопировать структуру.

❌ **Создаём**:
- [ ] Schema: `DailyCheckIn.qualityScore Decimal(4,3)?`.
- [ ] `backend/src/modules/operations/workers/reflection-quality-scorer.worker.ts` (на каждый чек-ин или batch).
- [ ] LLM оценивает чек-ин по 3 осям: глубина (слов), конкретность (есть ли action items с метриками), разнообразие тем.
- [ ] В карточке сотрудника секция 5 — обновляется с реальным quality score.

#### Фаза 3.6. Карточка сотрудника v2 — секции 8-12 (4 дня)

✅ **Уже существует**:
- `Specialist38HelpfulnessService` — секция 8 (трекер-активность, helpfulness %).
- `KnowledgeProfileService` — секция 11 (темы и знания).
- `EntityLink` + `personal-relation-builder.worker` — секция 10 (граф связей).
- `ActivityFeedService.getFeed({feedType:'probe_question', targetUserId})` — данные для **новой секции 9.5**.

❌ **Создаём**:
- [ ] 8. Активность в трекере: создал/закрыл Issue, время закрытия, комментарии (length, helpful %).
- [ ] 9. Активность в чатах: placeholder UI «когда подключим чаты» (раздел в Волне 6.9).
- [ ] **9.5 ⭐ NEW Вопросы AI этому человеку**: `<ActivityFeedWidget feedTypes={['probe_question']} scope='user' scopeId={person.userId} />`. Группировка: ответил / проигнорировал / истёк / активные. Это сильнейший сигнал engagement.
- [ ] 10. Граф связей: топ-5 с кем работает, конфликты (EntityLink), изоляция.
- [ ] 11. Темы и знания: топ-темы, knowledgeProfile.categories.
- [ ] 12. Risk-сигналы (Burnout-Risk-Detector — заглушка до Волны 4) + HR-флаги (Phase 3.8).

#### Фаза 3.7. HR-Recommender агент (3 дня)

✅ **Уже существует**:
- `recognition-formulate.worker` — 5 типов recognition (`thanks_*`, `mention_helped`, `idea_shipped`, `streak_milestone`, `weekly_summary`). **Это про благодарности от AI, не про действия руководителя. Не путать.**

❌ **Создаём**:
- [ ] Schema: `Person.hrSuggestionsJson Json?`.
- [ ] `backend/src/modules/dashboard/agents/hr-recommender.cron.ts` (weekly).
- [ ] Для каждого Person: LLM сводит сигналы из карточки + recognition + engagement → рекомендации.
- [ ] 5 типов рекомендаций: ПОХВАЛИТЬ / ЗП-РЕВЬЮ / ОБСУДИТЬ НАГРУЗКУ / РАЗВИТИЕ / СРОЧНО ПОГОВОРИТЬ.
- [ ] Provenance: каждая рекомендация — на основе каких сигналов.

#### Фаза 3.8. Карточка сотрудника v3 — AI Resume финал (3 дня)

✅ **Уже существует**: всё из Фаз 3.4-3.7.

❌ **Создаём**:
- [ ] AI Resume в секции 2 обновляется реальным выводом HR-Recommender.
- [ ] Timeline событий (опц. под спойлером).

#### Фаза 3.9. QA (2 дня)

### 7.3. DoD Волны 3

1. Карточка сотрудника v3 со всеми 12 секциями + секция 9.5 «Вопросы AI».
2. Team Health агрегаты реальные (от Team-Health-Analyzer).
3. Engagement Score per person считается.
4. HR-рекомендации генерируются и отображаются.
5. Reflection quality считается.
6. Все тесты + регрессия.

### 7.4. 🛑 Чекпоинт 3

- Open rate карточки сотрудника у руководителей ≥2 раза/неделю на одного сотрудника.
- ≥30% сессий — клик на HR-рекомендацию (действие).
- Precision HR-рекомендаций ≥60% (по user feedback «релевантно/нет»).
- Просмотр секции «Вопросы AI» ≥40% сессий — подтверждает что лента работает в контексте человека.
- ≥1 customer case study «помогло заметить выгорание / найти кого похвалить».

Если precision <50% — пауза агентов, тюнинг промптов.

---

## 8. Волна 4 — Compliance + углубление (3 недели)

### 8.1. Цели

1. 152-ФЗ opt-in flow при найме / первом входе (Блок C onboarding).
2. Audit log: сотрудник видит кто открывал его карточку (`/me/privacy`).
3. Region flag (`ru` / `eu` / `other`) — разные правила.
4. Новые агенты: Meeting-Speaker-Analyzer (расширение existing), Burnout-Risk-Detector, Forecaster.
5. Роль `hr_partner` в RBAC.

### 8.2. Фазы

#### Фаза 4.1. 152-ФЗ opt-in flow (3 дня)

✅ **Уже существует**:
- `OnboardingModule` (Блок A квалификатор + Блок B setup-tour). `Org.welcomeCompletedAt`, `Org.setupCompletedAt`. **Добавляем Блок C.**
- `Org` модель.

❌ **Создаём**:
- [ ] Schema: новые модель `ConsentLog` (per personId, dataType, consentedAt, revokedAt?), поле `Person.analyticsOptIn Boolean @default(false)`, `Person.analyticsOptInAt DateTime?`, `Org.region String? @default("ru")`.
- [ ] **Блок C onboarding** — 3 шага галочек:
  - Согласие на обработку чек-инов и sentiment.
  - Согласие на анализ Risk-сигналов.
  - Согласие на показ карточки руководителю (default: да, можно отказать).
- [ ] Каждая галочка → запись в `ConsentLog`.
- [ ] Опция «отозвать согласие» в `/me/privacy/consents`.

#### Фаза 4.2. Audit Log `/me/privacy/access-log` (2 дня)

✅ **Уже существует**:
- `AuditLog` модель + `AuditLogService` (`tenantId, userId, action, resourceId, metadata, ipHash, userAgent, createdAt`). **Расширяем подход, не дублируем.**
- `IpHashingService` (для приватности).

❌ **Создаём**:
- [ ] Schema: модель `KnowledgeAccessLog` (per viewerUserId, viewedPersonId, sectionAccessed, accessedAt). Отдельная от общего AuditLog — нужна детализация view-events карточки.
- [ ] Middleware на endpoint `/api/v1/persons/:id/pulse` — пишет access log (кроме когда сам себе).
- [ ] Frontend `/me/privacy/access-log` — таблица «кто и когда открывал твою карточку».

#### Фаза 4.3. Region flag (2 дня)

✅ **Уже существует**:
- `Org` модель.

❌ **Создаём**:
- [ ] Schema: `Org.region String? @default("ru")`.
- [ ] В UI conditional rendering — для `region='eu'` определённые фичи (например, voice features) скрыты.
- [ ] Для `region='ru'` — приоритет 152-ФЗ flow.

#### Фаза 4.4. Meeting-Speaker-Analyzer (расширение existing) (3 дня)

✅ **Уже существует**:
- `MeetingParticipantBehavior` модель: `speakingTimeMs, speakingTimePercent, turnsCount, avgTurnDurationMs, monologueCount, questionCount, fillerWordsCount, interruptionsMadeCount, ...`. **Это уже speaker analysis!**
- `behavior-metrics.worker.ts` — считает эти метрики.
- `Participant` модель + `TranscriptChunk` + `MeetingTranscriptChunk` — текст по chunk'ам.

❌ **Создаём**:
- [ ] Schema: `MeetingParticipantBehavior.sentimentTextPerSpeakerJson Json?` (sentiment **по тексту**, не по голосу — emotion-recognition по голосу/видео ЗАПРЕЩЁН EU AI Act §1.3).
- [ ] Worker (новый или расширение `behavior-metrics.worker`): после `transcribe.worker` → LLM анализирует текст per speaker (темы, sentiment текста) → пишет в `sentimentTextPerSpeakerJson`.
- [ ] Используется в карточке сотрудника секция 4 (активность во встречах).

#### Фаза 4.5. Burnout-Risk-Detector (3 дня)

✅ **Уже существует** — все сигналы:
- `DailyCheckIn.sentiment` (sentiment dip).
- `commitment-followup` (broken/overdue).
- `MeetingParticipantBehavior` (no-shows, monologue ratio).
- `EntityLink.conflicted_with` (conflict mentions).
- `Specialist38Helpfulness` (response latency proxy).

❌ **Создаём**:
- [ ] Schema: `Person.riskFlagsJson Json?`.
- [ ] `backend/src/modules/dashboard/agents/burnout-risk-detector.cron.ts` (daily).
- [ ] Топ-10 сигналов с порогами **относительно личного baseline**:
  - Sentiment dip ≥1σ от 90-day baseline.
  - Reply latency rise ≥2× от baseline за 14 дней.
  - Missed check-ins ≥2 подряд.
  - Promise hygiene (≥3 broken promises за 4 недели).
  - Workload overload (≥7 дней >100% capacity).
  - Meeting no-shows ≥3 за 7 дней.
  - Conflict mentions (новый EntityLink `conflicted_with` за 14 дней).
  - Disappearing from chats (опц., после Волны 6.9).
- [ ] Кладёт в `Person.riskFlagsJson` со списком активных сигналов + explanation.
- [ ] **НЕ** агрегирует в одну цифру. Только список сигналов.
- [ ] **Эскалационный guardrail**: маркеры суицидальной идеации → blocking UI на /me/pulse + ссылка на горячую линию + опц. notify HR (с opt-in).

#### Фаза 4.6. Forecaster агент (2 дня)

❌ **Создаём**:
- [ ] Schema: модель `ForecastSnapshot` (id, tenantId, scope, scopeId?, payloadJson, snapshotAt).
- [ ] `forecaster.cron` (weekly).
- [ ] LLM анализирует тренды за 4 недели → прогноз на следующую неделю по командам и компании.
- [ ] Используется в Weekly digest (заглушка из 2.2 заменяется) и на Главной.

#### Фаза 4.7. Роль `hr_partner` в RBAC (2 дня)

✅ **Уже существует**:
- `MembershipRole` enum: `owner / admin / manager / coo / super_admin`. **Добавляем `hr_partner`.**
- `RbacService` + Casbin + `policy.csv`.

❌ **Создаём**:
- [ ] Schema: добавить `hr_partner` в `MembershipRole`.
- [ ] Правила в `policy.csv`: hr_partner видит карточку при `Person.analyticsOptIn=true`, видит агрегаты по командам.
- [ ] Методы в `RbacService`: `canViewEmployeeFullCard(userId, employeeId)`.

#### Фаза 4.8. QA + Compliance audit (2 дня)

- [ ] Manual проверка: все pulse-метрики требуют opt-in.
- [ ] Юридическое review opt-in текстов (рекомендуется до релиза).

### 8.3. DoD Волны 4

1. 152-ФЗ opt-in flow работает для новых сотрудников.
2. Audit log виден сотруднику.
3. Region flag разделяет EU и RU.
4. Burnout-Risk-Detector выводит сигналы.
5. Forecaster даёт прогнозы.
6. Meeting-Speaker-Analyzer работает (расширение existing).
7. Роль hr_partner добавлена.

### 8.4. 🛑 Чекпоинт 4

- Adoption opt-in flow ≥80% сотрудников новых tenant'ов.
- 0 жалоб типа «отслеживает меня».
- Burnout-Risk-Detector — ≤20% false positives.

Если жалобы есть — пауза, разбор UX и framing.

---

## 9. Волна 5 — Спринты + каналы push/pull (3 недели)

### 9.1. Цели

1. Sprint Daily экран — гипотеза + что вчера + подсказки помощника + цвета задач.
2. Sprint Weekly экран — статус гипотезы + чему научились + retro draft.
3. Архив гипотез — хроника всех спринтов.
4. Telegram weekly digest для спринтов (расширение существующего `telegram-digest.cron`).
5. Расширенный Concierge chat — новые tools (PersonPulse / PromiseOverdue / SprintStatus / TeamHealth / IgnoredProbeQuestions).
6. In-app sidebar «Помощник компании» — **поверх существующих** ProactiveNotification + ActivityFeedItem.

### 9.2. Фазы

#### Фаза 5.1. Sprint Daily экран (4 дня)

✅ **Уже существует**:
- `Cycle` модель + `SprintHint` + `SprintHintKind` enum (10 типов).
- `sprint-helper.cron` + `sprint-helper.worker` + `SprintHelperService.runForCycle()`.
- `SprintAnalystService` + endpoint `GET /api/v1/cycles/:id/dashboard`.
- `frontend/app/(authenticated)/sprints/[id]/SprintDashboardClient.tsx` (5 блоков: Прогресс / Помощник / Подсказки / Задачи / Активные люди). **Расширяем или создаём вариант daily.**

❌ **Создаём**:
- [ ] `frontend/app/(authenticated)/sprints/[id]/daily/page.tsx` + клиент (либо расширение SprintDashboardClient с tab="daily").
- [ ] Секции (v3-expanded §3.7):
  - Гипотеза + текущая метрика + confidence team (использует `Cycle.description` пока, потом расширим в 5.2).
  - AI Daily Standup (расширить `sprint-analyst.service.ts` методом `getDailyDigest`).
  - Подсказки помощника (уже есть — SprintHint все 10 типов).
  - Список задач с цветным светофором (по Issue + `lastActivity` из 2.3).
  - Кто двигает спринт (top-3 closed + top-3 helpful — данные из existing).
  - Alarm-bar (если ≥1 критическая подсказка).
- [ ] Backend: расширить `SprintAnalystService` методом `getDailyDigest({cycleId})`.

#### Фаза 5.2. Sprint Weekly экран (3 дня)

✅ **Уже существует**:
- `frontend/app/(authenticated)/sprints/[id]/review/SprintReviewClient.tsx` — **retro template есть, расширяем.**
- `POST /api/v1/cycles/:id/start-meeting` (type='sprint_review').

❌ **Создаём**:
- [ ] Решить совместно с оркестратором: добавлять `Cycle.hypothesisJson` (structured) или оставить `description` + convention. До решения — convention.
- [ ] `frontend/app/(authenticated)/sprints/[id]/weekly/page.tsx` (либо tab в SprintDashboardClient).
- [ ] Секции (v3-expanded §3.8):
  - Recap гипотезы + статус (подтверждается / нет).
  - AI Weekly Sprint Summary (новый agent `sprint-strategist.worker` или расширение `operations-weekly-digest`).
  - Velocity + throughput trend.
  - Health команды спринта (mini-Health Grid для членов спринта).
  - Outcome метрика недели.
  - Что узнали за неделю.
  - Action items для retro.
  - Прогноз закрытия (через Forecaster из 4.6).
  - Retro-template (автогенерация из существующего SprintReviewClient).

#### Фаза 5.3. Архив гипотез (3 дня)

✅ **Уже существует**:
- `Cycle` модель.
- `SprintsListClient` — паттерн списка.

❌ **Создаём**:
- [ ] `frontend/app/(authenticated)/sprints/archive/page.tsx` + клиент.
- [ ] Список всех `Cycle` за период с (гипотеза, результат, чему научились, решение).
- [ ] Фильтры: подтвердились / не подтвердились / в процессе.
- [ ] Сводка квартала.
- [ ] Backend endpoint `GET /api/v1/sprints/archive?period=quarter`.
- [ ] Поиск по тексту гипотезы (использовать embedding на `Cycle.description` если есть).

#### Фаза 5.4. Telegram weekly digest для спринтов (3 дня)

✅ **Уже существует**:
- `telegram-digest.cron.ts` — hourly, per-user TZ, default 09:00. Собирает Issue (urgentToday/inProgress/overdue), LLM `telegram-digest-formulate`, Redis dedup. Отправка через `sendNotification(eventType='telegram.digest')`. **Расширяем для спринтов.**
- `operations-weekly-digest.cron.ts` — шлёт coo/owner еженедельно.

❌ **Создаём/расширяем**:
- [ ] Расширить `telegram-digest.cron` или создать `sprint-weekly-digest.cron` для генерации спринт-секции (3 сигнала + 1 победа + 1 действие).
- [ ] Inline-кнопки (если Telegram адаптер поддерживает — иначе кликабельные ссылки) «Открыть источник».
- [ ] User-настройка: какой день/время + on/off (через существующие `ChannelBinding`).

#### Фаза 5.5. Расширенный Concierge chat (4 дня)

✅ **Уже существует**:
- `ConciergeService` + `ToolRouterService` + `ServiceMapGeneratorService` — whitelist tools, RBAC. **Добавляем новые tools.**

❌ **Создаём**:
- [ ] Зарегистрировать новые tools в whitelist:
  - `get_person_pulse({personId})` → данные карточки сотрудника.
  - `list_overdue_promises({scope?, scopeId?})` → просроченные обещания.
  - `get_sprint_status({cycleId})` → текущий статус спринта.
  - `get_team_health({departmentId?})` → top из Team Health.
  - `list_ignored_probe_questions({scope?, scopeId?, period})` → агрегат `ActivityFeedItem` со status=`expired` group by targetUserId — для запроса «кто игнорирует вопросы AI?».
- [ ] Concierge **никогда не пишет первым** (правило из `feedback_concierge_text_only_output.md`).

#### Фаза 5.6. In-app sidebar «Помощник компании» (3 дня) — переделано

✅ **Уже существует — переиспользуем целиком**:
- `ProactiveModule` — 8 deterministic rules + REST `/api/v1/me/proactive-notifications` (list + dismiss). Anti-spam 1/день.
- `ActivityFeedService.getFeed({severity, status, ...})` — фильтрация critical/high уведомлений.
- `ActivityFeedGateway` WS — live-обновления.

❌ **Создаём (только frontend)**:
- [ ] `frontend/src/ui/components/layout/AssistantSidebar.tsx`:
  - Badge-counter справа сверху (composes: `getFeed({severity:['critical','high'], status:['emitted','delivered','seen']}).length` + `listProactiveNotifications().length`).
  - Sidebar выезжает справа.
  - 3-5 actionable сигналов (anomalies, hanging items, alerts).
  - Каждый сигнал → action button («запланировать 1:1», «открыть», «dismiss» через REST).
  - Auto-decay через ActivityFeed `expiresAt` (cron уже работает) + Proactive auto-expire.
- [ ] Подключение в `frontend/app/(authenticated)/layout.tsx`.
- [ ] Notification budget: уже задан в backend (anti-spam ProactiveDedupService + rate-limit Probe).
- [ ] **Модель `AssistantSignal` НЕ создаём** (см. §4.3).

#### Фаза 5.7. QA (2 дня)

### 9.3. DoD Волны 5

1. Sprint Daily / Sprint Weekly / Архив гипотез работают.
2. Telegram weekly digest приходит со спринт-секцией.
3. Concierge отвечает на новые tools.
4. Sidebar работает с дедупликацией (через ProactiveDedupService + ActivityFeed FSM).
5. Все тесты + регрессия.

### 9.4. 🛑 Чекпоинт 5

- Telegram digest open rate ≥40%.
- Sprint Daily — открывается ≥1 раз/день sprint owner'ом во время спринта.
- Sidebar action click ≥30%.
- Concierge query «кто игнорирует вопросы AI» использован ≥1 раз/неделю руководителем.
- ≥1 customer case study «архив гипотез помог не повторить ошибку».

---

## 10. Волна 6 — Чаты + 8 показателей-патернов (4 недели)

### 10.1. Цели

Глубинная аналитика — 8 паттернов которые я как операционный директор сам предложил (v3-expanded §12-bis). Плюс подключение чатов как источника данных.

### 10.2. Фазы

#### Фаза 6.1. Bus Factor Analyzer (3 дня)

✅ **Уже существует**:
- `PersonKnowledgeCategoryEmbedding` модель.
- `KnowledgeCloneModule` (β-2).

❌ **Создаём**:
- [ ] Schema: модель `KnowledgeRiskSnapshot`.
- [ ] `backend/src/modules/dashboard/agents/bus-factor-analyzer.cron.ts` (weekly).
- [ ] Для каждой knowledge-area: `COUNT(person WHERE confidence='high')`.
- [ ] Виджет «Угрозы непрерывности» на Главной — топ-5 critical (≤1 эксперт).
- [ ] В карточке сотрудника — «Без этого человека пропадёт».

#### Фаза 6.2. Topic Recurrence Detector (2 дня)

✅ **Уже существует**:
- `Theme` модель (weight, dynamic, lastSignalAt).
- `IdeaBlock` со связями к `Theme`.

❌ **Создаём**:
- [ ] Schema: модель `RecurringTopic`.
- [ ] `topic-recurrence-detector.cron` (weekly): для каждого Theme — упоминаний за период, число встреч, наличие implemented Decision.
- [ ] Виджет «Что мы обсуждаем по кругу» на Главной (top-5).
- [ ] Виджет в Operations Daily.

#### Фаза 6.3. Meeting ROI Scorer (3 дня)

✅ **Уже существует**:
- `Meeting` модель (без roiScore).
- `tasks-extract.worker`, `behavior-metrics.worker`, `quality-score.worker`, `specialist-3-3-decisions.worker` (decisions/commitments/tasks).

❌ **Создаём**:
- [ ] Schema: `Meeting.roiScore Decimal(4,3)?`.
- [ ] `meeting-roi-scorer.worker` (на каждое Meeting после `tasks-extract` + `quality-score`).
- [ ] Формула: `(decisions×10 + commitments×5 + closedTasks×3) / (avgParticipants × durationMinutes / 60)`.
- [ ] Виджет «Топ-3 встречи-болтологии» на Главной.
- [ ] В Operations Daily: вчерашние low-ROI встречи.
- [ ] В карточке сотрудника: % его времени на low-ROI встречи.

#### Фаза 6.4. Cross-functional Bottleneck Heatmap UI (2 дня)

✅ **Уже существует**:
- `cross-functional-friction-aggregator.cron` + `CrossFunctionalFrictionReport` модель.

❌ **Создаём (только UI)**:
- [ ] Виджет на Главной: heatmap 5×5 / 6×6 отделов × отделов.
- [ ] В Operations Daily: «новые трения вчера».
- [ ] В Teams dashboard: с кем больше всего трений у команды.

#### Фаза 6.5. Promise Network Analyzer (3 дня)

✅ **Уже существует**:
- `Commitment` / IdeaBlock `signalType='commitment'` + author/recipient.
- `EntityLink`.

❌ **Создаём**:
- [ ] Schema: модель `PromiseNetworkSnapshot`.
- [ ] `promise-network-analyzer.cron` (weekly): строит граф, считает paradoxы (in-degree, out-degree, balance).
- [ ] Помечает узлы: накопитель / донор / изолированный.
- [ ] Виджет в Teams dashboard.
- [ ] В карточке сотрудника: «кому ты обещаешь / кто тебе».

#### Фаза 6.6. Goal Vector Tracker (3 дня)

✅ **Уже существует**:
- `Goal` модель + `strategic-alignment.cron` + `Goal.cachedAlignment`.

❌ **Создаём**:
- [ ] Schema: модель `PersonGoalContribution`.
- [ ] `goal-vector-tracker.cron` (weekly): LLM анализирует артефакты (IdeaBlock, Commitment, Issue closed, MeetingAttendee, чек-ины) → pro/contra per active Goal.
- [ ] Виджет на Главной: «Вектор компании».
- [ ] В карточке сотрудника: «Куда направлены усилия».
- [ ] В Teams: aggregate команды.
- [ ] В Sprint Pulse: % action team спринта на спринт-цель.

#### Фаза 6.7. Knowledge Velocity Tracker (2 дня)

✅ **Уже существует**:
- `IdeaBlock` `signalType='knowledge_gap'` + `trustedAnswer`.

❌ **Создаём**:
- [ ] Schema: модель `KnowledgeVelocitySnapshot`.
- [ ] `knowledge-velocity-tracker.cron` (weekly): median time от создания knowledge_gap до появления trustedAnswer.
- [ ] KPI «Скорость накопления знаний» на Главной.
- [ ] В карточке сотрудника: «твои вопросы без ответа».

#### Фаза 6.8. Decision Hygiene Scorer (3 дня)

✅ **Уже существует**:
- `Decision` модель.
- `specialist-3-3-decisions.worker`.

❌ **Создаём**:
- [ ] Schema: `Decision.reversibility String?` (type-1 / type-2).
- [ ] `decision-hygiene-scorer.worker` (на каждое новое Decision).
- [ ] LLM классифицирует type-1/type-2 на основе текста.
- [ ] Для type-1: проверяет наличие `IdeaBlock signalType='decision_basis'` вокруг → есть ли альтернативы.
- [ ] Алерт на Главной: «3 необратимых решения без альтернатив за неделю».
- [ ] На странице Decision: «Это type-1, рассмотрены ли альтернативы?»

#### Фаза 6.9. Чат-интеграция (опц., ~5 дней)

✅ **Уже существует**:
- `TelegramBotChannelAdapter` + handlers (inbound уже умеет принимать сообщения).
- `MeetingChatMessage` (внутри встреч, не путать).

❌ **Создаём**:
- [ ] Schema: новая модель `ChatMessage` (для внешних чатов команды, read-only от Telegram bot).
- [ ] Telegram bot read-only access на канал команды (opt-in каждого участника).
- [ ] Сохранение messages в `ChatMessage`.
- [ ] `chat-helper.cron`: анализ переписки — кто помогает, кто молчит, sentiment per pair.
- [ ] Виджет «Чат-активность» в карточке сотрудника секция 9 (раньше заглушка).
- [ ] Slack / Discord интеграции — отдельный трек (не в этой волне).

#### Фаза 6.10. QA (3 дня)

### 10.3. DoD Волны 6

1. Все 8 паттернов (Bus Factor / Topic Recurrence / Meeting ROI / Bottleneck Heatmap / Promise Network / Goal Vector / Knowledge Velocity / Decision Hygiene) считаются и видны.
2. Chat-integration (опционально) даёт первые сигналы.
3. Все агенты в Prometheus метриках.
4. Тесты + регрессия.

### 10.4. 🛑 Финальный чекпоинт

- ≥3 customer case studies «помог увидеть X за месяцы до того как взорвалось».
- Daily active на Главной ≥80% от signed-up tenant'ов.
- Net Promoter Score продукта ≥+30.
- Churn rate < 5% за квартал.

---

## 11. Общие риски и митигации

| Риск | Митигация |
|---|---|
| 15 недель — пользователь устаёт ждать value | Чекпоинты после каждой волны — реальная польза должна быть видна через 3 недели (Волна 1), 6 недель (Волна 2), 10 недель (Волна 3) |
| Один разработчик не справится за 15 недель | Roadmap рассчитан на 1-2 fullstack, реально 12-20 недель |
| LLM-агенты галлюцинируют, теряем доверие | Transparent Sourcing на каждом утверждении; precision threshold ≥70% на чекпоинтах; кнопка «нерелевантно» с обратной связью |
| 152-ФЗ не соблюдён, юридический риск | Волна 4 — opt-in flow обязателен до релиза любых pulse-фич для бизнеса; рекомендуется юр.consult |
| Hawthorne effect | Документ «что система знает» обязателен на /me/pulse; opt-out возможен |
| Поля конфликтуют с существующими | **Правило §0.5: grep перед добавлением каждого поля** |
| Sprint Hypothesis как structured-поле | Решить совместно в Фазе 5.2. До этого `Cycle.description` + convention |
| Trade-off cohort 3 vs 5 | Волны 1-3 — minimum 3 (демо-режим), Волна 4 строго min 5 после opt-in flow |
| Производительность с >10k records | Redis-кэш на всех агрегатах; если медленно — materialized views в Волне 2 |
| EU AI Act — для будущих EU-клиентов | Region flag в Волне 4; emotion-recognition по голосу/видео — никогда |
| **Дублирование инфраструктуры (как в v1 ТЗ)** | **§0.5 правила работы агента + §3.0 реестр существующих систем** |
| Coordination между параллельными сессиями Claude Code | `git fetch + log --since=1h` перед стартом каждой фазы (см. `feedback_parallel_sessions_git_check.md`) |

---

## 12. Итог реализации

Заполняется по мере выполнения. Формат: дата завершения / коммиты / выпустили на пилот / результаты.

### Волна 1 — Фундамент
- Фаза 1.0 Хотфиксы: [ ]
- Фаза 1.1 Commitment Reliability: [ ]
- Фаза 1.2 Hanging Decisions: [ ]
- Фаза 1.3 Sentiment Index: [ ]
- Фаза 1.4 AI Narrative + Citations: [ ]
- Фаза 1.5 3 KPI Hero: [ ]
- Фаза 1.6 Team Health Grid: [ ]
- Фаза 1.7 QA: [ ]
- Фаза 1.8 ActivityFeedWidget на главной: [ ]
- **Релиз Волны 1**: дата, коммиты, пилот на N клиентов.
- **Чекпоинт 1**: результаты замеров метрик через 2 недели.

### Волна 2 — Усиление операционных
- Фаза 2.1 Daily-Reporter: [ ]
- Фаза 2.2 Weekly-Strategist: [ ]
- Фаза 2.3 Операции — расширение + Issue.lastActivity + probe widget: [ ]
- Фаза 2.4 /teams список: [ ]
- Фаза 2.5 /teams/[id] детально + probe-questions tab: [ ]
- Фаза 2.6 QA: [ ]
- **Релиз Волны 2**: дата.
- **Чекпоинт 2**: метрики.

### Волна 3 — Команды и сотрудники
- Фаза 3.1 Team-Health-Analyzer: [ ]
- Фаза 3.2 Conflict-Detector расширение: [ ]
- Фаза 3.3 Engagement-Scorer: [ ]
- Фаза 3.4 Карточка сотрудника v1: [ ]
- Фаза 3.5 Reflection-Quality-Scorer: [ ]
- Фаза 3.6 Карточка сотрудника v2 + секция 9.5 вопросы AI: [ ]
- Фаза 3.7 HR-Recommender: [ ]
- Фаза 3.8 Карточка сотрудника v3: [ ]
- Фаза 3.9 QA: [ ]
- **Релиз Волны 3**: дата.
- **Чекпоинт 3**: метрики.

### Волна 4 — Compliance + углубление
- Фаза 4.1 152-ФЗ opt-in (Блок C onboarding): [ ]
- Фаза 4.2 Audit log + KnowledgeAccessLog: [ ]
- Фаза 4.3 Region flag: [ ]
- Фаза 4.4 Meeting-Speaker-Analyzer (расширение existing): [ ]
- Фаза 4.5 Burnout-Risk-Detector: [ ]
- Фаза 4.6 Forecaster: [ ]
- Фаза 4.7 hr_partner роль: [ ]
- Фаза 4.8 QA + audit: [ ]
- **Релиз Волны 4**: дата.
- **Чекпоинт 4**: метрики.

### Волна 5 — Спринты + каналы
- Фаза 5.1 Sprint Daily (расширение SprintDashboardClient): [ ]
- Фаза 5.2 Sprint Weekly (расширение SprintReviewClient): [ ]
- Фаза 5.3 Архив гипотез: [ ]
- Фаза 5.4 Telegram digest для спринтов (расширение telegram-digest.cron): [ ]
- Фаза 5.5 Concierge новые tools: [ ]
- Фаза 5.6 Sidebar помощник (поверх Proactive + ActivityFeed): [ ]
- Фаза 5.7 QA: [ ]
- **Релиз Волны 5**: дата.
- **Чекпоинт 5**: метрики.

### Волна 6 — Чаты + 8 показателей
- Фаза 6.1 Bus Factor: [ ]
- Фаза 6.2 Topic Recurrence: [ ]
- Фаза 6.3 Meeting ROI: [ ]
- Фаза 6.4 Bottleneck Heatmap UI: [ ]
- Фаза 6.5 Promise Network: [ ]
- Фаза 6.6 Goal Vector: [ ]
- Фаза 6.7 Knowledge Velocity: [ ]
- Фаза 6.8 Decision Hygiene: [ ]
- Фаза 6.9 Чаты (опц.): [ ]
- Фаза 6.10 QA: [ ]
- **Релиз Волны 6**: дата.
- **Финальный чекпоинт**: результаты по итогам полной реализации.

---

## 13. Команды разработки (напоминание)

- Все команды — через `bun`, не `npm`.
- Backend: `cd backend && bun run dev` + `bun run worker:dev` (отдельный процесс воркеров).
- Frontend: `cd frontend && bun run dev`.
- Prisma: только `bun run prisma:push`, **никогда** `migrate`. После правок схемы — `bun run prisma:generate`.
- Тесты: `bun run test:unit` / `test:integration` / `test:e2e`.
- Проверка перед commit: `bun run typecheck && bun run lint`.
- Patch-скрипты в `backend/scripts/` → регистрировать в `apply-prod-deploy.ts` (массив STEPS).
- `prod-deploy-log.md` — после каждой фазы с миграциями.

---

## 14. История правок ТЗ

- **2026-05-30 v1**: первая версия (рабочее обсуждение с владельцем). 892 строки. Найдено дублирование `AssistantSignal` ↔ `ActivityFeedItem`, отсутствие ссылок на `MeetingParticipantBehavior`, `personal-relation-builder.worker`, `telegram-digest.cron`, `ProactiveModule` и др.
- **2026-05-30 v2** (этот документ): полный аудит существующего кода 6 параллельными Explore-агентами. Добавлен §0.5 (правила работы агента), §1.4 (дизайн-стандарты SaaS 2026), §3.0 (реестр существующих систем). Удалена модель `AssistantSignal` и параллельная инфраструктура для Sidebar. Каждая фаза получила блок «✅ Уже существует — проверь и переиспользуй» + «❌ Создаём». Добавлена Фаза 1.8 (ActivityFeedWidget на главной) и секция 9.5 (вопросы AI этому человеку) в карточке сотрудника. Meeting-Speaker-Analyzer переделан в расширение `MeetingParticipantBehavior`, Telegram digest — в расширение `telegram-digest.cron`. Принцип 12 (современный SaaS-дизайн 2026) и §1.4 — обязательны для всех frontend-фаз.
