---
title: RBAC — система доступов в Z
status: actual
updated: 2026-05-27
type: architecture
---

# RBAC — система доступов в Z

Система ролевого управления доступом (Role-Based Access Control) на основе **Casbin-стиля политик**. Реализована как in-house engine с policy.csv.

## Основные понятия

### Сущности

| Сущность | Описание |
|---|---|
| **User** | Пользователь; `isSuperAdmin` флаг для обхода всех проверок |
| **Org** | Организация (tenant); один owner, может быть несколько members |
| **Membership** | Связь User ↔ Org с ролью; один user может быть в нескольких Org'ах с разными ролями |
| **ResourceType** | Тип ресурса (meeting, card, task, block, person и др.); ~60 типов в RESOURCE_TYPES |
| **Action** | Действие: read / write / delete / manage / erase |

### Слои защиты

1. **TenantGuard** — извлекает `tenantId` из заголовка `X-Org-Id`, URL-параметра или дефолта
2. **CookieAuthGuard** — проверяет авторизацию
3. **RbacService.check()** — проверяет права на основе membership + policy.csv
4. **Service layer** — дополнительные логики (per-resource ownership, department-checks и т.д.)

---

## Роли (5 типов)

### 1. super_admin
- **Источник:** `User.isSuperAdmin = true`
- **Права:** ✅ Обходит ВСЕ проверки RBAC и TenantGuard
- **Применение:** системные операции, миграции, отладка
- **Ограничения:** пока НЕ логируется (SuperAdminAccessLog — Фаза 7 ТЗ)

### 2. owner (владелец Org)
- **Источник:** `Membership.role = 'owner'` первый кто зарегистрировался в Org
- **Права:**
  - ✅ Read/write/delete ВСЕ ресурсы в Org (org, meeting, card, task, block, entity, theme, decision, goal и др.)
  - ✅ Управление Org (смена visibilityMode, удаление members, смена последнего owner'а ЗАЩИЩЕНА)
  - ✅ Управление интеграциями (каналы, webhook'и, источники, prompt templates)
  - ✅ Инициация erasure-запросов (право на удаление данных по 152-ФЗ)
  - ✅ Manage-действия (rebuild cron'ы, force-transition'ы)
- **Ограничения:** только owner может делать owner-only действия
- **Защита:** последнего owner'а нельзя ни понизить в роли, ни удалить из Org

### 3. admin (администратор Org)
- **Источник:** `Membership.role = 'admin'` (назначает owner)
- **Права:**
  - ✅ Read/write/delete ВСЕ ресурсы в Org (как owner, но кроме owner-only действий)
  - ✅ Управление интеграциями
  - ✅ Manage-действия (rebuild, force-transition)
  - ✅ Read операционных дашбордов
- **Ограничения:**
  - ❌ Не может менять settings Org (только owner)
  - ❌ Не может менять роли members (только owner)
  - ❌ Не может удалять members (только owner)
  - ❌ Не может инициировать erasure (только owner)

### 4. manager (менеджер / сотрудник)
Права зависят от **visibilityMode** Org.

#### manager в `visibilityMode='open'`
- **Права:**
  - ✅ Read ВСЕ ресурсы Org
    - Встречи, карточки, задачи всех colleagues
    - Блоки, сущности, темы (shared knowledge)
    - Людей, должности, отделы, процессы
    - Идеи, решения, insights (shared knowledge)
  - ✅ Write/delete только СВОИ:
    - Встречи (если ownerId == self)
    - Карточки (если ownerId == self)
    - Задачи (если creatorId == self)
    - Идеи (create + support других)
    - Check-ins (свои)
  - ✅ Read дашборд (но не операционный)
- **Исключение:** knowledge-core (блоки, темы, сущности) НЕ имеют ownerId → shared для всех, manager не может писать (пишут воркеры)

#### manager в `visibilityMode='strict'`
- **Права:**
  - ✅ Read структуру компании (люди, должности, отделы) — видят полную оргструктуру
  - ✅ Read shared knowledge (блоки, темы, сущности) — нужно для поиска
  - ✅ Read/write только СВОИ:
    - Встречи
    - Карточки
    - Задачи
    - Идеи (только свои)
    - Check-ins (только свои)
  - ❌ Не видит встречи/задачи/карточки colleagues
  - ❌ Не видит чужие идеи/решения

### 5. coo (Chief Operations Officer)
- **Источник:** `Membership.role = 'coo'` (Фаза β-8)
- **Права:**
  - ✅ Read на ВСЮ информацию Org:
    - Встречи, карточки, задачи, блоки, сущности, темы
    - Структура: люди, отделы, роли, должности
    - Люди: appointments, KPI, maturity, skill_profile
    - Операционные дашборды (dashboard_operations, temperature, weekly)
    - Решения, идеи, insights
    - Цели (goal)
  - ✅ Write только СВОИ:
    - Check-ins (свои)
  - ✅ Операционные права:
    - Read/write intake_issue (входящие задачи — триаж)
  - ❌ Не может писать во встречи, карточки, задачи
  - ❌ Не может менять Org-настройки
  - ❌ Не видит операционные дашборды (только COO + owner + admin)

---

## Видимость организации (visibilityMode)

Параметр `Org.visibilityMode` меняет права `manager'а`:

| visibilityMode | manager read | manager write | Случай использования |
|---|---|---|---|
| **open** | все ресурсы | только свои | Открытые компании, где информация shared |
| **strict** | структура + shared знание | только свои | Закрытые компании, конфиденциально |

**Knowledge-core исключение:** блоки, темы, сущности читают ВСЕ (shared knowledge), независимо от strict/open. Иначе knowledge-core разваливается на per-user силосы.

---

## Policy.csv — Casbin-стиль правила

**Файл:** `backend/src/modules/rbac/policies/policy.csv` (~900 строк)

**Формат:**
```
p, роль, видимость_org, кому_принадлежит, ресурс, действие
```

**Параметры:**

| Параметр | Варианты | Описание |
|---|---|---|
| `роль` | owner / admin / manager / coo | Роль из Membership |
| `видимость_org` | open / strict / * | Org.visibilityMode; * = игнорировать |
| `кому_принадлежит` | self / * | self = только если resourceOwnerId == userId; * = любой |
| `ресурс` | meeting, card, task, block, ... | ResourceType из RESOURCE_TYPES |
| `действие` | read / write / delete / manage / erase | Action |

**Примеры:**

```csv
# Owner: полный доступ ко встречам
p, owner, *, *, meeting, read
p, owner, *, *, meeting, write
p, owner, *, *, meeting, delete

# Manager в open-режиме: читай все встречи
p, manager, open, *, meeting, read
# ...но пиши только свои
p, manager, open, self, meeting, write
p, manager, open, self, meeting, delete

# Manager в strict-режиме: только свои встречи
p, manager, strict, self, meeting, read
p, manager, strict, self, meeting, write
p, manager, strict, self, meeting, delete

# Knowledge-core: shared для всех (нет ownerId)
p, manager, *, *, block, read      # читай любые блоки
# (write на блоки НЕ выдаём — пишут воркеры)

# Решения: shared knowledge, manager видит по режиму
p, manager, open, *, decision, read
p, manager, strict, self, decision, read
```

---

## ResourceType'ы (60+ ресурсов)

Полный список в `RbacService.RESOURCE_TYPES`:

### Основные операционные
- `meeting` — встречи на LiveKit
- `card` — карточки (CRM: client, deal, project, topic, custom)
- `task` — задачи (legacy, до Tracker)
- `chapter`, `highlight` — разделы и highlights из отчёта
- `chat-message` — сообщения в чате встречи

### Tracker (Фаза B1)
- `project` — проекты трекера
- `issue` — задачи трекера
- `cycle` — циклы (sprints)
- `intake_issue` — входящие задачи (inbox)
- `team_template` — шаблоны команд
- `issue_webhook` — исходящие webhook'и

### Knowledge-core (память компании)
- `block` — информационные блоки из встреч
- `entity` — сущности (люди, компании, процессы)
- `theme` — AI-кластеры блоков
- `decision` — решения компании (rationale, status, timeline)
- `insight` — повторяющиеся проблемы, риски, блокеры
- `idea` — идеи сотрудников и запросы клиентов
- `probe_event` — вопросы от Layer 6 Probe-Agent

### Структура компании (Фаза 0, группа А)
- `person` — люди
- `department` — отделы
- `role` — должности
- `appointment` — назначения (Person на Role)
- `job-description` — описания должностей
- `skill` — навыки (справочник)
- `document` — документы (загруженные в систему)
- `role-profile` — материализованный кеш «карта должности»

### Каркас компании (Фаза 0, группа Б)
- `mission`, `vision`, `strategy` — идентичность компании
- `process`, `process-step` — процессы
- `process_template` — шаблоны процессов (canonical)
- `regulation` — регламенты
- `policy` — политики
- `tool` — инструменты
- `metric`, `kpi` — метрики и KPI

### Специалисты Слоя 3 (SBA)
- `knowledge_profile` — что человек знает (Specialist 3.2)
- `skill_profile` — профиль навыков сотрудника (Specialist 3.7)
- `clone_persona` — executable persona для Clone API (Specialist 3.7)
- `skill_category` — эмерджентные категории навыков
- `helpfulness_trait` — сигналы помощи / mentoring (Specialist 3.8)
- `commitment` — обещания сотрудников (IdeaBlock signalType='commitment')
- `brand_voice` — голос бренда Org (Specialist 3.10)

### Операционные дашборды (Фаза β-8)
- `dashboard_operations` — агрегат пульса операций
- `dashboard_operations_temperature` — температура команды
- `dashboard_operations_weekly` — недельная сводка
- `daily_checkin` — ежедневные check-ins сотрудников
- `personal_relation` — типизированные связи между людьми

### Кураторство (Layer 4, Фаза α-4)
- `curation_item` — запись в очереди проверки
- `curation_decision` — решение куратора
- `conflict_item` — конфликты между карточками
- `card_version` — версии карточек
- `curator_assignment` — назначение кураторов
- `completeness_slot` — слоты незаполненных полей

### AI-рефлексия
- `prompt_template` — шаблоны промптов (конструктор в админке)
- `concierge` — AI-помощник кабинета (tool-use)
- `orchestrator` — multi-agent research (Фаза δ-1)

### Разное
- `tag` — теги
- `audit-log` — логи аудита
- `ai-usage` — логи использования LLM
- `source` — внешние источники (Telegram, IMAP, web-form)
- `vendor` — поставщики
- `event_card` — события графа знаний
- `goal` — цели компании
- `company_profile` — идентичность Org (1:1)
- `functional_domain` — функциональные области + дерево
- `maturity` — сводка зрелости (Role/Department/Company)
- `activity_feed_item` — единая лента активности
- `social_contribution_profile` — агрегат вклада per person
- `helpfulness_spotlight` — публичные спасибо
- `recognition` — благодарности (от AI или user'а)
- `badge` — каталог бейджей
- `user_badge` — выданные бейджи
- `contribution_snapshot` — агрегат вклада (ideas, thanks, helpfulness)
- `voice` — синтез/распознавание речи (TTS + ASR)
- `chat_v2_conversation` — диалоги с AI-чатом
- `channel` — настройки каналов (SMTP, Telegram, etc.)
- `notification` — уведомления
- `push_subscription` — браузерные push-подписки
- `import_tracker` — миграционный wizard (Trello, Bitrix24)
- `proactive_notification` — инициативные уведомления от Watcher'а
- `experiment` — эксперименты компании

---

## Реализация (RbacService)

### Основной метод: check()

```typescript
async check(params: CheckParams): Promise<boolean> {
  const ctx = await this.loadContext(userId, tenantId);  // 1. Загрузить membership (+60s кэш)
  if (ctx === null) return false;                         // 2. Нет membership → false
  if (ctx.isSuperAdmin) return true;                      // 3. super_admin → true
  
  return this.evaluate({                                  // 4. Найти подходящее правило
    role: ctx.role,
    visibility: ctx.visibility,
    obj: params.obj,
    act: params.act,
    isSelfOwner: params.resourceOwnerId === params.userId
  });
}
```

### Параметры запроса

```typescript
interface CheckParams {
  userId: string;
  tenantId: string;
  obj: ResourceType;
  act: Action;
  resourceOwnerId?: string | null;  // ID владельца ресурса (для check ownerMatch='self')
}
```

### Пример использования в контроллере

```typescript
// Проверка перед удалением встречи
const allowed = await this.rbacService.check({
  userId: req.user.id,
  tenantId: req.tenantId,
  obj: 'meeting',
  act: 'delete',
  resourceOwnerId: meeting.ownerId  // только owner встречи (если strict) или owner/admin Org
});
if (!allowed) throw new ForbiddenException('Нет прав на удаление встречи');
```

### Кэширование

- **TTL:** 60 сек
- **Max size:** 10k записей (LRU eviction)
- **Инвалидация:** `RbacService.invalidate(userId, tenantId)` после смены роли

---

## Специальные логики

### Knowledge-core (блоки, темы, сущности)

Нет `ownerId` → это shared knowledge Org:

```csv
# Даже manager:strict может ЧИТАТЬ (для поиска)
p, manager, *, *, block, read
p, manager, *, *, entity, read
p, manager, *, *, theme, read

# Но ПИСАТЬ не может — пишут только воркеры (block-ingest, entity-resolver и т.д.)
# (policy.csv НЕ выдаёт manager write на block/entity/theme)
```

**Почему?** Если manager видит встречи/задачи но не видит блоки из них → разваливается поиск, графики, интеллект.

### Person.erase (право на удаление по 152-ФЗ)

Только owner Org может инициировать:

```csv
p, owner, *, *, person, erase
# admin/manager НЕ в policy.csv
```

Super_admin обходит проверку.

### Decision (решения) и Insight

Shared knowledge, но видимость зависит от режима:

```csv
# open: manager видит все решения, может помечать как helpful
p, manager, open, *, decision, read

# strict: manager видит только свои решения
p, manager, strict, self, decision, read
```

### Clone Access (доступ к клонам сотрудников)

**Legacy (до ТЗ 2026-05-25):** в RbacService есть `canAccessPersonCloneLegacy()` с логикой:
- owner/admin Org
- сам человек (Person.userId == requesterUserId)
- direct manager в той же primaryDepartment

**Новый (ТЗ 2026-05-25+, `CLONE_V2_ENABLED=true`):** явные `CloneAccessGrant`:
- Admin выдаёт галочку → `CloneAccessGrant{tenantId, grantedToUserId, cloneRefId, expiresAt, revokedAt}`
- Проверка: `RbacService.canAccessPersonClone()` → смотрит на грант + `revokedAt IS NULL` + `expiresAt > now`
- Носитель не видит свой клон автоматически (違う от legacy)

---

## Граф доступов

```
User.isSuperAdmin=true  →  bypass всё
     ↓
User.id (+ Org.id)      →  RbacService.loadContext()
     ↓
Membership{orgId, userId, role}  +  Org.visibilityMode
     ↓
policy.csv (роль + видимость + кому_принадлежит + ресурс + действие)
     ↓
→ true (разреши) / false (запрети)
```

---

## Группы доступа к знаниям (knowledge-access, 2026-06-06)

Новая **ось доступа поверх `tenantId`** — управляет видимостью знаний ВНУТРИ компании («менеджер низшего звена не видит знания совета директоров»). Это отдельное измерение от ролевого RBAC: RBAC решает «можно ли вызвать эндпоинт», группы доступа решают «какие блоки знаний попадут в выдачу AI-чата/поиска/клона».

ТЗ: [plans/tz/2026-06-06-knowledge-access-groups-and-provenance.md](../../plans/tz/2026-06-06-knowledge-access-groups-and-provenance.md).

### Модель групп
- **department** — горизонталь, ссылается на существующий `Department` (refId=departmentId, оргдерево не дублируется). Мягкий фильтр: видимость через направленную матрицу `GroupVisibilityPolicy`.
- **leadership / council** («Руководство» / «Совет») — закрытые «верхние» группы (синглтоны на Org, `isClosed=true`). Вертикаль: видна ТОЛЬКО прямым членам, НЕ через матрицу отделов.
- **personal** — личный сейф (refId=personId), создаётся лениво.

Принцип: **дефолт — знание видно всей компании** (ценность памяти не ломаем). Группа лишь сужает. Вертикаль (closed) главнее горизонтали (department).

### `KnowledgeAccessResolver`
[backend/src/modules/rbac/knowledge-access-resolver.service.ts](../../backend/src/modules/rbac/knowledge-access-resolver.service.ts) — резолвит группы пользователя из должности (`Person`/`PersonRole`/`Department`/`Membership`) с кэшем (TTL 60с, `invalidateAll()`):
- `resolveAccessibleGroups({tenantId,userId})` → `{deptGroupIds[], closedGroupIds[], isBypass}`.
- `buildAccessWhere(ctx)` — Prisma-фрагмент для `findMany` (bypass → пустой фильтр `{}`).
- `buildAccessSqlPredicate(...)` — SQL-предикат для raw-SQL поверхностей (retrieval).
- `partitionBlockIdsByAccess(...)` / `partitionProjectionsByAccess(...)` — defense-in-depth фильтр финального набора.
- `RbacService.canAccessKnowledgeGroup(...)` — чистая ABAC-функция по образцу `canViewEmployeeFullCard`.

### Флаг выката `KNOWLEDGE_ACCESS_ENFORCEMENT`
ENV `z.enum(['off','shadow','enforce']).default('off')`:
- **off** (дефолт) — поведение байт-в-байт текущее (no-op гейт);
- **shadow** — выдача не меняется, но считается метрика `kc_access_shadow_diff_total{surface}` (сколько блоков было бы отфильтровано);
- **enforce** — фильтр применяется, `kc_access_denied_total{surface}` растёт.

**Bypass:** owner / admin / super_admin видят всё (как и в ролевом RBAC).

> **Уточнение к «Knowledge-core исключение».** Раньше граф знаний фильтровался только по `tenantId` (все члены Org видели весь граф). Теперь это исключение **опционально гейтится** при `enforce`: пользователь получает только блоки своих групп. При `off`/`shadow` исключение сохраняется (всё видят все).

### Admin-CRUD
Модуль `knowledge-access` ([knowledge-access-admin.controller.ts](../../backend/src/modules/knowledge-access/knowledge-access-admin.controller.ts), `/api/v1/knowledge-access`) — направленная матрица отделов, членство групп (override + clearance), дефолт закрытости по типу встречи. UI: `frontend/app/(admin)/company-admin/access-groups`.

## Версионирование и miграции

### Добавление нового ResourceType

1. Добавить в `RbacService.RESOURCE_TYPES`
2. Написать соответствующие правила в policy.csv
3. Пример: для `new_resource`
   ```csv
   p, owner, *, *, new_resource, read
   p, owner, *, *, new_resource, write
   p, owner, *, *, new_resource, delete
   p, admin, *, *, new_resource, read
   p, admin, *, *, new_resource, write
   p, manager, open, *, new_resource, read
   p, manager, open, self, new_resource, write
   ```

### Путь на @nestjs/casbin (в будущем)

Policy.csv уже совместима с Casbin. Если потребуется динамическое управление политиками через UI:
1. Заменить `RbacService.evaluate()` на `enforcer.enforce()` (из @nestjs/casbin)
2. Остальной код не меняется

---

## Фазы реализации RBAC

| Фаза | Когда | Что добавилось |
|---|---|---|
| **Фаза 0** | 2026-05-10 | Org / Membership / TenantGuard / RbacService (owner/admin/manager) |
| **β-8** | 2026-05-25 | COO роль + dashboard_operations |
| **γ-1** | 2026-05-25 | skill_profile / clone_persona / CloneAccessGrant v2 (ТЗ 2026-05-25) |
| **δ-2** | TBD | ProactiveNotification |
| **δ-3** | TBD | Voice endpoint доступ |
| **Фаза 7** | TBD | SuperAdminAccessLog |
| **knowledge-access** | 2026-06-06 | Группы доступа к знаниям поверх tenantId (department/leadership/council/personal) + `KnowledgeAccessResolver` + флаг `KNOWLEDGE_ACCESS_ENFORCEMENT` (off→shadow→enforce); см. раздел выше |

---

## Важные граждане

- **TenantGuard:** `backend/src/modules/rbac/guards/tenant.guard.ts`
- **RbacService:** `backend/src/modules/rbac/rbac.service.ts`
- **Policies:** `backend/src/modules/rbac/policies/policy.csv`
- **Testy:** `backend/src/modules/rbac/rbac.service.spec.ts`
- **Membership модель:** `backend/prisma/schema.prisma` (Membership table)
