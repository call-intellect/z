---
type: tz
feature: clones-role-based-rebrand
codename: Клоны = Роли
status: draft
created: 2026-05-25
updated: 2026-05-25
owner: @sergrv80
phases_total: 6
depends_on:
  - plans/archive/2026-05-21-sba-gamma-1-specialist-3-7-skill-and-clone.md (исходное γ-1 ТЗ, уже реализованное)
  - C:\Users\USER\.claude\projects\c--work-z\memory\project_clones_are_role_based.md (решение владельца 2026-05-25)
related:
  - plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md (W4 floor для executable_persona = internal)
  - second-brain/01_projects/skill-and-clone.md
---

# ТЗ: Клоны = Роли — рефакторинг γ-1 UI и публичных артефактов

> **Кодовое имя:** «Клоны = Роли».
> **Цель:** изменить публичную модель клонов в Z с **персональной** («Клон Маши») на **ролевую** («Клон Маркетолога v2»). Решение владельца 2026-05-25.
>
> **Что НЕ ломаем:** внутренняя модель данных остаётся (`SkillProfile` per Person, `SkillTrait`, `ExecutablePersona`). Меняем только публичную витрину и добавляем versioning.

---

## 0. Контекст

### 0.1 Почему меняем

γ-1 ТЗ ([plans/archive/2026-05-21-sba-gamma-1-specialist-3-7-skill-and-clone.md](../archive/2026-05-21-sba-gamma-1-specialist-3-7-skill-and-clone.md)) был реализован в составе Коры v2 (см. shipping report 2026-05-23). Там клон назывался по имени сотрудника, было 3 страницы:
- `/me/clone` — сотрудник смотрит свой клон.
- `/persons/[id]/skill-profile` — руководитель смотрит профиль сотрудника.
- `/roles/[id]/skill-profile` — клон роли.

**Решение владельца 2026-05-25:**
1. Клоны называем **по должности, не по имени** («Клон Маркетолога», не «Клон Маши»).
2. При смене носителя роли — **новая версия** клона (v1, v2, v3...). Старые версии в архиве.
3. Сотрудник **не видит «свой» клон** (его и нет — есть клон должности, на которой он сейчас).
4. Клоны — это **корпоративный артефакт** (как должностная инструкция). 152-ФЗ к ним не применяется (нет персональных данных конкретного человека на витрине).
5. Сотрудники в курсе, что клоны создаются — это прозрачно, не скрываем.

### 0.2 Что это даёт

- **Снимает тревожность** сотрудника («что система обо мне думает»).
- **Снимает риск гейминга** (если человек знает, что про него ведут профиль — начнёт «играть на камеру»).
- **Снимает большую часть 152-ФЗ риска** (на витрине нет PII).
- **Создаёт реальную ценность** — институциональная память роли переживает смену сотрудников.

### 0.3 Принципы

1. **Аддитивно к моделям, разрушительно к UI.** Prisma-модели сохраняем (внутри они продолжают per-Person работать). UI-страницы удаляем и заменяем.
2. **Versioning через `ExecutablePersona.version`.** Не плодим новую таблицу.
3. **SkillProfile per Person остаётся** — это служебная структура (источник данных для агрегации в ролевой клон). На UI не показывается.
4. **prisma:push, не migrate.** Правило `prisma-db-push-rules`.
5. **Backfill через one-off patch-script.** Существующие `ExecutablePersona(scope='person')` остаются в БД для истории, но не появляются в новом UI.

---

## 1. Что меняется (сводка)

### 1.1 Модели данных (Prisma)

```prisma
model ExecutablePersona {
  // ... существующие поля
  // НОВЫЕ:
  roleVersion        Int?      @default(1)             // версия клона роли (1, 2, 3...) — null для scope='person' (legacy)
  currentBearerPersonId String?                        // кто сейчас на роли (null для scope='person' и для архивных версий)
  publicName         String?                           // «Клон Маркетолога v2» — генерируется при save (null для legacy)
  succeedsPersonaId  String?                           // → ExecutablePersona.id предыдущей версии (для chain)
  succeeds           ExecutablePersona? @relation("PersonaSuccession", fields: [succeedsPersonaId], references: [id])
  succeededBy        ExecutablePersona[] @relation("PersonaSuccession")

  @@index([scope, scopeRefId, status, roleVersion])
}
```

**Что НЕ меняем в Prisma:**
- `SkillProfile` per Person — остаётся как было.
- `SkillTrait` — остаётся.
- `ExecutablePersona.scope='person'` — модель поддерживается (legacy + источник данных), но новые UI её не показывают.
- `ExecutablePersona.scope='role'` — основной публичный артефакт.

### 1.2 UI

| Что | Действие |
|---|---|
| `/me/clone` | **Удалить страницу.** Маршрут возвращает 404 + редирект на `/clones` с подсказкой «Клоны делаются на роль, посмотрите свою должность». |
| `/persons/[id]/skill-profile` | **Удалить страницу.** Маршрут 404 + редирект на `/persons/[id]` (профиль человека без skill-блока). |
| `/roles/[id]/skill-profile` | **Переименовать в `/roles/[id]/clone`.** Прежний URL делает 301 redirect. |
| `/clones` | **Создать новую страницу.** Список клонов компании (по ролям, текущие версии). |
| `/roles/[id]/clone/history` | **Создать новую страницу.** История версий клона роли (v1, v2... с датами и носителями). |

### 1.3 RBAC

| Ресурс | Действие | Раньше | Теперь |
|---|---|---|---|
| `skill_profile` | read | owner/admin/manager.open/manager.strict/self | owner/admin/manager.open/manager.strict. **Self убран.** |
| `clone_persona` (`ExecutablePersona`) | read | owner/admin/manager (по scope)/self | **Все member'ы Org** (это рабочий артефакт). manager-write/owner-only. |
| `clone_persona` | write | owner/admin | owner/admin |
| `clone_persona` | delete | owner | owner |

`clone_persona` становится «shared knowledge» уровня Org — как regulation, decision, theme.

### 1.4 DataClass

- `ExecutablePersona(scope='role')` → floor **`internal`** (KC-Temporal W4).
- `SkillProfile` per Person → `internal` (служебный, не на UI).
- `SkillTrait` → `internal`.

**Раньше** (γ-1 ТЗ): `private` для скрытых, `sensitive` для manager-видимых. **Теперь:** всё внутреннее, как должностная инструкция.

### 1.5 Терминология

В UI и копи:
- ❌ «Клон Маши Ивановой» → ✅ «Клон Маркетолога v2»
- ❌ «Профиль знаний сотрудника» → ✅ «Клон должности» / «Клоны»
- ❌ «Мой клон» → ✅ ничего (страницы нет)
- ❌ «Skill Profile», «Executable Persona» в копи → ✅ «Клон» / «Версия клона»

### 1.6 Concierge / Chat-v2

Сейчас `Chat-v2` имеет `mode='clone_style'` (см. α-5 ТЗ) — отвечает «от лица человека». Меняется:
- Раньше: `clone_style` мог отвечать «от лица Маши».
- Теперь: `clone_style` отвечает **«от лица роли»** — «как Маркетолог компании Z». Если на роли сейчас Маша, её опыт учитывается; если придёт Петя, через 2 недели стиль может сдвинуться (новая версия персоны).

API `POST /api/v1/clones/persons/:id/ask` — **удалить** (404). API `POST /api/v1/clones/roles/:id/ask` — оставить, переименовать в `POST /api/v1/clones/:roleId/ask`.

---

## 2. Фазы реализации

### Фаза 1 — Prisma + backfill

**Цель:** добавить новые поля в `ExecutablePersona`, backfill existing role-scope personas как v1.

**Файлы:**
- `backend/prisma/schema.prisma` — расширить `ExecutablePersona` (см. §1.1).
- `backend/scripts/patch-clones-role-versioning.ts` — новый.

**Backfill script logic:**
```
1. Для каждого ExecutablePersona(scope='role', status='active'):
   roleVersion = 1
   currentBearerPersonId = NULL (компания решит руками первым deployment'ом)
   publicName = 'Клон ' + Role.name + ' v1'
   succeedsPersonaId = NULL
2. Для ExecutablePersona(scope='person', *) — НЕ трогаем, legacy.
3. Логировать сколько обработано, dry-run флаг.
```

**DoD:**
- [ ] `prisma:push` применён.
- [ ] `typecheck` зелёный.
- [ ] Patch отработал на снапшоте prod-данных без ошибок.
- [ ] Existing role-scope personas получили `publicName` вида «Клон <Role.name> v1».

---

### Фаза 2 — Versioning logic в backend

**Цель:** при смене носителя роли — автоматически создаётся новая версия персоны.

**Hook:** в `Appointment` или `Role.assignmentChange` event:
- Когда `Person.A` перестаёт занимать `Role.X` и `Person.B` начинает — emit event `role.bearer_changed`.
- Listener `RoleClonePersonaVersioningHandler`:
  - Текущий `ExecutablePersona(scope='role', scopeRefId=roleId, status='active')` помечается `status='archived'`.
  - Создаётся новый `ExecutablePersona(roleVersion=prev+1, currentBearerPersonId=newPersonId, succeedsPersonaId=prevId, publicName='Клон <Role.name> v<N+1>')` со статусом `pending_rebuild`.
  - Enqueue `executable-persona-build.cron` для немедленной пересборки на основе данных нового носителя.

**API:**
- `POST /api/v1/admin/clones/:roleId/force-new-version` — ручное создание новой версии (owner-only, для отладки).
- `GET /api/v1/clones/:roleId/history` — список версий с датами и носителями.

**Метрики:**
- `clones_role_version_created_total{role_id}` (counter).
- `clones_role_versions_total{role_id}` (gauge) — общее число версий на роль.

**DoD:**
- [ ] Event handler работает на integration test.
- [ ] Архивные версии остаются доступными по API.
- [ ] Метрики снимаются.

---

### Фаза 3 — UI: удалить старые страницы

**Цель:** убрать `/me/clone` и `/persons/[id]/skill-profile`.

**Файлы:**
- `frontend/app/(authenticated)/me/clone/page.tsx` — **удалить**. На месте — `notFound()` или redirect:
  ```tsx
  import { redirect } from 'next/navigation';
  export default function MyClonePage() {
    redirect('/clones');
  }
  ```
- `frontend/app/(authenticated)/persons/[id]/skill-profile/page.tsx` — **удалить**. Redirect на `/persons/[id]`.
- `frontend/src/api/clones.api.ts` — удалить `askPersonClone(personId)` функцию. Оставить `askRoleClone(roleId)`.
- Sidebar навигация — убрать пункт «Мой клон» если есть.
- Concierge tools — убрать `ask_my_clone` tool. Оставить `ask_role_clone`.

**DoD:**
- [ ] Прямой переход на `/me/clone` редиректит на `/clones`.
- [ ] Прямой переход на `/persons/[id]/skill-profile` редиректит на `/persons/[id]`.
- [ ] Sidebar не показывает удалённые пункты.
- [ ] Concierge не предлагает «свой клон».

---

### Фаза 4 — UI: новый `/clones` (список) и `/roles/[id]/clone` (детали)

**Цель:** новая публичная витрина клонов.

**`/clones` — список:**
- Сетка / таблица карточек по ролям.
- Карточка: «Клон <Role.name> v<N>», текущий носитель (имя сотрудника + аватарка), confidence клона (бар), число активных traits, дата последнего rebuild.
- Фильтры: департамент, статус (active / pending_rebuild), confidence-диапазон.
- Сортировка: по дате rebuild / по confidence.
- Поиск по `Role.name`.
- Файл: `frontend/app/(authenticated)/clones/page.tsx`.
- API: `GET /api/v1/clones?status=active` — список текущих ролевых клонов Org.

**`/roles/[id]/clone` — детали (переиспользует существующий код `/roles/[id]/skill-profile`):**
- Шапка: «Клон <Role.name> v<N>», текущий носитель.
- Кнопка «Спросить клона» → диалог через `ask_role_clone`.
- Блок traits с провенансом (откуда мы это знаем).
- Кнопка «История версий» → `/roles/[id]/clone/history`.
- Файл: `frontend/app/(authenticated)/roles/[id]/clone/page.tsx`.
- 301 redirect: `frontend/app/(authenticated)/roles/[id]/skill-profile/page.tsx` → `redirect(\`/roles/${id}/clone\`)`.

**`/roles/[id]/clone/history` — история версий:**
- Таблица: версия (v1, v2...), носитель в этот период, период (validFrom / validUntil из ExecutablePersona.createdAt и status='archived' даты), confidence на момент архивации.
- Клик по версии → read-only view персоны на тот момент (через `ExecutablePersona.snapshotJson` если есть, иначе предупреждение «детали недоступны для архивных версий»).
- Файл: `frontend/app/(authenticated)/roles/[id]/clone/history/page.tsx`.

**DoD:**
- [ ] `/clones` показывает список всех текущих role-personas Org.
- [ ] `/roles/[id]/clone` работает идентично прежнему `/skill-profile` + 301 redirect.
- [ ] `/roles/[id]/clone/history` показывает версии (если есть, иначе «v1 — единственная»).
- [ ] Sidebar навигация добавлен пункт «Клоны» (в группе «Знания» или «Команда»).

---

### Фаза 5 — RBAC + DataClass update

**Цель:** перевести `executable_persona` в shared-знания Org, обновить DataClass.

**RBAC:** в `backend/src/modules/rbac/policies/policy.csv`:
- `clone_persona, read, member` — все member'ы Org читают.
- `clone_persona, write, owner` + `admin`.
- `clone_persona, delete, owner`.
- `skill_profile, read, manager.open, manager.strict, owner, admin` — убрать `self`.

**DataClass:**
- Hook в `executable-persona-build.cron`: при создании/обновлении `ExecutablePersona(scope='role')` — `dataClass = 'internal'` через `DataClassPolicyService` (см. KC-Temporal W4.1).
- Backfill: `patch-clones-dataclass-update.ts` — для existing `ExecutablePersona(scope='role')` проставить `dataClass='internal'`.

**DoD:**
- [ ] Любой member Org может открыть `/clones` и `/roles/[id]/clone`.
- [ ] Manager.strict видит, но не правит.
- [ ] DataClass у всех role-personas = `internal`.

---

### Фаза 6 — Концьерж + Chat-v2 + промпты

**Цель:** обновить семантику `clone_style` и убрать ask-person.

**Изменения:**
- `chat-v2.service.ts` (mode='clone_style'):
  - Раньше: при `clone_style` мог искать `ExecutablePersona(scope='person')`.
  - Теперь: только `ExecutablePersona(scope='role', status='active')` — текущая версия клона роли.
  - Если у пользователя в Person.appointmentRoleId есть role — берём её клон. Иначе — Concierge просит уточнить роль.
- Промпт `clone-respond.prompt.ts`:
  - Раньше: «Ты — клон сотрудника X».
  - Теперь: «Ты — клон должности <Role.name> в компании. На этой должности сейчас работает <bearer.name>, его опыт учтён в твоих ответах».
- Concierge tool registry:
  - Убрать `ask_my_clone`.
  - Оставить `ask_role_clone(roleId, question)`.
  - Добавить `list_clones()` — список текущих клонов.

**DoD:**
- [ ] `clone_style` в Chat-v2 не возвращает person-scope persona.
- [ ] Промпт обновлён, snapshot-тест прошёл.
- [ ] Concierge не предлагает «свой клон» в подсказках.

---

## 3. RBAC ресурс `skill_profile` — что остаётся

После рефакторинга `skill_profile` per Person — это **служебная структура**. На публичном UI её нет. Но она доступна по API для:
- Admin debugging (`/admin/debug/skill-profile/:personId`).
- Force-rebuild персоны.
- DSAR-флоу (если когда-то понадобится): запрос «выгрузите всё, что знаете обо мне» — отвечаем через выгрузку source IdeaBlock-ов + SkillProfile + связанных traits.

`skill_profile` остаётся в RBAC как separate resource, но без `self read` — только `owner` / `admin` / `manager.open` / `manager.strict`. Если сотрудник запросит — owner получит уведомление и решит, что выгружать.

---

## 4. Что НЕ делаем

- **Не удаляем `ExecutablePersona(scope='person')` модели.** Эти записи остаются как legacy + источник данных для будущих агрегаций (если когда-то решим вернуть person-style для отдельных кейсов — данные уже есть).
- **Не делаем UI для «моего клона»** ни в каком виде. Если сотрудник захочет узнать «что система обо мне знает» — это DSAR через owner.
- **Не переписываем существующий `executable-persona-build.cron`** — он продолжает строить и `role`, и `person` personas. Просто `person` personas не появляются на UI.
- **Не делаем «голосование сотрудников» против клона.** Mark-as-misleading работает на уровне отдельных traits, как в γ-1.

---

## 5. Глобальные ENV (без изменений)

Этот рефакторинг не добавляет новых ENV. Использует существующие настройки γ-1.

---

## 6. Глобальные метрики (новые)

| Метрика | Тип | Где |
|---|---|---|
| `clones_role_version_created_total{role_id}` | counter | RoleClonePersonaVersioningHandler |
| `clones_role_versions_total{role_id}` | gauge | списочный API |
| `clones_role_active_count` | gauge | sweep cron (или прямо в API) |
| `clones_legacy_person_persona_count` | gauge | sweep cron — наблюдение за legacy остатком |

---

## 7. Риски и rollback

| Риск | Митигация |
|---|---|
| Пользователи будут жаловаться на пропавший `/me/clone` | Редирект на `/clones` + onboarding-плашка «Мы перешли к клонам по должностям. Подробнее: ...» (короткий обучающий блок на `/clones`). |
| Versioning ломает existing personas | Backfill v1 для всех existing role-scope. Person-scope не трогаем. |
| RBAC опускает порог видимости | Через AdminSetting можно вернуть `clone_persona read = manager-only`, если в конкретной Org member-wide шаринг не подходит. |
| Concierge ломает person-asks в production | Phase 6 делаем последней, после Phase 1-5. Person-ask API сначала возвращает 410 Gone с подсказкой, потом удаляется через 2 недели. |
| Сотрудники почувствуют слежку через `/clones` | Прозрачное оформление: «Это рабочий артефакт компании, как должностная инструкция. Сотрудники знают, что клоны создаются». Plus возможность DSAR-запроса через owner. |

**Rollback:** все шесть фаз обратимы.
- Фаза 1: backfill идемпотентный.
- Фаза 2: handler можно выключить через ENV `CLONES_ROLE_VERSIONING_ENABLED=false`.
- Фаза 3-4: redirect-страницы можно вернуть к старым реализациям.
- Фаза 5: RBAC возврат через policy.csv.
- Фаза 6: Chat-v2 mode `clone_style` можно временно отключить.

---

## 8. Зависимости между фазами

```
Фаза 1 (Prisma + backfill) ─┬─ Фаза 2 (versioning logic)
                            └─ Фаза 5 (RBAC + DataClass — нужно поле dataClass через KC-Temporal W4.1)

Фаза 3 (delete old UI) ─── Фаза 4 (new UI)  -- можно параллелить с Фазой 2

Фаза 6 (Concierge + Chat-v2) — последняя, после всех остальных.
```

**Зависимость с KC-Temporal:** Фаза 5 требует `DataClassPolicyService.derive({kind:'executable_persona'})` — нужен W4.1 minimum в shadow-mode. Можно стартовать Фазу 5 параллельно с W4.1.

---

## 9. Фазовый roadmap

| Спринт (2 нед каждый) | Фазы |
|---|---|
| **S1** | Фаза 1 (Prisma + backfill) + Фаза 3 (delete old UI) |
| **S2** | Фаза 2 (versioning logic) + Фаза 4 (new UI) |
| **S3** | Фаза 5 (RBAC + DataClass, требует KC-Temporal W4.1) + Фаза 6 (Concierge + Chat-v2) |

Итого: **~6 недель / 3 спринта**. Совмещается с KC-Temporal S1-S3.

---

## 10. Definition of Done (зонтичный)

- [ ] Все 6 фаз закрыты по своим DoD.
- [ ] `bun run typecheck` + `bun run lint` + `bun run test:unit` + `bun run test:integration` зелёные.
- [ ] Любой member Org может открыть `/clones` и увидеть список ролевых клонов.
- [ ] Прямой переход на `/me/clone` или `/persons/[id]/skill-profile` → корректный redirect.
- [ ] Concierge не предлагает «свой клон».
- [ ] Snapshot-тест на промпт `clone-respond.prompt.ts` обновлён.
- [ ] Метрика `clones_role_versions_total` снимается, видна в Grafana.
- [ ] `second-brain/01_projects/skill-and-clone.md` обновлён (раздел «Ребрендинг 2026-05-25»).
- [ ] Документ `docs/user-guide/clones.md` опубликован (объяснение для пользователей: что такое клон, почему по ролям, как их использовать).

---

## 11. Прод-операции (сводка для деплоя)

```
# 1. БД-схема (после Фазы 1)
cd backend && bun run prisma:push && bun run prisma:generate

# 2. Backfill
bun run scripts/patch-clones-role-versioning.ts        # после Фазы 1
bun run scripts/patch-clones-dataclass-update.ts       # после Фазы 5

# 3. ENV (если включить kill-switch versioning'а)
# CLONES_ROLE_VERSIONING_ENABLED=true в .env

# 4. Перезапустить backend + workers + frontend
docker compose up -d --build backend
docker compose up -d --build worker
docker compose up -d --build frontend

# 5. Smoke-тест:
# - Открыть /clones — должен показать список.
# - Открыть старый /me/clone — должен редиректить.
# - Спросить Concierge «покажи моего клона» — должен предложить клоны должностей.
```

---

## 12. Открытые вопросы

1. **На какие роли вообще делать клонов?** Сейчас `executable-persona-build.cron` строит для каждой Role с ≥2 employee. Может ли быть Role с 1 сотрудником? Например, единственный CFO. Решение: **да, начиная с 1 сотрудника**, если активных traits ≥ 3. Иначе клон преждевременный.
2. **Как называется кнопка «спросить клона»?** Варианты: «Спросить клона», «Спросить должность», «Спросить роль». Рекомендую **«Спросить клон должности»** — длинно, но однозначно.
3. **DSAR-флоу** (запрос сотрудника «что вы обо мне знаете») — нужен? Это `private` персональные данные на уровне source IdeaBlock-ов (где упомянут конкретный человек). Можно начать с ручного process: сотрудник пишет owner'у → owner запрашивает у админа выгрузку → выдают. Автоматизировать в γ+, не сейчас.
4. **Уведомление сотруднику** при создании новой версии клона его роли? Например: «Создана v2 Клона Маркетолога — на основе ваших данных». Помогает прозрачности. Решение: **да, в Phase 6** — внутреннее уведомление при первом deploy с пометкой «вы можете влиять на качество, помечая неверные знания».

---

## 13. Совместимость с `clone-reliability-hardening` (2026-05-25)

Параллельной сессией 2026-05-25 был **реализован** `plans/tz/2026-05-25-clone-reliability-hardening.md` — 6 фаз доработок клона: антифальшивка, smart-trait-concepts, глава отдела, semantic search, реактивная пересборка, snapshot-тесты. Этот ТЗ (Clones=Roles) **частично пересекается** с ним. Разбор пересечений:

### 13.1 Что переносится без изменений ✅

- **Антифальшивка** (Фаза 1 reliability) — программное правило «отказать, если мало рассуждений» работает одинаково для `askPerson` и `askRole`. После Clones=Roles мы оставляем только `askRole` — антифальшивка переезжает туда без рефакторинга.
- **Skill-trait-concepts** (Фаза 2 reliability) — нормализация категорий через смысловые блоки. Категории определяются на уровне traits, не зависят от scope='person'|'role'. Работает.
- **Semantic search «кто разбирается в X»** (Фаза 4 reliability) — `Specialist32CardHandler` ищет по embedding'у категории, возвращает Person'ов. Это для **внутренней** аналитики, не публичной витрины. Остаётся.
- **Snapshot-тесты + golden-набор `skill-trait-detect`** (Фаза 6 reliability) — фикстуры на уровне taskType, не зависят от UI. Работают.

### 13.2 Что конфликтует ⚠️ — митигации

| Пересечение | Конфликт | Митигация |
|---|---|---|
| **Кнопка «Обновить клона»** на `/me/clone` и `/persons/[id]/skill-profile` (Фаза 5.2 reliability) | Я обе страницы удаляю в Фазе 3. Кнопка теряет место. | Кнопка переезжает на `/roles/[id]/clone`. Логика та же — вызов `ClonesService.triggerManualPersonaSnapshot(roleId, scope='role')`. RBAC: видна owner / admin / direct manager (носителя на этой роли). |
| **API `POST /api/v1/clones/persons/:personId/ask`** (Фаза 1 reliability добавила антифальшивку в неё) | Я предлагал удалить (404). | НЕ удаляю — оставляю **под admin-only** для отладки. Из публичного Concierge убираем (Фаза 6 моего ТЗ). Антифальшивка остаётся в `askPerson`, плюс копируется в `askRole`. |
| **Глава отдела + переадресация уведомлений** (Фаза 3 reliability) | Сейчас это «уведомление про конкретного подчинённого идёт главе отдела вместо самого подчинённого». В role-модели нет «уведомлений про подчинённого» — есть «уведомление про новую версию клона роли в отделе». | Переадресация остаётся, **смысл переориентируется**: вместо «новый trait у Маши → notif руководителю Маши» → «новая версия клона маркетолога → notif главе маркетинга». То есть `SkillManagerDigestCron` (см. ниже) собирает per-department, а не per-person. |
| **`SkillManagerDigestCron`** (`0 9 * * MON`) сейчас шлёт manager'ам digest «новые черты у подчинённых» | После Clones=Roles нет «подчинённых person'ов» как публичной сущности | Digest переориентируется на «новые версии клонов ролей в вашем отделе за неделю». Менеджер получает: «Клон Маркетолога v3 (на основе работы Маши с 2026-05-20)» — без раскрытия личных трейтов. |
| **`/me/clone` страница** (Фаза 5.2 reliability упоминает «страница уже существует, см. skill-and-clone.md») | Удаляю в Фазе 3 моего ТЗ. | Сначала Phase 3 моего ТЗ делает редирект → `/clones`. Документация в `skill-and-clone.md` обновляется одновременно с моей Phase 3. |

### 13.3 Что НЕ конфликтует, но требует синхронизации 🔄

- **Фаза 6 reliability** — переключение моделей `skill-trait-detect` на DeepSeek V4 Pro (заблокировано на момент 2026-05-25 фиксом `deepseek-pro-output-format-fix.md`). Это `LlmTaskRoute` уровень, не зависит от UI. Не блокирует мой ТЗ.
- **Snapshot-тесты на промпт `clone-respond.prompt.ts`** (Фаза 6 моего ТЗ обновляет промпт) — нужно перегенерировать snapshot после изменения промпта. Это обычный flow snapshot-тестов.

### 13.4 Порядок выполнения

Чтобы избежать сломанной работы:

1. **Сначала запустить Phase 1-2 моего ТЗ** (Prisma + versioning logic). Это не трогает UI и API.
2. **Параллельно** — закончить любые остающиеся хвосты `clone-reliability-hardening` (если есть).
3. **Phase 3-4 моего ТЗ** (delete old UI + new UI) — за один спринт, чтобы не оставлять промежуточное полу-сломанное состояние.
4. **Phase 5 моего ТЗ** (RBAC + DataClass) — после Phase 1 KC-Temporal W4.1 (shadow mode DataClassPolicy).
5. **Phase 6 моего ТЗ** (Concierge + Chat-v2 + промпт) — последняя.

В каждой фазе:
- Прогнать snapshot-тесты `skill-trait-detect` golden-набора (Фаза 6 reliability) — не должны сломаться.
- Прогнать integration test `clones-refusal.spec.ts` (Фаза 1 reliability) — антифальшивка должна работать.

---

## 14. Связь с γ-1 ТЗ

[plans/archive/2026-05-21-sba-gamma-1-specialist-3-7-skill-and-clone.md](../archive/2026-05-21-sba-gamma-1-specialist-3-7-skill-and-clone.md) — исходное ТЗ, реализованное в составе Коры v2.

**Этот ТЗ — поверх γ-1.** Не отменяет, а уточняет публичную модель:
- Внутренние модели (`SkillProfile`, `SkillTrait`, `ExecutablePersona`) — без изменений по структуре, только новые поля versioning.
- Воркеры (`skill-trait-detector`, `skill-profile-rebuild`, `executable-persona-build.cron`) — без изменений.
- 4 LLM-taskType (`skill-trait-detect`, `skill-trait-merge`, `executable-persona-compile`, `clone-respond`) — без изменений; только промпт `clone-respond` обновляется (Фаза 6).
- Probe-trigger'ы `skill.profile_starved` / `skill.contradicting_traits` — остаются, но переориентированы на роли (не человека).

**§16 γ-1 ТЗ DoD «обязательная страница `/me/clone`» — отменено решением 2026-05-25.** Прямо переписано здесь в §1.2.

---

_Это исполнительное ТЗ. После согласования — выделить sub-ТЗ на каждую фазу при старте, если кто-то будет реализовывать параллельно с другими задачами._
