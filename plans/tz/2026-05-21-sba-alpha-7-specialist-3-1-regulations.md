---
type: tz
status: draft
feature: SBA α-7 — Specialist 3.1 (Regulations) — поглощает каркас 5 уровней Фазы 0b
date: 2026-05-21
parent_tz: tz/2026-05-21-second-brain-agents-umbrella.md
phase: alpha
depends_on:
  - tz/2026-05-21-sba-alpha-2-layer1-marking-extension.md (signalType='regulation'/'process_step')
  - tz/2026-05-21-sba-alpha-3-layer2-ontology-extension.md (RouterService)
  - tz/2026-05-21-sba-alpha-4-layer4-curation-foundation.md (triage)
  - tz/2026-05-21-sba-alpha-6-specialist-3-4-project-customer.md (как референс контракта)
soft_depends_on:
  - tz/2026-05-21-phase-0b-document-ingest.md (если реализован — переиспользуем extraction)
covers_matrix_rows: [A2, B6, C1, J1..J11, L4, M3..M10]
---

# ТЗ α-7: Specialist 3.1 — Regulations

> **Это sub-TZ.** Зонтичный — [`plans/tz/2026-05-21-second-brain-agents-umbrella.md`](2026-05-21-second-brain-agents-umbrella.md). При расхождениях — приоритет у зонтичного.
>
> **Контракт специалиста §5** — реализация по образцу α-6. Если что-то неясно — смотри туда.
>
> **Поглощение Фазы 0b.** Каркас 5 уровней (Mission/Process/Regulation/Policy/Tool/Metric/Decision) из [Фазы 0b](2026-05-21-phase-0b-document-ingest.md) — это и есть карточки Слоя 3. В α-7 закрываем Process/Regulation/Policy. Decision — отдельно в β-3. Mission/Vision/Strategy — позже в γ.

---

## 1. Цель

После α-7 специалист 3.1 работает:
- Извлекает регламенты, процессы, политики из блоков с `signalType='regulation'/'process_step'`.
- Дедуплицирует: «один регламент = одна каноническая карточка с версиями».
- Извлекает шаги процесса как структурированные поля для `kind='process'`.
- Регистрируется в `CardSpecialistRegistry` для chat-v2.
- Подключён к Слою 4 (regulation/process/policy = critical-types, всегда deep review).
- Эмиссит probe-events: «новый процесс упомянут, кто owner?», «регламент устарел — подтвердить?».
- UI `/regulations` master-detail с фильтрами по `kind`/`owner`/`scope`.

Это **первая видимая ценность** Слоя 3: «у нас появились регламенты сами собой».

---

## 2. Зависимости

**Зависит от:** α-2, α-3, α-4, α-6 (как референс).

**Опционально от:** [Фаза 0b](2026-05-21-phase-0b-document-ingest.md) — если реализована, переиспользуем её extraction; если нет — α-7 работает только из встреч + чек-инов.

**Разблокирует:** β-3 (Decisions — берёт ту же структуру).

---

## 3. Scope

### Входит

- 1 Prisma-модель `Regulation` (с `kind: 'regulation' | 'process' | 'policy' | 'standard'`).
- Воркер `regulation-detector.worker` — consumer `core.specialist-routing` для jobName '3-1-regulations'.
- LLM-extraction промпт `regulation-extract` (placeholder + TODO).
- Дедуп через KNN cosine + LLM-арбитр (`regulation-dedupe`).
- Извлечение шагов процесса (для kind='process') — `process-steps-extract` (опц. отдельный LLM-вызов).
- Интеграция с CurationService.triage (regulation в critical-list → always deep review).
- Интеграция с ConversationalService для probe-events.
- Регистрация в `CardSpecialistRegistry`.
- API: `/api/v1/regulations` + детальные эндпоинты.
- UI: `/regulations` master-detail.
- 3 новых `LlmTaskType` с тремя provider'ами каждый.
- Поглощение существующих сущностей из Фазы 0b (если есть) — миграционный patch-script.

### Не входит

- Decision (β-3), Mission/Vision/Strategy (γ), Risk (β-4), Metric (γ).
- UI назначения owner регламента (упрощённо в α-7, расширенный — в γ).
- Workflow approval-цепочки (γ+).
- Импорт из Confluence/Notion/SharePoint (отдельный sub-TZ в ε).

---

## 4. Модель данных

```prisma
model Regulation {
  id              String   @id @default(uuid())
  tenantId        String
  entityId        String?  @unique  // связка с графом (опц., создаётся если стало canonical)
  kind            RegulationKind  // 'regulation' | 'process' | 'policy' | 'standard'
  title           String
  statement       String   @db.Text   // суть регламента/процесса
  scope           String?  // 'org' | 'department:<id>' | 'role:<id>' | 'project:<id>'
  ownerEntityId   String?  // кто отвечает (Person или Department)
  status          RegulationStatus  // 'draft' | 'canonical' | 'superseded' | 'archived'
  supersedesId    String?  // → Regulation
  currentVersionId String?  // → CardVersion
  sourceBlockIds  String[]
  personSubjectIds String[]
  confidence      Decimal  @db.Decimal(4, 3)
  dataClass       DataClass
  embedding       Unsupported("vector(1536)")?  // для дедупа и chat-v2 retrieval

  // Для kind='process'
  processSteps    Json?    // массив { ord, title, role, durationMin?, condition? }
  inputs          Json?    // что нужно для запуска процесса
  outputs         Json?    // что производит процесс
  metrics         Json?    // как меряем (текст пока, в γ — связь с Metric model)

  // Для kind='policy'
  severity        PolicySeverity?  // 'recommended' | 'standard' | 'mandatory' | 'critical'

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  lastConfirmedAt DateTime?
  @@index([tenantId, kind, status])
  @@index([tenantId, scope])
}
```

HNSW индекс на `embedding` — через `apply-postgres-init.sql`.

---

## 5. Воркер regulation-detector

```ts
@Processor(CORE_QUEUE_NAMES.SPECIALIST_ROUTING)
export class RegulationDetectorWorker {
  @Process('3-1-regulations')
  async handle(job: Job<RoutedBlock>) {
    const block = await this.prisma.ideaBlock.findUnique(...);
    if (!['regulation', 'process_step'].includes(block.signalType)) return;

    // 1. LLM-extraction (regulation-extract): из блока → черновик Regulation
    const draft = await this.llmRouter.call({ taskType: 'regulation-extract', ... });

    // 2. Если kind='process' и блок дает шаг — присоединяем к существующему Process или создаём новый
    // 3. KNN cosine top-5 существующих Regulation того же kind в Org
    // 4. LLM-арбитр regulation-dedupe: новый regulation, merge с существующим, или extension существующего
    // 5. Сборка proposedPayload (с sourceBlockIds, personSubjectIds, confidence)
    // 6. CurationService.triage(card='regulation', proposedPayload, ...)
    //    Так как kind='regulation'/'process'/'policy' в critical-list → ВСЕГДА deep review
    // 7. На approve → создаётся CardVersion(version=N) + обновляется Regulation
    // 8. Метрики
  }
}
```

---

## 6. Probe-events

| Reason | Trigger | Recipient |
|---|---|---|
| `regulation.missing_owner` | новый regulation без `ownerEntityId` | owner/admin Org |
| `regulation.process_no_steps` | kind='process' AND processSteps IS NULL | owner/admin или process owner если есть |
| `regulation.stale` | lastConfirmedAt > 6 мес AND есть свежие блоки противоречия | regulation owner |
| `regulation.scope_unclear` | scope IS NULL для важного regulation | owner/admin |

---

## 7. Conflict-events

| Type | Trigger | Suggested resolution |
|---|---|---|
| `regulation.contradicts_existing` | LLM-арбитр сказал «противоречит» | manual + LLM-arbiter suggestion |
| `regulation.process_step_conflict` | разные шаги для одного процесса в разных источниках | `evolving` если новые источники свежее старых |

---

## 8. ENV

```
REGULATION_DEDUPE_THRESHOLD=0.85  # cosine
REGULATION_KNN_TOP_K=5
REGULATION_STALE_MONTHS=6
```

---

## 9. RBAC

`regulation` ResourceType:
- read: все member'ы Org
- write/delete/supersede: owner/admin + curator (если назначен через `CuratorAssignment`)

---

## 10. Метрики (по §5.7 контракта)

```
core_specialist_cards_total{type='regulation', kind, status}
core_specialist_pipeline_duration_seconds{type='regulation'}
core_specialist_llm_tokens_total{type='regulation', model, tier}
core_specialist_probe_events_total{type='regulation', reason}
core_specialist_conflict_events_total{type='regulation'}
core_specialist_extraction_failures_total{type='regulation', reason}
```

---

## 11. LLM (3 уровня обязательны)

**3 новых `LlmTaskType`:**

1. **`regulation-extract`** — извлечение черновика Regulation из IdeaBlock. JSON Schema strict.
   - Primary, Secondary, Tertiary (Ollama qwen3:30b) — placeholder, согласовать с playbook.
   - Все три фильтр `maxDataClass >= 'confidential'`.

2. **`regulation-dedupe`** — арбитр merge/new/extension. JSON Schema strict.
   - Дешевле чем extract, но та же 3-уровневая цепочка.

3. **`process-steps-extract`** — структурированное извлечение шагов из текста. JSON Schema strict.
   - Та же цепочка.

**Seed-script:** `seed-llm-task-routes-regulations.ts` со ссылкой на [llm-models-playbook.md](../../llm-models-playbook.md) в комментарии.

---

## 12. UI `/regulations`

Master-detail:
- Левая колонка — список Regulation с фильтрами:
  - `kind`: regulation/process/policy/standard
  - `status`: canonical/superseded/draft
  - `scope`: my/department/all
  - search по title/statement
- Правая колонка — детальная страница:
  - Title, kind, status, owner, scope, severity (для policy)
  - Statement (markdown render)
  - Для process — список шагов (ord, title, role)
  - История версий (CardVersion timeline)
  - Provenance (sourceBlockIds → ссылки на встречи/документы)
  - `<CurationBanner>` (если pending)
  - Действия: «отметить устаревшим», «superseded by», «manually edit» (admin)

API:
- `GET /api/v1/regulations` (с фильтрами, пагинация)
- `GET /api/v1/regulations/:id`
- `GET /api/v1/regulations/:id/history` — CardVersion timeline
- `POST /api/v1/regulations/:id/supersede` (admin) — `{ supersededByRegulationId }`
- `POST /api/v1/regulations/:id/confirm` — обновить `lastConfirmedAt` (owner или admin)

---

## 13. Фазы реализации

- [ ] **α-7.0** Ревью существующих сущностей в Фазе 0b (если реализована) — что нужно мигрировать.
- [ ] **α-7.1** Prisma-модель `Regulation` + enum'ы + HNSW индекс через `apply-postgres-init.sql` + `bun run prisma:push`.
- [ ] **α-7.2** Воркер `regulation-detector.worker.ts` + подключение к `core.specialist-routing` (jobName '3-1-regulations').
- [ ] **α-7.3** LLM-extraction промпт `regulation-extract.prompt.ts` (placeholder).
- [ ] **α-7.4** LLM-dedupe промпт `regulation-dedupe.prompt.ts` (placeholder).
- [ ] **α-7.5** LLM-process-steps промпт `process-steps-extract.prompt.ts` (placeholder).
- [ ] **α-7.6** Seed-script `seed-llm-task-routes-regulations.ts` с 3 provider'ами для каждого taskType + ссылка на playbook.
- [ ] **α-7.7** Интеграция с `CurationService.triage()` — для regulation/process/policy → deep review.
- [ ] **α-7.8** Интеграция с `ConflictService.report()` — auto conflict для contradicts.
- [ ] **α-7.9** Probe-events (4 trigger'а из §6).
- [ ] **α-7.10** Stale cron-логика — расширение `card-stale-detector.cron` из α-4 на Regulation.
- [ ] **α-7.11** Регистрация в `CardSpecialistRegistry` для chat-v2.
- [ ] **α-7.12** REST API + DTO + Swagger.
- [ ] **α-7.13** UI `/regulations` master-detail.
- [ ] **α-7.14** (если есть данные Фазы 0b) Patch-script `migrate-phase-0b-to-regulations.ts` — поглощение существующих Process/Regulation/Policy моделей.
- [ ] **α-7.15** RBAC: `regulation` ResourceType.
- [ ] **α-7.16** Метрики `core_specialist_*{type='regulation'}` + регистрация в `BusinessMetricsService`.
- [ ] **α-7.17** Глоссарий UI (русские названия kind, statuses, severity).
- [ ] **α-7.18** second-brain: новый файл `01_projects/regulations.md`, обновление `02_architecture/module-map.md`, обновление `02_architecture/knowledge-core.md`.

---

## 14. Открытые вопросы

1. **Process — отдельная таблица или Regulation.kind='process' с поля для шагов?** (см. зонтичный §11) Рекомендация — один Regulation с `kind` + Json для шагов. Если в γ потребуется больше структуры — выделим.
2. **Standard** — отдельная сущность или Regulation.kind='standard'? Рекомендация — kind='standard' (как договорились в Фазе 0).
3. **Поглощение Фазы 0b — full replace или dual-write?** Если Фаза 0b в проде на момент α-7 — dual-write на короткий период, потом убираем old models.
4. **process_steps извлекаются одним LLM-вызовом с regulation-extract или отдельным проходом?** Рекомендация — отдельным (process-steps-extract), потому что для regulation/policy шаги не нужны и расход токенов меньше.

---

## 15. DoD

- `Regulation` модель в схеме + HNSW индекс, `bun run prisma:push` зелёный.
- `regulation-detector.worker` потребляет из `core.specialist-routing`.
- 3 промпта-placeholder с TODO + seed-script с 3 provider'ами + playbook-ссылка.
- CurationService интеграция работает: regulation в critical-list → deep review.
- ConflictService интеграция (smoke).
- 4 probe trigger'а эмитят notifications.
- Stale cron работает.
- `CardSpecialistRegistry.register()` вызывается на init, chat-v2 находит Regulation в выдаче.
- API + UI `/regulations` работают.
- (если применимо) Patch-script Фазы 0b прошёл в dev.
- Метрики, RBAC, glossary, second-brain.

---

## 16. Итог

**Реализовано целиком:** нет (draft).

**Что осталось:** вся реализация.

**Что меняет в продукте:** первая видимая ценность Слоя 3 — у компании появляются автогенерируемые регламенты с провенансом, AI-чат отвечает «по регламенту X шаг такой-то».
