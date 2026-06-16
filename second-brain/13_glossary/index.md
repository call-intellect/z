---
type: glossary
updated: 2026-05-10
---

# Глоссарий Z

Термины, появляющиеся в knowledge-core ТЗ и за его пределами. Заполняется по ходу фаз.

Соседние источники в этой папке (перенесены из ретайренного `delivery/` 2026-06-17):
- [ui-glossary.md](ui-glossary.md) — словарь русских UI-терминов по фазам (термин ↔ сущность ↔ «не путать с»). Источник перевода для админки.
- [copy-strings.ru.md](copy-strings.ru.md) — реестр всех пользовательских RU-строк (ключ → строка). Источник bulk-import в `/admin/content/copy`.

## Активные (Фаза 0)

### Org (Организация)

Тенант в multi-tenant модели Z. Любой ресурс (встреча, карточка, задача, теги, ai-логи) принадлежит одной Org через `tenantId`. Org создаётся автоматически при регистрации юзера + ручное создание через `POST /api/v1/orgs`. См. [[../01_projects/rbac-access-control|rbac-access-control]].

### Membership

Связь между User и Org с ролью (owner / admin / manager). Один юзер может быть в нескольких Org. `@@unique([orgId, userId])`.

### OrgInvitation

Приглашение в Org по email. Token nanoid(40), TTL 7 дней. При accept в одной транзакции — статус `accepted` + создание Membership.

### super_admin

Флаг `User.isSuperAdmin = true`. Владелец продукта Z (Z-Admin). Bypass всех RBAC проверок. На Фазе 0 — просто пропускает проверки. В Фазе 7 каждое drill-down действие super_admin пишется в `SuperAdminAccessLog` (compliance).

### visibilityMode

Поле `Org.visibilityMode: open | strict`. Управляет, что видит роль `manager`:
- `open` (дефолт) — manager читает все ресурсы Org, пишет только свои.
- `strict` — manager читает/пишет только свои ресурсы.

`owner` и `admin` всегда видят всё.

### tenantId

Поле во всех tenant-scoped моделях. Указывает, к какой Org относится ресурс. На Фазе 0 — nullable; после backfill в проде — NOT NULL для основных моделей.

### LlmTaskRoute

Запись в БД, описывающая для конкретного `taskType` цепочку провайдеров (с fallback'ом). Может быть глобальной (`tenantId = NULL`) или Org-специфичной (override от Z-Admin Фаза 7). См. [[../01_projects/llm-router|llm-router]].

### LlmModelPrice

Версионируемая прайс-карта моделей. `effectiveFrom/effectiveTo` позволяют корректно считать ретроспективные расходы при смене цен провайдером. Источник правды для costUsd в `AiUsageLog` (Фаза 7+); fallback — `MODEL_PRICES` в коде.

## Будущие фазы (placeholder'ы со ссылками)

### IdeaBlock (Блок знаний) — Фаза 2

Канонический атомарный фрагмент знания. Содержит `name`, `criticalQuestion`, `trustedAnswer`, `signalType` (fact/pain/feature_request/objection/...), `embedding`, `evidenceCount`. Дедуплицируется через distill-pipeline.

### IdeaBlockEvidence — Фаза 2

Связь блока с источником: `rawEventId`, `quote`, `startMs/endMs` для медиа.

### Entity (Сущность) — Фаза 2

Упомянутая бизнес-сущность: `client / person / project / product / topic / location / custom`. Имеет `canonicalName`, `aliases`, `embedding`. Склейка дублей через `mergedIntoId`.

### Theme (Тема) — Фаза 4

AI-кластер связанных IdeaBlock-ов. Имеет `name`, `description`, `branch` (одна из 12 веток компании), `dynamic` (growing/stable/declining). Создаётся `theme-clusterer.worker`'ом, обновляется `reframing.worker`'ом.

### Source (Источник) — Фаза 1

Подключённый к Org канал входящих данных: meeting / chat / phone_call / bot / email / web_form / external. Конфигурируется в `/settings/sources` (Фаза 10).

### RawEvent (Событие источника) — Фаза 1

Иммутабельная запись сырого события из Source. Идемпотентно по `idempotencyKey`. Хранит `payload` (jsonb до 10MB inline, больше — в S3).

### IdeaBlockLink / EntityLink — Фаза 3

Типизированные связи между блоками (develops/contradicts/causes/...) и между сущностями (works_at/belongs_to/...). Создаются `block-linker.worker` / `entity-graph-builder.worker` по KNN+LLM-арбитру.
