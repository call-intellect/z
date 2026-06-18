---
type: handoff
status: ready-for-pickup
date: 2026-05-25
supersedes: plans/archive/2026-05-25-handoff-after-wave3-complete.md
from: claude-orchestrator (Opus 4.7) — ревизия plans/tz/ vs реальный код 2026-05-24 (8 параллельных агентов на 64 ТЗ)
to: next-orchestrator
scope: финальное закрытие всего недоделанного scope Z/Кора, кроме Tracker Mobile native (внешний блокер)
---

# Handoff — финальная закрывашка. 9 тикетов, ~2-3 недели работы.

## ⚡ TL;DR

1. **Старый handoff `2026-05-25-handoff-after-wave3-complete.md` устарел на 4/7 тикетов.** Ревизия 2026-05-24 показала: α-10 wave3 frontend, α-7 wave2 ProcessTemplate, α-3 wave3 AxisClassifier full, β-1 Telegram MAX rip-out — **все done**. См. блок «Ревизия от 2026-05-24» в каждом ТЗ в `plans/archive/`.
2. **57 закрытых ТЗ переехали в `plans/archive/`** — теперь `plans/tz/` содержит только реально открытое (7 проверенных + 6 служебных непроверенных + final-roadmap umbrella).
3. **Этот handoff = полный пакет на закрытие всего** (9 тикетов). Без минимизации.
4. **Внешний блокер один:** Tracker Mobile native — нужны Apple/Google/RuStore dev accounts + RN/Expo среда у владельца.
5. **Регламент** унаследован — коммиты + push сам, рефлексия после push автоматически.

---

## 0. Регламент работы (СТРОГО)

Унаследовано из `2026-05-24-handoff-wave3-and-finishing.md` §0. Дельты:

- **Ты главный оркестратор.** Коммиты + push сам, без подтверждения владельца.
- **Conventional Commits + HEREDOC + `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`**.
- **`git add` явно перечисляет файлы.** НЕ `git add .` / `-A`.
- **Параллельные агенты:** только если трогают РАЗНЫЕ файлы. На `schema.prisma` / `app.module.ts` / `policy.csv` / `tracker.module.ts` / `concierge.module.ts` — оркестратор сам интегрирует ПОСЛЕ всех агентов.
- **Никогда `prisma migrate*`** — только `bun run prisma:push`.
- **🚨 АГЕНТЫ В ПАРАЛЛЕЛИ НЕ ДЕЛАЮТ `git stash`** — это уничтожает работу других. Включай в каждый промпт.
- **Pre-разведка обязательна.** За 30 секунд через `run_pipeline({task: "проверь реализацию X"})` — спасает часы. Главный урок 4 предыдущих сессий.
- **vexp `run_pipeline` вместо Grep/Glob** — Grep блокируется hook'ом.
- **Рефлексия после push автоматически** в `second-brain/05_история/YYYY-MM-DD-...md`.
- **Каждое изменение схемы → обновить `second-brain/02_architecture/data-model.md`.** Каждый новый модуль → `module-map.md`. Каждая фича → `01_projects/<feature>.md`.

---

## 1. Inventory (актуальный — после ревизии 2026-05-24)

### 1.1. Открытые тикеты — это весь оставшийся scope

| # | Тикет | ТЗ | Что нужно | Время | Приоритет |
|---|---|---|---|---|---|
| **1** | **Gamification frontend** | `plans/archive/2026-05-23-gamification-and-motivation.md` | 5 страниц + 3 виджета + api-client. Backend готов (4 модели + 4 cron + RecognitionFormulateWorker + bridges). | 3 дня | 🟢 P0 |
| **2** | **Helpfulness frontend** | `plans/tz/2026-05-23-specialist-3-8-helpfulness-agent.md` | 3 страницы + 3 виджета + api-client. Backend готов (3 модели + worker + 3 cron + 4 probe-trigger + 2 controller + HNSW + bridge с Recognition). | 3 дня | 🟢 P0 |
| **3** | **kie-grsai LLM Router** | `plans/archive/2026-05-24-kie-grsai-llm-router-integration.md` | seed-провайдеры в БД + цены `gemini-3-flash` / `gpt-5-4` + unit-тесты + smoke. Основа KieService+GrsaiService+enum+dispatch готова. | 1 день | 🟠 P1 |
| **4** | **δ-3 WebSocket-стриминг голосового ВВОДА** | `plans/archive/2026-05-23-sba-delta-3-voice-channel-adapter.md` | WebSocket-gateway для real-time стриминга микрофона → ASR (вместо file-upload). Сокращает задержку с 15 сек до 1-2 сек. **Голосовой вывод не делаем — Concierge отвечает только текстом.** | 1.5-2 дня | 🟠 P1 |
| **5** | **Tracker email-to-task IMAP** | `plans/tz/2026-05-23-tracker-phase-4-rf-musthave.md` | Mail-inbound через IMAP (уникальный `project-<id>@inbox.kora.app`) → создание Issue. Остальное Phase 4 готово (TG-бот, голос, digest, 10 templates, HolidayService). | 2 дня | 🟠 P1 |
| **6** | **Wave 2 polish (3 микро)** | inline | `GET /me/inbox/count` + `ChatV2ScopeEnum + 'issue'` + `@testing-library/react` + 4 базовых теста Board.tsx. | 0.5 дня | 🟠 P1 |
| **7** | **prompts-hardening** | `plans/tz/2026-05-24-prompts-hardening.md` | 16 фич (F1-F16) в 3 фазах. F1 injection-guard и F2 confidence-calibration — security/качество критично. | 13-16 дней (3 фазы) | 🟡 P2 |
| **8** | **WebSocket multi-user чат** | новый ТЗ нужен | Real-time presence + @-упоминания + IssueMention + Notification + typing indicator в IssueChat. | 4 дня | 🟡 P2 |
| **9** | **Supervised Prompt Optimization (SPO)** | `plans/tz/2026-05-24-supervised-prompt-optimization.md` | Чистый старт. Сначала прочитать ТЗ → уточнить scope с владельцем → реализовать. | 5-7 дней | ⚪ P3 |
| **—** | ❌ Tracker Mobile native | `plans/tz/2026-05-23-tracker-mobile-native.md` | RN+Expo+RuStore+App Store+Google Play. **Внешний блокер.** | 6-8 нед | блок |

### 1.2. Итого по объёму

- **P0 (быстрые победы — frontend для готового backend):** 6 дней.
- **P1 (доделки бизнес-логики):** 6-7 дней.
- **P2 (большие фичи):** ~17-20 дней.
- **P3 (после владельческого решения):** 5-7 дней.

**Итого ~5 недель последовательно** или **~2-3 недели при правильной параллелизации** (P0+P1 параллельно, P2 потом).

### 1.3. Что **НЕ** делать (handoff устарел!)

Не запускай агентов на этих — они уже сделаны, ревизия подтвердила в коде:
- α-10 wave3 frontend (Admin LLM + Unit Economics) — 6 admin страниц готовы.
- α-7 wave2 ProcessTemplate finishing — 4 сервиса + worker + cron + 3 probe-trigger + REST + UI `/processes`.
- α-3 wave3 AxisClassifier full — AxisClassifierService + IdeaBlockAxisLabel + LLM-fallback + ENV-флаги.
- β-1 Telegram MAX rip-out — command-handler удалён, adapters переписаны.
- α-2-19 signal types — все 19 в `enum SignalType` (schema.prisma:265-283).
- β-8 COO + DailyCheckIn + PersonalRelation — операционный модуль `backend/src/modules/operations/` (18/18 тестов).
- γ-2 Concierge backend — модуль `backend/src/modules/concierge/`.
- δ-1 Orchestrator + δ-2 ProactiveWatcher + γ-3 CrossFunctional — все done.

**Проверка перед каждым стартом:** `run_pipeline({task: "проверь реализацию X в backend"})`. 30 секунд → экономия часов.

---

## 2. Готовые промпты для агентов

Все промпты — копи-паст-готовы. Замени `{{...}}` плейсхолдеры по факту перед запуском.

### Промпт-шаблон-обёртка (включай в каждый!)

```
Ты {{backend|frontend|fullstack}} разработчик проекта Z/Кора (платформа памяти компании).

Working directory: c:\work\z. Стек: NestJS backend (`backend/`) + Next.js 14 App Router (`frontend/`) + Prisma (`backend/prisma/schema.prisma`) + LiveKit + Redis + BullMQ + Postgres+pgvector.

Команды: `cd backend && bun run dev` / `bun run typecheck` / `bun run lint` / `bun run test:unit`. Frontend: `cd frontend && bun run dev` / `typecheck` / `lint`.

## Контекст
{{...sub-ТЗ файл / зависимости / связанные модули...}}

## Skills проекта (применяй автоматом)
- `frontend-rules` (ApiDto → DomainModel → UiModel; единый apiClient).
- `nestjs-rules` (DTO-цепочки, Swagger, FiltersDto, транзакции через Prisma).
- `prisma-db-push-rules` (только `bun run prisma:push`, никогда migrate).
- `domain-business-context` (бизнес-смысл проверять, naming/контракты под него).

## РАЗВЕДКА ОБЯЗАТЕЛЬНА (Грабли 4 предыдущих сессий)
Перед написанием кода вызови `run_pipeline({task: "проверь реализацию {{ключевая сущность}} в backend/frontend"})`.
Если 90%+ уже готово — отчитайся «реализовано, не дублирую» и выходи.
НЕ используй Grep/Glob — заблокированы hook'ом. Используй `run_pipeline` + `get_skeleton`.

## Что сделать
{{...чёткие шаги...}}

## DoD
{{...чек-лист готовности...}}

## ⚠ КРИТИЧНО — иначе уничтожишь работу
- НЕ `git stash` в параллельной сессии (затрёт изменения других агентов).
- НЕ `git commit` / `git push` — оркестратор сделает.
- НЕ меняй `schema.prisma` — оркестратор добавил/добавит ДО запуска.
- НЕ трогай `app.module.ts` / `tracker.module.ts` / `concierge.module.ts` / `policy.csv` — сообщи в отчёте, ЧТО туда добавить (полные строки imports + providers).
- НЕ ломай существующие модули. Покрыто типизацией Prisma client — проверяй `bun run typecheck` после правок.
- Русский UI везде. Английские слова — только в скобках при первом упоминании.

## Формат отчёта (в конце)
1. Разведка — что нашёл готового / какие конфликты.
2. Файлы созданные / изменённые (с путями).
3. Проверки — `bun run typecheck` / `lint` / `test:unit` (зелёные?).
4. Что добавить в module.ts / app.module.ts / policy.csv (точные строки).
5. TODO / Risks для оркестратора.
```

---

### Тикет 1: Gamification frontend (P0, 3 дня)

```
Ты frontend разработчик Z/Кора. Тикет: Gamification frontend.

## Контекст
- Sub-ТЗ: `plans/archive/2026-05-23-gamification-and-motivation.md` — прочитай целиком, особенно §«Что делаем» и §«Pages + виджеты».
- Backend готов: модели `Recognition`, `RecognitionThanks`, `CheckinStreak`, `IdeaContributionStat` в `backend/prisma/schema.prisma`. Сервисы и cron'ы в `backend/src/modules/recognition/` и `backend/src/modules/gamification/`. RecognitionFormulateWorker уже шлёт уведомления через ActivityFeedService.publish.
- Соседи: Activity Feeds frontend готов в `frontend/app/(authenticated)/feed/*`. AppShell — `frontend/src/ui/components/app-shell/AppShell.tsx`. Sidebar — там же `Sidebar.tsx`.

## Разведка
1. `run_pipeline({task: "проверь existing gamification и recognition страницы и компоненты frontend"})`.
2. Если страницы есть — не дублируй, дополни.

## Что сделать

### REST контракты (backend уже есть — проверь Swagger /api/docs)
- `GET /api/v1/me/contributions` — мои recognition + thanks + streaks + ideas-in-work.
- `GET /api/v1/persons/:id/contributions` — то же для другого участника (с RBAC).
- `GET /api/v1/orgs/:orgId/recognition/team-spotlight` — спотлайт недели (top 3-5 по recognition, без рейтинга «лучший/худший»).
- `POST /api/v1/me/recognition-optout` — отказ публично показывать contributions.

Если каких-то нет — отчитайся, оркестратор добавит в backend.

### Frontend слои (по `frontend-rules`)
1. **API-слой:** `frontend/src/api/gamification.api.ts` через единый `api-client`. ApiDto типы.
2. **Domain-слой:** `frontend/src/domain/contribution.ts` — мапперы ApiDto → DomainModel.
3. **UI-слой:**
   - **Страница `/me/contributions`** (`frontend/app/(authenticated)/me/contributions/page.tsx`):
     - Блок «Идеи в работе» (карточки с переходом на Idea).
     - Блок «Полученные спасибо за неделю/месяц/всё время» (счётчик + ленточная история, без топа).
     - Блок «Стрик чек-инов» (текущий + best, без штрафов).
     - Блок «Благодарности от AI-агента» (последние Recognition).
     - Кнопка «Скрыть мои contributions для команды» (POST recognition-optout).
   - **Страница `/persons/[id]/contributions`** — то же что `/me/contributions` но read-only, с RBAC-проверкой (`canViewPersonContributions`).
4. **Виджеты для встраивания:**
   - `frontend/src/ui/components/gamification/TeamSpotlightWidget.tsx` — недельный спотлайт (для Sidebar или Operations Dashboard).
   - `frontend/src/ui/components/gamification/MyContributionsWidget.tsx` — мини-блок в `/me` (sidebar) с 3 цифрами: идеи-в-работе / спасибо / стрик.
   - `frontend/src/ui/components/gamification/RecognitionFeedWidget.tsx` — последние 5 Recognition (для главной страницы / Activity Feeds).
5. **Подключения:**
   - В `AppShell.tsx` Sidebar — добавь раздел «Мой вклад» → `/me/contributions`.
   - В `Operations Dashboard` (если уместно) — `TeamSpotlightWidget`.
   - В `feed/spotlights/page.tsx` — `RecognitionFeedWidget`.

### Тон UI
- Мягкое позитивное признание. Никаких рейтингов «топ-1». Никаких очков как валюты. Никакого позора за неактивность.
- Цитаты из ТЗ §«Что НЕ делаем (anti-patterns)» — учти при копирайтинге.

## DoD
- [ ] Страницы `/me/contributions` и `/persons/[id]/contributions` рендерятся, данные с backend.
- [ ] 3 виджета встроены: Sidebar (Мой вклад), Operations Dashboard (Team Spotlight), Feed Spotlights.
- [ ] Опт-аут через UI работает (POST + UI отключает публичные виджеты).
- [ ] Русский UI везде, английские слова только в скобках.
- [ ] `bun run typecheck` + `lint` зелёные.
- [ ] Минимум 1 component-тест на странице (vitest).
- [ ] Скриншоты (если возможно через `playwright_browser_snapshot`).
```

---

### Тикет 2: Helpfulness frontend (P0, 3 дня)

```
Ты frontend разработчик Z/Кора. Тикет: Helpfulness frontend (Specialist 3.8).

## Контекст
- Sub-ТЗ: `plans/tz/2026-05-23-specialist-3-8-helpfulness-agent.md` — прочитай целиком, особенно §«Pages + Widgets» и §«Этика приватности» (приватные негативные сигналы только админу).
- Backend готов: модули `backend/src/modules/specialist-3-8-helpfulness/` (или `helpfulness/`) + `backend/src/modules/recognition/`. Модели `HelpfulnessTrait`, `HelpfulnessSpotlight`, `HelpfulnessSocialProfile` в schema. Workers: `specialist-3-8-helpfulness.worker.ts`, `helpfulness-spotlight.cron.ts`. HNSW индекс для embeddings.
- Bridge с Recognition: `RecognitionFormulateWorker` уже получает данные от Helpfulness.

## Разведка
1. `run_pipeline({task: "проверь helpfulness frontend pages и helpfulness api в frontend"})`.
2. Backend контроллеры: `helpfulness.controller.ts` + `helpfulness-admin.controller.ts` — посмотри Swagger, какие endpoints отдают что.

## Что сделать

### Frontend слои
1. **API-слой:** `frontend/src/api/helpfulness.api.ts`.
2. **Domain-слой:** `frontend/src/domain/helpfulness.ts` — типы для SocialProfile / Spotlight / Trait.
3. **UI-слой:**
   - **Страница `/me/social-contribution`** (`frontend/app/(authenticated)/me/social-contribution/page.tsx`):
     - Мой social profile: какие traits видит AI (help_provided / proactive_hint / mentoring / emotional_support / constructive_feedback) — счётчики за неделю/месяц/всё время.
     - Последние 10 traits с цитатами-evidence (из чек-инов / чата задач / транскрипта встречи).
     - Кнопка «Не показывать публично» (опт-аут).
   - **Страница `/persons/[id]/social-contribution`** — read-only, с RBAC.
   - **Страница `/admin/helpfulness-overview`** (`frontend/app/(admin)/admin/helpfulness-overview/page.tsx`):
     - Только для HR / руководителей с правом `helpfulness_admin`.
     - Сводка по команде: кто помогает кому (граф) + question_unanswered / question_acknowledged_no_action.
     - **Приватные негативные сигналы видны ТОЛЬКО здесь** — никаких лидербордов «худшие».
4. **Виджеты:**
   - `TopHelpfulWidget.tsx` — недельный (top 3-5 по received thanks, по аналогии с TeamSpotlightWidget из gamification).
   - `SpotlightsTodayWidget.tsx` — что сегодня одобрил руководитель в публичный спотлайт.
   - `HelpRequestsWidget.tsx` — открытые question_unanswered (только админ).
5. **Подключения:**
   - Sidebar — «Мой вклад в команду» → `/me/social-contribution`.
   - Operations Dashboard — `TopHelpfulWidget`.
   - Activity Feed `/feed/spotlights` — `SpotlightsTodayWidget`.
   - Admin layout — ссылка `/admin/helpfulness-overview`.

### Особо — этика и приватность (из ТЗ §«ВАЖНО (этика)»)
- 5 позитивных типов (help_provided, proactive_hint, mentoring, emotional_support, constructive_feedback) — публично.
- 2 негативных (question_unanswered, question_acknowledged_no_action) — ТОЛЬКО `/admin/helpfulness-overview`.
- На `/me/social-contribution` — пользователь видит свой ПОЗИТИВ + предупреждение «руководитель видит дополнительные сигналы».
- Спотлайты в публичную ленту — только после ручного одобрения руководителем (UI кнопка «Одобрить в спотлайт» в `/admin/helpfulness-overview` — backend endpoint уже есть).

## DoD
- [ ] 3 страницы рендерятся, данные с backend.
- [ ] 3 виджета подключены.
- [ ] Опт-аут работает, скрывает публичный показ.
- [ ] Админ-страница недоступна без `helpfulness_admin` (проверка через `EntitlementContext`/RBAC).
- [ ] Русский UI, без английских слов вне скобок.
- [ ] `bun run typecheck` + `lint` зелёные.
- [ ] 1 component-тест.
```

---

### Тикет 3: kie-grsai LLM Router — доделки (P1, 1 день)

```
Ты backend разработчик Z/Кора. Тикет: kie-grsai LLM Router — доделки.

## Контекст
- Sub-ТЗ: `plans/archive/2026-05-24-kie-grsai-llm-router-integration.md`.
- Уже готово: `KieService`, `GrsaiService`, enum/capability/dispatch в `backend/src/modules/ai/services/llm-router.service.ts`. Адаптеры провайдеров в `backend/src/modules/ai/services/providers/`.
- Не готово (по ревизии 2026-05-24): unit-тесты, seed провайдеров/моделей в БД, цены `gemini-3-flash` / `gpt-5-4`, A/B seed + smoke-тест.

## Разведка
1. `run_pipeline({task: "проверь KieService и GrsaiService реализацию и где они подключены в LlmRouter"})`.
2. Прочитай `backend/scripts/seed-llm-task-routes-default.ts` и `backend/scripts/seed-llm-providers.ts` (если есть) — шаблон для своих seed.
3. Прочитай `backend/src/modules/ai/services/llm-router.service.ts` — фактическая логика dispatch.

## Что сделать

### 1. Seed: провайдеры + модели в БД
Создай `backend/scripts/seed-llm-providers-kie-grsai.ts`:
- `LlmProvider`: `kie` и `grsai` (id, name, baseUrl, requiresApiKey: true).
- `LlmModel` для каждого: `gemini-3-flash` (kie), `gpt-5-4` (grsai), плюс остальные согласно ТЗ.
- Идемпотентный upsert.

### 2. Seed: цены в `LlmModelPrice`
Создай `backend/scripts/seed-llm-prices-kie-grsai.ts`:
- Для каждой модели — `inputPricePer1MTokens`, `outputPricePer1MTokens` в USD согласно ТЗ.
- Если в ТЗ цены не указаны — попроси оркестратора уточнить с владельцем (НЕ выдумывай).
- Currency RUB подтягивается через CurrencyRate cron (α-10).

### 3. Unit-тесты
`backend/src/modules/ai/services/providers/kie.service.spec.ts` + `grsai.service.spec.ts`:
- Mock HTTP-клиент → проверь форматирование запроса под их API.
- Парсинг ответа (включая usage tokens).
- Error handling: timeout, 429, 500.
- Минимум 6 тестов на сервис.

### 4. Smoke-тест
`backend/scripts/smoke-test-kie-grsai.ts`:
- Реальный вызов через каждый провайдер с фиксированным prompt.
- Лог: model, latency, input/output tokens, cost.
- НЕ запускать в CI (только manual через `bun run`).

### 5. A/B seed
`backend/scripts/seed-ab-test-kie-grsai.ts`:
- Создаёт `LlmModelExperiment` для пары taskType (например, `block-ingest`): A=primary текущий, B=kie/grsai кандидат.
- Percentage split (например, 10% на B).

## DoD
- [ ] 4 seed-скрипта работают (dry-run + apply).
- [ ] `bun run test:unit` зелёный, новые spec'ы покрывают KieService и GrsaiService.
- [ ] smoke-test возвращает валидный ответ от обоих провайдеров (если есть API ключи в env).
- [ ] A/B seed добавляет минимум 1 эксперимент.
- [ ] Цены sourced (либо из ТЗ, либо явный TODO + вопрос владельцу).
- [ ] Документация в `docs/reference/llm-models-playbook.md` обновлена с новыми моделями.
```

---

### Тикет 4: δ-3 WebSocket-стриминг голосового ВВОДА (P1, 1.5-2 дня)

> **Важно по продукту:** Concierge / AI-помощник отвечает **ТОЛЬКО текстом**. Голосового вывода нет — это намеренный продуктовый выбор (тише в офисе/созвоне, проще копировать, не требует наушников). Никаких кнопок «🔊 Слушать», никакого `voiceMode` toggle, никакой автоматической озвучки ответов. TTS-endpoint существует на backend для будущих nишевых сценариев (accessibility), но в Concierge flow НЕ встраиваем.

```
Ты fullstack разработчик Z/Кора. Тикет: δ-3 — WebSocket-стриминг голосового ВВОДА в Concierge.

## Контекст
- Sub-ТЗ: `plans/archive/2026-05-23-sba-delta-3-voice-channel-adapter.md`.
- Готово: VoiceChannelAdapter, REST `POST /api/v1/voice/transcribe` (file → text), TtsService + `/voice/synthesize` (используется не в Concierge — оставляем как есть, не трогаем).
- НЕ готово (по ревизии 2026-05-24): **WebSocket-стриминг голоса отсутствует** — `ConciergeVoice.tsx` использует file-upload (записал → загрузил → распарсил → ответ). Это даёт задержку 15-18 секунд от начала записи до текстового ответа. Нужен стриминг ≤1-2 сек после отпускания микрофона.

## ⚠ Что НЕ делать
- НЕ интегрировать TTS в ответы Concierge. Concierge отвечает только текстом — продуктовое решение.
- НЕ добавлять кнопку «🔊 Слушать» в ConciergeChat.
- НЕ добавлять `Person.preferences.voiceMode` или Settings toggle про озвучку.
- НЕ менять формат ответа Concierge (он остаётся `{ text, actions? }` без `audioUrl`).

## Разведка
1. `run_pipeline({task: "Concierge frontend voice input и backend voice transcribe"})`.
2. Прочитай `frontend/src/ui/concierge/ConciergeVoice.tsx`, `frontend/src/ui/concierge/ConciergeChat.tsx`.
3. Прочитай `backend/src/modules/voice/*` — VoiceChannelAdapter и transcribe endpoint.
4. Прочитай `backend/src/modules/tracker/gateways/tracker.gateway.ts` — паттерн socket.io gateway + auth (для копии auth-логики).

## Что сделать

### Backend (~1 день)
- Новый gateway `backend/src/modules/voice/voice-stream.gateway.ts`:
  - Socket.io namespace `/voice`.
  - Auth: тот же JWT/cookie что REST, через socket.io middleware (копировать из tracker.gateway.ts).
  - Events client→server:
    - `voice:start` (clientId, sampleRate, mimeType) — открыть сессию, выделить buffer.
    - `voice:chunk` (Buffer 100-200ms WebM/Opus или PCM) — append в buffer (Redis или in-memory с TTL 60 сек).
    - `voice:end` — финализировать сессию → ASR через VoiceChannelAdapter → emit `voice:transcribed`.
    - `voice:cancel` — отбросить буфер.
  - Events server→client:
    - `voice:transcribed` (text, durationMs).
    - `voice:error` (code, message).
  - Опциональная оптимизация (если провайдер поддерживает streaming ASR — OpenAI Whisper realtime / GigaAM streaming): стримить chunks сразу в провайдер вместо буферизации. Если нет — буферизация до `voice:end` и batch ASR. Документировать выбранный подход в коде.
- Метрики:
  - `z_voice_ws_session_total{outcome="completed|cancelled|error"}`.
  - `z_voice_ws_chunk_total`.
  - `z_voice_ws_asr_latency_ms` (histogram).

### Frontend (~0.5-1 день)
- В `frontend/src/ui/concierge/ConciergeVoice.tsx`:
  - Заменить `<input type="file">` / fetch-upload на `MediaRecorder` + socket.io клиент.
  - При нажатии микрофона:
    - `navigator.mediaDevices.getUserMedia({audio: true})` → новый `MediaRecorder` с `mimeType: 'audio/webm;codecs=opus'` (или fallback).
    - `socket.emit('voice:start', {...})`.
    - `mediaRecorder.start(200)` — `timeslice: 200ms` → каждые 200мс event `dataavailable` → `socket.emit('voice:chunk', blob)`.
  - При отпускании микрофона:
    - `mediaRecorder.stop()` → дослать последний chunk → `socket.emit('voice:end')`.
    - Показать «распознаю…» индикатор.
    - При `voice:transcribed` → передать текст в `ConciergeChat` как обычный пользовательский ввод.
  - При отмене (Esc или повторный клик): `socket.emit('voice:cancel')`.
- UI-индикаторы:
  - Запись: waveform или пульсирующая красная точка.
  - Распознавание: spinner «распознаю речь…».
  - Время записи (счётчик секунд).

### End-to-end smoke (~0.25 дня)
- Manual scenario:
  1. Открыть Concierge → нажать микрофон → говорить «создай задачу подготовить отчёт до пятницы» 5 секунд → отпустить.
  2. Через ≤2 секунды появляется текст в чате Concierge.
  3. Concierge отрабатывает обычным flow и возвращает текстовый ответ (НЕ голосовой).
- Лог метрик: `z_voice_ws_asr_latency_ms` p50 ≤ 1500ms на 5-секундной записи.

## DoD
- [ ] WebSocket gateway работает, JWT/cookie auth проверены.
- [ ] `ConciergeVoice.tsx` стримит микрофон через WS, file-upload убран.
- [ ] Время от «отпустил микрофон» до «text появился в чате» ≤ 2 сек на 5-секундной записи.
- [ ] Concierge продолжает отвечать ТОЛЬКО текстом (формат ответа не изменён).
- [ ] Метрики `z_voice_ws_*` в /metrics.
- [ ] Unit-тесты на gateway (mock WS, mock ASR).
- [ ] Cancel-flow работает (буфер чистится).
- [ ] Русский UI («распознаю речь…», «запись…»).
- [ ] Mobile Safari проверен (MediaRecorder support quirks).
```

---

### Тикет 5: Tracker Phase 4 — email-to-task IMAP (P1, 2 дня)

```
Ты backend разработчик Z/Кора. Тикет: Tracker Phase 4 — email-to-task через IMAP.

## Контекст
- Sub-ТЗ: `plans/tz/2026-05-23-tracker-phase-4-rf-musthave.md` — раздел «Email-to-task».
- Готово в Phase 4: Telegram-бот для задач (5 сценариев + голос + 4 LlmTaskType), HolidayService, 10 templates команд (sales/dev/installation/marketing/management/customer_support/hr/finance/operations/product), POST `/projects/from-template`, Telegram digest per-user TZ.
- НЕ готово: IMAP inbound — уникальный адрес каждого проекта (`project-<id>@inbox.kora.app`), парсинг входящих писем → создание Issue с парсингом полей из subject/body, приложениями.

## Разведка
1. `run_pipeline({task: "проверь mail модуль и IMAP реализацию в backend"})`.
2. Прочитай `backend/src/modules/mail/*` (если есть) и `backend/src/modules/channels/telegram/*` (там паттерны inbound).
3. Прочитай `backend/src/modules/tracker/services/issues.service.ts` — как создавать Issue (CreateIssueDto, attachments через S3).

## Что сделать

### 1. Schema (если поля нет — оркестратор добавит, ты используй)
- `Project.emailInboxAlias` String? unique — например `project-abc123` (без домена).
- `Project.emailInboxEnabled` Boolean @default(false).
- Полный адрес собирается на лету: `${alias}@${ENV.MAIL_INBOX_DOMAIN}`.

### 2. ENV
- `MAIL_INBOX_DOMAIN` — например `inbox.kora.app`.
- `MAIL_INBOX_IMAP_HOST`, `MAIL_INBOX_IMAP_PORT`, `MAIL_INBOX_IMAP_USER`, `MAIL_INBOX_IMAP_PASS`, `MAIL_INBOX_IMAP_TLS`.

### 3. IMAP cron + worker
`backend/src/modules/mail/inbound/imap-poll.cron.ts` (или расширение существующего):
- `@Cron('*/2 * * * *')` — каждые 2 минуты.
- Подключение к IMAP (`imapflow` библиотека — добавь dep, проверь Bun-совместимость).
- Получить все непрочитанные → для каждого письма:
  - Распарсить `To:` → найти `Project` по `emailInboxAlias`.
  - Если не найден — отправить bounce («адрес не найден»), пометить read.
  - Если найден:
    - `From:` → найти `Person` по email (если нет — создать guest Person с пометкой external).
    - Subject → `Issue.title` (truncate 200 chars).
    - Body (text/plain или html → text) → `Issue.description` (truncate ~5000 chars).
    - Attachments → upload в S3 через S3Service, создать `IssueAttachment` для каждого.
    - Создать Issue через `IssuesService.create()` с RBAC bypass (system-level).
    - Пометить письмо read.
- Логирование: каждое письмо → `MailInboundLog` (id, projectId, fromEmail, subject, status, issueId).

### 4. REST endpoint для проекта
- `POST /api/v1/projects/:id/email-inbox/enable` — генерирует alias, включает.
- `GET /api/v1/projects/:id/email-inbox` — возвращает полный адрес + статус.
- `POST /api/v1/projects/:id/email-inbox/regenerate-alias` — для случая утечки.

### 5. UI (frontend, можно отдельным агентом)
- В Project Settings (`frontend/app/(authenticated)/projects/[id]/settings/page.tsx`):
  - Секция «Email-to-task».
  - Toggle включить/выключить.
  - Показ полного адреса (copy-button).
  - Кнопка «Сгенерировать новый адрес» (с подтверждением).
  - Лог последних 20 inbound писем (из MailInboundLog).

### 6. Метрики
- `z_mail_inbound_received_total{project_id, status}`.
- `z_mail_inbound_issues_created_total`.
- `z_mail_inbound_bounce_total{reason}`.

### 7. Тесты
- Mock IMAP клиент → тест парсинга letter → Issue.
- Тест на attachments → S3 upload.
- Тест на bounce (несуществующий alias).

## DoD
- [ ] Schema + ENV + dep `imapflow` подключены.
- [ ] Cron работает каждые 2 минуты, idempotent.
- [ ] Email с attachments создаёт Issue со всеми вложениями.
- [ ] Email на несуществующий alias bounce'ит.
- [ ] REST endpoints работают, RBAC проверяется (admin проекта).
- [ ] UI в Project Settings (если решено в этом же тикете).
- [ ] Метрики в /metrics.
- [ ] Unit-тесты зелёные.
- [ ] Документация в `second-brain/01_projects/tracker.md` обновлена.
```

---

### Тикет 6: Wave 2 polish (3 микро-тикета, 0.5 дня)

Можно сделать одним агентом-генералистом или 3 микро-агентами параллельно.

#### 6a. Реальный `GET /me/inbox/count` (15 мин backend)

```
Backend микро-тикет. Сделай реальный endpoint `GET /api/v1/me/inbox/count` возвращающий { total: number, unread: number }.

Сейчас `frontend/src/hooks/useMyInboxCount.ts` использует workaround (cnt ∈ {0,1}) — нужно заменить на реальный count.

Файлы:
- `backend/src/modules/me/me.controller.ts` (или где живёт /me) — новый method.
- Сервис — query через PrismaService с tenantId.
- Swagger DTO `InboxCountDto`.
- На frontend: обновить `useMyInboxCount.ts` чтобы парсил `{ total, unread }`.

DoD: typecheck + lint зелёные, badge в BottomNav показывает реальное число.
```

#### 6b. `ChatV2ScopeEnum + 'issue'` (30 мин)

```
Расширь `ChatV2ScopeEnum` в `backend/src/modules/chat-v2/dto/` добавив значение `'issue'`. Зарегистрируй `IssueCardHandler` (уже создан Agent C в Wave 3) для scope='issue'.

На frontend в `frontend/src/ui/tracker/IssueChat.tsx` — заменить scope='card' fallback на scope='issue'.

Файлы:
- `backend/src/modules/chat-v2/enums/chat-scope.enum.ts`.
- `backend/src/modules/chat-v2/services/scope-resolver.service.ts` (или где маршрутизация scope→handler).
- `frontend/src/ui/tracker/IssueChat.tsx`.

DoD: чат-в-задаче работает через scope='issue', не падает на fallback.
```

#### 6c. Component-тесты Board.tsx (90 мин)

```
Добавь dep `@testing-library/react` + `@testing-library/jest-dom` в frontend/package.json (devDependencies). Настрой vitest config для DOM.

Напиши минимум 4 component-теста для `frontend/src/ui/tracker/Board.tsx`:
1. Рендерит N колонок согласно props.columns.
2. Drag-and-drop карточки между колонками вызывает onMove.
3. Пустое состояние показывает empty placeholder.
4. Loading state показывает skeleton.

DoD: `bun run test:unit` зелёный, новые тесты покрывают Board.tsx ≥60%.
```

---

### Тикет 7: prompts-hardening — security + калибровка + гигиена (P2, 13-16 дней в 3 фазах)

Это самый объёмный тикет. Оркестратор должен:
1. Сначала **прочитать ТЗ целиком** — `plans/tz/2026-05-24-prompts-hardening.md` (~500 строк).
2. **Разбить на 3 волны** (F1-F5 → F6-F11 → F12-F16) — это уже сделано в §3 ТЗ.
3. **Внутри волны запускать параллельных агентов** по группам промтов.

Шаблон для волны P1 (F1-F5):

```
Ты backend разработчик Z/Кора. Промт-hardening, фаза P1 (security + калибровка + кеширование).

## Контекст
- Sub-ТЗ: `plans/tz/2026-05-24-prompts-hardening.md` — §4 (F1), §5 (F2), §6 (F3), §7 (F4), §8 (F5). Прочитай эти разделы полностью.
- Затрагивает ~63 промта в 7 группах:
  - `backend/src/modules/ai/services/prompts/` (11 типов встреч + сервисные)
  - `backend/src/modules/knowledge-core/prompts/` (27 промтов ядра)
  - `backend/src/modules/chat-v2/prompts/` (factual/synthetic/clone_style)
  - `backend/src/modules/dialog-layer/prompts/` (5 RAG-промтов)
  - 5 узких (dashboard / brand-voice / role-map / helpfulness / recognition).
- Точка вставки sanitize + caching: `backend/src/modules/ai/workers/analyze.worker.ts`.

## Разведка
1. `run_pipeline({task: "промты Z и точки вставки пользовательского ввода"})`.
2. `get_skeleton([backend/src/modules/ai/services/prompts/common.ts, backend/src/modules/ai/workers/analyze.worker.ts])`.

## Что сделать (этот агент берёт ОДНУ из F1-F5)

### Вариант агента-F1: prompt-injection guard
- `DATA_MARKER_OPEN/CLOSE` константы в `common.ts`.
- `wrapUserData()`, `withInjectionGuard()`, `INJECTION_GUARD_NOTE`.
- `sanitizeCustomPrompt()` с FORBIDDEN_PATTERNS + truncate 4000 chars + метрика `z_prompt_injection_attempt_total`.
- В analyze.worker: customPrompt из system в user (внутри маркеров) + transcript+roomChat обернуть в `wrapUserData`.
- Расширение на knowledge-core / chat-v2 / dialog-layer.
- Unit + integration тесты (см. §4.3 acceptance).
- Документация в `second-brain/02_architecture/code-pitfalls.md`.

### Вариант агента-F2: CONFIDENCE_CALIBRATION
- См. §5 ТЗ — точные строки + список 12-15 промтов для применения.
- `withConfidenceCalibration()` helper.

### Вариант агента-F3: prompt caching
- Распространить `cacheControl: 'ephemeral'` на knowledge-core воркеры + quality-score + chat-v2.
- См. §6 ТЗ.

### Вариант агента-F4: few-shot для 5 критичных
- type-sales, type-interview, skill-trait-detect, decision-extract, idea-extract.
- 2 примера на промт (positive + tricky).

### Вариант агента-F5: tasks дедуп
- Единый builder для tasks (legacy + Wave 3 + tasks-structured).

## ⚠ Особые правила hardening
- Никаких breaking changes для существующих AI-отчётов в проде. Перед удалением кода — проверь, что новый прошёл тот же тестовый набор.
- Изменение промта в production → семантика ответа может поменяться. Каждый изменённый промт прокатить через `bunx vitest run -t "<имя промта>"`.
- Новый промт-fallback константа — версионировать через `_V2` суффикс (соглашение из §F10).
- Изменённый промт в БД-registry (`PromptTemplate`) — через `PromptTemplateVersion` (фаза A — уже есть).

## DoD (для своей F)
- См. §«Acceptance» в соответствующем разделе ТЗ.
- Тесты зелёные.
- Не сломаны существующие промты (snapshot ≥ 90% prompts).
```

**Орестратор: запускай F1, F2, F3 параллельно. F4 и F5 потом (зависят от F1-F2). Затем волна P2 (F6-F11), затем P3 (F12-F16).**

---

### Тикет 8: WebSocket multi-user чат в IssueChat (P2, 4 дня)

```
Ты fullstack разработчик Z/Кора. Тикет: real-time коллаборация в IssueChat — presence + @-упоминания + IssueMention + Notification + typing indicator.

## Контекст
- IssueChat (`frontend/src/ui/tracker/IssueChat.tsx`) сейчас работает через chat-v2 REST + polling.
- WebSocket gateway уже есть для tracker (`backend/src/modules/tracker/gateways/tracker.gateway.ts`) — реальное обновление статусов карточек.
- ConversationalChannels (`backend/src/modules/conversational/`) — единая точка отправки уведомлений (in-app + email + telegram).

## Разведка
1. `run_pipeline({task: "tracker WebSocket gateway и IssueChat real-time"})`.
2. Прочитай `tracker.gateway.ts`, `useTrackerWebSocket.ts`.

## Что сделать

### Backend
1. **Расширить tracker.gateway.ts** новыми events:
   - `issue:chat:join` (issueId) → клиент подписывается на real-time чат конкретной задачи.
   - `issue:chat:typing` (issueId, userId) → broadcast «X печатает...» (с auto-expire 5 сек).
   - `issue:chat:presence` (issueId) → возвращает список текущих online users.
   - `issue:chat:message:new` (broadcast при создании IssueComment).
2. **Сервис `IssueMentionService`** — при создании IssueComment с `@username` parsed mentions:
   - Создать `IssueMention` (mentionedUserId, issueCommentId, issueId).
   - Через `ConversationalService.send()` отправить уведомление mentioned user'у (in-app + telegram если включён).
3. **Schema** (если поля нет — оркестратор добавит):
   - `IssueMention` модель: id, issueId, issueCommentId, mentionedUserId, createdAt, readAt?.
   - `IssueComment.mentionedUserIds` String[] (для быстрого поиска).

### Frontend
1. **Хук `useIssueChatPresence(issueId)`** — возвращает `{ onlineUsers, typingUsers }`.
2. **В `IssueChat.tsx`:**
   - При маунте `socket.emit('issue:chat:join', issueId)`.
   - Список online users — справа от чата (avatar pile).
   - Indicator «N печатают...» — внизу.
   - При вводе текста — throttled `socket.emit('issue:chat:typing')`.
3. **@-mentions autocomplete:**
   - При вводе `@` — открывать popup со списком участников проекта (через `GET /projects/:id/members`).
   - Подсветка `@username` в превью.
   - При submit — извлечь mentions, передать на backend через `POST /issues/:id/comments` (расширить body параметром mentionedUserIds).
4. **Live-обновление чата:**
   - `socket.on('issue:chat:message:new', (comment) => SWR mutate)` — добавить новый комментарий без polling.

## DoD
- [ ] Открыл одну задачу с двух tab'ов → видишь друг друга в online + typing indicator работает.
- [ ] Написал `@Иванов` → Иванов получил in-app notification + telegram (если включён).
- [ ] Новый комментарий появляется у всех подписанных без F5.
- [ ] Polling SWR в IssueChat отключён (теперь WS).
- [ ] Unit-тесты на IssueMentionService.
- [ ] Component-тест на @-mentions popup.
- [ ] Русский UI.
```

---

### Тикет 9: SPO (Supervised Prompt Optimization) — P3, требует обсуждения с владельцем

```
Промпт для НАЧАЛА — не для немедленной реализации:

Ты ассистент-аналитик. Тикет SPO (Supervised Prompt Optimization).

## Что сделать
1. Прочитай ТЗ `plans/tz/2026-05-24-supervised-prompt-optimization.md` целиком.
2. Прочитай связанные ТЗ:
   - `plans/archive/2026-05-21-phase-A-prompt-registry-admin.md` (родительский) — в plans/archive/.
   - `plans/tz/2026-05-24-prompts-hardening.md` — сейчас тоже идёт.
3. Составь короткий (1 страница) **discovery-документ** для владельца:
   - Что такое SPO в нашем контексте (3-5 предложений).
   - Какие 3-5 промтов первыми кандидаты на автооптимизацию (с обоснованием — те где есть AiResultFeedback от пользователей).
   - Какой metric для оценки «лучше vs хуже» (rating, retention, downstream task success).
   - Сколько данных нужно собрать перед тем как первый запуск SPO даст осмысленный результат (минимум N feedback).
   - Какой бюджет на LLM-meta-оптимизацию (вопрос к владельцу).
   - 3 архитектурных подхода (DSPy / простой A/B / RLHF-light) с trade-offs.
4. Сохрани документ в `plans/analysis/YYYY-MM-DD-spo-discovery.md`.
5. НЕ начинай реализацию — ждёт ответа владельца на discovery.
```

---

## 3. Workflow оркестрации (14 шагов)

Унаследовано из предыдущего handoff. Ключевые правила:

1. **Открыть этот handoff + все 9 ТЗ из `plans/tz/`** в начале сессии.
2. **`git log --oneline -20`** — последние коммиты, чтобы понять что свежее.
3. **Pre-разведка через `run_pipeline`** на каждый тикет за 30 сек.
4. **Параллелизация:** P0 + P1 можно гнать ОДНОВРЕМЕННО (разные модули):
   - Wave 1 параллельно: T1 Gamification frontend + T2 Helpfulness frontend + T3 kie-grsai + T6c Board tests.
   - Wave 2 параллельно: T4 δ-3 backend + T4 δ-3 frontend (2 агента на один тикет) + T5 email-to-task + T6a/b микро.
   - Wave 3 (prompts-hardening): F1+F2+F3 параллельно → F4+F5 → P2 → P3.
   - Wave 4: T8 WebSocket multi-user (один большой агент или 2 — backend+frontend).
5. **Координационные schema-коммиты ОТДЕЛЬНО ДО запуска агентов.** Если нужны новые Prisma поля — добавь schema + `bun run prisma:push && bun run prisma:generate` ОДНИМ chore-коммитом, дай агентам свежий типизированный client.
6. **После каждой волны:** общий `typecheck` + `lint` + `test:unit` + интеграция module.ts + policy.csv в общем коммите.
7. **Коммиты по тикетам:** Conventional Commits, HEREDOC, Co-Authored-By.
8. **Push origin dev** после волны (не после каждого коммита).
9. **second-brain update:**
   - `01_projects/tracker.md` (после T5 email-to-task).
   - `01_projects/ai-jobs.md` (после T3 kie-grsai, T7 prompts).
   - `01_projects/frontend-pages.md` (после T1, T2, T8).
   - `02_architecture/data-model.md` (если новые модели).
   - `02_architecture/module-map.md` (если новые модули).
   - `02_architecture/code-pitfalls.md` (после T7 — injection guard pitfall).
10. **Рефлексия** в `second-brain/05_история/YYYY-MM-DD-finishing-handoff-full-close.md`.
11. **Push рефлексии** отдельным `docs(second-brain): ...` коммитом.
12. **Prod-инструкция** владельцу — см. §4.

---

## 4. Prod-операции после закрытия (для владельца)

```bash
# 1. Подтянуть код
git pull origin dev
cd backend && bun install
cd ../frontend && bun install

# 2. Prisma (если были новые модели в T4, T5, T7, T8)
cd ../backend && bun run prisma:push
bun run prisma:generate

# 3. HNSW индексы (если в T7 добавлены embeddings)
bun run apply-postgres-init

# 4. Seed-скрипты (выполнить только нужные по факту реализации)
# T3 kie-grsai:
bun run scripts/seed-llm-providers-kie-grsai.ts
bun run scripts/seed-llm-prices-kie-grsai.ts
bun run scripts/seed-ab-test-kie-grsai.ts

# T7 prompts-hardening (если добавлены новые prompt templates в БД-registry):
# bun run scripts/seed-prompt-templates-hardened.ts (если будет)

# 5. ENV для prod (добавь в .env / secrets manager):
# T4 — δ-3 TTS:
CONCIERGE_TTS_VOICE_ID=alloy
# T5 — email-to-task:
MAIL_INBOX_DOMAIN=inbox.kora.app
MAIL_INBOX_IMAP_HOST=imap.yandex.ru
MAIL_INBOX_IMAP_PORT=993
MAIL_INBOX_IMAP_USER=...
MAIL_INBOX_IMAP_PASS=...
MAIL_INBOX_IMAP_TLS=true
# T3 — kie-grsai:
KIE_API_KEY=...
GRSAI_API_KEY=...

# 6. Пересобрать
bun run build
cd ../frontend && bun run build

# 7. Перезапустить процессы
# - Backend HTTP — новые WS gateway (T4, T8)
# - Backend worker — новые cron'ы (T5 imap-poll каждые 2 мин)
# - Frontend Next.js

# 8. Проверки
curl https://app.kora.ai/api/v1/health
curl https://app.kora.ai/metrics | grep -E 'z_mail_inbound|z_concierge_tts|z_voice_ws'

# 9. Domain DNS для T5:
# MX-запись inbox.kora.app → почтовый сервер (Yandex Mail для бизнеса / собственный SMTP).
# Создать почтовый ящик-loop `*@inbox.kora.app` → IMAP.
```

---

## 5. Что **НЕ** делать (унаследовано)

1. **НЕ запускать агентов на уже сделанном** — см. §1.3.
2. **НЕ дублировать concierge backend** — модуль готов.
3. **НЕ запускать seed-скрипты локально** — `PrismaClient v7.8.0` падает на init без правильного ENV. На проде работают.
4. **НЕ трогать Tracker Mobile native** — внешний блокер.
5. **НЕ менять existing PromptTemplate без `PromptTemplateVersion`** — версионирование уже работает (phase A).
6. **НЕ делать `git push` без полного цикла:** typecheck + lint + tests + second-brain update.
7. **НЕ забывать про MEMORY.md** — если нашёл новое поведенческое правило (например, какой-то паттерн hardening), сохрани в `~/.claude/projects/c--work-z/memory/feedback_*.md`.

---

## 6. После закрытия всех 9 тикетов

Этот handoff закрывает **весь оставшийся scope Кора v2** кроме внешне-блокированного Mobile native.

Следующая сессия должна:
1. Переместить закрытые ТЗ в `plans/archive/` (через `git mv`).
2. Создать новый умозрительный roadmap **v3** — что строим дальше (новые продуктовые гипотезы по результатам positioning research v2, market research final, ai-coo readiness analysis).
3. Если Mobile dev accounts появились — запустить Mobile native как отдельный wave.

---

## 7. Метрика темпа (для самоконтроля)

| Сессия (2026-05-24) | Коммитов | Строк | Агентов | Скорость |
|---|---|---|---|---|
| Sprint 1+2 | 13 | ~17 900 | 9 | ~2 000 строк/час |
| Sprint 3 finishing | 10 | ~21 000 | 3 | ~7 000 строк/час (большой 1 агент) |
| Wave 2 finishing | 10 | ~4 000 | 8 | ~500 строк/час (мелкие) |
| Wave 3 (3 итерации) | 11 | ~22 300 | 12 | ~1 800 строк/час |

**Темп держится. Главный множитель — `run_pipeline` за 30 секунд перед каждым агентом + параллелизация по разным модулям.**

---

**Удачи. 9 тикетов до полного закрытия Кора v2. Mobile — потом, когда у владельца появится RN-среда и dev accounts.**

— claude-orchestrator (Opus 4.7), ревизия 2026-05-24 — 8 параллельных агентов проверили 64 ТЗ vs реальный код, 57 переехало в archive, остался реальный бэклог из 9 тикетов
