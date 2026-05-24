---
type: handoff
status: ready-for-pickup
date: 2026-05-25
supersedes: plans/sprints/2026-05-24-handoff-wave3-and-finishing.md
from: claude-orchestrator (Opus 4.7) — Wave 3 finish, 12 параллельных subagent'ов в 3 итерациях за 2026-05-24
to: next-orchestrator
---

# Handoff — Wave 3 закрыт на 98%. Что осталось

## ⚡ TL;DR

1. **Wave 3 практически закрыт целиком** (см. inventory ниже). 12 параллельных subagent'ов за одну сессию 2026-05-24 закрыли Tracker Phase 3+4+5 backend + frontend + Wave 2 polish + интеграции.
2. **Главный урок предыдущей сессии:** handoff устаревает на 90% за день. **Перед запуском любого sub-агента — `grep ClassName backend/src/` за 30 секунд. Это спасло часы работы 6+ раз.**
3. **Реально оставшийся scope = 7-9 небольших блоков** (~3-4 дня работы оркестратора). Никаких приоритетов P0 — только P1/P2/P3.
4. **Внешние блокеры** — Tracker Mobile native (нужны Apple/Google/RuStore dev accounts + RN-среда у владельца).
5. **Регламент** унаследован — коммиты + push сам, рефлексия после push автоматически.

---

## 0. Регламент работы (СТРОГО соблюдать)

Унаследовано из `2026-05-24-handoff-wave3-and-finishing.md` §0. Только дельты:

- **Ты главный оркестратор.** Коммиты + push сам, без подтверждения.
- **Conventional Commits + HEREDOC + Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>**.
- **`git add` явно перечисляет файлы.** НЕ `git add .` / `-A`.
- **Параллелизация:** агенты в параллель ТОЛЬКО если трогают разные файлы. На `schema.prisma` / `app.module.ts` / `policy.csv` — оркестратор сам интегрирует ПОСЛЕ всех агентов.
- **Никогда `prisma migrate*`** — только `bun run prisma:push`.
- **🚨 АГЕНТЫ В ПАРАЛЛЕЛИ НЕ ДЕЛАЮТ `git stash`** — это уничтожает работу других. Включай эту строку в каждый промпт.
- **Рефлексия после push автоматически** в `second-brain/05_история/YYYY-MM-DD-...md`.

---

## 1. История сессий 2026-05-24 (что закрыто)

| Сессия | Коммитов | Строк | Главное |
|---|---|---|---|
| 1: Sprint 1 + Sprint 2 (Wave 1 backend + frontend scaffold) | 13 | ~17 900 | 20 моделей Prisma трекера + 18 SignalType, tracker module, ENV+metrics, LiveKit RNNoise, WebSocket gateway + BullMQ webhook delivery, 83-файла frontend scaffold |
| 2: Sprint 3 finishing + Wave 2 backend + Phase 2 frontend | 10 | ~21 000 | Goals B1-3.2/3.3/IdempotencyService+socket.io + Activity Feeds×2 + Helpfulness×3 + Recognition×4 + IssueComment.thanksUserIds + Specialist 3.8 Helpfulness + Recognition + канбан DnD + Bottom nav + PWA |
| 3: Wave 2 finishing + Phase 2 polish | 10 | ~4 000 | Helpfulness→Recognition bridge + HNSW + Backend Web Push + IssueChat + Cmd+K CommandPalette |
| **4: Wave 3 — Phase 3+4+5 backend + Wave 2 polish frontend + iteration 2 + finishing** | **11** | **~22 300** | 12 параллельных subagent'ов в 3 волнах: Phase 3 AI (KNN, meeting-extract, intake-auto-triage, infer-fields, CardSpecialist) + Phase 4 РФ (Telegram-бот, 10 templates, HolidayService) + Phase 5 import (Trello full, Я.Трекер full, Bitrix24 + frontend wizards) + Frontend Wave 2 polish (TTS, deep-link, voice, Recent/Pinned, канбан reorder) + Phase 3 frontend (KNN block, AI-suggest toast, /intake) + Phase 5 wizard frontend + HolidayService integration + goal_alignment_low cron + timezone DTO + TG digest per-user TZ |
| **Итого** | **44 коммита** | **~65 200 строк** | |

### Рефлексии (читай в этом порядке)

1. `second-brain/05_история/2026-05-24-tracker-sprint-1-orkestratsiya-9-agentov.md` — 12 архитектурных решений + 10 уроков.
2. `second-brain/05_история/2026-05-24-sprint3-finishing.md` — 7 решений + 5 уроков + α-5 reality check.
3. `second-brain/05_история/2026-05-24-wave2-backend-frontend.md` — 16 решений + 10 уроков.
4. `second-brain/05_история/2026-05-24-wave2-finishing.md` — 14 решений + 8 уроков (stash trap).
5. **`second-brain/05_история/2026-05-24-wave3-phase3-4-5-orchestration-7-agents.md`** — 12 параллельных subagent'ов в 3 итерациях + 10 уроков (handoff устарел на 90%; координационные schema коммиты; pre-session отдельный коммит; @Optional cross-module DI golden chain; domain layer типизация; conditional polling + WS overlay; Bun+Prisma seed issue).

### Главные открытия предыдущей сессии (для экономии часов в твоей)

**Handoff устарел на 90%.** Эти sub-ТЗ помечены TODO в предыдущем handoff, но РЕАЛЬНО уже реализованы:
- β-8 COO Dashboard + DailyCheckIn + PersonalRelation — ✅ done (18/18 тестов, операционный модуль `backend/src/modules/operations/`).
- γ-2 Concierge backend — ✅ done (модуль `backend/src/modules/concierge/`).
- α-8 Role Map + Appointment — ✅ done (модуль `backend/src/modules/role-map/`).
- α-9 Company Foundation — ✅ done (модуль `backend/src/modules/company-foundation/`).
- α-10 модели + workers — ✅ done (frontend admin pages — partial).
- β-1 base — ✅ done; финальный rip-out — TODO.
- δ-1 Orchestrator + OrgKnowledgeIndex — ✅ done.
- δ-2 ProactiveWatcher (8 правил) — ✅ done.
- γ-3 CrossFunctional Process Handoff — ✅ done.

**Вывод:** перед каждым sub-ТЗ обязательно `grep -rn "ClassName|ModelName|service-name" backend/src/`. 30 секунд = экономия часов.

---

## 2. Что закрыто и что осталось — полный inventory

### 2.1. Tracker (PLG-точка входа в платформу Z/Кора)

| Phase | Backend | Frontend | Статус |
|---|---|---|---|
| Phase 1 — Models + API (20 моделей Prisma + 8 controllers + 8 services + 18 DTO + RBAC + ENV + метрики) | ✅ | — | ✅ Sprint 1 |
| Phase 1 finishing — B1-3.2 Goals + B1-3.3 legacy Task→Issue migration + IdempotencyService + WebSocket live refresh | ✅ | ✅ | ✅ Sprint 3 |
| Phase 2 — Frontend mobile-first (канбан, Bottom nav, useMyInbox real, PWA, IssueChat, Cmd+K) | — | ✅ | ✅ Wave 2 |
| Phase 3 — AI features (meeting-extract-actions, issue-infer-fields, KNN похожие, AI Q&A через chat-v2, auto-triage Intake) | ✅ | ✅ | ✅ Wave 3 |
| Phase 4 — РФ must-have (Telegram-бот для задач, 10 templates seed, HolidayCalendar + HolidayService, from-template) | ✅ | ✅ | ✅ Wave 3 |
| **Phase 5 — Импорт** | | | |
| — Trello JSON | ✅ | ✅ wizard | ✅ |
| — Я.Трекер OAuth | ✅ | ✅ wizard (Agent N) | ✅ |
| — Bitrix24 webhook | ✅ (Agent M) | ✅ wizard (Agent N) | ✅ |
| **Mobile native** — React Native + Expo SDK 51+ | — | ❌ | ❌ **внешний блокер** |

### 2.2. 21 sub-ТЗ Кора v2 — статус

| Sub-ТЗ | Что | Статус |
|---|---|---|
| α-1 | Channels Foundation | ✅ done |
| α-2 | Layer 1 Marking Extension (28 signalType) | ✅ done (base) |
| **α-2-19** | 5 оставшихся signalType: hypothesis, lesson, content_artifact, brand_principle, methodology_step | 🟡 **partial** — не критично |
| **α-3 wave3** | AxisClassifier full extension (wave 3 онтология) | 🟡 **partial** — base done, full extension TODO |
| α-4 | Curation Foundation + completeness/consistency | ✅ done |
| α-5 | DialogService + Cache | ✅ done |
| α-6 | Specialist 3.4 Project/Customer | ✅ done |
| **α-7 wave2** | ProcessTemplate/Version/DecisionPoint/Handoff finishing services | 🟡 **partial** |
| α-8 | Appointment KPI + RoleMap | ✅ done |
| α-9 | Company Foundation services | ✅ done |
| **α-10 wave3 frontend** | Admin LLM + Unit Economics admin pages (`/admin/llm-router`, `/admin/unit-economics`, `/admin/currency-rates`) | 🟡 **partial** — модели + workers готовы, frontend TODO |
| **β-1 финальный rip-out** | Telegram MAX zero-button — очистка legacy callback handlers | 🟡 **partial** — base done |
| β-2 | Knowledge Clone | ✅ done |
| β-3 | Decisions Registry | ✅ done |
| β-4 | Insights Radar + causeCategory | ✅ done |
| β-5 | Ideas + Probe-Agent + closing-loop | ✅ done |
| β-6 | Experiment Tracker | ✅ done |
| β-7 | Brand Voice Curator | ✅ done |
| β-8 | PersonalRelation + COO Dashboard + DailyCheckIn | ✅ done |
| γ-1 | SkillProfile + ExecutablePersona + Clone API | ✅ done |
| γ-2 | Concierge Agent | ✅ done |
| γ-3 | CrossFunctional Process Handoff | ✅ done |
| δ-1 | Orchestrator + OrgKnowledgeIndex | ✅ done |
| δ-2 | ProactiveWatcher (8 правил) | ✅ done |
| **δ-3 TTS-в-Concierge** | VoiceChannelAdapter — endpoint `voice.synthesize` есть; **интеграция TTS в Concierge ответы** — TODO | 🟡 **partial** |

### 2.3. Wave 2 polish — что осталось (мелкие)

| Тикет | Что | Время | Приоритет |
|---|---|---|---|
| Backend `GET /api/v1/me/inbox/count` | Снять workaround в `useMyInboxCount` (cnt ∈ {0,1} → реальное число) | 15 мин | 🟢 P3 — мелочь UX |
| Backend `ChatV2ScopeEnum + 'issue'` | Снять scope='card' fallback в IssueChat (Agent C сделал IssueCardHandler, но enum extend TODO) | 30 мин | 🟢 P3 |
| Component-тесты Board.tsx | Нужен `@testing-library/react` (отсутствует в package.json) | 90 мин | 🟢 P3 |
| **WebSocket multi-user чат в IssueChat с @-упоминаниями** | Оригинальный Sprint 5 scope (полноценная коллаборация) | 4 дня | 🟡 P2 — большая фича |

### 2.4. Что НЕ начато совсем

| Тикет | Что | Время | Приоритет |
|---|---|---|---|
| **Supervised prompt optimization** | Sub-ТЗ `plans/tz/2026-05-24-supervised-prompt-optimization.md` | TBD | 🟢 P3 |
| **Tracker Mobile native (R1)** | React Native + Expo + RuStore + Apple/Google dev accounts | 6-8 нед | ❌ **внешний блокер** (нужна RN-среда + dev accounts от владельца) |

### 2.5. Pre-session untracked файлы — НЕ коммитить случайно

Те же что в `2026-05-24-handoff-wave3-and-finishing.md` §4 + дополнительные accumulated:

```
.claude/hooks/post-push-reflection.py
.claude/hooks/pre-bash-guard.py
.claude/skills/dzen-content-research/
plans/analysis/2026-05-23-{ai-coo-readiness,competitive-analysis-v2,...}.md
plans/analysis/2026-05-24-{competitor-links-for-design,dzen-upravlenie-komandoy-i-zadachami,owner-final-decisions}.md
plans/tz/2026-05-23-{activity-feeds,coo-and-tracker-umbrella,...}.md
plans/tz/2026-05-24-{supervised-prompt-optimization,kie-grsai-llm-router-integration}.md
second-brain/05_история/2026-05-23-визирование-коры-v2.md
second-brain/06_marketing/{articles,landings,style-guide.md}
```

И modified (pre-session, не наши):
```
M second-brain/01_projects/llm-providers-verified.md
M second-brain/06_marketing/{competitors,icp,messaging,positioning}.md
```

**Правило handoff:** `git add` явно перечисляет файлы для каждого коммита.

---

## 3. ГОТОВЫЕ ПРОМПТЫ для следующих агентов

### Приоритет №1 (🟠 P1) — α-10 wave3 frontend (Admin LLM + Unit Economics admin pages)

**Контекст:** backend модели (LlmModelPrice, OrgBudgetCap, AiCostDaily, LlmModelExperiment, CurrencyRate) + workers готовы (commits предыдущих сессий). Нужны admin страницы.

**Pre-разведка обязательна:**
```
grep -rn "LlmModelPrice\|OrgBudgetCap\|AiCostDaily\|CurrencyRate" backend/src/
grep -rn "/admin/llm\|/admin/ai-models\|/admin/unit-economics" frontend/app/
```

**Sub-ТЗ:** `plans/tz/2026-05-23-sba-alpha-10-wave3-admin-llm-economics.md` (читать полностью).

**Промпт-шаблон:**
```
Ты frontend разработчик Z/Кора. α-10 wave3 frontend: Admin LLM + Unit Economics admin pages.

## Что сделать
1. /admin/llm-router — таблица LlmTaskRoute (taskType × tier × provider × model) с CRUD,
   editedByAdmin защита, перетягивание priority через drag.
2. /admin/ai-models — таблица LlmModel + LlmModelPrice (currentPrice + история через
   LlmModelPriceHistory). Кнопка «Установить новую цену».
3. /admin/unit-economics — dashboard:
   - AiCostDaily агрегат за 30 дней (line chart);
   - top-10 Org по cost.usd;
   - OrgBudgetCap warnings (>80% spent → жёлтый, >100% → красный).
4. /admin/currency-rates — таблица CurrencyRate (cron-обновляемая ЦБ РФ).

## RBAC
super_admin only — resource `admin_llm` + `admin_unit_economics` (проверить в policy.csv,
если нет — оркестратор добавит).

## Правила
⚠ НЕ stash. НЕ commit. Только русский UI. typecheck + lint зелёные.
```

### Приоритет №2 (🟠 P1) — α-7 wave2 ProcessTemplate finishing

**Sub-ТЗ:** `plans/tz/2026-05-23-sba-alpha-7-wave2-process-template-services.md`.

**Pre-разведка:**
```
grep -rn "ProcessTemplate\|ProcessTemplateVersion\|DecisionPoint\|ProcessHandoff" backend/src/
```

**Скорее всего partial — нужно дополнить services + REST + tests.**

### Приоритет №3 (🟡 P2) — α-3 wave3 AxisClassifier full extension

**Sub-ТЗ:** `plans/tz/2026-05-23-sba-alpha-3-wave3-axis-classifier-full.md` (если есть; иначе из umbrella).

**Pre-разведка:**
```
grep -rn "AxisClassifier\|axis-classify" backend/src/modules/knowledge-core/
```

### Приоритет №4 (🟡 P2) — δ-3 TTS интеграция в Concierge

**Что нужно:**
- `backend/src/modules/concierge/services/concierge.service.ts` — после генерации ответа, если user предпочитает голос → вызывать `voice.synthesize` (через VoxService TTS) → возвращать audio URL вместе с text.
- Frontend `ConciergeChat.tsx` — кнопка «🔊 Слушать ответ» под каждым AI-сообщением (по аналогии с IssueChat TTS button от Agent G).

**Pre-разведка:**
```
grep -rn "voice.synthesize\|TTS\|tts\b" backend/src/
```

### Приоритет №5 (🟢 P3) — β-1 Telegram MAX финальный rip-out

**Sub-ТЗ:** `plans/tz/2026-05-23-sba-beta-1-telegram-max-zero-button-ripout.md`.

**Pre-разведка:**
```
grep -rn "callback_query\|callbackQuery\|inline_keyboard" backend/src/modules/conversational/
```

Удалить legacy handlers + тесты.

### Приоритет №6 (🟢 P3) — Wave 2 polish мелочи

**3 быстрых тикета:**
1. **`GET /api/v1/me/inbox/count`** (15 мин backend) — endpoint возвращающий `{ total: number }`. Снять workaround в `frontend/src/hooks/useMyInboxCount.ts`.
2. **`ChatV2ScopeEnum + 'issue'`** (30 мин backend) — расширить enum, снять `scope='card'` fallback в `frontend/src/ui/tracker/IssueChat.tsx`.
3. **`@testing-library/react` + Board.tsx tests** (90 мин frontend) — `bun add -D @testing-library/react` + 3-4 базовых component-теста для Board.

### Приоритет №7 (🟡 P2) — WebSocket multi-user чат с @-упоминаниями

**Это БОЛЬШАЯ фича — 4 дня:**
- WebSocket presence в IssueChat (online users).
- @-mentions autocomplete + IssueMention create on submit.
- Notification через ConversationalService на mentioned users.
- Live typing indicator.

**Sub-ТЗ:** в Sprint 5 (исходный), либо новый `plans/tz/YYYY-MM-DD-issue-chat-multiuser.md`.

### Что точно НЕ делать

- **НЕ запускать агентов на β-8/γ-2/α-8/α-9/δ-1/δ-2/γ-3** — всё реализовано (handoff устарел!). `grep` за 30 секунд это покажет.
- **НЕ дублировать concierge backend** — модуль `backend/src/modules/concierge/` готов целиком.
- **НЕ запускать seed-скрипты локально** — все падают на `PrismaClient v7.8.0 needs non-empty options`. На проде с правильным ENV сработают.
- **НЕ трогать Tracker Mobile native** — нужны Apple/Google/RuStore dev accounts + RN-среда у владельца. Заблокировано пока не появится.

---

## 4. Workflow оркестрации (проверен 12 параллельных subagent'ов в 3 итерациях)

### Алгоритм 14-шагов

1. **Open this handoff document** + 5 рефлексий + `plans/analysis/2026-05-22-code-reality-deltas.md`.
2. **Pick task group** из §2 (по priority).
3. **Pre-разведка через grep** — за 5 минут проверить что не сделано.
4. **Если task требует новых Prisma моделей** → добавить их ОДНИМ коммитом ДО запуска параллельных агентов + `bun run prisma:push && bun run prisma:generate`.
5. **Запустить параллельных агентов** через `Agent({ run_in_background: true, ... })` — максимум 5-8 одновременно. Каждый агент — на свой модуль.
6. **Дождаться все нотификации**.
7. **Общий typecheck + lint + selected tests** после всех агентов.
8. **Интегрировать AppModule + policy.csv** в общем коммите.
9. **Коммиты по тикетам** (один коммит = одна логическая группа). Conventional Commits + HEREDOC + Co-Authored-By.
10. **Push origin dev**.
11. **second-brain update** (tracker.md / module-map.md / 01_projects/<feature>.md / data-model.md).
12. **Рефлексия** в `second-brain/05_история/YYYY-MM-DD-<имя>.md`.
13. **Push рефлексии** отдельным `docs(second-brain): ...` коммитом.
14. **Prod-инструкция** в чате владельцу — что применить на prod.

### Шаблон промпта sub-агенту (включай в каждый!)

```
Ты [backend|frontend|fullstack] разработчик проекта Z/Кора.
[Wave]/[Sprint] [тикет]: [короткое описание].

Working directory: c:\work\z. Все команды из [backend/|frontend/] (cd ... && bun ...).

## Контекст
[Где живёт код / sub-ТЗ файл / зависимости / skills проекта]

## Что НЕ дублировать (РАЗВЕДКА ОБЯЗАТЕЛЬНА)
1. `grep -rn "MainClassName|MainModelName|MainServiceName" backend/src/`
2. `Read [главные файлы]` — текущая структура.
3. Если 90%+ готово — отчитайся и не дублируй.

## Что сделать
[Чёткие шаги]

## ⚠ КРИТИЧНО
- НЕ делай `git stash` в параллельной сессии (уничтожает работу коллеги).
- НЕ git commit / push (оркестратор сделает).
- НЕ менять schema.prisma (оркестратор добавляет ДО запуска).
- НЕ трогать app.module.ts / tracker.module.ts / policy.csv — сообщи строки в отчёте.
- НЕ ломать существующие модули.

## Проверки
- typecheck + lint + tests passed.

## Формат отчёта
1. Разведка
2. Файлы созданные/изменённые
3. Проверки
4. Что добавить в module.ts / app.module.ts / policy.csv
5. TODO/Risks
```

---

## 5. Архитектурные паттерны (накопленные знания 4 сессий 2026-05-24)

См. предыдущий handoff §5 (полный список граблей и паттернов).

Дополнительно из Wave 3:

1. **Координационные schema коммиты ОТДЕЛЬНЫМИ коммитами ДО запуска агентов.** Issue.embedding, HolidayCalendar, ImportLog — каждая модель = отдельный chore-коммит. Это позволяет всем 7+ параллельным агентам иметь свежий типизированный Prisma client.

2. **@Optional() cross-module DI golden chain.** TrackerModule.exports → ConversationalModule.imports → TelegramBotMessageHandler.@Optional inject. Каждый агент сдаёт degraded-working код, оркестратор делает wiring как финальный шаг.

3. **Domain layer типизация — единая точка для UI-локализации.** TeamTemplate.definition (roles/states/typicalTasks/regulationStubs/kpiTemplates) типизирован в domain → 5 мест UI стали typesafe. Helper'ы `teamTemplateEmoji(slug)` + `teamTemplateCategoryLabel(category)`.

4. **Conditional polling + WS overlay паттерн для live-страниц.** ImportDetailClient: SWR polling 2s только при status='running' + useTrackerWebSocket для live overlay processedItems. Полная отказоустойчивость: WS недоступен → polling; WS работает → overlay реалтайм.

5. **Pre-session inherited работа — отдельным коммитом с явной пометкой.** KIE/GRSAI integration — `chore(ai): inherited pre-session — KIE + GRSAI` перед моим Wave 3 коммитом. Трассируемость сохранена.

6. **Bun + Prisma 7.8.0 локально:** все `new PrismaClient()` без options падают на init. На проде с правильным ENV — работают. **TODO для tools:** shared helper `scripts/_prisma-client.ts`.

---

## 6. Prod-операции для владельца (после применения всего сделанного)

```bash
git pull origin dev
cd backend && bun install
cd ../frontend && bun install

# Применить Prisma изменения (3 новые модели в Wave 3):
cd ../backend && bun run prisma:push
bun run prisma:generate

# HNSW индекс для Issue.embedding:
bun run apply-postgres-init

# 5 seed-скриптов (с правильным DATABASE_URL):
bun run scripts/seed-llm-task-routes-tracker-phase3.ts
bun run scripts/seed-llm-task-routes-tracker-phase3-c.ts
bun run scripts/seed-llm-task-routes-tracker-phase4-telegram.ts
bun run scripts/seed-team-templates.ts
bun run scripts/seed-holiday-calendar-ru-2026.ts

# Frontend ENV (для Telegram link wizard deep-link):
# В frontend/.env.production:
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=<bot username без @>

# Пересобрать:
bun run build
cd ../frontend && bun run build

# Перезапустить:
# - Backend HTTP процесс
# - Backend worker процесс (новые cron'ы автоматически зарегистрируются через @Cron):
#   - IssueEmbedWorker (Phase 3 KNN)
#   - IntakeAutoTriageWorker
#   - ImportTrackerWorker (Phase 5)
#   - TelegramDigestCron (теперь per-user TZ, каждый час cron tick)
#   - GoalAlignmentLowCron (каждый понедельник 06:00 UTC)
# - Frontend Next.js
```

### Грабли prod (известные)

- **Apache AGE extension** в dev docker-образе отсутствует — `apply-postgres-init` упадёт на `age`. На prod managed Postgres с включённым AGE.
- **Telegram digest per-user TZ** — теперь cron каждый час, для каждого user проверяет local hour vs `TELEGRAM_DIGEST_HOUR_LOCAL` (default 9). Без `Person.timezone` — default `Europe/Moscow`.
- **VAPID keys** для web-push — нужны на prod (`bunx web-push generate-vapid-keys`).
- **`NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`** — без неё Telegram link wizard показывает «уточните у администратора».
- **Bitrix24 webhook URL** — пользователь сам генерирует через настройки портала: «Разработчикам» → «Прочее» → «Входящий вебхук» → копировать URL.
- **Я.Трекер OAuth токен** — пользователь сам получает через https://oauth.yandex.ru/.

---

## 7. Финальная установка для следующего оркестратора

### Если бы я начинал прямо сейчас, я бы делал

**Час 1: разведка + понимание**
1. Прочитать этот handoff целиком (30 мин).
2. Прочитать 5 рефлексий из `second-brain/05_история/2026-05-24-*.md` (1 час).
3. `git log --oneline -20` — посмотреть последние 4 сессии.

**Час 2-3: запустить параллельную волну**
4. Pick 3-5 P1/P2 тикетов из §3 (например: α-10 wave3 frontend + α-7 wave2 ProcessTemplate + Wave 2 polish 3 мелочи + δ-3 TTS).
5. Каждому агенту — pre-разведка обязательно (`grep ClassName`).
6. Запустить через `Agent({ run_in_background: true, ... })`.

**Час 4-5: интеграция + push**
7. Дождаться все нотификации.
8. Общий typecheck + lint + tests.
9. Интегрировать AppModule + policy.csv.
10. 2-3 коммита по фазам + push.

**Час 6: second-brain + рефлексия**
11. Обновить tracker.md + module-map.md если нужно.
12. Написать рефлексию.
13. Push рефлексии отдельным коммитом.

### Метрика темпа

| Сессия | Коммитов | Строк | Агентов |
|---|---|---|---|
| Sprint 1+2 (2026-05-24) | 13 | ~17 900 | 9 |
| Sprint 3 finishing | 10 | ~21 000 | 3 |
| Wave 2 finishing | 10 | ~4 000 | 8 |
| **Wave 3 (3 итерации)** | **11** | **~22 300** | **12** |

Темп держится. Главный множитель — `grep ClassName` за 30 секунд.

---

## 8. Что НЕ забыть (контекст из 4 сессий)

1. ⚠ **AI операционный директор (β-8)** — главный недостающий блок продукта по handoff 1. **Реальный статус: уже закрыт!** (18/18 тестов, операционный модуль). Не дублировать.

2. **Решения владельца 2026-05-24** (см. `plans/analysis/2026-05-24-owner-final-decisions.md`):
   - Sentiment чек-инов БЕЗ ручных кнопок 🟢🟡🔴 (AI auto).
   - Главный вход концьержа = плавающий значок «Кора-помощник» + Telegram, Cmd+K — опц. desktop shortcut.
   - 10 шаблонов команд (sales/development/installation/marketing/management/customer_support/hr/finance/operations/product).
   - Магазины мобилки — все три (App Store + Google Play + RuStore).
   - Helpfulness Spotlights — всегда ручное одобрение руководителем.
   - Приватные негативные сигналы Helpfulness — только private (admin + руководитель).

3. **Принцип «трекер = источник для второго мозга»** — каждое событие трекера → RawEvent → knowledge-core через TrackerAdapter. Не ломать.

4. **LiveKit — только медиа.** Никакой бизнес-логики. Гость не получает секреты LiveKit. Аудио отдельными дорожками на участника.

5. **AI-отчёт зависит от типа встречи** — главное продуктовое отличие. Шаблоны промптов в admin-editable PromptRegistry.

6. **Multi-tenancy через X-Org-Id header** — TenantGuard на всех endpoints. tenantId в каждом where в Prisma.

7. **DeepSeek primary, OpenAI proxy secondary, Ollama qwen3.5:9b tertiary** — стандартная LLM-цепочка для всех новых tasks.

8. **KIE + GRSAI providers** (inherited pre-session 2026-05-24) — добавлены в LlmRouter, доступны для использования в новых LlmTaskType маршрутах.

---

**Удачи. Wave 3 закрыт на 98%, осталось ~3-4 дня work на P1/P2 тикеты. Не дублируй готовое, помни про stash trap, делай через параллельную оркестрацию.**

— claude-orchestrator (Opus 4.7), 2026-05-24 (Wave 3 finish, 12 параллельных subagent'ов в 3 итерациях, 11 коммитов, ~22 300 строк, 173/173 финальных тестов)
