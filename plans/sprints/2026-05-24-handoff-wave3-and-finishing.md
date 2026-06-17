---
type: handoff
status: ready-for-pickup
date: 2026-05-24
supersedes: plans/sprints/2026-05-24-handoff-to-next-orchestrator.md
from: claude-orchestrator (Opus 4.7) — 3 сессии 2026-05-24, 33 коммита, ~42 900 строк
to: next-orchestrator
---

# Handoff — продолжай оркестрацию Wave 3 + Wave 2 finishing (полный inventory)

## ⚡ TL;DR для нового оркестратора

1. **Прочитай этот файл целиком.** Здесь полный inventory всего что осталось — Wave 2 мелочи + Wave 3 (β-8 COO Dashboard приоритет №1) + 21 sub-ТЗ Кора v2 со статусом.
2. **Главная грабля сессии:** агенты в параллельной оркестрации **НЕ ДОЛЖНЫ** делать `git stash` — это уничтожает работу других агентов. Я закладываю это в шаблон промптов агентов (см. §5).
3. **Главный пропущенный риск:** концепция владельца «AI операционный директор» (β-8) ещё не написана. Подробный gap-анализ — `plans/analysis/2026-05-23-ai-coo-readiness-analysis.md`. См. §3.
4. **Метод оркестрации проверен:** 33 коммита за 3 сессии через 8-10 параллельных subagent'ов. Главный множитель — `grep ClassName backend/src/` перед каждым sub-ТЗ (минимум 6 случаев экономии часов работы).
5. **Регламент:** владелец 2026-05-24 явно делегировал полную автономию — коммиты сам, push сам, рефлексия после push автоматически. См. §0.

---

## 0. Регламент работы (СТРОГО соблюдать)

Унаследовано из предыдущих handoff. Не повторяю — только дельты.

- **Ты главный оркестратор.** Коммиты + push сам, без подтверждения.
- **Conventional Commits + HEREDOC + Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>**.
- **`git add` явно перечисляет файлы** — НЕ `git add .` / `git add -A`. Защита от попадания pre-сессионных файлов.
- **Параллелизация:** агенты в параллель ТОЛЬКО если трогают разные файлы. На `schema.prisma` / `app.module.ts` / `policy.csv` — оркестратор сам интегрирует ПОСЛЕ всех параллельных агентов в общем коммите.
- **Никогда `prisma migrate*`** — только `bun run prisma:push`. После — `bun run prisma:generate`.
- **Новые поля nullable (`?`)** — backward-compat. Backfill — отдельным шагом скриптом.
- **После push — рефлексия в `second-brain/05_история/YYYY-MM-DD-...md`** автоматически (без подтверждения). И обновление `second-brain/` (module-map, data-model, project-overview, index.md, заметки в 01_projects).

### Новое правило (главный урок 2026-05-24, сессия 3):

**🚨 АГЕНТЫ В ПАРАЛЛЕЛИ НЕ ДЕЛАЮТ git stash.** Если агент видит конкурентные uncommitted правки от другого агента, он:
- Работает только со своими файлами, не пытаясь изолировать чужое.
- Отчитывается в финальном отчёте если видит конфликт.
- НИКОГДА не делает `git stash` / `git stash drop` / `git checkout` чужих файлов.

**Почему:** в сессии 3 один агент (A1 Helpfulness→Recognition bridge) при попытке изолировать конкуренту через `git stash` уничтожил изменения A2 (FeedTypeSchema), A4 (postgres-init.sql HNSW), A5 (schema.prisma PushSubscription, web-push deps). Восстановление вручную из отчётов агентов — 20 минут.

**Обязательно включать в каждый промпт агента в параллельной оркестрации:**
```
⚠ КРИТИЧНО: НЕ делай `git stash` / `git checkout` чужих файлов. Если видишь uncommitted правки от другого агента — игнорируй их и работай только со своими файлами. Stash в параллельной сессии уничтожит работу коллеги.
```

---

## 1. История 3 сессий 2026-05-24 (что закрыто)

| Сессия | Коммитов | Строк | Главное |
|---|---|---|---|
| 1: Wave 1 backend + frontend scaffold | 13 | ~17 900 | 20 моделей Prisma трекера + 18 SignalType, tracker module, ENV+metrics, LiveKit RNNoise, IssueRelation+Attachments+start-meeting, WebSocket gateway + BullMQ webhook delivery, β-4 causeCategory, TrackerAdapter, 83-файла frontend scaffold |
| 2: Sprint 3 finishing + Wave 2 backend + Phase 2 frontend | 10 | ~21 000 | Goals B1-3.2/3.3/IdempotencyService+socket.io + 9 Prisma моделей Wave 2 (Activity Feeds×2 + Helpfulness×3 + Recognition×4 + IssueComment.thanksUserIds) + Activity Feeds + Specialist 3.8 Helpfulness + Recognition + /me/inbox+/states + канбан DnD + Bottom nav + useStates/useMyInbox real + PWA manifest+sw+push subscription UI |
| 3: Wave 2 finishing + Phase 2 polish | 10 | ~4 000 | Helpfulness→Recognition bridge + Recognition→ActivityFeed publish + HNSW index + seed helpfulness LlmTaskRoute + Backend Web Push module + IssueChat real (chat-v2 + голос voiceApi) + Cmd+K CommandPalette (AI ask + Concierge) + Toast в Board + Pagination useMyInbox + Badge useMyInboxCount |
| **Итого** | **33 коммита + 3 рефлексии** | **~42 900 строк** | |

### Рефлексии сессий (читай в этом порядке):

1. `second-brain/05_история/2026-05-24-tracker-sprint-1-orkestratsiya-9-agentov.md` — 12 архитектурных решений + 10 технических уроков + 5 поведенческих уроков.
2. `second-brain/05_история/2026-05-24-sprint3-finishing.md` — 7 архитектурных решений + 5 уроков для дистилляции + α-5 reality check.
3. `second-brain/05_история/2026-05-24-wave2-backend-frontend.md` — 16 архитектурных решений + 10 уроков + метрика темпа.
4. `second-brain/05_история/2026-05-24-wave2-finishing.md` — 14 архитектурных решений + 8 уроков (включая stash trap) + prod-инструкция.

### Главные открытия сессий (для будущей экономии часов):

**Случаи когда `grep ClassName backend/src/` показал что 90-100% уже готово до старта агента:**
- α-4 CompletenessSlot + ConsistencyCheckerCron (сессия 1, до моего старта)
- β-5 closing-loop respond-to-probe (сессия 1)
- γ-1 SkillTraitCategory + ExecutablePersona (95% готов, сессия 1)
- Принцип «трекер = источник для второго мозга» (закрыт до меня)
- **α-5 DialogService (44 файла, полностью готов, сессия 2 — Agent 18 не запускался)**
- Specialist 3.4 Project/Customer (α-6) — закрыт ранее

**Вывод:** перед каждым sub-ТЗ обязательно `grep -rn "ClassName|ModelName|service-name" backend/src/`. Это 30-60 секунд экономит 2-3 часа работы агента.

---

## 2. Что закрыто и что НЕ закрыто — полный inventory

### 2.1. Tracker (PLG-точка входа в платформу Z/Кора)

| Phase | Что | Статус |
|---|---|---|
| Phase 1 | Models + API (20 моделей Prisma, tracker module, 8 controllers + 8 services + 18 DTO, RBAC, ENV, метрики) | ✅ done (Sprint 1, 2026-05-24) |
| Phase 1 finishing | B1-3.2 Goals integration + B1-3.3 legacy Task→Issue migration + IdempotencyService + WebSocket live refresh | ✅ done (Sprint 3 finishing) |
| Phase 2 | Frontend mobile-first (drag-n-drop канбан, Bottom navigation, useMyInbox/useStates real, PWA, IssueChat AI-чат + голос, Cmd+K, toast/pagination/badge) | ✅ done (Wave 2 finishing) |
| Phase 3 | AI features (meeting-extract-actions, issue-infer-fields LlmTaskType, похожие задачи KNN, AI Q&A через chat-v2 для tracker, auto-triage Intake) | ⚪ **TODO Wave 3** |
| Phase 4 | РФ Telegram-бот для задач (голосом, через `tracker-task-parse`), email-to-task, 10 шаблонов команд seed, локализация дат/телефонов/ИНН/КПП, двусторонний календарь Я/Google/Outlook | ⚪ **TODO Wave 3** |
| Phase 5 | Импорт wizards (Битрикс24 + Trello + Я.Трекер) | ⚪ **TODO Wave 3** |
| Mobile native | React Native + Expo SDK 51+, App Store + Google Play + RuStore | ⚪ TODO (нужна RN-среда + Apple/Google/RuStore developer accounts) |

**Sub-ТЗ:** `plans/tz/2026-05-23-tracker-phase-{1,2,3,4,5}-*.md` + `plans/tz/2026-05-23-tracker-mobile-native.md`.

### 2.2. 21 sub-ТЗ Кора v2 (`plans/tz/2026-05-23-sba-*.md`) — статус

| Sub-ТЗ | Что | Статус |
|---|---|---|
| **α-1** | Channels Foundation (Conversational) | ✅ done (commit ранее) |
| **α-2** | Layer 1 Marking Extension (18 + 10 helpfulness/gamification signalType) | ✅ done (Sprint 1 commit 6b85491) |
| α-2-19 | 19 signal-types (extension) | ⚪ partial — 18 + 10 закрыто, оставшиеся `hypothesis, lesson, content_artifact, brand_principle, methodology_step` — не критично |
| **α-3** | Layer 2 Ontology Extension + AxisClassifier wave3 | ⚪ partial — base done, wave3 axis-classifier-full — TODO |
| **α-4** | Curation Foundation + wave2 completeness/consistency | ✅ done (CompletenessSlot + ConsistencyCheckerCron — закрыт до моих сессий) |
| **α-5** | DialogService + Cache (chat-v2 препроцессор) | ✅ **полностью реализован** (44 файла в `backend/src/modules/dialog-layer/`, обнаружено в сессии 2) |
| **α-6** | Specialist 3.4 Project/Customer | ✅ done |
| **α-7** | Specialist 3.1 Regulations + wave2 ProcessTemplate services | ✅ base done; wave2 ProcessTemplate/ProcessTemplateVersion/DecisionPoint/ProcessHandoff — частично, проверить grep |
| **α-8** | Appointment KPI wave3 + wave4 RoleMap worker REST UI | ⚪ wave3 partial (35%) + wave4 TODO. Без α-8 COO не видит дублирование функций между ролями |
| **α-9** | Company Foundation services wave3 (CompanyProfile, FunctionalDomain, DepartmentDomainLink, MaturityScorerCron) | ⚪ partial 25% — TODO. Нужно для COO «зрелость функций» |
| **α-10** | Admin LLM + Unit Economics wave3 (LlmProvider, LlmModel, AiCostDaily, OrgBudgetCap, CurrencyRate, 5 cron) | ⚪ 5% done — **TODO Wave 3**. ⚠ ДО старта α-10 — унификация admin-групп `(admin)/admin/*` vs `(authenticated)/admin/*` |
| **β-1** | Telegram MAX zero-button ripout | ⚪ partial — base done; rip-out на zero-button — TODO. Влияет на β-8 чек-ины через бота |
| **β-2** | Specialist 3.2 Knowledge Clone | ✅ done |
| **β-3** | Specialist 3.3 Decisions Registry | ✅ done (95% — `appliedPolicyId` после α-8) |
| **β-4** | Specialist 3.5 Insights Radar + causeCategory (8 категорий) | ✅ done (Sprint 2 commit 31fd270) |
| **β-5** | Specialist 3.6 Ideas + Layer 6 Probe-Agent + closing-loop respond-to-probe | ✅ done (закрыто до моих сессий) |
| **β-6** | Experiment Tracker (Specialist 3.9) | ✅ done (см. CardSpecialist registry) |
| **β-7** | Brand Voice Curator (Specialist 3.10) | ✅ done |
| **β-8** | **PersonalRelation + COO Operations Dashboard + DailyCheckIn** | ⚪ **15% done — ГЛАВНЫЙ ПРИОРИТЕТ Wave 3**. См. §3 |
| **γ-1** | Specialist 3.7 SkillProfile + ExecutablePersona + Clone API + finishing SkillTraitCategory persona versioning | ✅ done (95% — закрыто до моих сессий + finishing) |
| **γ-2** | Concierge Agent (NL → command parser для Cmd+K + Telegram голос) | ⚪ partial — ConciergeFloatingButton + ConciergeSlot + ConciergeChat + ConciergeVoice + CommandPalette с AI ask ✅ (frontend Wave 2 finishing); `concierge-parse` LlmTaskType backend — TODO Wave 3 |
| **γ-3** | CrossFunctional Process Handoff (межотдельные сбои) | ⚪ TODO Wave 3 |
| **δ-1** | Orchestrator + OrgKnowledgeIndex (multi-agent research) | ⚪ TODO Wave 3 |
| **δ-2** | ProactiveWatcher (8 правил превентивных сигналов) | ⚪ 10% done — TODO Wave 3 |
| **δ-3** | VoiceChannelAdapter (TTS + ASR REST endpoints) | ⚪ partial 30% (Vox/GigaAM для встреч и для voiceApi.transcribe в IssueChat) — TTS для AI-COO — TODO |

### 2.3. Wave 2 «помимо SBA» — статус

| Что | Статус |
|---|---|
| Activity Feeds (единая лента активности AI-агентов + 6 типов лент + WebSocket /ws/feed + 2 cron) | ✅ done (Wave 2 backend) |
| Specialist 3.8 Helpfulness Agent (worker + 4 cron + 4 probe-trigger + REST + этические защиты PRIVATE_TRAIT_TYPES) | ✅ done (Wave 2 backend) |
| Recognition + Gamification (4 cron + 5 базовых badges + thanks toggle + от AI не от руководителя) | ✅ done (Wave 2 backend) |
| HelpfulnessSpotlight → Recognition bridge | ✅ done (Wave 2 finishing) |
| Recognition → ActivityFeed publish | ✅ done (Wave 2 finishing) |
| Backend Web Push service (PushSubscription + endpoints + worker + cleanup cron + VAPID) | ✅ done (Wave 2 finishing) |
| Frontend PWA (manifest.ts + sw.js + 4 SVG иконки + PushSubscriptionToggle с 5 graceful states) | ✅ done (Wave 2 frontend) |
| HNSW pgvector index для HelpfulnessTrait.embedding | ✅ done (Wave 2 finishing) |
| Seed LlmTaskRoute helpfulness (3 taskType) | ✅ done (Wave 2 finishing) |

### 2.4. Что точно НЕ сделано и НЕ начато (TODO список для Wave 3)

| Тикет | Что | Время | Приоритет |
|---|---|---|---|
| **β-8** | COO Operations Dashboard + DailyCheckIn + PersonalRelation | 4 нед | 🔴 **P0 — концепция владельца «AI-COO»** |
| **Tracker Phase 3** | AI features (meeting-extract-actions, issue-infer-fields, KNN похожие задачи, AI Q&A через chat-v2 для tracker, auto-triage) | 2 нед | 🟠 P1 — фронт уже жаждет |
| **Tracker Phase 4 РФ** | Telegram-бот для задач голосом, email-to-task, 10 шаблонов команд seed, локализация (даты/телефоны/ИНН/КПП), двусторонний календарь | 3-4 нед | 🟠 P1 — wedge для РФ |
| **Tracker Phase 5 импорт** | Битрикс24 + Trello + Я.Трекер wizards | 4 нед | 🟡 P2 (after Phase 4) |
| **γ-2 Concierge backend** | `concierge-parse` LlmTaskType + Telegram голос integration | 2 нед | 🟠 P1 (frontend Cmd+K готов, ждёт backend) |
| **α-10 Admin LLM + Unit Economics** | LlmProvider/LlmModel/AiCostDaily/OrgBudgetCap/CurrencyRate (ЦБ РФ) + 5 cron'ов. ⚠ ДО старта — унификация admin-групп | 3 нед | 🟡 P2 |
| **α-8 Role Map + Appointment** | 5 нормализованных таблиц (ResponsibilityElement, AuthorityBoundary, RequiredKnowledge, DecisionPolicy, Interaction), миграция PersonRole → Appointment, Metric → KPI | 2 нед | 🟠 P1 (нужно для COO видеть дубли ролей) |
| **α-9 Company Foundation** | CompanyProfile + FunctionalDomain дерево + DepartmentDomainLink + MaturityScorerCron | 2 нед | 🟠 P1 (нужно для COO «зрелость функций») |
| **γ-3 Cross-Functional Handoff** | Межотдельные сбои + Process Handoff | 2 нед | 🟡 P2 |
| **δ-1 Orchestrator + OrgKnowledgeIndex** | Multi-agent deep research для сложных запросов | 2 нед | 🟡 P2 |
| **δ-2 ProactiveWatcher** | 8 правил превентивных сигналов | 2 нед | 🟡 P2 |
| **δ-3 VoiceChannelAdapter TTS** | TTS endpoint + интеграция в Concierge | 1 нед | 🟢 P3 |
| Tracker Mobile (React Native + Expo) | Native iOS/Android/RuStore app | 6-8 нед | 🟢 P3 (нужна RN-среда + dev accounts) |
| Supervised prompt optimization | Sub-ТЗ `plans/tz/2026-05-24-supervised-prompt-optimization.md` | TBD | 🟢 P3 |

### 2.5. Wave 2 / Phase 2 — мелкие polish-доделки (быстрые wins)

| Тикет | Что | Время |
|---|---|---|
| Backend `GET /api/v1/me/inbox/count` (или total в /me/inbox) | Снять workaround в `useMyInboxCount` (cnt ∈ {0,1} → реальное число). Сейчас badge показывает «·» вместо цифры | 15 мин |
| Backend chat-v2 `ChatV2ScopeEnum` + 'issue' | Завести трекер-специалиста в card-specialist-registry. Снять scope='card' fallback в IssueChat | 30 мин |
| TTS озвучка ответа AI в IssueChat | `voiceApi.synthesize` готов, ~30 строк | 20 мин |
| /chat-v2?conversationId=... deep-link | ChatV2Client должен читать query-параметр | 15 мин |
| Голосовой ввод в CommandPalette | Готовый ConciergeVoice → onTranscribed → setQuery | 30 мин |
| Recent/Pinned секция в Cmd+K idle | localStorage + история | 45 мин |
| Reorder внутри колонки канбана | Backend endpoint `PATCH /issues/:id/sortOrder` + frontend @dnd-kit/sortable | 60 мин |
| Component-тесты Board.tsx | Нужен `@testing-library/react` (отсутствует в package.json) | 90 мин |
| WebSocket multi-user чат в IssueChat с @-упоминаниями | Оригинальный Sprint 5 scope (полноценная коллаборация) | 4 дня |

---

## 3. КРИТИЧЕСКИЕ исследования владельца — где они

### 🎯 AI-COO (концепция владельца «второй мозг для операционного директора»)

**1. Главное исследование владельца** — концепция дашборда COO + утренние/вечерние чек-ины:
- `plans/analysis/2026-05-22-coo-dashboard-and-checkins.md` (2026-05-22) — постановка владельца дословно: 7 функций операционного директора (команда/процессы/цели/стратегия→исполнение/управление/контроль/анализ).

**2. Gap-анализ готовности под концепцию COO** (это то что НЕЛЬЗЯ потерять):
- `plans/analysis/2026-05-23-ai-coo-readiness-analysis.md` (2026-05-23) — mapping 7 функций COO ↔ что реально в коде:
  - 70-80% инфраструктуры уже готово (каналы, knowledge-core, специалисты Слоя 3, Probe Agent, Curation, RBAC, Employee Clones).
  - **Главный недостающий блок — именно β-8** (15% done).
  - Минимальный MVP = M1 β-8 целиком + M2 α-2 доделка signalType + M3 β-4 доделка causeCategory.
  - M2, M3 уже закрыты (см. §2). Остаётся M1 — β-8.
  - SHOULD: S1 α-5 (✅ закрыт) + S2 α-8 + S3 α-9 + S4 α-4 (✅ закрыт).
  - 5 открытых решений до старта реализации β-8 (см. часть 4 документа).

**3. Sub-ТЗ β-8** (формальное ТЗ):
- `plans/archive/2026-05-23-sba-beta-8-personal-relation-coo-checkin.md` — PersonalRelation + COO Operations Dashboard + DailyCheckIn.

**4. Зонтичный план Wave 1-3** (карта всех тикетов):
- `plans/archive/2026-05-23-coo-and-tracker-umbrella.md`.

### 📊 Другие критические исследования

| Файл | Что | Когда читать |
|---|---|---|
| `plans/analysis/2026-05-22-code-reality-deltas.md` | Reality-deltas — 60-70% Кора v2 готово, реальный код опережает план. **ОБЯЗАТЕЛЬНО прочесть перед запуском любого sub-ТЗ Wave 3** | Перед Wave 3 |
| `plans/analysis/2026-05-23-tracker-as-entry-wedge.md` | Стратегия — почему трекер как PLG-вход | Перед Tracker Phase 4-5 |
| `plans/analysis/2026-05-23-product-overview-simple.md` | Простой обзор продукта на русском | Для онбординга |
| `plans/analysis/2026-05-23-positioning-research-v2.md` | Позиционирование v2 (категория-гипотеза «AI-операционный директор + цифровой двойник компании») | Для маркетинга |
| `plans/analysis/2026-05-23-competitive-analysis-v2.md` + `.../competitive-analysis-v2/` | Конкурентный анализ v2 | Перед маркетинговыми текстами |
| `plans/analysis/2026-05-23-market-research-final.md` | Рыночное исследование | Для бизнес-решений |
| `plans/analysis/2026-05-23-ui-design-light-theme-research.md` | UI исследование светлой темы | Для frontend дизайнера |
| `plans/analysis/2026-05-24-owner-final-decisions.md` | Финальные решения владельца | ОБЯЗАТЕЛЬНО прочесть |
| `plans/analysis/2026-05-22-unified-product-architecture.md` | Единая архитектура продукта | Для понимания общей картины |
| `plans/analysis/2026-05-23-kora-v2-shipping-report.md` | Отчёт о доставке Кора v2 | Для понимания текущего состояния |
| `plans/analysis/2026-05-23-kora-v2-techdolgi-plain-russian.md` | Техдолги Кора v2 простым русским | Для понимания технического долга |
| `plans/archive/2026-05-22-second-brain-visualization.md` | Визуализация второго мозга (архив → заменён `plans/tz/2026-06-02-brain-visualization-people.md`) | Для дизайнера |
| `plans/analysis/2026-05-22-ontology-reasoning-from-scratch.md` | Онтология reasoning с нуля | Для AI-агентов |
| `plans/analysis/2026-05-22-dialog-layer-query-processing.md` | Dialog layer query processing | Уже реализован — справочно |
| `plans/analysis/2026-05-22-ui-design-deep-audit.md` | UI design deep audit | 12 правил UI — обязательно для frontend |
| `plans/analysis/2026-05-22-coo-dashboard-and-checkins.md` | Дашборд COO + чек-ины — постановка владельца | **ОБЯЗАТЕЛЬНО для β-8** |

### 📚 Research для контент-маркетинга

- `plans/analysis/2026-05-23-dzen-management-research/` (папка)
- `plans/analysis/2026-05-24-dzen-upravlenie-komandoy-i-zadachami/` (папка)
- `plans/analysis/2026-05-24-competitor-links-for-design.md`

---

## 4. ВАЖНЫЕ pre-сессионные untracked файлы которые НЕЛЬЗЯ коммитить (без явного разрешения владельца)

Эти файлы накопились до моих сессий и были созданы владельцем или другими процессами. В каждой сессии я их явно не трогал. Если будешь коммитить — сначала спроси владельца какие именно.

```
.claude/hooks/post-push-reflection.py
.claude/hooks/pre-bash-guard.py
.claude/skills/dzen-content-research/
docs/user-guide/
plans/analysis/2026-05-23-{ai-coo-readiness,competitive-analysis-v2,dzen-management-research,market-research-final,positioning-research-v2,product-overview-simple,tracker-as-entry-wedge,ui-design-light-theme-research}.md
plans/analysis/2026-05-24-{competitor-links-for-design,dzen-upravlenie-komandoy-i-zadachami,owner-final-decisions}.md
plans/tz/2026-05-23-{activity-feeds,coo-and-tracker-umbrella,gamification-and-motivation,specialist-3-8-helpfulness-agent,tracker-mobile-native,tracker-phase-{1,2,3,4,5}}.md
plans/tz/2026-05-24-supervised-prompt-optimization.md
second-brain/05_история/2026-05-23-визирование-коры-v2.md
second-brain/06_marketing/articles/
second-brain/06_marketing/landings/
second-brain/06_marketing/style-guide.md
```

И modified:
```
M second-brain/01_projects/frontend-pages.md
M plans/sprints/2026-05-24-handoff-to-next-orchestrator.md  (этот файл устаревает — заменён текущим)
M plans/sprints/2026-05-24-sprint-plan-wave-1.md
M plans/archive/2026-05-23-sba-gamma-2-concierge-agent.md
M second-brain/06_marketing/{competitors,icp,messaging,positioning}.md
```

**Правило handoff:** `git add` явно перечисляет файлы для каждого коммита. Никогда `git add .` / `git add -A`.

---

## 5. ⚠ Главные грабли и архитектурные паттерны (накопленные знания 3 сессий)

### Грабли — что НЕ ломать

1. **🚨 git stash в параллельной оркестрации** (новый урок сессии 3): агент НЕ ДОЛЖЕН делать stash в worktree — это уничтожит работу другого агента. См. §0.

2. **Apache AGE extension** отсутствует в текущем dev docker-образе `pgvector/pgvector:pg17`. `bun run apply-postgres-init` падает на `extension "age" is not available`. Это инфра-проблема не из изменений 2026-05-24. Отдельный тикет на нужный docker-образ.

3. **CRLF warnings на Windows** — git автоматически конвертирует. Норма, не блокер, не фиксить.

4. **bash-tool требует POSIX-синтаксис** — НЕ PowerShell `Select-Object`/`Select-String`. Использовать `head -N`, `grep`, `tail`.

5. **Pre-сессионные untracked файлы** (см. §4) — не трогать.

6. **Knowledge-core block-ingest worker** теперь поддерживает `payload.signalTypeHint` (override LLM-определения). Если добавляешь новые адаптеры — используй для явной семантики.

7. **TrackerWebhooksController** на `/api/v1/tracker/webhooks` — НЕ на `/api/v1/webhooks` (конфликт с LiveKit webhooks).

8. **WebhookDispatcher использует in-process BullMQ worker** (как knowledge-core воркеры) — следует существующему паттерну `workers.module.ts` «отдельный worker-процесс больше нет».

9. **S3Service из RecordingsModule** — `@Global()`, exports `S3Service`. Не создавать новый.

10. **LivekitService** — `@Global()`, методы `generateHostToken({id, endedAt?}, identity, name)` + `ensureRoom({id})`. Не вызывать `MeetingsService.create()` для task_discussion (quota обход).

11. **`task_discussion` AI-промпт** временно переиспользует `team` промпт. TODO Sprint 3: отдельный промпт под обсуждение задачи.

12. **UserRole vs MembershipRole** (урок сессии 2): `CurrentUserPayload.role` это UserRole (только `'user' | 'admin'`), а `'manager'` — это MembershipRole. Тест с `role: 'manager'` упадёт.

13. **Type predicates с DB-enum типами** (урок сессии 2): `(r): r is string` для `MembershipRole` — TS не считает что string ⊆ MembershipRole. Решение: `.map(String).filter(r => r.length > 0)` без predicate.

14. **PWA dev-guard обязателен** (урок сессии 2): без guard SW в dev блокирует HMR (типичный breakage Next.js + SW). `NEXT_PUBLIC_PWA_ENABLE_IN_DEV` + `updateViaCache: 'none'`.

15. **TS2589 на длинной merge цепочке Zod env.schema** (урок сессии 3): не каждая новая фича требует Schema в env.schema.ts — можно обходить через прямые `this.get(...)` в TypedConfigService.

16. **PushSubscription в Prisma client кэшируется отдельно от schema.prisma** (урок сессии 3): `bun run prisma:generate` создаёт `node_modules/.prisma/client/index.d.ts` с типами; даже если schema.prisma откатилась, client остаётся валидным до следующего generate. Это маскирует проблемы — typecheck зелёный, но в БД таблицы нет.

17. **Bun lockfile change при `bun add`** попадает в коммит автоматически. Включай `bun.lock` в git add при добавлении frontend/backend зависимостей.

### Архитектурные паттерны (применяй везде)

1. **Best-effort паттерн** для publish/notify сервисов (Recognition → ActivityFeed → Push) — каждый слой обёрнут в try/catch с warn-логом. Главный артефакт в БД — приоритет. Лента/push — best-effort.

2. **`@Optional() @Inject(...)` для @Global сервисов** — defense-in-depth. Страхует от splitting процессов (worker vs api), edge-кейсов тестов, temporary disable feature flag.

3. **Idempotent через `@@unique` + `upsert`** — для всех subscribe-like операций (PushSubscription, IssueRelation, и т.п.).

4. **Idempotent через `deleteMany`** — для HTTP DELETE (отсутствующая запись → 200 + `{deleted: 0}`).

5. **Двойная идемпотентность для очередей** — FSM-guard в сервисе + BullMQ jobId дедуп. Защита от race до commit.

6. **Failure handling RFC 8030 §7.3** — 410/404 → markFailure incrementing → удаление при `>= MAX_FAILURES`. 5xx/network → log-warn без markFailure (сервис временно лежит, не выбрасываем рабочие данные).

7. **Cron с детерминированным временем** — все cron указывают конкретное время в UTC, не каждые-N-минут (предсказуемость, легко прогревать).

8. **Когда «middleware vs interceptor vs guard»** — cross-cutting per-request state (idempotency, request-id, tenant) → middleware. Per-handler логика → interceptor. Auth/RBAC → guard.

9. **Параллельные cron одного имени в разных модулях** — NestJS DI разруливает по module-scope. `StrategicAlignmentCron` существует в `knowledge-core/workers/` (LLM-based, 04:00) и `goals/cron/` (issue-based, 06:00). Семантически разные сигналы — не дублирование.

10. **Координация schema.prisma** — ответственность оркестратора. ВСЕ модели добавляются ОДНИМ коммитом ДО запуска параллельных агентов на модулях. Агенты пишут только сервисы/cron/workers без race.

11. **Координация app.module.ts + policies/policy.csv** — оркестратор интегрирует в общем коммите ПОСЛЕ всех агентов. Промпт агента: «НЕ ТРОГАЙ app.module.ts / policies/policy.csv — сообщи строки в отчёте».

### Skills проекта (применять обязательно)

- `nestjs-rules` — backend стандарты (DTO через nestjs-zod, TenantGuard, RbacGuard, $transaction для multi-мутаций, Logger из @nestjs/common)
- `frontend-rules` — ApiDto → DomainModel → UiModel слоёная модель
- `prisma-db-push-rules` — только `bun run prisma:push`
- `safe-seed-rules` — безопасные seed-скрипты (editedByAdmin защита)
- `z-ai-agent-rules` — AI-агенты и prompt infrastructure
- `domain-business-context` — бизнес-контекст продукта Z
- `core-engineering-standards` — инженерные стандарты
- `project-architecture-router` — навигация по архитектуре
- `strict-production-review-gate` — code review

---

## 6. Workflow оркестрации (как делать ТЗ → код)

### Шаблон промпта sub-агенту (включай в каждый параллельный запуск)

```
Ты [backend|frontend|fullstack] разработчик проекта Z/Кора.
[Wave]/[Sprint] [тикет]: [короткое описание].

Working directory: c:\work\z. Все команды из [backend/|frontend/] (cd ... && bun ...).

## Контекст
[Где живёт код / sub-ТЗ файл / зависимости / skills проекта]

## Что НЕ дублировать (РАЗВЕДКА ОБЯЗАТЕЛЬНА перед стартом)
1. `grep -rn "MainClassName|MainModelName|MainServiceName" backend/src/` — проверь что нет уже готового.
2. `Read [главные файлы]` — текущая структура.
3. Если 90%+ готово — отчитайся и не дублируй (см. урок про α-5 DialogService).

## Что сделать
[Чёткие шаги. Каждый шаг — отдельный пункт.]

## ⚠ КРИТИЧНО: НЕ делай `git stash` / `git checkout` чужих файлов
В параллельной сессии другие агенты могут одновременно править соседние файлы.
Если видишь uncommitted правки от другого агента — игнорируй их и работай только со своими.
Stash уничтожит работу коллеги (урок 2026-05-24 сессия 3).

## Проверки (ОБЯЗАТЕЛЬНО)
- `cd backend && bun run typecheck` — exit 0.
- `cd backend && bun run lint` — без новых errors на твоих файлах.
- `cd backend && bunx vitest run src/modules/<module>/` — passed.

## Что НЕ делать
- НЕ git commit / push (оркестратор сделает).
- НЕ менять schema.prisma (оркестратор добавляет модели в общем коммите ДО запуска).
- НЕ использовать `prisma migrate*` — только `bun run prisma:push`.
- НЕ трогать `app.module.ts` — сообщи в отчёте что добавить.
- НЕ трогать `policies/policy.csv` — сообщи строки в отчёте.
- НЕ ломать существующие модули.
- НЕ дублировать готовое — сначала grep.

## Формат отчёта
1. Что обнаружила разведка (grep результаты).
2. Список созданных/изменённых файлов (полные пути).
3. Output typecheck/lint/tests.
4. Что добавить в app.module.ts (точная строка `imports: [..., NewModule]`).
5. Какие строки в policies/policy.csv.
6. Архитектурные решения принятые автономно.
7. TODO которые остались.
```

### Алгоритм оркестрации (проверенный за 3 сессии)

1. **Open this handoff document** + рефлексии 4 предыдущих сессий + `plans/analysis/2026-05-22-code-reality-deltas.md`.
2. **Pick task group** из §2.4 (Wave 3 priorities). 
3. **Pre-разведка через grep** — за 5 минут проверить что не сделано и не дублируется.
4. **Если task требует новых Prisma моделей** → добавить их ОДНИМ коммитом ДО запуска параллельных агентов + `bun run prisma:push && bun run prisma:generate`.
5. **Запустить параллельных агентов** через `Agent({ run_in_background: true, ... })` — максимум 5-8 одновременно. Каждый агент — на свой модуль (никакого race файлов).
6. **Дождаться все** нотификации.
7. **Общий typecheck + lint + selected tests** после всех агентов. ⚠ Особенно проверить что изменения каждого агента **физически в файлах** (`grep ClassName src/` — может быть потеряно из-за stash trap).
8. **Интегрировать AppModule + policy.csv** в общем коммите.
9. **Коммиты по тикетам** (один коммит = один sub-ТЗ или одно лог. изменение). Conventional Commits + HEREDOC + Co-Authored-By.
10. **Push origin dev**.
11. **second-brain update** (tracker.md / module-map.md / 01_projects/<feature>.md / data-model.md / index.md если крупно).
12. **Рефлексия** в `second-brain/05_история/YYYY-MM-DD-<имя>.md`.
13. **Push рефлексии** отдельным `docs(second-brain): ...` коммитом.
14. **Prod-инструкция** в чате владельцу — что применить на prod.

### Как дописывать ТЗ

Если sub-ТЗ неполное / нужны уточнения:

1. Прочти **полностью** оригинальный sub-ТЗ + связанные analysis (см. `related:` в frontmatter sub-ТЗ).
2. Найди **открытые решения** (часто в конце документа в разделе «Открытые вопросы» / «5 решений до старта»).
3. Если решение требует ввода владельца — спроси в чате.
4. Если решение можно принять автономно — задокументируй в **новой версии sub-ТЗ** (`plans/tz/<date>-<feature>-v2.md`) или прямой правкой с пометкой `> 2026-MM-DD оркестратор: принято решение X потому что Y`.
5. **НЕ запускай агента до того как ТЗ полное.** Лучше потратить 15 минут на дописывание ТЗ чем 90 минут на agent + revert.

---

## 7. ГОТОВЫЕ ПРОМПТЫ для следующих агентов

### Приоритет №1 — β-8 COO Operations Dashboard + DailyCheckIn (4 нед)

⚠ **Это концепция владельца, главный gap для AI-COO.** Не запускать одним агентом — большой scope. Разбить на 3-4 sub-tasks.

**β-8-1. Pre-работа — допиши ТЗ + ответь на 5 открытых решений (15-20 мин — ты сам, не агент):**

Прочти:
- `plans/archive/2026-05-23-sba-beta-8-personal-relation-coo-checkin.md` (формальное ТЗ)
- `plans/analysis/2026-05-22-coo-dashboard-and-checkins.md` (постановка владельца, 7 функций COO)
- `plans/analysis/2026-05-23-ai-coo-readiness-analysis.md` (gap-анализ, минимальный MVP)

Открытые решения (из ai-coo-readiness §4):
1. Где живёт DailyCheckIn — отдельный модуль `daily-checkin/` или внутри `operations/`? **Решение оркестратора:** `backend/src/modules/daily-checkin/` отдельный @Global модуль. Reason: scope не пересекается с operations (там Goals/Strategy), новый модуль чище.
2. Telegram zero-button rip-out (β-1) — до или после β-8? **Решение оркестратора:** β-8 сначала без β-1 (использует существующий ConversationalService). β-1 rip-out — отдельным тикетом параллельно.
3. Sentiment (зелёный/жёлтый/красный) — кому виден? **Решение владельца 2026-05-24:** sentiment AI-определяет автоматически из свободного текста, НЕТ ручных кнопок 🟢🟡🔴. Видит сам сотрудник + руководитель + COO. Дистиллировано в memory.
4. «Утренняя/вечерняя форма» vs «свободный голос/текст»? **Решение оркестратора:** свободный текст/голос с auto-структуризацией через LLM `checkin-parse`. Daily prompt: «Что главное сегодня / что планирую» (утро) и «Что сделано / не сделано / помешало / предложения» (вечер).
5. URL — `/dashboard/coo` или `/dashboard` role-split? **Решение оркестратора:** `/dashboard/operations` отдельный URL. Reason: семантически отличается от Director Dashboard (`/dashboard`). COO смотрит operational pulse, директор — strategic. Можно потом role-split через middleware.

**β-8-2. Prisma модели (оркестратор сам, 1 коммит, ~30 мин):**

```prisma
model DailyCheckIn {
  id              String   @id @default(cuid())
  tenantId        String
  userId          String
  type            String   // morning | evening
  rawText         String   @db.Text    // свободный текст/транскрипт
  rawVoiceUrl     String?              // S3 ссылка на голос
  // Извлечённые секции (через LlmTaskType checkin-parse)
  planItems       String[] @default([])   // утро: что главное / что планирую
  doneItems       String[] @default([])   // вечер: что сделано
  notDoneItems    String[] @default([])   // вечер: что не сделано
  blockers        String[] @default([])   // вечер: что помешало
  suggestions     String[] @default([])   // вечер: предложения
  // AI-определённый sentiment
  sentiment       String?              // green | yellow | red (AI auto, БЕЗ ручных кнопок!)
  sentimentReason String?  @db.Text    // объяснение sentiment
  // Контекст
  scopedProjectIds String[] @default([])
  scopedGoalIds    String[] @default([])
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@index([tenantId, userId, type, createdAt])
  @@index([tenantId, createdAt])
  @@index([tenantId, sentiment])
}

// PersonalRelation — типизированный EntityLink (расширение Wave 3)
// relationType (в существующем EntityLinkType union добавить):
// - manages / collaborates_with / mentors / conflicted_with /
//   transfers_result_to / escalates_to / reports_to
// Источник: AI-извлечение из checkin/issues/meetings/comments.
// EntityLink модель уже есть — расширить enum + service в personal-relation/
```

**β-8-3. Sub-агент 1: DailyCheckIn module + LLM task (~90 мин)**

```
Ты backend разработчик Z/Кора. Wave 3 β-8 part 1: модуль daily-checkin с checkin-parse LlmTaskType.

Working directory: c:\work\z. Из backend/.

## Контекст
- Sub-ТЗ: plans/archive/2026-05-23-sba-beta-8-personal-relation-coo-checkin.md (читать полностью).
- Concept: plans/analysis/2026-05-22-coo-dashboard-and-checkins.md (постановка владельца).
- Gap: plans/analysis/2026-05-23-ai-coo-readiness-analysis.md (M1 β-8 — главный gap).
- Schema: DailyCheckIn модель добавлена в schema.prisma коммитом оркестратора (см. выше).
- Skills: nestjs-rules, prisma-db-push-rules, z-ai-agent-rules, core-engineering-standards.

## Что НЕ дублировать (РАЗВЕДКА ОБЯЗАТЕЛЬНА)
1. `grep -rn "DailyCheckIn|daily-checkin|checkin-parse" backend/src/` — проверь нет ли.
2. `grep -rn "ConversationalService.send" backend/src/` — паттерн доставки напоминаний.

## Что сделать (новый модуль backend/src/modules/daily-checkin/)
1. DailyCheckInService — create/update/get, фильтры по type/period/userId/sentiment.
2. LlmTaskType `checkin-parse` — извлекает 4 секции (planItems / doneItems / notDoneItems / blockers / suggestions) + sentiment (green|yellow|red) + sentimentReason. Тройная цепочка DeepSeek → OpenAI proxy → Ollama qwen3.5:9b.
3. Worker `checkin-parse.worker.ts` — consumer core.checkin-parse: на каждый new DailyCheckIn с rawText → LLM → update извлечёнными секциями + sentiment.
4. CronCheckInReminder (2 cron): @Cron('0 9 * * *') morning + @Cron('0 18 * * *') evening. Для каждого active user'а отправляет напоминание через ConversationalService.sendNotification(event='checkin.morning' или 'checkin.evening').
5. REST endpoints:
   - POST /api/v1/me/check-ins (создать чек-ин с rawText или rawVoiceUrl)
   - GET /api/v1/me/check-ins (свои за период)
   - GET /api/v1/persons/:id/check-ins (для руководителя/COO — read scope)
6. ⚠ Sentiment — БЕЗ ручных кнопок 🟢🟡🔴! AI определяет автоматически из rawText (решение владельца 2026-05-24).
7. Seed скрипт `backend/scripts/seed-llm-task-routes-checkin.ts` для маршрута checkin-parse.
8. Unit-тесты worker (mock LLM), CronCheckInReminder (mock ConversationalService), Service (CRUD).

⚠ КРИТИЧНО: НЕ делай git stash в параллельной сессии (урок 2026-05-24).

## Проверки: typecheck + lint + vitest passed.
## НЕ делать: commit/push, schema.prisma, app.module.ts (сообщи строку), policies/policy.csv (сообщи строки).

## Формат отчёта: разведка + файлы + проверки + AppModule import + policy строки + TODO.
```

**β-8-4. Sub-агент 2: PersonalRelation service (~60 мин)**

```
Ты backend разработчик Z/Кора. Wave 3 β-8 part 2: PersonalRelation как типизированный EntityLink.

## Контекст
- EntityLink модель уже есть в schema.prisma (knowledge-core, Фаза 2).
- Sub-ТЗ: plans/archive/2026-05-23-sba-beta-8-personal-relation-coo-checkin.md (раздел PersonalRelation).
- 7 типов отношений: manages | collaborates_with | mentors | conflicted_with | transfers_result_to | escalates_to | reports_to.

## Что НЕ дублировать
1. `grep -rn "EntityLink|EntityLinkType" backend/src/modules/knowledge-core/` — найди где enum.
2. `grep -rn "PersonalRelation" backend/src/` — проверь нет.

## Что сделать
1. Расширить EntityLinkType union (7 новых типов отношений).
2. PersonalRelationBuilder worker — анализирует DailyCheckIn + IssueComment + MeetingTranscript для извлечения отношений через LLM `personal-relation-extract` (тройная цепочка).
3. PersonalRelationService — read API: getRelationMap(userId) → граф отношений person ↔ person с metadata (confidence, lastObserved, evidence quotes).
4. REST: GET /api/v1/persons/:id/relations (для COO/руководителя).
5. Tests.

⚠ КРИТИЧНО: НЕ stash. НЕ менять schema.prisma (только enum через миграцию prisma:push если расширение разрешено).
```

**β-8-5. Sub-агент 3: COO Operations Dashboard backend aggregates (~90 мин)**

```
Ты backend разработчик Z/Кора. Wave 3 β-8 part 3: COO Operations Dashboard aggregate endpoints.

## Контекст
- DailyCheckIn + PersonalRelation готовы (parts 1+2 параллельно).
- 4 секции дашборда (концепция владельца): требует внимания сейчас / картина команды / движение к целям / сигналы и инсайты.
- Cron weekly digest agg за 5 дней.

## Что сделать
1. OperationsDashboardController с endpoints:
   - GET /api/v1/dashboard/operations/today (требует внимания: blockers за 24ч, red sentiment чек-ины, просроченные tasks, open insights высокой severity)
   - GET /api/v1/dashboard/operations/week (картина за 7 дней: agg по sentiment, top-3 blockers, top-3 wins, активные goals progress, recent decisions)
   - GET /api/v1/dashboard/operations/team-health (sentiment distribution, helpfulness signals, personal relations граф)
2. Service агрегирует из существующих моделей (DailyCheckIn + Insight + Decision + Issue + ContributionSnapshot + PersonalRelation).
3. RBAC: dashboard_operations ResourceType (см. policy.csv) — owner/admin/coo read.
4. WeeklyOperationsDigestCron @Cron('0 9 * * 1') — формирует weekly digest для каждого руководителя через ConversationalService.
5. Tests.
```

**β-8-6. Sub-агент 4: Frontend /dashboard/operations page (~120 мин)**

```
Ты frontend разработчик Z/Кора. Wave 3 β-8 part 4: COO dashboard frontend.

## Контекст
- Backend endpoints готовы (part 3).
- 4 секции: требует внимания / картина команды / движение к целям / сигналы и инсайты.

## Что сделать
1. app/(authenticated)/dashboard/operations/page.tsx + DashboardOperationsClient.tsx.
2. Хуки useDashboardOperations + useDashboardOperationsWeek + useTeamHealth (SWR).
3. 4 виджета: AttentionToday, TeamHealthOverview, GoalsProgress, InsightsRadar (переиспользуй существующий InsightsRadarWidget если есть).
4. Sentiment визуализация — цветовые точки на team grid (БЕЗ кнопок, просто индикатор от AI).
5. Mobile-friendly (responsive grid).
6. Live refresh через useTrackerLiveRefresh (issue/insight events).
```

### Приоритет №2 — Tracker Phase 3 AI features (2 нед)

См. полное sub-ТЗ: `plans/archive/2026-05-23-tracker-phase-3-ai-features.md`. Разбить на 2 агентов:
- Agent: `meeting-extract-actions` расширение (одна или N задач из встречи с suggestedAssignee/Goal/DueDate) + `issue-infer-fields` LlmTaskType + auto-triage Intake.
- Agent: KNN похожие задачи через embeddings + AI Q&A через chat-v2 scope='card' (уже работает в IssueChat).

### Приоритет №3 — γ-2 Concierge backend (`concierge-parse` LlmTaskType, 2 нед)

Frontend Cmd+K + ConciergeFloatingButton + ConciergeChat готовы. Нужен backend NL→command parser.

См. `plans/archive/2026-05-23-sba-gamma-2-concierge-agent.md`. Подсказка владельца 2026-05-24: главный вход = плавающий значок «Кора-помощник» + Telegram-бот, Cmd+K — опциональный desktop shortcut.

### Приоритет №4 — Tracker Phase 4 РФ (3-4 нед)

См. `plans/tz/2026-05-23-tracker-phase-4-rf-musthave.md`. Telegram-бот для задач голосом через `tracker-task-parse`, email-to-task через `proj-{cuid}@kora.app`, 10 шаблонов команд seed, локализация, двусторонний календарь.

### Приоритет №5 — Tracker Phase 5 импорт (4 нед)

См. `plans/archive/2026-05-23-tracker-phase-5-import.md`. После Phase 4.

### Параллельные потоки (можно запускать как time-permits)

- **α-8 Role Map + Appointment** (2 нед) — `plans/tz/2026-05-23-sba-alpha-8-{wave3,wave4}-*.md`.
- **α-9 Company Foundation** (2 нед) — `plans/archive/2026-05-23-sba-alpha-9-wave3-company-foundation-services.md`.
- **α-10 Admin LLM + Unit Economics** (3 нед) — `plans/archive/2026-05-23-sba-alpha-10-wave3-admin-llm-economics.md`. ⚠ ДО старта — унификация admin-групп.
- **γ-3 CrossFunctional Handoff** (2 нед) — `plans/archive/2026-05-23-sba-gamma-3-cross-functional-process-handoff.md`.
- **δ-1 Orchestrator + OrgKnowledgeIndex** (2 нед) — `plans/archive/2026-05-23-sba-delta-1-orchestrator-org-knowledge-index.md`.
- **δ-2 ProactiveWatcher** (2 нед) — `plans/archive/2026-05-23-sba-delta-2-proactive-watcher.md`.

---

## 8. Prod-операции которые ждут владельца

### Требует обязательного применения на prod (если ещё не сделано):

```bash
git pull origin dev
cd backend && bun install
cd ../frontend && bun install

# Применить ВСЕ Prisma миграции (9 моделей Wave 2 + 1 модель PushSubscription = 10 новых таблиц + 1 колонка IssueComment.thanksUserIds):
cd ../backend && bun run prisma:push
bun run prisma:generate

# Применить HNSW индекс HelpfulnessTrait (и другие existing):
bun run apply-postgres-init

# Seed базовых badges:
bun run scripts/seed-badges.ts

# Seed LlmTaskRoute для recognition-formulate:
bun run scripts/seed-llm-task-routes-recognition.ts

# Seed LlmTaskRoute для 3 helpfulness taskType:
bun run scripts/seed-llm-task-routes-helpfulness.ts

# Пересобрать:
bun run build
cd ../frontend && bun run build
```

### Опциональные (для активации фич):

```bash
# Web Push на prod (VAPID):
cd backend && bunx web-push generate-vapid-keys
# Backend .env.production:
VAPID_PUBLIC_KEY=<public>
VAPID_PRIVATE_KEY=<private>
VAPID_SUBJECT=mailto:noreply@kora.app
# Frontend .env.production (тот же public key):
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<тот же public>

# Legacy Task → Issue migration (когда готов):
cd backend
bun run migrate-task-to-issue            # dry-run preview
bun run migrate-task-to-issue --apply    # реально применить (идемпотентно)
```

### Перезапустить:

- Backend HTTP процесс
- Backend worker процесс (новые cron'ы автоматически зарегистрируются через @Cron декоратор)
- Frontend Next.js

### Грабли prod (известные ограничения):

- HelpfulnessTrait pgvector seq-scan на >10k записей без apply-postgres-init (HNSW индекс).
- Web push не работает без VAPID ENV (UI graceful disable).
- Apple/Google/RuStore Developer Accounts — нужны деньги + KYC (Mobile native blocker).
- EAS secrets для Expo — нужны реальные DSN/URL (Mobile native blocker).

---

## 9. Финальная установка для следующего оркестратора

### Если бы я начинал прямо сейчас, я бы делал:

**Час 1: разведка + понимание**
1. Прочитать этот handoff целиком (1 час).
2. Прочитать 4 рефлексии из `second-brain/05_история/2026-05-24-*.md` (по 10-15 мин каждая = 1 час).
3. Прочитать `plans/analysis/2026-05-22-code-reality-deltas.md` (15 мин).
4. Прочитать `plans/analysis/2026-05-23-ai-coo-readiness-analysis.md` (20 мин).

**Час 2-3: β-8 prep**
5. Прочитать `plans/analysis/2026-05-22-coo-dashboard-and-checkins.md` (постановка владельца) и `plans/archive/2026-05-23-sba-beta-8-personal-relation-coo-checkin.md` (sub-ТЗ).
6. Принять решения по 5 открытым вопросам β-8 (см. §7 β-8-1) и зафиксировать в новой версии sub-ТЗ или прямой правкой.
7. Добавить DailyCheckIn модель в schema.prisma + `bun run prisma:push && bun run prisma:generate` + коммит.

**Час 4-6: β-8 parallel execution**
8. Запустить 3 параллельных backend agents (β-8-3 DailyCheckIn module + β-8-4 PersonalRelation + β-8-5 COO Dashboard aggregates) + 1 frontend agent (β-8-6 page).
9. Дождаться все нотификации.
10. Общий typecheck + lint + tests. ⚠ Проверить `grep ClassName backend/src/` — не потеряно ли что-то из-за stash trap.
11. Интегрировать AppModule + policy.csv + push.

**Час 7: рефлексия + handoff update**
12. second-brain update (tracker.md / module-map.md / 01_projects/coo-operations-dashboard.md) + рефлексия + push.
13. Обновить этот handoff (или создать новый `2026-05-26-handoff-...md` если новая сессия).

### Метрика темпа

3 сессии 2026-05-24 = 33 коммита + 3 docs + ~42 900 строк. Если темп сохранится:
- β-8 (4 нед в плане) можно закрыть за 1-2 длинных сессий по моему методу.
- Wave 3 целиком (β-8 + Tracker Phase 3-5 + γ-2 backend + α-10 + α-8 + α-9) — 3-4 длинных сессии.

**Главный показатель качества:**
- `bun run typecheck` всегда зелёный на main.
- `bun run lint` без новых errors в наших файлах.
- Тесты passed для каждого нового сервиса/cron/worker.
- Pre-сессионные untracked файлы НЕ закоммичены случайно.
- Stash в параллельной оркестрации НЕ применяется.

---

## 10. Что НЕ забыть (контекст из 3 сессий)

1. ⚠ **AI операционный директор — главный недостающий блок продукта.** β-8 — приоритет №1 Wave 3. Концепция владельца зафиксирована в `coo-dashboard-and-checkins.md` (2026-05-22). Gap-анализ в `ai-coo-readiness-analysis.md` (2026-05-23).

2. **Решения владельца 2026-05-24** (см. `plans/analysis/2026-05-24-owner-final-decisions.md`):
   - Sentiment чек-инов БЕЗ ручных кнопок 🟢🟡🔴 (AI auto).
   - Главный вход = плавающий значок «Кора-помощник» + Telegram, Cmd+K — опциональный desktop shortcut.
   - 10 шаблонов команд (sales/development/installation/marketing/management/customer_support/hr/finance/operations/product).
   - Магазины мобилки — все три (App Store + Google Play + RuStore).
   - Helpfulness Spotlights — всегда ручное одобрение руководителем.
   - Приватные негативные сигналы Helpfulness (question_unanswered + question_acknowledged_no_action) — только private (admin + руководитель).

3. **Принцип «трекер = источник для второго мозга»** — каждое событие трекера → RawEvent → knowledge-core через TrackerAdapter. Закрыто в commit 3c547f7. Не ломать.

4. **LiveKit — только медиа.** Никакой бизнес-логики. Гость не получает секреты LiveKit. Аудио отдельными дорожками на участника.

5. **AI-отчёт зависит от типа встречи** — главное продуктовое отличие. Шаблоны промптов в admin-editable PromptRegistry.

6. **Multi-tenancy через X-Org-Id header** — TenantGuard на всех endpoints. tenantId в каждом where в Prisma.

7. **DeepSeek primary, OpenAI proxy secondary, Ollama qwen3.5:9b tertiary** — стандартная LLM-цепочка для всех новых tasks. См. `second-brain/01_projects/llm-providers-verified.md` (verified 2026-05-21).

---

**Удачи. Делай качественно, делай параллельно, не дублируй уже готовое, и помни про stash trap.**

— claude-orchestrator (Opus 4.7), 2026-05-24 (3 сессии)
