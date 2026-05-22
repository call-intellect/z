---
date: 2026-05-22
session_kind: implementation
distilled: false
related_tz:
  - plans/tz/2026-05-21-second-brain-agents-umbrella.md
  - plans/tz/2026-05-21-sba-alpha-2-layer1-marking-extension.md
  - plans/tz/2026-05-21-sba-alpha-3-layer2-ontology-extension.md
  - plans/tz/2026-05-21-sba-alpha-4-layer4-curation-foundation.md
  - plans/tz/2026-05-21-sba-alpha-5-layer5-chat-v2.md
  - plans/tz/2026-05-21-sba-alpha-6-specialist-3-4-project-customer.md
  - plans/tz/2026-05-21-sba-alpha-7-specialist-3-1-regulations.md
  - plans/tz/2026-05-21-sba-beta-1-channels-telegram-max.md
  - plans/tz/2026-05-21-sba-beta-2-specialist-3-2-knowledge-clone.md
  - plans/tz/2026-05-21-sba-beta-3-specialist-3-3-decisions.md
  - plans/tz/2026-05-21-sba-beta-4-specialist-3-5-insights.md
  - plans/tz/2026-05-21-sba-beta-5-specialist-3-6-ideas-and-layer6-probe.md
  - plans/tz/2026-05-21-sba-gamma-1-specialist-3-7-skill-and-clone.md
---

# Рефлексия — SBA зонтичный, 12 sub-ТЗ за одну сессию через оркестрацию агентов

## Что было поставлено

Прошлый агент сделал α-1 (Channels Foundation) и остановился. Зонтичное ТЗ `2026-05-21-second-brain-agents-umbrella.md` содержит **13 sub-ТЗ** (α-1..α-7 + β-1..β-5 + γ-1). Пользователь дал прямую инструкцию: «ты, как главный оркестратор, идёшь по порядку, шаг за шагом. У нас есть время и ресурсы. Объёмишь задачу и идёшь. Выполняя задачу полностью.» Позже уточнил: «ты всё готовишь и отдаёшь писать код агентам».

То есть моя роль — senior orchestrator + reviewer, не сам пишу код. Раздаю детальные брифы, потом проверяю результат (typecheck/build/lint + точечная проверка ключевых артефактов).

## Как решал

Делегирование по одному sub-ТЗ за раз через `Agent` tool (subagent_type=general-purpose). Перед каждым делегированием:
1. Читал sub-ТЗ полностью.
2. Проверял что **УЖЕ существует** в коде (грозит дубликатами без этого) — например в α-3 обнаружил что `Person.entityId` УЖЕ был, `Card.kind` хранится строкой а не enum'ом, RBAC уже содержит много типов от других sub-ТЗ.
3. Фиксировал решения по открытым вопросам ТЗ ДО передачи агенту — чтобы агент не делал собственный выбор.
4. Указывал эталонные референсы (другие sub-ТЗ как образец паттерна).
5. Подробно описывал интеграционные точки (`α-4 CurationService.triage`, `α-5 CardSpecialistRegistry`, β-5 ProbeService).
6. Явно перечислял что **не трогать** (другие специалисты, общие сервисы).

После каждого агента — сам прогонял `bun run typecheck` + `bun run build`. Проверял ключевые файлы (worker, controller, service) на корректность.

### Цепочка верификаций (все зелёные на каждом шаге)
- α-2 → α-3 → α-4 → α-5 → α-6 → α-7 → β-1 → β-2 → β-3 → β-4 → β-5 → γ-1
- Каждый этап заканчивался `typecheck=0 errors`, `build=зелёный`, `lint=без новых errors поверх baseline 89-93`.

### Коммиты и слияние
Все коммиты сделал не я — пользователь сам выполнил слияние с `origin/dev`. Финальные коммиты в логе:
- `0fa5c17 feat(competitor-parity): Wave 4 — SBA Alpha/Beta/Gamma backend+frontend`
- `503f243 docs: Wave 4 — ТЗ SBA, delivery-пакет, заметки second-brain`
- `5c5146c Merge remote-tracking branch 'origin/dev' into dev`
- `69a585b fix(post-merge): починка typecheck после слияния origin/dev`

После слияния — backend typecheck/build остались зелёные.

## Что вышло

**13/13 sub-ТЗ + M-блок (LLM tier-routing был сделан ранее как Фаза A.4):**

| Sub-ТЗ | Артефакт |
|---|---|
| α-2 Layer 1 Marking | SignalType +5 (reasoning, rationale, decision_basis, regulation, process_step) |
| α-3 Layer 2 Ontology | EntityType +6, Vendor/Event модели, Person.relationship, RouterService + BullMQ `core.specialist-routing`, API /vendors /events |
| α-4 Curation Foundation | 5 моделей (CurationItem/Decision/ConflictItem/CardVersion/CuratorAssignment), triage с auto/light/deep, evolving-conflict, card-stale-detector.cron, UI /curation + dashboard widget |
| α-5 Chat-v2 Omnichannel | Новый модуль `chat-v2/`, ChatV2OrchestrationService, conversation history, CardSpecialistRegistry, omnichannel inbound, UI /chat-v2, cron auto-archive |
| α-6 Specialist 3.4 (эталон) | Рефакторинг card-rollup-v2 под §5 контракт, Probe 4 trigger'а, registry registration, vendor prompt |
| α-7 Specialist 3.1 Regulations | Расширены existing Process/Regulation/Policy (без новой таблицы), worker + 3 промпта, KNN-dedupe, API/UI /regulations |
| β-1 Telegram + MAX adapters | Оба канала реализованы (MAX Bot API подтверждена через context7), webhooks + HMAC, slash-commands, setup-scripts, 8/8 unit-тестов |
| β-2 Knowledge Clone | Person.knowledgeProfile, worker + cron + rebuild-worker, эмерджентные категории, UI /me/knowledge-profile |
| β-3 Decisions Registry | Decision модель (statement/rationale/alternatives/supersede chain/evolving/actualOutcomes), 5 probe-trigger'ов + daily cron, API /decisions |
| β-4 Insights Radar | Insight кластеризация, dynamic 7d/30d ratio (spike/growing/stable/declining), Director Dashboard widget |
| β-5 Ideas + Layer 6 Probe-Agent | Idea/IdeaCluster/ProbeEvent, ProbeService.suggest с дедупом/rate-limit/quiet-hours/cold-start, **миграция 5 specialist'ов** на ProbeService, closing-loop через EventEmitter, /myideas Telegram |
| γ-1 SkillProfile + Clone | 3 модели, worker + 3 cron, 4 промпта (skill-trait-detect — primary capable gpt-5.4), Clones API, ChatV2 mode='clone_style' интеграция, UI /me/clone (обязательная) |

## Чему научился

### 1. Делегирование агентам — детальные брифы экономят итерации

Длинный бриф (1500-3000 строк инструкций) с явными решениями по открытым вопросам, эталонными референсами и списком «не трогать» — позволяет агенту с первого раза получить корректный результат. Я не возвращал ни одной задачи на доработку.

Ключевые элементы успешного брифа:
- «УЖЕ существует и используй» — чтобы не дублировал.
- «Не трогай» — явный whitelist файлов.
- «Решения по открытым вопросам» — фиксирую за агента, чтобы он не выбирал сам.
- «Эталонные референсы» — другие sub-ТЗ как образец паттерна.
- DoD с конкретными командами (`bun run typecheck`, `bun run build`, `bun run lint baseline`).

### 2. Trust but verify — критично

Системное правило «agent's summary describes intent, not necessarily what they did» сработало: после каждого агента я сам прогонял typecheck/build/lint и точечно читал ключевые файлы (worker, service, controller). Нашёл несколько мелких косяков:
- В α-3 агент верно сделал bash glob с `{a,b}` синтаксисом который не сработал — пришлось расширить пути.
- В α-7 агент столкнулся с конфликтом «новая Regulation таблица из ТЗ vs existing Process/Regulation/Policy из Фазы 0b» — нужно было дать чёткую стратегию (расширить in-place, не пересоздавать).
- В γ-1 агент имел рекомендацию использовать в primary `gpt-5.4` вместо flash — это критично для качества `skill-trait-detect`.

### 3. Существующий код важнее ТЗ

Несколько раз ТЗ описывал концепции которые УЖЕ были реализованы (M-блок Фазы A.4, α-1 в работе) или конфликтовали с реальностью (Decision.text vs Decision.statement, RegulationCategory enum vs нужный kind). В таких случаях я останавливал агента и явно фиксировал «расширяем in-place, не пересоздаём». Это сохраняет backward-compat.

### 4. DataClass enum

Зонтичное ТЗ использовало `confidential | restricted | top_secret` — но в реальном проекте `DataClass = public | internal | sensitive | private`. Это расхождение я ловил в нескольких sub-ТЗ (β-3, γ-1) и явно зафиксировал агенту использовать существующий enum.

### 5. Card.kind как строка vs enum

Card.kind хранится как строка `@default("client")` — это позволяет добавлять виды без миграций. В α-3 я обнаружил это вовремя и сэкономил миграцию для добавления `vendor`. Урок: проверять как именно типизирована модель перед предложением расширения enum.

### 6. EventEmitter впервые

β-5 потребовал @nestjs/event-emitter (для closing-loop по `idea.status_changed`). До этого его в проекте не было. Агент сам добавил dependency + `EventEmitterModule.forRoot()` в app.module. После — другие sub-ТЗ (γ-1 hook на Person.relationship change) использовали тот же механизм.

### 7. Cold-start mode для Probe-Agent

Открытый вопрос β-5 §14.4 — нужен ли cold-start режим против probe-storm при массовом deploy специалиста. Я решил «ДА, реализуем», и агент завёл `PROBE_COLD_START_MODE_HOURS=24` + соответствующую логику в `ProbeService.suggest`. Это даёт безопасность на проде: после deploy первые 24h все probe-events идут только в админ-очередь, без массовой рассылки в каналы.

## Не закрытые остатки (для следующих сессий)

### Ручные шаги для prod (накопленный долг)
- `bun run prisma:push` — применить все новые модели
- `bun run apply-postgres-init` — HNSW + GIN + tsvector индексы
- 5 patch-скриптов α-3 (`patch-rename-client-to-customer`, `patch-backfill-entity-id-*`, `patch-person-relationship`)
- 1 patch-скрипт α-6 (`patch-backfill-card-versions`)
- 7 seed-скриптов для новых LlmTaskType цепочек

### Согласование с владельцем продукта
- Все промпты — placeholder с `// TODO(owner-product)`. По зонтичному §10 — отдельный круг согласования. Список из ~20 промптов:
  - α-2: `block-ingest` (расширенные signalType-описания)
  - α-5: `chat-v2-synthesize`, `chat-v2-cite-select`, `chat-v2-conversation-title`
  - α-6: 6 промптов `card-rollup-v2-{client,deal,project,topic,custom,vendor}`
  - α-7: `regulation-extract`, `regulation-dedupe`, `process-steps-extract`
  - β-2: `knowledge-clone-extract`, `knowledge-clone-merge`
  - β-3: `decision-extract`, `decision-supersede-detect`
  - β-4: `insight-extract`, `insight-link-to-decisions`
  - β-5: `idea-extract`, `idea-cluster-merge`, `probe-formulate`, `idea-status-summarize`
  - γ-1: `skill-trait-detect`, `skill-trait-merge`, `executable-persona-compile`, `clone-respond`

### Manager validation (γ-1 особо)
- 1-2 dev-куратора должны лично оценить traits 3 dev-сотрудников после deploy. Если средняя «похоже на правду» < 3/5 — не выпускать в general availability.

### Smoke-тесты на проде
- Telegram bot (β-1) — реальный setup и /link → /ask flow
- MAX bot (β-1) — проверить формат updates после первого smoke
- ChatV2 omnichannel — `/ask` через Telegram → ответ через тот же канал
- Probe-Agent — реальная цепочка от specialist'а до notification

### Открытые вопросы для будущих фаз (γ+ или новый sub-ТЗ)
- Удаление `client` и `custom` из `EntityType` (после успешного применения rename patch на проде)
- Удаление legacy `card-rollup.worker` (после стабилизации `card-rollup-v2`)
- Удаление legacy `chat/` модуля (после стабилизации `chat-v2/`)
- ML-priority для Probe-Agent
- Multi-org агрегаты Skill (отраслевые бенчмарки)
- Voice-input для `/me/clone`

## Артефакты сессии

**Backend:** ~120 новых файлов + ~50 modified. 11 новых модулей: `chat-v2`, `clones`, `curation`, `decisions`, `events`, `ideas`, `insights`, `knowledge-clone`, `probe`, `regulations`, `vendors`. Specialist'ы 3-1..3-7 в `knowledge-core/`.

**Frontend:** ~30 новых страниц/компонентов + 11 API клиентов + 11 DomainModel модулей. Sidebar расширен 6 новыми пунктами («Регламенты», «Решения», «Сигналы», «Идеи», «Поставщики», «События»).

**Документация:** 11 файлов в `second-brain/01_projects/`, обновлены module-map / knowledge-core / index. Глоссарий `delivery/13-glossary.md` расширен 8 секциями.

**LLM:** 16 новых `LlmTaskType` + 7 seed-скриптов с tier-цепочками.

**Метрики:** ~30 новых counters/gauges/histograms через `BusinessMetricsService`.

**RBAC:** 11 новых ResourceType.
