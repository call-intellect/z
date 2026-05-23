---
date: 2026-05-23
title: Кора v2 — оркестрация 19 sub-ТЗ за одну сессию (14 параллельных coders)
related:
  - plans/analysis/2026-05-23-kora-v2-shipping-report.md
  - plans/tz/2026-05-22-final-roadmap.md
distilled: false
---

# Кора v2 — оркестрация 19 sub-ТЗ за одну сессию (14 параллельных coders)

## Что было поставлено

Владелец передал мне инструкцию-оркестратора: «работаешь полностью автономно, пишешь sub-ТЗ → запускаешь агента-кодера в background → пока он работает, пишешь следующее sub-ТЗ → принимаешь готовый код → переходишь дальше». 13 локальных коммитов уже были запушены, передо мной — закрыть оставшийся scope Кора v2 (wave 3+ доделки для α-2..α-10 + целиком новые β/γ/δ блоки).

## Как решал

### Стратегия оркестрации

Структурировал работу как 17-секционные sub-ТЗ (каждое — отдельный markdown в `plans/tz/2026-05-23-*.md`) → dispatch coder через Agent tool в background → cap 5 параллельных coders.

**Граф зависимостей (фактический порядок dispatch):**

1. Round 1 (parallel): β-5 + α-4 wave 2.
2. Round 2 (parallel): + α-7 wave 2 + α-9 wave 3.
3. Round 3: после β-5 closed → + α-5 + γ-1 доделки.
4. Round 4: после α-4 wave 2 closed → + α-3 wave 3.
5. Round 5: после α-7 wave 2 closed → + α-8 wave 3 + γ-3.
6. Round 6: после α-9 wave 3 closed → + β-7 + β-6.
7. Round 7: после α-5 closed → + β-1.
8. Round 8: после β-1 closed → + γ-2 + α-10 wave 3 + δ-3.
9. Round 9: после γ-2 closed → + δ-1.
10. Round 10: после α-8 wave 3 closed → + α-8 wave 4.
11. Round 11: после δ-1 closed → + δ-2 + β-8.

Всего 14 параллельных coders, активный cap 5. Cycle time: одно sub-ТЗ ~25-50 мин coder + ~5-10 мин orchestrator dispatch.

### Принятые архитектурные решения (примеры)

- **Process модели:** ProcessTemplate parallel рядом с legacy Process, не rename. Backward-compat для regulations.
- **PersonRole → Appointment:** parallel модель + feature-flag в PersonsService. Patch-script idempotent dry-run default.
- **Metric → KPI:** добавление полей в Metric, без переименования. KPI = подмножество Metric с заполненными `attachedTo*Id`.
- **/structure vs /company/departments/domains/maturity:** новые отдельные страницы + cross-links, не tabs в /structure.
- **ToastContext extend** (action prop), не миграция на Sonner — меньше breaking changes.
- **CommandPalette extend** двумя режимами Search/Command, не replace.

Все 14+ архитектурных решений зафиксированы в каждом sub-ТЗ §3 «Принятые решения» — снимают с coder'а ответственность за выбор.

## Что вышло

- **19 / 19 sub-ТЗ closed.** Все DoD пройдены. ~250 unit/integration тестов зелёные.
- **221 файл изменён.** 132+ новых, 65+ модифицированных, 3 удалённых.
- **19 новых Prisma моделей** (Appointment, ProcessTemplate*, CompanyProfile, FunctionalDomain, DepartmentDomainLink, ResponsibilityElement, AuthorityBoundary, RequiredKnowledge, DecisionPolicy, Interaction, Experiment*, BrandVoiceProfile, DailyCheckIn, ConciergeConversation*, OrchestratorRun*, ProactiveNotification, IdeaBlockAxisLabel, CrossFunctionalFrictionReport, CompletenessSlot, SkillTraitCategory).
- **12 новых frontend страниц** (/company, /departments, /domains, /maturity, /experiments, /brand-voice, /dashboard/operations, /me/check-ins, /admin/economics, /admin/llm/{providers,models}, /admin/org/economics, /assistant, /orchestrator, /roles/[id]/map, /persons/[id]/appointments + extension /processes tabs).
- **25+ новых LlmTaskType** (axis-classify, router-fallback, process-template-extract, department-extract, domain-expand, maturity-rationale, dialog-{contextualize,confidence,classify,multi-query,summarize}, experiment-extract, experiment-summarize-lessons, brand-voice-extract, checkin-parse, operations-summary, concierge-respond, concierge-toolcall-validate, orchestrator-{plan,subagent,synthesize,verify}, proactive-message-craft, cross-functional-friction-summary, role-map-extract, role-completeness-rationale).
- **17 новых RBAC ResourceType** (completeness_slot, process_template, appointment, kpi, brand_voice, experiment, concierge, orchestrator, proactive_notification, voice, daily_checkin, personal_relation, dashboard_operations, role_map, skill_category, llm_provider, llm_model + COO role).
- **30+ Prometheus метрик**, все cardinality-safe (top-100 tenant bucket + 'other').
- **15 patch-scripts** для prod-миграций (idempotent, dry-run default где применимо).

## Чему научился

### 1. TS2589 эпидемия в EnvSchema при parallel coders
Когда 5+ coders параллельно расширяли `env.schema.ts` через `.merge(NewSchema)`, Zod inference depth превысила лимит TypeScript. Workaround сначала был «process.env.* в коде», но β-8 coder сделал фундаментальный fix через `EnvSchema: z.ZodTypeAny` cast (parseEnv returns `Record<string, unknown>`). После этого все coders безопасно расширяли. **Урок:** при росте Zod-цепочек cast'ить вверх; не плодить новые `.merge()`-ы.

### 2. Race condition на shared файлах при parallel coders
γ-1 coder отметил "автоматический revert" в `curation.service.ts`, `typed-config.service.ts`, `clones.api.ts` — другие coders писали те же файлы параллельно. Mitigation: оркестратор отслеживал какие файлы каждый sub-ТЗ затронет; serial dispatch для тех, кто конфликтует на shared файлах (schema.prisma, env.schema, llm-router). **Урок:** для 5+ parallel coders нужны worktree isolation или строгая queue по shared resources.

### 3. Компактный 17-секционный sub-ТЗ — реальная производительность
Шаблон из 17 секций (Scope / Принятые решения / Зависимости / Prisma-дельта / Patch / REST API / Workers / LlmTaskType / RBAC / Метрики / Frontend / ENV / Связь с кодом / DoD / Тесты / Риски) позволяет coder'у работать без обратных вопросов. **Самая важная секция — §3 «Принятые решения»** (с обоснованием) — снимает с coder'а ответственность за архитектурный выбор. Coders в summary'ах подтвердили: ни один не задал уточняющий вопрос.

### 4. Параллельность 5 coders — sweet spot
4-6 параллельных coders дают throughput ~7-10 sub-ТЗ за час. 7+ упирается в shared-file conflicts (см. #2). 1-2 — медленно. **5 — оптимум** для текущей архитектуры (без worktree).

### 5. Acceptance — батч лучше per-task
Принимать sub-ТЗ по одному = много мелких commits + bookkeeping fatigue. Лучше копить 5-10 закрытых, тогда делать batch acceptance + commits. Coders не блокируются ожиданием acceptance (их работа уже на диске).

### 6. process.env.* fallback — допустимый временный паттерн
При TS2589/blocked-types кодеры использовали `process.env.X` с `// TODO(env-refactor)` комментом. После фикса EnvSchema можно перенести в TypedConfig — но runtime безопасен, и это не блокирует работу. **Урок:** допускать аккуратные техдолги с явным TODO когда blocker — короткий путь к completed-state.

### 7. Prod-инструкции — обязательный outcome
Shipping report содержит копи-пейст команды для prod-миграции (prisma:push, patch-scripts в порядке, seed-scripts, ENV updates, restart). Это спасает время от «а что там нужно прокатить?» через 2 дня.

## Состояние (что НЕ запушено)

Все 19 sub-ТЗ + 221 файл — uncommitted local changes на ветке `dev`. Готов к серии commits (~3-5 batches) и push после явного разрешения владельца.

## Что НЕ сделано (sub-ТЗ, рекомендованные на следующий заход)

См. `plans/analysis/2026-05-23-kora-v2-shipping-report.md` §5 «Известные TODO (vNext)».

Главные:
- Concierge native tool-use protocol (вместо JSON emulation).
- WebSocket voice интеграция в Concierge (VoiceAdapter готов, не вписан).
- Recharts установить для COO dashboard charts.
- AiUsageLogService real-time labeled metrics.
- 4-я Orchestrator subagent strategy (timeline_construction full impl).
- PersonRole удаление (через 1 месяц прод-миграции).
