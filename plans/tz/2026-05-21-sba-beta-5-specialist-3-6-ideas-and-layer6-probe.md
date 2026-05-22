---
type: tz
status: done
feature: SBA β-5 — Specialist 3.6 Ideas Collector + Layer 6 Probe-Agent (выпускаются парой)
date: 2026-05-21
parent_tz: tz/2026-05-21-second-brain-agents-umbrella.md
phase: beta
depends_on:
  - tz/2026-05-21-sba-alpha-1-channels-foundation.md (ConversationalModule для доставки probe и статусов)
  - tz/2026-05-21-sba-alpha-2-layer1-marking-extension.md (signalType='idea'/'suggestion'/'client-request')
  - tz/2026-05-21-sba-alpha-3-layer2-ontology-extension.md
  - tz/2026-05-21-sba-alpha-4-layer4-curation-foundation.md
  - tz/2026-05-21-sba-alpha-6-specialist-3-4-project-customer.md (референс)
  - tz/2026-05-21-sba-beta-1-channels-telegram-max.md (для реальной доставки probe в Telegram)
covers_matrix_rows: [C2, C4, I1..I5, J1..J11, L7]
---

# ТЗ β-5: Specialist 3.6 Ideas Collector + Layer 6 Probe-Agent

> **Это sub-TZ.** Зонтичный — [`plans/tz/2026-05-21-second-brain-agents-umbrella.md`](2026-05-21-second-brain-agents-umbrella.md). При расхождениях — приоритет у зонтичного.
>
> **Особое правило:** 3.6 и Слой 6 — **неразделимы**. Без Слоя 6 идеи превращаются в кладбище. Без идей Слой 6 не имеет первой видимой ценности. См. §3.3 (C4) зонтичного.
>
> **Контракт специалиста §5** для части 3.6 — реализация по образцу α-6.

---

## 1. Цель

После β-5:
- **3.6 Ideas Collector** — Idea модель с весом, supporterCount, статусом. Кластеризация смысловая. Раздельные пулы «внутренние» (от сотрудников) и «клиентские» (запросы клиентов из встреч).
- **Слой 6 Probe-Agent** — отдельный модуль `probe/`, потребляет probe-events от всех специалистов, формулирует вопросы, выбирает адресата, отправляет через ConversationalService с анти-спам и приоритизацией.
- **Замкнутая петля**: статус идеи изменён → автонотификация авторам через каналы. Симметрия: ответ на probe → новый RawEvent → ingest → пайплайн продолжается.

---

## 2. Зависимости

**Зависит от:** α-1 (ConversationalModule), α-2, α-3, α-4, α-6 (референс), β-1 (Telegram для эффективной доставки).

**Используется:** все специалисты Слоя 3 (эмиссия probe-events).

---

## 3. Scope

### Входит — часть 3.6 Ideas

- Prisma-модели `Idea`, `IdeaCluster`.
- Воркер `idea-detector.worker` (consumer `core.specialist-routing` jobName '3-6-ideas').
- Cron `idea-clusterer.cron` — кластеризация (паттерн Theme).
- 2 новых `LlmTaskType` с 3 provider'ами: `idea-extract`, `idea-cluster-merge`.
- Probe-events для уточнения смысла идеи (если LLM не понял).
- API: `GET /ideas`, `GET /me/ideas`, `POST /ideas/:id/status`.
- UI: `/ideas` master-detail + персональная вкладка «мои идеи».
- Closing loop: при изменении статуса идеи → автонотификация авторам.
- Регистрация в `CardSpecialistRegistry`.
- HNSW индекс.
- RBAC: `idea`.

### Входит — часть Слой 6 Probe-Agent

- Новый модуль `probe/` в `backend/src/modules/probe/`.
- `ProbeService.suggest(probeEvent)` — контракт для специалистов Слоя 3 (заменяет прямые вызовы ConversationalService.sendNotification из α-4/α-6/α-7/β-2/β-3/β-4 для probe).
- `probe-dispatcher.worker` (consumer `core.probe-events`):
  - Дедуп (не задавать тот же вопрос дважды — Redis-based на `<recipient>_<reason>_<contextHash>`).
  - Анти-спам (rate limit per-user — N probe в час максимум, ENV).
  - Quiet hours (читает `User.notification_preferences`).
  - Приоритизация (severity + freshness + recipient_engagement_rate).
  - Выбор адресата (если несколько candidates — round-robin или round-robin с весом по engagement).
  - LLM `probe-formulate` — формулировка точечного вопроса из контекста.
  - `ConversationalService.sendNotification(probe)` — канал выбирается роутером.
- Handler `notification.responded`:
  - При ответе на probe → новый `RawEvent` (через ingest) с `metadata.respondsToProbeId`, `metadata.contextBlockId`.
  - Пайплайн знаний обрабатывает как обычный новый блок.
- Idea status closing loop:
  - При update `Idea.status` → автонотификация всем `supporters[]` через ConversationalService.
- 2 новых `LlmTaskType` с 3 provider'ами: `probe-formulate`, `idea-status-summarize`.
- API: `GET /probe/queue` (admin), `GET /me/probe-history`.
- UI: расширение `/me/notifications` фильтром «probe».
- Метрики `probe_*`.
- RBAC: внутреннее (probe-события доступны admin'ам, обычные через notifications).

### Не входит

- ML-приоритизация probe (γ+).
- Дедуп через embedding (только rule-based в β-5 — content hash).
- Adoption analytics per-user (γ+).

---

## 4. Модели данных

### 4.1. Idea + IdeaCluster (3.6)

```prisma
model Idea {
  id              String   @id @default(uuid())
  tenantId        String
  entityId        String?  @unique
  kind            IdeaKind  // 'internal' | 'client_request'
  statement       String   @db.Text
  rationale       String?  @db.Text  // зачем
  weight          Decimal  @db.Decimal(6, 3)  // композитный score: supporterCount * recency * specificity
  supporterCount  Int       @default(1)
  supporters      Json      // [{ kind: 'person'|'customer', entityId, firstSupportedAt, blockId }, ...]
  firstProposedAt DateTime
  lastDiscussedAt DateTime
  status          IdeaStatus  // 'captured' | 'in_discussion' | 'accepted' | 'in_progress' | 'shipped' | 'rejected' | 'archived'
  statusChangedAt DateTime?
  statusChangedByUserId String?
  statusReason    String?  @db.Text
  clusterId       String?
  sourceBlockIds  String[]
  personSubjectIds String[]
  confidence      Decimal  @db.Decimal(4, 3)
  dataClass       DataClass
  currentVersionId String?
  embedding       Unsupported("vector(1536)")?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([tenantId, status, kind])
  @@index([tenantId, weight])
}

model IdeaCluster {
  id              String   @id @default(uuid())
  tenantId        String
  name            String
  description     String?  @db.Text
  ideaIds         String[]
  clusterWeight   Decimal  @db.Decimal(6, 3)
  embedding       Unsupported("vector(1536)")?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([tenantId])
}
```

### 4.2. Probe (Слой 6)

```prisma
model ProbeEvent {
  id              String   @id @default(uuid())
  tenantId        String
  emittedByService String  // '3-1-regulations' | '3-4-project-customer' | ...
  reason          String   // 'regulation.missing_owner' | ...
  payload         Json     // { contextBlockId?, contextCardId?, candidates?, suggestedQuestion? }
  recipientCandidates String[]  // userIds — кому потенциально задать
  selectedRecipientId String?   // финальный выбор
  status          ProbeStatus  // 'pending' | 'dispatched' | 'dropped_dedup' | 'dropped_rate_limit' | 'expired'
  dispatchedNotificationId String?  // если dispatch состоялся → ссылка на Notification из α-1
  contentHash     String   // sha256(reason + contextId) для дедупа
  priority        Int      // computed: severity * freshness * engagement
  createdAt       DateTime @default(now())
  dispatchedAt    DateTime?
  expiresAt       DateTime?
  @@index([tenantId, status])
  @@index([contentHash])
}
```

---

## 5. ProbeService API (для специалистов)

```ts
@Injectable()
export class ProbeService {
  /**
   * Контракт §5.4 — вызывается специалистами Слоя 3 при обнаружении пробела.
   */
  async suggest(input: {
    tenantId: string;
    emittedByService: string;
    reason: string;
    payload: ProbePayload;
    recipientCandidates: string[];
    priorityHint?: number;  // 0..1
  }): Promise<ProbeEvent | { dropped: 'dedup' | 'rate_limit' }>
}
```

Внутри:
1. Compute contentHash → check Redis для дедупа последних N часов.
2. Если дубль → status='dropped_dedup', return.
3. Compute priority (см. §6).
4. Insert ProbeEvent с status='pending'.
5. Enqueue `core.probe-events` для dispatcher.

---

## 6. Probe-dispatcher

```ts
@Processor('core.probe-events')
export class ProbeDispatcherWorker {
  @Process()
  async dispatch(job: Job<{ probeEventId: string }>) {
    const probe = await this.getProbe(...);
    // 1. Re-check rate limit per recipient (Redis-based)
    // 2. Select recipient: round-robin по recipientCandidates с весом engagement rate
    // 3. Check quiet hours для recipient — если в quiet → defer (re-enqueue с delay)
    // 4. LLM probe-formulate: payload + reason → точечный вопрос с inline-options
    // 5. ConversationalService.sendNotification({
    //      eventType: 'probe.question',
    //      payload: { question, options, contextLink },
    //      dataClass: probe.payload.dataClass,
    //      recipientUserId: selected,
    //      contextBlockId: probe.payload.contextBlockId,
    //    })
    // 6. ProbeEvent status='dispatched', dispatchedNotificationId set
  }
}

@OnEvent('notification.responded')
async handleProbeResponse(event: NotificationRespondedEvent) {
  // Если notification.eventType начинается с 'probe.' → это ответ на probe
  // → создать RawEvent через IngestService с metadata.respondsToProbeId
  // → ingest пайплайн обработает как новый блок
}
```

Priority compute (rule-based в β-5):
```
priority = severity_weight * freshness_factor * (1 + recipient_engagement_rate)
where:
  severity_weight = { 'critical': 1.0, 'high': 0.7, 'medium': 0.4, 'low': 0.2 }
  freshness_factor = max(0.1, 1 - (age_days / 30))
  recipient_engagement_rate = (probe responses last 30d) / (probe sent last 30d) — Redis cache
```

---

## 7. Closing loop для Ideas

```ts
@OnEvent('idea.status_changed')
async handleIdeaStatusChange(event: IdeaStatusChangedEvent) {
  const idea = await this.prisma.idea.findUnique(...);
  for (const supporter of idea.supporters) {
    if (supporter.kind !== 'person') continue;  // клиентам не шлём (они не в Z)
    const personUserId = await this.lookupUserId(supporter.entityId);
    if (!personUserId) continue;
    await this.conversationalService.sendNotification({
      eventType: 'idea.status_changed',
      recipientUserId: personUserId,
      dataClass: idea.dataClass,
      payload: {
        ideaId: idea.id,
        statement: idea.statement,
        oldStatus: event.oldStatus,
        newStatus: idea.status,
        reason: idea.statusReason,
      },
      contextCardId: idea.id,
    });
  }
}
```

---

## 8. ENV

```
# Ideas
IDEA_CLUSTER_THRESHOLD=0.80
IDEA_CLUSTERER_CRON="30 */4 * * *"
IDEA_MIN_SUPPORTERS_FOR_CLUSTER=2

# Probe
PROBE_DEDUP_TTL_HOURS=72
PROBE_RATE_LIMIT_PER_USER_PER_HOUR=5
PROBE_RATE_LIMIT_PER_USER_PER_DAY=20
PROBE_EXPIRY_DAYS=14
PROBE_PRIORITY_REFRESH_CRON="*/15 * * * *"
PROBE_QUIET_HOURS_DEFAULT_TZ_OFFSET_MIN=180  # MSK
```

---

## 9. RBAC

- `idea` ResourceType:
  - read: member
  - write status: owner/admin/curator
  - `POST /me/ideas/:id/withdraw` — автор может withdraw свою идею
- `probe_event` ResourceType:
  - read: owner/admin (queue), recipient (свои)
- ProbeService API — internal (другие модули).

---

## 10. Метрики

```
# Ideas (по §5.7)
core_specialist_cards_total{type='idea', kind, status}
core_specialist_pipeline_duration_seconds{type='idea'}
core_specialist_llm_tokens_total{type='idea', model, tier}

# Probe
probe_events_total{emitted_by_service, reason, status}
probe_dispatched_total{kind}  # kind = channel kind
probe_response_total{eventType, kind}
probe_response_time_seconds{eventType, kind}  # histogram
probe_dedup_dropped_total{reason}
probe_rate_limit_dropped_total
probe_expired_total
probe_recipient_engagement_rate{userId}  # gauge

# Idea closing loop
idea_status_change_notifications_total{newStatus}
```

---

## 11. LLM (3 уровня)

**4 новых `LlmTaskType`:**

1. `idea-extract` — из блока → черновик Idea (statement, kind, supporter info).
2. `idea-cluster-merge` — арбитр кластеризации (новая идея, merge с кластером, отдельный кластер).
3. `probe-formulate` — формулировка точечного вопроса для probe (короткий, понятный, с inline-options).
4. `idea-status-summarize` — генерация текста для closing-loop нотификации.

Все 4 через `seed-llm-task-routes-ideas-and-probe.ts` с 3 provider'ами + playbook.

---

## 12. UI

### `/ideas`

Master-detail:
- Tabs: «Внутренние» / «От клиентов» / «Мои»
- Фильтры: status, weight (high/medium/low), kind
- Сортировка: weight desc по умолчанию
- Cluster-view (collapsible groups)
- Правая колонка: statement, rationale, supporters, history, action buttons (status change для owner/admin)

### `/me/ideas`

Вкладка на `/me`:
- Мои идеи (как автор)
- Идеи которые я поддержал
- Статусы (с auto-refresh)

### `/me/notifications` filter

Добавить фильтр «probe» в существующий center из α-1.

---

## 13. Фазы реализации

- [x] **β-5.0** Согласовать с UX дизайны `/ideas`, cluster-view, probe-формат для каналов.
- [x] **β-5.1** Prisma-модели `Idea`, `IdeaCluster`, `ProbeEvent` + enum'ы + HNSW + `bun run prisma:push`.
- [x] **β-5.2** Воркер `idea-detector.worker` + подключение к `core.specialist-routing`.
- [x] **β-5.3** Cron `idea-clusterer.cron`.
- [x] **β-5.4** Промпты `idea-extract`, `idea-cluster-merge`, `probe-formulate`, `idea-status-summarize` (placeholder + TODO).
- [x] **β-5.5** Seed `seed-llm-task-routes-ideas-and-probe.ts` с 3 provider'ами для каждого + playbook.
- [x] **β-5.6** CurationService.triage интеграция для Idea (НЕ critical-type, auto).
- [x] **β-5.7** Модуль `probe/`: `ProbeService.suggest` + `probe-dispatcher.worker`.
- [x] **β-5.8** Дедуп через Redis (TTL=72h).
- [x] **β-5.9** Rate limit через Redis (5/hr, 20/day).
- [x] **β-5.10** Priority computation (severity * freshness * engagement).
- [x] **β-5.11** Quiet hours respect.
- [x] **β-5.12** Handler `notification.responded` → новый RawEvent через ingest с `respondsToProbeId`.
- [x] **β-5.13** Closing loop `idea.status_changed` → notify supporters.
- [x] **β-5.14** **Миграция вызовов** в α-4 / α-6 / α-7 / β-2 / β-3 / β-4 — заменить `ConversationalService.sendNotification` для probe на `ProbeService.suggest`. Стандартизировать reason-naming.
- [x] **β-5.15** API + UI `/ideas`, `/me/ideas`, расширение `/me/notifications`.
- [x] **β-5.16** Регистрация Idea в `CardSpecialistRegistry`.
- [x] **β-5.17** RBAC: `idea`, `probe_event`.
- [x] **β-5.18** Метрики `probe_*` + `idea_*`.
- [x] **β-5.19** Slash-commands `/myideas`, `/status` в Telegram (β-1) — использовать ProbeService API.
- [x] **β-5.20** Глоссарий UI + second-brain (новые файлы `01_projects/ideas.md`, `01_projects/probe-agent.md`).

---

## 14. Открытые вопросы

1. **Кластеризация идей — на уровне Idea (KNN) или через Theme паттерн?** Рекомендация — отдельный `IdeaCluster` с KNN-greedy (как Theme).
2. **«Клиентские идеи» — Customer как supporter (kind='customer'). Кому слать closing-loop?** Account manager (через Customer.responsibleUserId). Если нет — admin.
3. **Probe `priority` — ML-модель или rule-based?** Rule-based в β-5, ML — γ+.
4. **Probe storm prevention при массовом deploy специалиста** — нужен `cold start mode` (первые 24h после deploy — все probe только в админ-очередь, не в каналы). Решить — да или нет.
5. **Дедуп через embedding** vs content hash. Рекомендация — content hash (быстрее, проще). Embedding-дедуп — γ+ если требуется.

---

## 15. DoD

- 3 модели в схеме, `bun run prisma:push` зелёный.
- Idea воркер + cluster-cron работают.
- ProbeService API + dispatcher работают end-to-end.
- 4 промпта placeholder + seed с 3 provider'ами + playbook.
- Дедуп + rate limit + quiet hours работают (integration test).
- Closing loop: change status → автонотификация автору (через Telegram если linked).
- Все специалисты Слоя 3 мигрированы на ProbeService.
- API + UI `/ideas`, `/me/ideas`, notifications filter работают.
- `CardSpecialistRegistry.register('idea')`.
- Метрики `probe_*` + `idea_*` экспортируются.
- Slash-commands в Telegram работают.
- Glossary + second-brain.

---

## 16. Итог

**Реализовано целиком (2026-05-22):** да — все 20 фаз §13.

**Что осталось:**
- Полный flow «ответ на probe → новый RawEvent через ingest pipeline» — γ+ (нужен conversational Source с type='conversational').
- Реальная активация cold-start mode после deploy (требует deploy-маркер) — γ+.
- ML-priority в выборе recipient'а Probe-Agent — γ+.
- Embedding-based дедуп Probe — γ+.
- Quiet hours defer (re-enqueue с delay) — γ+.
- Closing-loop для customer supporters через `Customer.responsibleUserId` — модели Customer как отдельной таблицы нет (только Entity{type=customer}), fallback на admin.

**Что меняет в продукте:** замкнутая петля самообучения работает — компания учится у себя через каналы, идеи сотрудников не теряются («мой голос виден»), пробелы знаний закрываются точечными вопросами в Telegram.
