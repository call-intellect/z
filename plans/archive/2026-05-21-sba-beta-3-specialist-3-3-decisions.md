---
type: tz
status: done
feature: SBA β-3 — Specialist 3.3 Decisions Registry (реестр решений с rationale, supersedes, evolving)
date: 2026-05-21
parent_tz: tz/2026-05-21-second-brain-agents-umbrella.md
phase: beta
depends_on:
  - tz/2026-05-21-sba-alpha-2-layer1-marking-extension.md (signalType='decision'/'rationale'/'decision_basis')
  - tz/2026-05-21-sba-alpha-3-layer2-ontology-extension.md
  - tz/2026-05-21-sba-alpha-4-layer4-curation-foundation.md (Decision в critical-list → deep review; evolving resolution)
  - tz/2026-05-21-sba-alpha-6-specialist-3-4-project-customer.md (референс)
  - tz/2026-05-21-sba-alpha-7-specialist-3-1-regulations.md (паттерн)
unblocks:
  - tz/2026-05-21-sba-beta-4-specialist-3-5-insights.md (Insights видит «какие решения вызвали проблемы»)
  - tz/2026-05-21-sba-gamma-1-specialist-3-7-skill-and-clone.md (rationale = главный источник Skill)
covers_matrix_rows: [C2, J1..J11, L5]
---

# ТЗ β-3: Specialist 3.3 — Decisions Registry

> **Это sub-TZ.** Зонтичный — [`plans/tz/2026-05-21-second-brain-agents-umbrella.md`](2026-05-21-second-brain-agents-umbrella.md). При расхождениях — приоритет у зонтичного.
>
> **Особая важность.** Decision — самая ценная сущность для бизнес-кейсов (большинство knowledge loss — потеря логики прошлых решений). См. [company-ontology.md §Decision](../../second-brain/06_marketing/company-ontology.md).

---

## 1. Цель

После β-3 у компании работает **полноценный реестр решений**:
- Decision модель с автором, rationale, alternatives, status, supersedes, deadline.
- Воркер дедуплицирует «новое решение» vs «развитие старого» через KNN + LLM-арбитр.
- Conflict-events `evolving` для решений, меняющихся во времени (старое было правильно до даты X).
- 3.5 (Insights) использует Decision для связки «эта проблема — следствие решения X».
- 3.7 (Skill) использует Decision-rationale как главный источник наблюдений «как человек принимает решения».

---

## 2. Зависимости

**Зависит от:** α-2 (signalType), α-3 (entityId), α-4 (CurationService + evolving), α-6 (референс), α-7 (паттерн).

**Разблокирует:** β-4 (Insights → Decision linking), γ-1 (Skill через rationale).

---

## 3. Scope

### Входит

- 1 Prisma-модель `Decision` (см. §4).
- Воркер `decision-detector.worker` — consumer `core.specialist-routing` для jobName '3-3-decisions'.
- LLM-extraction промпт `decision-extract` (placeholder).
- LLM-арбитр `decision-supersede-detect` — определяет, что новый блок развивает старое решение.
- Дедуп через KNN cosine + LLM.
- 2 новых `LlmTaskType` с 3 provider'ами.
- Интеграция с CurationService (Decision в critical-list → deep review всегда).
- Probe-events (см. §6).
- Conflict-events с особым типом `evolving` (если решение изменилось во времени).
- Регистрация в `CardSpecialistRegistry`.
- API: `/api/v1/decisions` (master-detail) + supersede + history.
- UI: `/decisions` master-detail с фильтрами.
- HNSW индекс для embedding.
- RBAC: `decision` ResourceType.

### Не входит

- Workflow согласования решения (proposed → approved через approvals) — γ+.
- Голосование за решение — γ+.
- Decision как тип Entity (использует Card.kind или собственный entityId? — рекомендация: собственный, см. §4).

---

## 4. Модель данных

```prisma
model Decision {
  id              String   @id @default(uuid())
  tenantId        String
  entityId        String?  @unique  // связка с графом — создаётся при canonical
  statement       String   @db.Text   // суть решения («Ушли с поставщика X в пользу Y»)
  rationale       String?  @db.Text   // ПОЧЕМУ так решили (главный источник для Skill γ-1)
  alternatives    Json?    // [{ option: "...", reason_rejected: "..." }, ...]
  decidedByPersonIds String[]  // авторы решения (через Entity{type='person'})
  decidedAt       DateTime?
  deadline        DateTime?
  status          DecisionStatus  // 'proposed' | 'approved' | 'rejected' | 'superseded' | 'implemented' | 'cancelled'
  supersedesId    String?  // → Decision (если это новая версия старого)
  affectsEntityIds String[]  // Project / Customer / Product / Process на которые влияет
  sourceBlockIds  String[]
  personSubjectIds String[]
  confidence      Decimal  @db.Decimal(4, 3)
  dataClass       DataClass
  currentVersionId String?  // → CardVersion
  embedding       Unsupported("vector(1536)")?

  // Для evolving:
  validFrom       DateTime?  // когда решение начало действовать (для temporal)
  validUntil      DateTime?  // если superseded — когда заменено

  // Outcomes (опц., заполняется позже observably):
  actualOutcomes  String?  @db.Text  // что в реальности случилось — для retrospective

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  lastConfirmedAt DateTime?

  @@index([tenantId, status])
  @@index([tenantId, decidedAt])
  @@index([supersedesId])
}
```

HNSW индекс на `embedding`. Generated column `decision_search_tsv` для гибридного поиска (как в IdeaBlock).

---

## 5. Воркер `decision-detector`

```ts
@Processor(CORE_QUEUE_NAMES.SPECIALIST_ROUTING)
export class DecisionDetectorWorker {
  @Process('3-3-decisions')
  async handle(job: Job<RoutedBlock>) {
    const block = await this.prisma.ideaBlock.findUnique(...);
    if (!['decision', 'rationale', 'decision_basis'].includes(block.signalType)) return;

    // 1. LLM decision-extract: блок + контекст (предшествующие блоки в той же встрече) → черновик Decision
    //    Extracts: statement, rationale, alternatives, decidedByPersonIds, affectsEntityIds
    // 2. KNN cosine top-5 существующих Decision того же tenant
    // 3. LLM decision-supersede-detect: новый, supersedes, или extension (merge)
    //    Если supersedes → выставить supersedesId + ConflictItem(resolution suggestion='evolving' если разные validFrom)
    //    Если merge → дополнить rationale/alternatives/sourceBlockIds существующего
    //    Если новый → продолжить дальше
    // 4. proposedPayload готов
    // 5. CurationService.triage(card='decision', ...) → deep review (critical-type)
    // 6. На approve → CardVersion + Decision update/insert
    // 7. Метрики
  }
}
```

---

## 6. Probe-events

| Reason | Trigger | Recipient |
|---|---|---|
| `decision.missing_decider` | `decidedByPersonIds[]` пуст | participants of source meeting |
| `decision.no_deadline_critical` | status='approved' AND deadline IS NULL AND tag='critical' | decision owner |
| `decision.overdue` | deadline < now AND status NOT IN ('implemented','cancelled') | decision owner |
| `decision.competing_versions` | KNN нашёл 2 близких decision без supersedes-связки | owner/admin |
| `decision.outcome_unknown` | implemented decision без actualOutcomes через 3 мес | decision owner |

---

## 7. Conflict-events

| Type | Trigger | Suggested resolution |
|---|---|---|
| `decision.contradicts_existing` | LLM сказал «противоречит» при отсутствии supersedes-сигнала | manual |
| `decision.evolving_supersedes` | LLM нашёл supersedes-связку | `evolving` (старое валидно до validUntil, новое — с validFrom) |

---

## 8. ENV

```
DECISION_DEDUPE_THRESHOLD=0.85
DECISION_SUPERSEDE_THRESHOLD=0.75
DECISION_KNN_TOP_K=5
DECISION_OVERDUE_REMINDER_DAYS=7  # за сколько дней до deadline шлём probe
```

---

## 9. RBAC

`decision` ResourceType:
- read: все member'ы Org (decisions — shared knowledge)
- write/delete/supersede: owner/admin + curator
- Создание через worker; manual creation — owner/admin через UI (опц.)

---

## 10. Метрики (по §5.7)

```
core_specialist_cards_total{type='decision', status, kind}
core_specialist_pipeline_duration_seconds{type='decision'}
core_specialist_llm_tokens_total{type='decision', model, tier}
core_specialist_probe_events_total{type='decision', reason}
core_specialist_conflict_events_total{type='decision', evolving}
decision_supersede_chain_length (histogram)  # длина цепочек supersedes
```

---

## 11. LLM (3 уровня)

**2 новых `LlmTaskType`:**

1. `decision-extract` — JSON Schema strict, извлекает Decision из блока + контекста.
2. `decision-supersede-detect` — арбитр {new | merge | supersedes} с rationale.

Цепочки — placeholder, согласовать с playbook. `maxDataClass >= 'top_secret'` (decisions могут быть стратегическими).

Seed-script `seed-llm-task-routes-decisions.ts` со ссылкой на playbook.

---

## 12. UI `/decisions`

Master-detail:
- Левая колонка:
  - Фильтры: status (proposed/approved/implemented/superseded), decided_by, deadline (overdue/upcoming), affects (project/customer)
  - Поиск по statement
  - Сортировка: decidedAt desc по умолчанию
- Правая:
  - Statement (заголовок)
  - Status badge + supersedes-цепочка (визуально дерево если есть)
  - Authors (Person chips)
  - Rationale (markdown render)
  - Alternatives table
  - Affects (entity chips)
  - Provenance (sourceBlockIds → клик → встреча)
  - Timeline: validFrom → validUntil (для evolving)
  - Actual outcomes (если есть)
  - `<CurationBanner>` если pending
  - Действия: «mark implemented», «supersede by», «cancel» (owner/admin)

API:
- `GET /decisions` (фильтры, пагинация)
- `GET /decisions/:id`
- `GET /decisions/:id/history` — CardVersion timeline
- `GET /decisions/:id/supersede-chain` — родительские и дочерние
- `POST /decisions/:id/supersede` — `{ supersededByDecisionId, supersedeReason }`
- `POST /decisions/:id/status` — `{ newStatus, reason }`
- `POST /decisions/:id/outcomes` — `{ actualOutcomes }`

---

## 13. Фазы реализации

- [x] **β-3.0** Решить: collective decision view ([декомпозиция родитель-потомок]) — UI tree или линейно? Рекомендация — табличный список + tooltip preview supersedes-цепочки, дерево — γ+.
- [x] **β-3.1** Prisma-модель `Decision` + enum'ы + HNSW + tsvector + `bun run prisma:push` + `apply-postgres-init.sql`.
- [x] **β-3.2** Воркер `decision-detector.worker` + подключение к `core.specialist-routing`.
- [x] **β-3.3** Промпт `decision-extract.prompt.ts` (placeholder).
- [x] **β-3.4** Промпт `decision-supersede-detect.prompt.ts` (placeholder).
- [x] **β-3.5** Seed-script `seed-llm-task-routes-decisions.ts` с 3 provider'ами + playbook.
- [x] **β-3.6** Дедуп через KNN + LLM-арбитр.
- [x] **β-3.7** CurationService.triage интеграция (critical-type → deep review).
- [x] **β-3.8** ConflictService.report с evolving suggestion.
- [x] **β-3.9** Probe-events (5 trigger'ов из §6).
- [x] **β-3.10** Stale cron — расширение `card-stale-detector` (alphas) на Decision (overdue reminder).
- [x] **β-3.11** Регистрация в `CardSpecialistRegistry`.
- [x] **β-3.12** API + DTO + Swagger.
- [x] **β-3.13** UI `/decisions` master-detail.
- [x] **β-3.14** RBAC: `decision` ResourceType.
- [x] **β-3.15** Метрики + glossary + second-brain (новый файл `01_projects/decisions.md`).
- [ ] **β-3.16** Дашборд-виджет «Overdue decisions» (опц.).

---

## 14. Открытые вопросы

1. **`affectsEntityIds[]` — массив или join-таблица?** (зонтичный §11.5) Рекомендация — массив пока (PostgreSQL gin index на массив достаточен). Если в γ потребуется reverse-query «какие решения касались Project X» → миграция в join-таблицу.
2. **`alternatives` — Json или отдельная таблица?** Рекомендация — Json пока.
3. **Manual creation Decision через UI** — нужен или только AI-extraction? Рекомендация — нужен (owner может фиксировать решения вручную), endpoint `POST /decisions` (admin).
4. **Decision как Entity тип** vs только модель? Рекомендация — добавить `decision` в `Entity.type` enum (если нужно для графовых запросов). Решение — в начале β-3.

---

## 15. DoD

- Decision модель + индексы, `bun run prisma:push` зелёный.
- `decision-detector.worker` обрабатывает блоки.
- 2 промпта placeholder + seed с 3 provider'ами + playbook.
- Supersede-цепочки работают, evolving resolution через ConflictService.
- 5 probe trigger'ов работают.
- CurationService deep review для Decision.
- `CardSpecialistRegistry.register()` вызывается.
- API + UI `/decisions` работают.
- chat-v2 находит Decision в выдаче на вопросах «что мы решили по X».
- Метрики, RBAC, glossary, second-brain.

---

## 16. Итог

**Реализовано целиком:** нет (draft).

**Что осталось:** вся реализация.

**Что меняет в продукте:** реестр решений с rationale — самая ценная для бизнеса сущность («почему мы так решили»), знания компании перестают теряться при кадровой ротации.

## Ревизия от 2026-05-24

**Статус:** done

**Реализовано:**
- Модель `Decision` со всеми полями TЗ + `appliedPolicyId FK → DecisionPolicy` (доставлено в α-7 wave 2): `backend/prisma/schema.prisma:4464+`, `DecisionPolicy:3780`.
- Worker: `backend/src/modules/knowledge-core/workers/specialist-3-3-decisions.worker.ts` + сервисы `specialist-3-3-{decisions,card-handler,probe}.service.ts`.
- Промпты: `knowledge-core/prompts/decision-extract.prompt.ts`, `decision-supersede-detect.prompt.ts`.
- Seed: `backend/scripts/seed-llm-task-routes-decisions.ts` (2 LlmTaskType с tier-fallback).
- REST + UI: `backend/src/modules/decisions/{controller,service}` + `frontend/app/(authenticated)/decisions/page.tsx`.
- Probe-trigger'ы (5 шт.) + ConflictService с evolving — реализованы.

**Осталось:**
- β-3.16 dashboard-виджет «Overdue decisions» — опциональный, не реализован.
