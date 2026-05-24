---
type: tz
status: superseded
supersededBy: plans/tz/2026-05-23-sba-alpha-4-wave2-completeness-consistency.md
feature: SBA α-4 — Layer 4 Curation Foundation (triage + multi-touch UI + conflict first-class + версионность)
date: 2026-05-21
parent_tz: tz/2026-05-21-second-brain-agents-umbrella.md
phase: alpha
depends_on:
  - tz/2026-05-21-sba-alpha-1-channels-foundation.md (probe через channels)
unblocks:
  - tz/2026-05-21-sba-alpha-6-specialist-3-4-project-customer.md (вызывает triage)
  - tz/2026-05-21-sba-alpha-7-specialist-3-1-regulations.md (вызывает triage)
  - все sub-TZ Слоя 3 в β и γ (всем нужен CurationService)
covers_matrix_rows: [A3, F1..F10, K5 (curation_* метрики), L1, M1..M2 (через расширение existing reframing.cron)]
---

# ТЗ α-4: Layer 4 — Curation Foundation

> **Это sub-TZ.** Зонтичный — [`plans/tz/2026-05-21-second-brain-agents-umbrella.md`](2026-05-21-second-brain-agents-umbrella.md). При расхождениях — приоритет у зонтичного.
>
> **Архитектурное решение:** [§3.6 Curation — triage, per-domain кураторы, multi-touch, conflict first-class](2026-05-21-second-brain-agents-umbrella.md#36-curation-%D1%81%D0%BB%D0%BE%D0%B9-4--triage-per-domain-%D0%BA%D1%83%D1%80%D0%B0%D1%82%D0%BE%D1%80%D1%8B-multi-touch-conflict-first-class).
>
> **Контекст для исполнителя:**
> - Существующий [reframing.cron](../../backend/src/modules/knowledge-core/workers/reframing.cron.ts) — расширяется для stale-detection.
> - `IdeaBlockLink.relationType='contradicts'` уже существует — источник для авто-создания `ConflictItem`.
> - Паттерн master-detail UI — [как в `/admin`](../../second-brain/02_architecture/module-map.md).

---

## 1. Цель

После α-4:
- Любая новая карточка специалиста проходит через `CurationService.triage(card)` — 3 уровня (auto/light/deep).
- Кураторы назначаются гибко per-ResourceType через `CuratorAssignment`.
- Multi-touch UI: `/curation` (центральная очередь), inline-виджет на странице карточки, probe через ConversationalModule, dashboard-виджет.
- Conflict — first-class сущность. Resolution с типом `evolving` обязателен.
- Stale-detection — cron, probe владельцу через channels.
- Версионность через `CardVersion`.

Используется α-6 (3.4), α-7 (3.1) и далее всеми специалистами Слоя 3.

---

## 2. Зависимости

**Зависит от:** α-1 (ConversationalModule).

**Разблокирует:** все специалисты Слоя 3.

---

## 3. Scope

### Входит

- 5 Prisma-моделей: `CurationItem`, `CurationDecision`, `ConflictItem`, `CardVersion`, `CuratorAssignment`.
- `CurationService.triage(card, options)` — публичный API для специалистов.
- `CuratorRoutingService` — выбор куратора по `CuratorAssignment`.
- `ConflictService.report(...)` — публичный API для специалистов (создаёт `ConflictItem`).
- Stale-detection cron — расширение `reframing.cron` или новый `card-stale-detector.cron`.
- API эндпоинты для куратора + admin.
- 3 UI-страницы: `/curation` (master-detail), `/settings/curation` (config), компонент `<CurationBanner>` (inline для карточек).
- Dashboard-виджет «N pending review» в существующем `/dashboard`.
- Метрики `curation_*`.
- RBAC: 4 новых ResourceType.

### Не входит

- Skill-специфичная post-hoc логика (γ-1).
- Конкретные карточки специалистов (sub-TZ Слоя 3).
- Сам ConversationalModule (α-1).

---

## 4. Модели данных

```prisma
model CurationItem {
  id              String   @id @default(uuid())
  tenantId        String
  resourceType    String   // 'regulation' | 'decision' | 'insight' | 'idea' | 'knowledge_profile' | ...
  resourceId      String   // id карточки
  level           CurationLevel  // 'light' | 'deep'
  triageReason    Json     // { confidence, conflictIds, criticalType, ... }
  proposedPayload Json     // что специалист предлагает канонизировать
  status          CurationItemStatus  // 'pending' | 'decided' | 'expired' | 'cancelled'
  assignedToUserId String? // конкретный куратор (если решено)
  candidateCuratorIds String[]  // если назначен через CuratorAssignment criteria
  createdAt       DateTime @default(now())
  decidedAt       DateTime?
  expiresAt       DateTime?
  @@index([tenantId, status])
  @@index([assignedToUserId, status])
  @@index([resourceType, resourceId])
}

model CurationDecision {
  id              String   @id @default(uuid())
  curationItemId  String
  decisionType    CurationDecisionType  // 'approve' | 'reject' | 'approve_with_edits' | 'split' | 'merge' | 'supersede'
  payload         Json     // изменения, если approve_with_edits
  reasoning       String?  // обязательно для deep review
  reviewerUserId  String
  createdAt       DateTime @default(now())
  @@index([curationItemId])
}

model ConflictItem {
  id              String   @id @default(uuid())
  tenantId        String
  resourceType    String   // тип конфликтующих сущностей
  existingId      String
  newId           String
  evidence        Json     // ссылки на блоки/факты-источники конфликта
  relationType    String   // 'contradicts' | 'duplicates' | 'supersedes' | ...
  detectedBy      String   // 'block-linker' | 'specialist' | 'manual'
  status          ConflictStatus  // 'open' | 'resolved' | 'dismissed'
  resolution      ConflictResolution?  // 'accept_new' | 'keep_old' | 'merge' | 'evolving'
  evolvingMeta    Json?    // { existingValidUntil, newValidFrom } для evolving
  resolvedByUserId String?
  resolvedAt      DateTime?
  reasoning       String?
  createdAt       DateTime @default(now())
  @@index([tenantId, status])
  @@index([resourceType, existingId])
}

model CardVersion {
  id              String   @id @default(uuid())
  tenantId        String
  resourceType    String
  resourceId      String
  version         Int
  previousVersionId String?
  payload         Json     // полный snapshot карточки в этой версии
  changeReason    String?  // 'initial' | 'approve_with_edits' | 'merge' | 'supersede' | 'evolving'
  createdByUserId String?  // null если auto
  curationDecisionId String?
  createdAt       DateTime @default(now())
  @@unique([resourceType, resourceId, version])
}

model CuratorAssignment {
  id              String   @id @default(uuid())
  tenantId        String
  resourceType    String   // или wildcard '*'
  criteria        Json?    // { tag: 'enterprise', kind: 'process' } для гибкости
  curatorUserIds  String[] // несколько кураторов = round-robin / любой
  level           CurationLevel?  // если null — применяется к обоим уровням
  createdAt       DateTime @default(now())
  @@index([tenantId, resourceType])
}
```

---

## 5. CurationService API (публичный для специалистов)

```ts
@Injectable()
export class CurationService {
  /**
   * Triage новой/изменённой карточки. Возвращает решение «канонизировать сразу» или «создать CurationItem».
   * Вызывается специалистом Слоя 3 перед записью карточки как canonical.
   */
  async triage(input: TriageInput): Promise<TriageResult> {
    // 1. Получить org settings (пороги, critical-list)
    // 2. Проверить confidence vs auto-threshold
    // 3. Проверить conflict-signals (через ConflictService)
    // 4. Проверить critical-type list
    // 5. Решение:
    //    - auto-canonical → создать CardVersion(version=1) + return { decision: 'auto' }
    //    - light review → создать CurationItem(level='light') + probe куратору через ConversationalModule
    //    - deep review → создать CurationItem(level='deep') + probe + UI-уведомление
    //    Создание CardVersion идёт ПОСЛЕ approve.
  }
}

@Injectable()
export class ConflictService {
  async report(input: ConflictReportInput): Promise<ConflictItem> {
    // Создать ConflictItem, эскалировать куратору через CurationService
  }
}
```

---

## 6. Multi-touch UI

### 6.1. `/curation` — центральная очередь

Master-detail. Левая колонка — список CurationItem (фильтры: level, resourceType, status, assigned to me). Правая — детальная страница: payload + provenance + кнопки decision.

### 6.2. Inline-виджет `<CurationBanner>`

Встраивается на странице любой карточки специалиста (например, `/regulations/:id`). Если для этой карточки есть открытый `CurationItem` и текущий user — candidate curator — показывается баннер с кнопкой decision.

### 6.3. Conversational probe

Light review → `ConversationalService.sendNotification` с типом `curation.pending.light` + inline-options approve/reject/open. Один тап в Telegram (β) / email-link / in-app.

### 6.4. Dashboard-виджет

«N pending для тебя» на `/dashboard`. Кликабельный — переход на `/curation?assignedToMe=true`.

### 6.5. `/settings/curation`

- Настройка порогов triage (`autoThreshold`, `deepReviewThreshold`).
- Управление critical-types list.
- Управление `CuratorAssignment` (per-ResourceType).
- Доступно только owner/admin.

---

## 7. Stale-detection cron

Расширение существующего [reframing.cron](../../backend/src/modules/knowledge-core/workers/reframing.cron.ts) или новый `card-stale-detector.cron`:
- Раз в день в 4:00.
- Для каждой канонической карточки специалиста: если `lastConfirmedAt > N мес` И `dynamicScore < threshold` → создать `ProbeRequest` через `ProbeService` (β-5) ИЛИ напрямую через `ConversationalService.sendNotification` (в α-4 — напрямую, потом мигрировать на ProbeService).
- Если probe не отвечен за 30 дней → карточка → `status='stale'`.

---

## 8. ENV

```
CURATION_AUTO_THRESHOLD_DEFAULT=0.85
CURATION_DEEP_REVIEW_THRESHOLD_DEFAULT=0.6
CURATION_CRITICAL_TYPES_DEFAULT="regulation,process,decision"
CURATION_ITEM_EXPIRY_DAYS=30
CARD_STALE_DETECTOR_CRON="0 4 * * *"
CARD_STALE_MONTHS_THRESHOLD=6
```

---

## 9. RBAC

- `curation_item` — read: owner/admin/assigned curator; write/delete: owner/admin.
- `curation_decision` — write: assigned curator + owner/admin; read: те же.
- `conflict_item` — read: member; resolve write: owner/admin/curator.
- `card_version` — read: member; write только через CurationService (не прямой API).
- `curator_assignment` — owner/admin only.

---

## 10. Метрики

- `curation_items_total{resourceType, level, status}` (counter)
- `curation_decision_total{decisionType, level}` (counter)
- `curation_time_to_decide_seconds{level}` (histogram)
- `curation_auto_canonical_total{resourceType}` (counter)
- `curation_conflicts_total{relationType, resolution}` (counter)
- `curation_stale_detected_total{resourceType}` (counter)
- `curation_stale_superseded_total` (counter)

---

## 11. LLM

В α-4 — опционально LLM-арбитр для conflict resolution. Можно отложить на потом — в α-4 conflict резолвится только вручную куратором.

Если делается:
- Новый taskType `curation-conflict-suggest-resolution` — подсказывает «accept_new / keep_old / merge / evolving» + reasoning. Куратор финально решает.
- Цепочка из 3 provider'ов (см. §3.7 зонтичного) через seed.

---

## 12. Фазы реализации

- [x] **α-4.0** Согласовать с UX дизайн `/curation` и `<CurationBanner>` (макеты).
- [x] **α-4.1** 5 Prisma-моделей + enum'ы + `bun run prisma:push`.
- [x] **α-4.2** `CurationService.triage()` (без UI, без probe — только БД).
- [x] **α-4.3** `ConflictService.report()` + интеграция с существующим `block-linker.worker` (на `relationType='contradicts'` с high confidence → авто `ConflictItem`).
- [x] **α-4.4** Интеграция probe через `ConversationalService.sendNotification` (light review).
- [x] **α-4.5** API: `/api/v1/curation/queue`, `/api/v1/curation/items/:id/decide`, `/api/v1/curation/conflicts`, `/api/v1/curation/conflicts/:id/resolve`, `/api/v1/settings/curation` (GET/PATCH).
- [x] **α-4.6** `CuratorRoutingService` — выбор куратора по `CuratorAssignment` (правила: точное совпадение resourceType → wildcard → owner/admin fallback).
- [x] **α-4.7** UI `/curation` master-detail.
- [x] **α-4.8** UI `/settings/curation` (admin).
- [x] **α-4.9** Компонент `<CurationBanner>` + интеграция в страницы карточек (сейчас — задел, специалисты подключают в своих sub-TZ).
- [x] **α-4.10** Dashboard-виджет «N pending».
- [x] **α-4.11** `card-stale-detector.cron` + интеграция с ConversationalService.
- [x] **α-4.12** `evolving` resolution — модель + UI с date range pickers + API.
- [x] **α-4.13** Метрики `curation_*` в `BusinessMetricsService`.
- [x] **α-4.14** RBAC: 4 ResourceType в `policy.csv`.
- [x] **α-4.15** (опц.) LLM-арбитр `curation-conflict-suggest-resolution` + seed-script.
- [x] **α-4.16** Глоссарий UI + second-brain.

---

## 13. Открытые вопросы

1. **CardVersion — общая таблица для всех типов карточек, или per-resource версии?** Рекомендация — общая (см. §4). Меньше дублирования, единый API истории.
2. **Stale-detection — встроить в reframing.cron или отдельный cron?** Рекомендация — отдельный, потому что reframing.cron уже сложный.
3. **`evolving` — нужен ли UI для temporal-запросов в chat-v2 («что мы знали в марте?»)?** Связано с α-5. Решение — в α-4 храним temporal metadata в `ConflictItem.evolvingMeta`, в α-5 chat-v2 учитывает (если задана дата в вопросе).
4. **`CardVersion.payload` для текстовых карточек может быть огромным.** Рассмотреть `pg_jsonb` сжатие или ограничение версий (хранить последние N).

---

## 14. DoD

- 5 моделей в схеме, `bun run prisma:push` зелёный.
- `CurationService.triage()` интеграционно тестируется на mock-карточке.
- `ConflictService.report()` создаёт ConflictItem из `IdeaBlockLink.relationType='contradicts'` (smoke).
- Probe куратору через ConversationalModule (in_app + email) — реальная доставка.
- UI `/curation`, `/settings/curation`, `<CurationBanner>`, dashboard-виджет — работают.
- Stale-detection cron работает на тестовых данных.
- `evolving` resolution — UI + API + persistence.
- Метрики, RBAC, glossary, second-brain.

---

## 15. Итог

**Реализовано целиком:** нет (draft).

**Что осталось:** вся реализация.

**Что меняет в продукте:** появляется система контроля качества, которая защищает от LLM-галлюцинаций и позволяет компании корректировать AI-выводы в естественном потоке работы.

## Ревизия от 2026-05-24

**Статус:** superseded

**Реализовано (фактически):**
- 5 Prisma-моделей: `CurationItem`, `CurationDecision`, `ConflictItem`, `CardVersion`, `CuratorAssignment` — все есть в schema.prisma.
- Wave 2 модель `CompletenessSlot` + cron `completeness-scanner.cron.ts` + `consistency-checker.cron.ts`.
- `CurationService` + `ConflictService` + `CuratorRoutingService` — в `backend/src/modules/curation/services/`.
- `CardStaleDetectorCron` (раз в день в 4:00) — `backend/src/modules/curation/workers/card-stale-detector.cron.ts`.
- `card-stale-detector.cron.ts` (не reframing — это уточнение из delta-аудита).
- API: `/curation/queue`, `/items/:id/decide`, `/conflicts`, `/conflicts/:id/resolve`, `/settings/curation`, `GET /completeness-slots`.
- `CurationDecisionType` enum расширен `merge_categories` + `escalate`.
- Probe-нотификации куратору через Conversational channels (policy `curation.pending`).
- `evolving` resolution полностью работает (schema.prisma + `conflict.service.ts`).
- Метрики `curation_*`, RBAC.

**Заменён на:** `plans/tz/2026-05-23-sba-alpha-4-wave2-completeness-consistency.md` — wave 2 закрыл оставшиеся 10% (CompletenessSlot, ConsistencyChecker, новые CurationDecisionType). Основа была на 90% готова на момент 23.05.

