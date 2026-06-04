---
type: tz
status: ready-to-implement
date: 2026-06-02
owner: sergrv80@gmail.com
relates_to:
  - plans/tz/2026-05-31-smart-tables.md
  - plans/tz/2026-05-31-document-ingest-universal.md
  - second-brain/01_projects/smart-tables.md
  - second-brain/02_architecture/knowledge-core.md
  - second-brain/02_architecture/llm-cache-status.md
  - docs/user-guide/20-tables.md
phases:
  - 0
  - 1
  - 2
  - 3
  - 4
  - 5
research_basis:
  - tana.inc/docs/supertags (primary, 3-0)
  - learn.microsoft.com/fabric/iq/ontology/overview (primary, 3-0)
  - support.airtable.com/docs/using-omni-ai-in-airtable (primary, 3-0)
  - knowledge.hubspot.com/properties/create-smart-properties (primary, 3-0)
  - granola.ai/blog/granola-hubspot-integration-crm-updates (primary, 3-0)
  - arxiv.org/html/2512.22250 (primary, 3-0)
  - arxiv.org/abs/2510.08623 — PARSE/ARCHITECT (primary, 3-0)
---

> 📦 **АРХИВ (аудит 2026-06-04): ✅ реализовано — 95%.**
> Все 6 фаз (0–5) + параллельные потоки (eval-harness, privacy-research) реализованы и закоммичены отдельными feature-коммитами; код подтверждён по schema.prisma, сервисам, контроллерам, воркерам, промптам, фронту и регист
> ⚠️ Хвосты (см. реестр приоритетов): Поток ЭВАЛЬ: блокер для включения feature-flag Фазы 1 — harness готов, прод-прогон и включение флага отложены в finishin
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


> **Статус:** ТЗ согласовано владельцем 2026-06-02 на базе deep-research (113 субагентов, 30 источников, 25 verified claims). Все принципиальные развилки закрыты. Это расширение/продолжение [Smart-tables ТЗ](2026-05-31-smart-tables.md): MVP-CRUD (Фазы 0-3) уже выкачен, эта ТЗ покрывает Фазы 0a (системные таблицы) + 4-9 (автоматизация). Старый Phase-номер не используется, чтобы не путать с базовым ТЗ.
>
> **Принцип:** удалить ручной труд по созданию и наполнению таблиц. Оставить ручным только (а) свободный текст в карточке-странице строки, (б) override предложенной AI-схемы перед материализацией, (в) подтверждение спорных правок ячеек из встреч.

# Smart-tables auto-creation — уход от ручного труда

## Зачем

Текущее состояние Smart-tables — это Notion-clone без AI: пользователь вводит название → добавляет колонки руками → заполняет ячейки руками. Это путь Teamly/Notion, в котором Z никогда не выиграет — у конкурентов фора в годы.

Deep-research 2026-06-02 показал: ни один из best-in-class игроков (Notion, Airtable, Coda, Tana, Microsoft Fabric, HubSpot) **не объединяет в одной архитектуре** четыре пути автоматизации:
- A. Text-to-Schema (есть у Airtable Omni)
- B. Graph-driven rows / live view over entity type (есть у Tana Supertags, Microsoft Fabric Ontology)
- C. Document-to-Table (есть у Airtable Omni / Notion AI / Coda Brain)
- D. Event-to-Cells из транскриптов (есть у HubSpot Smart Properties, частично у Granola)

Z может склеить все четыре поверх единого графа знаний компании — это и есть дифференциация. При этом критично закрыть три уязвимых места, которые deep-research нашёл у конкурентов: schema-linking hallucinations LLM, опасность auto-dump в ячейки без подтверждения, переоценка важности document-to-table относительно граф-привязки.

## Доказательная база (выжимка из deep-research)

**Категория валидирована hyperscaler-ом.** Microsoft Fabric Ontology — *"defines enterprise concepts as entity types (like Customer), properties... and relationships... After defining your ontology, bind the entity type definitions to real data, so downstream tools can share the same language"* + *"entity instance is... populated from data bindings (like a semantic row)"* — [learn.microsoft.com/fabric/iq/ontology/overview](https://learn.microsoft.com/en-us/fabric/iq/ontology/overview).

**Категория валидирована стартапом-евангелистом.** Tana Supertags — *"unlike traditional tags... in Tana the content IS the tag"* + *"All nodes with the same supertag form a collection you can search, filter, and view as a table"* — [tana.inc/docs/supertags](https://tana.inc/docs/supertags).

**Главный риск — schema-linking hallucinations LLM.** Primary failure mode в академии 2025-2026: *"Schema-Based hallucinations invoke nonexistent tables or columns; detecting them is hard..."* — [arxiv.org/html/2512.22250](https://arxiv.org/html/2512.22250). Митигация — ARCHITECT-style оптимизация схем: *"up to 64.7% improvement in extraction accuracy"* — [arxiv.org/abs/2510.08623](https://arxiv.org/abs/2510.08623).

**Event-to-Cells требует confirmation gate.** Granola: *"Most integrations fail not because transcription doesn't work, but because they auto-dump unverified summaries directly into CRM records. The right approach is AI capture, human verification, and then a deliberate sync"* — [granola.ai/blog/granola-hubspot-integration-crm-updates](https://www.granola.ai/blog/granola-hubspot-integration-crm-updates). HubSpot Smart Properties: workflow-action `Data Agent: Fill Smart Property` в BETA — индустрия осознанно не торопится с авто-патчем.

## Принятые архитектурные решения

| # | Решение | Обоснование |
|---|---|---|
| **Б1** | **10 системных таблиц создаются автоматически при создании Org**: «Клиенты и сделки», «Команда», «Гипотезы и эксперименты», «Поставщики и подрядчики», «Реестр рисков», «Идеи и бэклог», «Обещания и обязательства», «Контент-план», «Регламенты и документы», «Цели и метрики». Флаг `Table.isSystem = true`. | Zero clicks to value (deep-research caveat: HubSpot Smart Properties требует ручной активации каждой record — это барьер). Системная таблица — это и шаблон, и витрина возможностей. |
| **Б2** | **Системные таблицы НЕ удаляются hard-delete'ом** — только архив. Восстановление из архива доступно всем (owner/admin). Hard-delete пользовательских таблиц работает как сейчас (только из архива). | Защита от случайной потери, которая выглядит «системной» (потерять «Клиентов» — катастрофа). |
| **Б3** | **Поле `Table.isSystem: Boolean @default(false)` + `Table.systemKey: String?`** (стабильный идентификатор шаблона, e.g. `clients_deals`). | `systemKey` — единственный способ безопасно матчить системную таблицу при апгрейдах (правка пользовательского name не ломает миграции). |
| **Б4** | **Единая AI-точка входа — Кора-ассистент (Concierge), не AI-кнопочки в ячейках.** На странице `/tables` третья кнопка «Спросить Кору» открывает [Concierge](../../docs/user-guide/05-concierge.md) с заготовкой «Помогите создать таблицу для…». Никакого второго AI-UI внутри Tables. | Тренд индустрии 2026: Airtable Omni, Notion Custom Agents, Coda Brain — все ушли в conversational entrypoint. Совпадает с feedback_concierge_entry_visible_button. |
| **Б5** | **ARCHITECT-pass над сгенерированной схемой ОБЯЗАТЕЛЕН.** SchemaAgent сначала генерит черновик, потом второй проход рефлексирует (SCOPE — какие колонки лишние/недостаточные; ARCHITECT — какие типы оптимальны; ENTITY-CHECK — какие колонки соответствуют существующим типам сущностей графа). Только после трёх pass-ов — превью пользователю. | Закрытие primary failure mode из arxiv 2512.22250. +до 64.7% accuracy по PARSE (arxiv 2510.08623). |
| **Б6** | **Confirmation gate в Event-to-Cells по умолчанию ВКЛЮЧЁН** для всех ячеек, кроме explicit-confidence ≥ threshold (default 0.85). На неуверенных правках — пуш в conversational channel («после встречи X я обновила 3 ячейки в Сделках, посмотрите»). Auto-mode opt-in через настройку организации. | Granola philosophy. HubSpot Smart Properties BETA. Деградация доверия от auto-dump — задокументированный failure mode. |
| **Б7** | **Audit-link на тайминг встречи / абзац документа — обязателен** для каждой ячейки, обновлённой агентом. Хранится в новой `TableCellProvenance` (или в `TableRow.cellProvenance JSONB`, решит реализатор). UI — иконка-микро `🔗` рядом с ячейкой, тултип «обновлено из встречи X, 14:32». | Аудит-трейл — критично для доверия. Невозможно без него отлавливать ошибки агента. |
| **Б8** | **Path C (Document-to-Table) — самый низкий приоритет (Фаза 4).** Все умеют парсить документы, дифференциация Z только в (а) cosine-dedup схем для слияния с существующими таблицами, (б) привязка строк к существующим entity-нодам, не orphan. | Deep-research: «Document-to-Table — наименее дифференцированный путь». |
| **Б9** | **NL Saved Views — последняя Фаза (5).** NL-запрос → filter JSON через DeepSeek V4 Flash, кэшируется в `TableView.config.filter`. | Достраивает картину после A+B+C+D, не блокер. |
| **Б10** | **Промпт-кеи cache-friendly.** SYSTEM-блок содержит стабильный каталог типов колонок (13 штук) + каталог типов сущностей графа (org/person/meeting/document/...) + правила. USER в конце — короткий запрос пользователя или короткий контекст события. Цель — 95%+ cache hit. | feedback_llm_prompts_cache_friendly. DeepSeek/OpenAI-proxy/MiniMax кэшируют с экономией ≈99%. |
| **Б11** | **Primary LLM tier для SchemaAgent — DeepSeek V4 Pro** (capable). Для EnrichAgent (rowwise) — DeepSeek V4 Flash (дёшево). Никакой Ollama в prod-пути. | Совпадает с project_z_infra_and_ai и feedback_ollama_tertiary_only_deepseek_flash_cheap. |
| **Б12** | **Eval Text-to-Schema на 100 русских NL-промптах ДО раскатки Фазы 1 на всех Org.** Параллельный поток к Фазе 1, не блокер для merge, но блокер для feature-flag `feature.tables_text_to_schema` = on. | Все известные benchmark'и (PARSE, RSL-SQL) — английские. Open question из deep-research caveats. |
| **Б13** | **Privacy/конфиденциальность positioning — отдельный research до GTM в РФ.** Не блокирует разработку, но включается в маркетинговый pitch отдельным разделом. | Open question deep-research. Notion AI privacy reviews показывают, что это becomes-or-breaks GTM в РФ. |
| **Б14** | **Тариф один.** Никаких free/paid веток в коде. Технические лимиты единые: `TABLE_AGENT_MAX_DAILY_TOKENS`, `TABLE_AGENT_MAX_CONCURRENT_ENRICH_JOBS_PER_ORG`, `TABLE_AGENT_CONFIRMATION_THRESHOLD` — в [`AdminSetting`](../../second-brain/01_projects/admin-settings.md), не в коде. | feedback_admin_settings_not_env_or_code. |

## Архитектура (high-level)

```
┌─────────────────────────────────────────────────────────────────┐
│                       /tables (frontend)                        │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────┐     │
│  │ + Создать пустую │  │ + Из файла       │  │ Спросить   │     │
│  │   (как сейчас)   │  │   (Phase 4)      │  │ Кору       │     │
│  └──────────────────┘  └──────────────────┘  └─────┬──────┘     │
└─────────────────────────────────────────────────────│───────────┘
                                                     │
              ┌──────────────────────────────────────┼───────────────────────┐
              │                                      ▼                       │
              │     Concierge → TableAgent (backend/src/modules/tables/      │
              │                            services/table-agent.service.ts)  │
              │                                                              │
              │  ┌─────────────────┐  ┌─────────────────┐  ┌───────────────┐ │
              │  │ inferSchema     │  │ populateFromGraph│ │ enrichFromEvent│ │
              │  │ FromText        │  │ (Path B)         │ │ (Path D)       │ │
              │  │ (Path A)        │  │                  │ │                │ │
              │  └────────┬────────┘  └────────┬─────────┘ └────────┬───────┘ │
              │           │                    │                    │         │
              │           │  ┌─────────────────┴─────────┐          │         │
              │           │  │ populateFromDocument      │          │         │
              │           │  │ (Path C)                  │          │         │
              │           │  └───────────────────────────┘          │         │
              └───────────┼────────────────────────────────────────┼─────────┘
                          │                                        │
                          ▼                                        ▼
                  LLMRouter (DeepSeek V4 Pro/Flash)        BullMQ воркеры:
                  prompt-keys:                              - table-sync.worker     (Path B)
                    table.infer-schema                      - table-enrich.worker   (Path D)
                    table.architect-pass                    - table-doc-import.worker (Path C)
                    table.entity-check
                    table.extract-rows
                    table.auto-fill
                    table.semantic-filter
                          │                                        │
                          └───────────────┬────────────────────────┘
                                          ▼
                              Prisma: Table / TableProperty / TableRow / TableView
                                          + новые: TableCellProvenance
                                          + новое поле: Table.isSystem / Table.systemKey
                                          + EntityGraph (org/person/meeting/document)
```

---

## Фаза 0 — Системные таблицы при создании Org (auto-provision)

### Цель
При создании любой новой Org в системе автоматически создаются 10 системных таблиц со схемой по умолчанию. Эти таблицы видны в `/tables` сразу после первого входа. Пользователь может архивировать, восстанавливать, добавлять/удалять колонки, добавлять строки. Hard-delete недоступен.

### Что входит
1. **Миграция Prisma**: добавить в модель `Table` поля `isSystem Boolean @default(false)` и `systemKey String? @unique` (uniq в пределах tenant). Индекс `@@index([tenantId, isSystem])`.
2. **Сидер `TablesAutoProvisionService.provisionDefaults(orgId, userId)`** в `backend/src/modules/tables/services/`. Идемпотентный: вызов на уже provisioned Org — no-op (проверка `systemKey` существования).
3. **Каталог 10 шаблонов** — `backend/src/modules/tables/templates/system-tables.catalog.ts` (TypeScript-константа, не БД):

| systemKey | Имя | Иконка | entitySync.type | Ключевые колонки |
|---|---|---|---|---|
| `clients_deals` | Клиенты и сделки | 💼 | `org` | название, контакт-`person`, телефон, email, стадия-`status`, сумма-`currency`, дата касания-`date`, ответственный-`person` |
| `team` | Команда | 👥 | `person` | имя, должность, отдел-`selectSingle`, навыки-`selectMulti`, руководитель-`person`, дата найма-`date` |
| `hypotheses` | Гипотезы и эксперименты | 🧪 | `experiment`* | формулировка-`longtext`, статус-`status`, метрика, ответственный-`person`, дата старта-`date`, результат-`longtext` |
| `vendors` | Поставщики и подрядчики | 🤝 | `org` | название, услуга-`selectSingle`, стоимость-`currency`, договор-`url`, активен-`checkbox`, ответственный-`person` |
| `risks` | Реестр рисков | ⚠️ | (нет) | описание-`longtext`, вероятность-`status`, влияние-`status`, митигация-`longtext`, статус-`status`, владелец-`person` |
| `ideas` | Идеи и бэклог | 💡 | `idea` | формулировка-`longtext`, источник-`selectSingle`, приоритет-`status`, ответственный-`person`, статус-`status` |
| `promises` | Обещания и обязательства | 🤞 | `promise` | кому-`person`, что-`longtext`, срок-`date`, статус-`status`, источник-`text` |
| `content_plan` | Контент-план | 📰 | (нет) | заголовок, формат-`selectSingle`, канал-`selectSingle`, дата публикации-`date`, статус-`status`, ответственный-`person` |
| `regulations` | Регламенты и документы | 📋 | `document` | название, область-`selectSingle`, владелец-`person`, дата ревизии-`date`, статус-`status` |
| `okr` | Цели и метрики | 🎯 | `goal` | формулировка-`longtext`, метрика, текущее-`number`, целевое-`number`, срок-`date`, ответственный-`person` |

*Если entity-тип `experiment`/`idea`/`promise`/`goal` отсутствует в текущей схеме графа — реализатор либо использует ближайший доступный, либо помечает таблицу `entitySync: null` с TODO. Не блокер для Фазы 0.

4. **Backfill-скрипт** `backend/scripts/backfill-system-tables.ts`: проходит по всем существующим Org, для каждой вызывает `provisionDefaults`. Регистрируется в `apply-prod-deploy.ts` STEPS как `phase: backfill`, `skipBootstrap: true`.
5. **Hook на создание Org**: вызов `provisionDefaults` после успешного `Org.create`. Точку входа реализатор найдёт сам (вероятно в `orgs.service.ts` или org-onboarding flow).
6. **Backend: блок hard-delete для системных таблиц** — в `TablesService.hardDelete`: если `existing.isSystem === true`, бросать `ForbiddenException` с кодом `system_table_hard_delete_forbidden`.
7. **Frontend**: на карточке системной таблицы — иконка-маркер 🔒 «системная» + tooltip «системная таблица — её можно архивировать, но не удалить навсегда». В шапке таблицы убрать кнопку «Удалить навсегда» (оставить только «В архив»).

### Что НЕ входит
- AI-генерация схемы (Фаза 1).
- Graph-driven автоматическое наполнение строк (Фаза 2 — наполнение будет тогда). В Фазе 0 системные таблицы создаются **пустыми**, без строк.
- Опросник «вы B2C или B2B» при онбординге — все 10 шаблонов идут всем.

### Изменения в БД
```prisma
model Table {
  // ... существующие поля
  isSystem  Boolean @default(false)
  systemKey String?
  // ... существующие
  @@unique([tenantId, systemKey])
  @@index([tenantId, isSystem])
}
```
Применяется через `bun run prisma:push` + `bun run prisma:generate`. Без `migrate*` (см. skill prisma-db-push-rules).

### Acceptance criteria
- [ ] При вызове `Org.create` (или эквивалентного flow создания организации) — в БД появляются 10 записей `Table` с `isSystem=true`, `tenantId=$newOrgId`, валидным `systemKey` из каталога.
- [ ] При повторном вызове `provisionDefaults($sameOrg)` — БД не меняется (идемпотентность).
- [ ] Существующие Org получают 10 таблиц после прогона `backend/scripts/backfill-system-tables.ts`.
- [ ] На странице `/tables` системные таблицы помечены иконкой-маркером и не дают опции hard-delete.
- [ ] Кнопка «В архив» работает для системных таблиц. Кнопка «Из архива» возвращает таблицу видимой.
- [ ] Попытка hard-delete системной таблицы через API возвращает 403 с понятным error-code.
- [ ] Тесты: unit для `provisionDefaults` (идемпотентность, корректность всех 10 шаблонов), e2e для блокировки hard-delete.

---

## Фаза 1 — Text-to-Schema через Кору-ассистента

### Цель
Пользователь пишет в Concierge «нужна таблица клиентов с контактами и стадией сделки» → видит превью схемы (колонки + типы + опц. entitySync) → подтверждает / правит → таблица создаётся.

### Что входит
1. **Concierge intent `tables.create_from_text`** — реализатор смотрит существующую архитектуру Concierge (вероятно `backend/src/modules/concierge/` или `chat-v2/`) и добавляет новый intent + handler.
2. **`TableAgentService.inferSchemaFromText(prompt, orgContext)`** в `backend/src/modules/tables/services/table-agent.service.ts`. Три pass'а:
   - **SchemaAgent draft** — DeepSeek V4 Pro через `LLMRouter`, prompt-key `table.infer-schema`. SYSTEM-block: каталог 13 типов колонок + каталог типов сущностей графа + список 10 системных таблиц как эталоны.
   - **ARCHITECT-pass** — второй вызов того же LLM, prompt-key `table.architect-pass`. Вход: черновик схемы. Задача: убрать дубли, выбрать оптимальные типы, выявить недостающие колонки. Выход: оптимизированная схема + diff.
   - **ENTITY-CHECK** — prompt-key `table.entity-check`. Сравнивает предложенный `entitySync.type` с реально доступными типами сущностей в графе тенанта (запрос через `KnowledgeCoreService.listEntityTypes(tenantId)`). Если нет совпадения — `entitySync: null` + flag «без привязки к графу».
3. **UI превью схемы** в Concierge-окне: компактный список колонок (name + type icon + sample value), кнопка «Подтвердить и создать», кнопка «Изменить» (открывает inline-edit: убрать колонку, переименовать, поменять тип).
4. **POST `/api/v1/tables/from-schema`** — новый эндпоинт. Body: `{ name, description?, icon?, entitySync?, properties: [...] }`. Внутри — вызов существующего `TablesService.create` + bulk `TablePropertiesService.create`.
5. **Prompt-keys в registry** (`backend/src/modules/ai/services/prompts/` или эквивалентном месте, реализатор сверит с существующей структурой):
   - `table.infer-schema` (SchemaAgent draft)
   - `table.architect-pass` (рефлексия)
   - `table.entity-check` (валидация привязки)
6. **Feature-flag `feature.tables_text_to_schema`** в `AdminSetting`, default `off`. Включается отдельно после Фазы 1.5 (eval).

### Что НЕ входит
- Автоматическое наполнение строк после создания (Фаза 2).
- Прямая UI-кнопка «Создать через AI» в /tables (точка входа только через Concierge).

### Параллельный поток (блокер для включения feature-flag)
**Фаза 1.5 — Eval Text-to-Schema на 100 русских NL-промптах.**
- Сет из 100 запросов, разные тематики (HR, продажи, продукт, операционка), разный уровень специфичности.
- Метрики: schema-accuracy (precision/recall по колонкам vs golden), type-correctness, entity-binding-correctness, hallucination-rate.
- Threshold: schema-accuracy ≥ 0.85, hallucination-rate ≤ 0.05.
- Положить в `backend/test/eval/text-to-schema/` (как существующий eval-pattern, реализатор сверит).

### Acceptance criteria
- [ ] Пользователь пишет в Concierge «нужна таблица X» — получает превью схемы за ≤ 8 секунд (95 percentile).
- [ ] Превью показывает: name, описание, иконка, ≥3 колонки, тип каждой колонки, опц. entitySync.
- [ ] Кнопка «Подтвердить» создаёт таблицу через `/api/v1/tables/from-schema`.
- [ ] Eval на 100 русских промптах ≥ 0.85 accuracy до включения feature-flag.
- [ ] Каждый prompt-key проходит prompt-caching review (95%+ cache hit на повторных вызовах).
- [ ] Unit-тесты на `inferSchemaFromText` с моком LLM (3 случая: успешный, hallucinated column, no entity match).

---

## Фаза 2 — Graph-driven rows (живой entitySync)

### Цель
Системная таблица «Клиенты и сделки» (entitySync.type=org) автоматически содержит **все Org из памяти компании** как строки. Создаётся новая Org в графе — появляется строка. Архивируется Org — строка уходит в архив.

### Что входит
1. **Initial backfill** — при первом включении `entitySync.autoCreate=true` для таблицы (через сидер Фазы 0 или вручную через PATCH `/tables/:id`) — синхронный запрос: все Entity указанного типа в tenant → bulk insert TableRow. Если ≥1000 сущностей — фоновая задача в BullMQ.
2. **BullMQ-воркер `table-sync.worker`** — `backend/src/modules/tables/workers/table-sync.worker.ts`. Слушает события:
   - `entity.created` → добавить строку во все таблицы с подходящим entitySync.
   - `entity.updated` → обновить ячейки-атрибуты сущности (имя, домен, etc) в существующих строках.
   - `entity.archived` / `entity.deleted` → пометить строку `archivedAt` (не удалять).
   Реализатор найдёт существующий event-bus паттерн (вероятно через BullMQ pub/sub или EventEmitter из NestJS).
3. **Колонки-атрибуты сущности — read-only.** В UI отображаются с иконкой 🔗 и tooltip «значение приходит из памяти компании». Edit летит в саму Entity через `EntitiesService`, не в `TableRow.cells`.
4. **Конфликт-резолвер.** Если пользователь вручную добавил строку в `entitySync`-таблицу до initial backfill, и эта строка матчится с Entity (например, по `cells.email`) — слить, использовать пользовательский custom-cells override + автоматические attributes от Entity.

### Что НЕ входит
- Обратная синхронизация cells → Entity properties (это будет в потенциальной Фазе 6).
- Граф-driven фильтрация в Views (Phase 5 / NL Views).

### Acceptance criteria
- [ ] Создание новой Entity типа `org` в тенанте → в течение ≤ 5 секунд появляется строка в системной таблице «Клиенты и сделки».
- [ ] Изменение имени Org в EntitiesService → ячейка `name` в строке обновляется автоматически.
- [ ] Архивация Org → строка получает `archivedAt`.
- [ ] Initial backfill на 500 Entity занимает ≤ 30 секунд (синхронно) или ≤ 5 минут (фоновая задача).
- [ ] Read-only attribute-колонки нельзя редактировать через UI и через PATCH `/rows/:rowId` (возвращает 422).
- [ ] Unit-тесты воркера на три события + один e2e-тест end-to-end (create Entity → row appears).

---

## Фаза 3 — Event-to-Cells из транскриптов встреч

### Цель
После завершения встречи EnrichAgent читает транскрипт, ищет факты по схемам колонок открытых таблиц, патчит пустые/устаревшие ячейки **с audit-link** на тайминг встречи. Спорные правки требуют подтверждения.

### Что входит
1. **BullMQ-воркер `table-enrich.worker`** — слушает событие `meeting.finalized` (реализатор найдёт точку эмита в `meetings.service.ts` или ai-pipeline).
2. **`TableAgentService.enrichFromEvent({ eventType, payload })`** — оркестрирует:
   - Получить список таблиц tenant с непустыми entitySync, где attendees встречи ∈ entity-связь.
   - Для каждой такой таблицы — взять property-схему, собрать запрос к транскрипту.
   - DeepSeek V4 Flash через `LLMRouter`, prompt-key `table.extract-rows`. SYSTEM: каталог типов + правила «отвечай только если факт прямо назван в транскрипте». USER: транскрипт-chunk + property-схема.
   - Получить facts[] с confidence-score.
   - Для каждого факта: найти строку (по entity-link), проверить — пусто/устарело/новое. Если confidence ≥ `TABLE_AGENT_CONFIRMATION_THRESHOLD` (admin-setting, default 0.85) — применить патч; иначе — положить в очередь подтверждений.
3. **Новая модель `TableCellProvenance`** (или JSON-поле в TableRow — реализатор сравнит cost/benefit):
   ```prisma
   model TableCellProvenance {
     id           String   @id @default(cuid())
     tableRowId   String
     propertyId   String
     sourceType   String   // 'meeting' | 'document' | 'manual'
     sourceId     String   // meetingId / documentId
     sourceLabel  String   // "Встреча Алексей×Бета-Корп, 14:32"
     sourceLink   String?  // deep-link на тайминг
     confidence   Decimal? @db.Decimal(3,2)
     appliedAt    DateTime @default(now())
     appliedBy    String   // 'agent' | userId
     @@index([tableRowId, propertyId])
   }
   ```
4. **Очередь подтверждений** — `TableCellPendingPatch` (модель + сервис). При confidence < threshold или auto-mode=off — патч не применяется, кладётся в очередь. Уведомление в Concierge: «после встречи X я подготовила 3 правки в Сделках — посмотрите». Пользователь подтверждает batch'ем (одним кликом «принять все» или selective).
5. **UI**: в карточке строки рядом с ячейкой, обновлённой агентом, — иконка 🔗 + click → раскрыть provenance: «обновлено из встречи Алексей×Бета-Корп, 14:32, цитата: "договорились на 2.4М"». Возможность undo одной кнопкой.
6. **Prompt-keys**:
   - `table.extract-rows` (вытащить факты из транскрипта по схеме).
   - `table.auto-fill` (рекомендация значения для конкретной ячейки).

### Что НЕ входит
- Document-to-Table (Phase 4).
- Авто-создание новой Entity, если в транскрипте упомянута неизвестная организация (это работа KnowledgeCore, не Tables).
- Полное переписывание non-empty ячейки агентом (всегда требует подтверждения, независимо от confidence).

### Acceptance criteria
- [ ] Встреча с прозвучавшим фактом «договорились на 2.4М» → ячейка `amount` в строке клиента патчится автоматически (если confidence ≥ 0.85).
- [ ] При confidence < 0.85 → патч в очереди, уведомление в Concierge.
- [ ] Audit-link на каждой обновлённой ячейке — кликается, открывает тайминг встречи.
- [ ] Undo одной кнопкой возвращает ячейку к предыдущему значению.
- [ ] Throttling: один Org не может вызвать >100 одновременных enrich-job'ов (admin-setting).
- [ ] Кэш по `(entityId, propertyId, source-event-id)` — повторный enrich того же события не вызывает повторный LLM-call.
- [ ] e2e-тест: создать встречу, добавить fake transcript с известным фактом, проверить что ячейка патчится с audit-link.

---

## Фаза 4 — Document-to-Table

### Цель
Пользователь загружает Excel/PDF/CSV (включая скан-таблицы) → Кора инфёрит схему и предлагает: «слить с существующей таблицей X (cosine 0.91)» или «создать новую». Подтверждает — строки появляются.

### Что входит
1. **Интеграция с Document Conversion Service (DCS)** из [document-ingest ТЗ](2026-05-31-document-ingest-universal.md). DCS возвращает структурированный `tables[]` для офисных форматов и сканов.
2. **`TableAgentService.populateFromDocument(documentId, userIntent)`**:
   - Получить `tables[]` от DCS.
   - SchemaInferAgent (тот же prompt-pipeline, что Фаза 1, но вход — первые 20 строк документа, не NL-промпт) → схема.
   - **Dedup-step**: посчитать schema-embedding (`text-embedding-3-small`) для предложенной схемы и существующих таблиц tenant. Если cosine ≥ 0.85 — предложить слияние.
   - **Entity-linking** для строк: попытаться сматчить по primary-property (для `org` — name + domain) с существующими Entity. Сматченные строки — обновление; новые — insert + (опц.) create Entity.
3. **UI на странице `/tables`**: кнопка «Из файла» открывает drag&drop окно. После аплоада — превью схемы (как в Фазе 1) + блок «найдено совпадение со схемой "Поставщики" (91% совпадения) — слить?». Кнопки «Слить», «Создать новую», «Отменить».

### Что НЕ входит
- Сложные multi-table документы (несколько таблиц в одном Excel-листе) — bracket для будущих фаз; обрабатываем первую таблицу.
- Запись обратно в исходный документ.

### Acceptance criteria
- [ ] Загрузка Excel с 50 строк клиентов → за ≤ 30 секунд предложение «слить с Клиентами» или «создать новую».
- [ ] Cosine-dedup правильно срабатывает: ≥ 0.85 предлагает слияние, < 0.85 предлагает новую.
- [ ] Entity-linking сматчивает ≥ 80% строк, у которых в графе есть точное совпадение по primary-property.
- [ ] e2e-тест: загрузить тестовый Excel с 10 организаций (5 уже в графе, 5 новых) → 10 строк, 5 связаны со существующими Entity.

---

## Фаза 5 — NL Saved Views

### Цель
Пользователь в шапке таблицы пишет «покажи клиентов, кому месяц никто не писал» → Кора конвертит в filter JSON, применяет + предлагает сохранить как view.

### Что входит
1. **Prompt-key `table.semantic-filter`** — DeepSeek V4 Flash. SYSTEM: схема текущей таблицы + правила фильтрации (поддерживаемые операторы: eq/neq/gt/lt/contains/in/empty/before/after/older-than). USER: NL-запрос.
2. **`TableViewsService.parseSemanticFilter(tableId, nlQuery)`** → filter JSON, валидируется против `TableProperty.type`.
3. **UI**: в шапке `ViewSelector` поле ввода «Найти срез: …» рядом с кнопкой «Виды». После применения — кнопка «Сохранить как новый вид».
4. **Кэш** filter JSON по `(tableId, normalizedQuery)` — повторный запрос не вызывает LLM.

### Acceptance criteria
- [ ] «Покажи клиентов с просроченной оплатой» → корректный filter applied.
- [ ] Cache-hit на повторном запросе.
- [ ] Сохранение в TableView с visibility (личное/команде/публичная ссылка) работает.

---

## Параллельные потоки (не привязаны к конкретной фазе)

### Поток ЭВАЛЬ: Eval Text-to-Schema на 100 русских промптах
Блокер для feature-flag Фазы 1. См. подробности в Фазе 1.

### Поток PRIVACY: positioning-research по конфиденциальности
- Что говорят про privacy у Notion AI, Coda Brain, Airtable Omni, Tana, Microsoft Fabric (training data, where data flows, on-prem options).
- Куда уходят данные при enrich-вызове (proxy.agent-lia.ru → DeepSeek — данные не покидают РФ? — проверить, документировать).
- Privacy-блок в маркетинговом pitch для РФ-клиента.
- Не блокирует Фазы 0-5, но обязателен до публичного GTM.

---

## Острые места / Caveats

1. **Schema-linking hallucinations.** Митигация — ARCHITECT-pass (Б5), ENTITY-CHECK (Б5), eval (Б12). Невозможно довести до 0%; цель — < 5%.
2. **Стоимость event-to-cells enrichment.** В deep-research не верифицирована точно (HubSpot ~10 credits/record, Clay $0.10-$1.00/row). Митигация — throttling, кэш, threshold-патчи (Б6, Б14).
3. **Granola-style human-in-loop vs full automation tension.** Решение Б6: confirmation gate включён по умолчанию, auto-mode opt-in. Реализатор не должен «оптимизировать» это убрав gate.
4. **Системные таблицы при изменении каталога.** Если в Фазе 0+1 мы хотим добавить 11-й шаблон через 6 месяцев — backfill-скрипт прогоняет всех existing Org. `systemKey` остаётся стабильным.
5. **B2C-стартап получит «Поставщики» пустыми.** Решение: оставить как есть; не делать опросник в онбординге. Пустая системная таблица не вредит (можно архивировать).

## Open questions (вне scope ТЗ, но нужно ответить до GTM)
1. Privacy story для РФ — поток PRIVACY выше.
2. Точная стоимость enrichment per 1000 Entity per month при текущих ценах DeepSeek через proxy.
3. Готов ли Tana или Notion к Q3 2026 выкатить аналог auto-provision over knowledge graph — если да, окно дифференциации Z сужается.

## Связи с другими ТЗ
- **[plans/tz/2026-05-31-smart-tables.md](2026-05-31-smart-tables.md)** — базовое ТЗ Smart-tables, MVP-CRUD (Фазы 0-3 базового ТЗ) уже реализован. Это ТЗ — продолжение.
- **[plans/tz/2026-05-31-document-ingest-universal.md](2026-05-31-document-ingest-universal.md)** — Document Conversion Service, на который опирается Phase 4.
- **[second-brain/02_architecture/knowledge-core.md](../../second-brain/02_architecture/knowledge-core.md)** — pipeline графа знаний, источник Entity для Path B.
- **[second-brain/02_architecture/llm-cache-status.md](../../second-brain/02_architecture/llm-cache-status.md)** — cache-friendly prompt patterns (Б10).
- **[docs/user-guide/20-tables.md](../../docs/user-guide/20-tables.md)** — пользовательская справка, обновляется после каждой фазы.

## Итог: что должно быть в проде после всех фаз

1. Новая Org → 10 системных таблиц мгновенно (Фаза 0).
2. Эти таблицы наполняются автоматически из графа знаний (Фаза 2).
3. Пользователь хочет нестандартную таблицу → говорит словами Коре → получает превью → подтверждает (Фаза 1).
4. После каждой встречи ячейки обновляются с audit-link, спорное — на подтверждение (Фаза 3).
5. Загрузка Excel/PDF → таблица или merge с существующей (Фаза 4).
6. NL-запрос в виде создаёт фильтр (Фаза 5).

Ручной труд остаётся только в трёх местах: свободный текст в карточке-странице строки, override превью схемы перед созданием, подтверждение спорных правок из встреч. Всё остальное — автоматика поверх единого графа знаний компании.
