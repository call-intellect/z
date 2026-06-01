---
title: «Главная страница Кора» — финал зонтика main-screen-umbrella
date: 2026-06-02
type: reflection
distilled: false
---

# «Главная страница Кора» — финал зонтика main-screen-umbrella

## Что было поставлено

Зонтичное ТЗ [`plans/tz/2026-06-01-main-screen-umbrella.md`](../../plans/tz/2026-06-01-main-screen-umbrella.md) связывал две независимые работы:

- **Поток А** — [`plans/tz/2026-06-01-demo-shared-org-model.md`](../../plans/tz/2026-06-01-demo-shared-org-model.md): отказ от модели «копия ТехноСтрим в каждую Org» в пользу **shared эталонной демо-Org** (`isReferenceDemo=true`), куда новые пользователи попадают как `demo_observer` мгновенно при регистрации.
- **Поток Б** — [`plans/tz/2026-06-01-dashboard-main-tabs-restructure.md`](../../plans/tz/2026-06-01-dashboard-main-tabs-restructure.md): рефакторинг главной из «простыни 25 виджетов» в **sticky Hero + 4 pill-таба + AssistantSidebar.Спросить**.
- **Поток В** — мини-фаза в самом зонтике: совместная сборка по матрице 6 состояний главной (Org × Role × Subscription → рендер).

Работали через нестандартный паттерн: **главный оркестратор-промпт** в [`plans/tz/2026-06-01-main-screen-umbrella-orchestrator-prompt.md`](../../plans/tz/2026-06-01-main-screen-umbrella-orchestrator-prompt.md) задавал управление через делегирование исполнительным агентам с обязательным факт-чеком.

## Как решал

**21 фазный коммит** в `feature/main-screen-umbrella` (от `04c165c` до `c43593c`):

### Поток А (8 фаз, backend + frontend минимум)

1. **Фаза 0 pre-flight** (`04c165c`) — git log + APP_GUARD ordering + OrgSwitcher проверка. Зафиксировал критическое решение: `DemoObserverGuard` ставим как APP_GUARD с **self-load** через `rbac.loadContext`, потому что APP_GUARD выполняется до method-level `TenantGuard`. Method-guard вариант отклонён — это 100+ эндпоинтов.
2. **Фаза 1 schema + RBAC** (`5e0a36e`) — `MembershipRole +demo_observer`, `Org.isReferenceDemo`, `PaymentMode +reference`, `canMutate(role)`, +43 правила policy.csv. 6 downstream TS-фиксов в accounts/auth/billing (DTO narrowings).
3. **Фаза 2 DemoObserverGuard** (`3da886b`) — APP_GUARD + `@PublicDemo()` декоратор + расширение TenantGuard кэшем `req.rbacContext`. 23 unit-теста.
4. **Фаза 3 ENV + accounts** (`5015b22`) — `ZDEMO_ORG_ID` env + `cfg.demo.referenceOrgId` + `register` создаёт demo_observer membership + `getMe` явно предпочитает demo_observer как currentOrg. 7 новых spec-тестов.
5. **Фаза 4 listener + cleanup** (`08645da`) — `SubscriptionActivatedListener` теперь снимает membership при оплате. Удалены `demo-seed.queue/worker`, `OnboardingService.triggerDemoSeed/getDemoSeedStatus/ensureDemoSeed`, endpoints `GET /demo-seed-status` и `POST /demo-workspace/ensure`. -649/+206 строк. Listener получил self-detach guard (если активируемая Org = эталон → skip).
6. **Фаза 5 frontend минимум** (`c4f4f4f`) — backend: `OrgDomain.isReferenceDemo`. Frontend: удалён loading-экран `/onboarding/welcome/complete`, `step-6` redirect сразу `/dashboard`, удалены устаревшие API-методы, OrgSwitcher показывает бейдж «Демо», `/admin/demo` показывает «🌟 Эталон» с force-update только для эталона. Создан `MainEmptyState` компонент (не подключён — это Шаг В.1).
7. **Фаза 6 patch-скрипты + prod-deploy-log** (`8d107b3`) — `patch-create-reference-demo-org.ts` (создаёт эталон + заливает 8 модулей) + `patch-migrate-old-demo-orgs.ts` (мигрирует старые «копии» с проверкой skip-alive). Зарегистрированы в `apply-prod-deploy.ts`. Блок «🌟 2026-06-01 — Shared demo Org» в `docs/operations/prod-deploy-log.md`.
8. **Фаза 7 second-brain финал** (`39e5279`) — новая профильная заметка [[demo-workspace]], обновлены [[onboarding-wizard]] (секция «авто-сидинг» → «shared эталон») и `module-map.md`, индекс second-brain.

### Поток Б (10 фаз, frontend)

9. **Фаза 0 реестр** (`48292ff`) — `docs/reference/dashboards-registry.md` §4 «Карта главной — табы»: таблица 18 виджетов с распределением по 4 табам + матрица 6 состояний.
10. **Фаза 1 компонент** (`f6afa50`) — `DashboardTabs.tsx` (4 pill-таба) + `useDashboardTab(userId).ts` (localStorage `dashboard.lastTab.<userId>`, SSR-safe).
11. **Фаза 2 Hero refactoring** (`6437bd2`) — sticky Hero с 3 зонами (3 KPI + AI-сводка + TopRiskCard) + узкая sticky-полоса (StructureSummary + Pill «Спросите Кору»). Новый `TopRiskCard` (Топ-1 из `pulse.irreversibleDecisions`). Удалены: SampleStoryBanner, плоский AI-блок, IrreversibleDecisionsAlert (переехал в таб Цели).
12. **Фаза 3 виджеты → 4 таба** (`71c7577`) — 4 функции `OverviewTab/TeamTab/KnowledgeTab/GoalsTab` + `TabBottomLink` + `DigestCard`. Все 4 SectionHeader-секции удалены. `OrgChatPanel` снизу страницы тоже удалён (переезд в AssistantSidebar).
13. **Фаза 4 AssistantSidebar.Спросить** (`9ff44f4`) — Sidebar превращён из 3 секций стопкой в 4 pill-таба. AskSection использует существующий `OrgChatPanel`. EventListener `assistant-sidebar:open-ask` (из Hero pill).
14. **Фаза 5 онбординг-блок** (`2a7dc9d`) — `IntroWizardWidget` перепи­сан с простого «есть/нет отделов» на 4-state логику + 6-шаговый прогресс-бар + кнопка «Отложить на неделю» (localStorage).
15. **Фаза 6 TabEmptyState** (`75e96a4`) — единый empty-state для таба когда ВСЕ виджеты пусты. Подключён в Overview/Knowledge/Goals (TeamTab — без, сложная эвристика).
16. **Фаза 7 PeopleAtRiskWidget** (`a11c0db`) — компонент готов с props `items: PeopleAtRiskItem[] | null`. Сейчас рендерится с `items={null}` → скрыт, потому что backend endpoint `/dashboard/people-at-risk` не реализован (открытый хвост в `dashboards-registry.md` §4.4).
17. **Фаза 8 mobile + sticky fix** (`3d1fba7`) — снят `sticky top-0 z-20` со старого header (конфликт с Hero). Header теперь обычный, Hero — единственный sticky-блок.
18. **Фаза 9** — финальная верификация Б отдельным коммитом не понадобилась (Б.8 включил весь финал, проверки зелёные).

### Поток В (5 коммитов, сборка матрицы)

19. **В.1+В.2+В.3+В.5** (`3724b58`) — `MainEmptyState` подключён через ранний return при `isPageEmpty`, TopRiskCard CTA становятся `<button onClick={showPaywallModal}>` для demo_observer, MainEmptyState получил setupProgress (компактная плашка «N/6» с CTA), `useDashboardTab` JSDoc подтвердил per-user persistence через смену Org.
20. **В.4** (`cb15699`) — `@PublicDemo()` на `/chat-v2/messages` + `/concierge/messages` + `/concierge/messages/once`: LLM-чат разрешён для demo_observer в эталоне.
21. **В.6+В.7** (`c43593c`) — static smoke 6 строк матрицы зафиксирован inline-комментарием в `DirectorDashboardClient.tsx`. Дополнен `dashboards-registry.md` §4.6 «Реализация в коде» с цитатами условий.

## Что вышло (верификация)

Финальный прогон обеих codebase'ов:

- **Backend** `bun run typecheck`: 0 errors.
- **Backend** `bun run lint`: 0 errors, 134 pre-existing warnings (baseline).
- **Backend** `bun run test:unit`: **3017 / 3050 passed** (33 skipped — все pre-existing).
- **Frontend** `bun run typecheck`: 0 errors.
- **Frontend** `bun run lint`: 0 errors, 0 warnings.
- **Frontend** `bun run build`: успех (все routes, включая `/team-templates`, `/themes`, `/vendors` etc.).
- **Frontend** `bun run test:unit`: **115 / 115 passed**.

## Чему научился

1. **APP_GUARD vs method-guard в NestJS** — APP_GUARD'ы запускаются ДО method-level guards, поэтому `req.rbacContext` нужно либо положить в middleware (требует `req.user.id`, недоступен в middleware), либо APP_GUARD сам грузит membership через `rbac.loadContext`. Это не очевидно из документации NestJS — занял Фазу А.0 на анализ.
2. **DTO-narrowing после расширения Prisma enum** — добавление `demo_observer` в `MembershipRole` ломает 6 файлов (accounts, auth, billing), которые декларировали `'owner' | 'admin' | ...` в string literals. Дешёвая мини-правка (1-2 строки на файл), но если её не сделать — `bun run typecheck` остаётся красным, и следующая фаза наследует красноту. Зафиксировано как урок: «расширение enum'а в schema = поиск всех string-literal DTO в коде».
3. **Sticky-блок поверх sticky-блока ломает иерархию** — если header был sticky, а Hero тоже sticky → один перекрывает другой при скролле. Решение: оставить sticky только у самого важного («приборная панель» из принципа ТЗ).
4. **«Демо как состояние, а не как операция»** — концептуальная перестройка. Раньше демо означало sequence INSERT'ов (seed) в каждую Org с очередью и cleanup'ом. Теперь это просто `OrgMember(role='demo_observer')` к эталону. Mental model упростилась радикально — даже патч-миграция стала ~150 строк (не 2000+ как раньше).
5. **«Открытые хвосты» — нормальный паттерн** — не каждый виджет можно реализовать в одной волне. `PeopleAtRiskWidget` требует нового backend endpoint'а — зафиксировали как открытый хвост в `dashboards-registry.md` §4.4, виджет рендерит null. Это лучше чем mock-данные или плашка «Скоро» — пользователь не видит «незаконченный продукт».
6. **Делегирование исполнительным агентам с факт-чеком** — паттерн оркестрации работает, но требует **дисциплины факт-чека**: после каждого агента — `git status --short` + grep ключевых маркеров + независимый `bun run typecheck/lint`. Один раз агент сообщил «typecheck зелёный» — но downstream-narrowings были (Фаза А.1). Поймал только своим запуском.
7. **Mini-fix после факт-чека** оправдан — если правка на 1-2 строки уберёт красноту, проще исправить руками, чем перезапускать агента. Из 21 коммита 4-5 раз делал мини-фиксы (DTO narrowings, sticky-конфликт header, unused imports).

## Открытые хвосты для следующей волны

| Хвост | Где | Когда чинить |
|---|---|---|
| `GET /api/v1/dashboard/people-at-risk` endpoint | `PeopleAtRiskWidget` скрыт пока null | Следующая backend-волна |
| `CurrentOrgRole` DTO на фронте сужен (нет `demo_observer`) | `frontend/src/api/types/accounts.ts`, `frontend/src/domain/account.ts` | Следующая frontend-волна (точечный cast временно) |
| Probe-events для demo-Person'ов не фильтруются | `backend/src/modules/probe/probe-formulate.worker.ts` | Аудит per-user state (Фаза 4.6 ТЗ — отложено) |
| Privacy для members list / settings billing | `backend/src/modules/orgs/orgs.service.ts` | Аудит RBAC (Фаза 4.12 ТЗ — отложено) |
| Динамическое вычисление `--hero-h` CSS-var | sticky-смещение узкой полосы + Tabs | Опциональный полишинг |
| Auto-focus textarea при `open-ask` event | `OrgChatPanel` не экспонирует `autoFocus` | Расширение `OrgChatPanel` (минор) |

## Prod-операции

Полная инструкция — [`docs/operations/prod-deploy-log.md`](../../docs/operations/prod-deploy-log.md), блок «🌟 2026-06-01 — Shared demo Org».

Кратко по шагам:
1. **Шаг 4 (Prisma)** — авто-применяется через migrate-контейнер (`prisma db push --accept-data-loss`).
2. **Шаг 6 (Patch #1)** — `docker compose exec backend bun run scripts/patch-create-reference-demo-org.ts` → печатает `ZDEMO_ORG_ID=<cuid>`.
3. **Шаг 1 (ENV)** — записать `ZDEMO_ORG_ID=<cuid>` в `.env`, `docker compose up -d backend`.
4. **Шаг 6 (Patch #2)** — `docker compose exec backend bun run scripts/patch-migrate-old-demo-orgs.ts` (опц. `--dry-run` сначала).
5. **Шаг 12 (Smoke)** — проверить новый user → `accounts/me.currentOrgId === ZDEMO_ORG_ID`; POST к эталону → 403 demo_observer_readonly; `/admin/demo` показывает бейдж «🌟 Эталон».

## Связи

- ТЗ: [main-screen-umbrella.md](../../plans/tz/2026-06-01-main-screen-umbrella.md), [demo-shared-org-model.md](../../plans/tz/2026-06-01-demo-shared-org-model.md), [dashboard-main-tabs-restructure.md](../../plans/tz/2026-06-01-dashboard-main-tabs-restructure.md).
- Анализ: [demo-shared-org-architecture.md](../../plans/analysis/2026-06-01-demo-shared-org-architecture.md).
- Профильные заметки: [[../01_projects/demo-workspace]], [[../01_projects/onboarding-wizard]], [[../01_projects/frontend-pages]].
- Реестр: [docs/reference/dashboards-registry.md](../../docs/reference/dashboards-registry.md) §4.
- Prod-инструкция: [docs/operations/prod-deploy-log.md](../../docs/operations/prod-deploy-log.md).
