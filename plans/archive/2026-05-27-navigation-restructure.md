> 📦 **АРХИВ (аудит 2026-06-04): ✅ реализовано — 100%.**
> Реализовано полностью: единственный затронутый файл Sidebar.tsx содержит все 6 групп в правильном порядке, условную «Управление» по роли coo, collapsible «Справочник» с persist в localStorage, hideGroupLabel, все перенес
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`

# ТЗ: Реструктуризация навигации Кора по слоям использования

**Дата:** 2026-05-27
**Контекст:** Информационная архитектура меню должна отражать частоту использования, ролевую принадлежность и природу данных (ежедневные действия vs знания vs справочник).

## Принцип

Меню переходит с трёх плоских групп (Компания/Оперативка/Настройки) на **6 слоёв по природе использования**:

1. **Каждый день** — ежедневные действия (встречи, дамп, карточки, проекты, входящие, помощник)
2. **Моё пространство** — личный кабинет (я, мой вклад, обещания, предложения)
3. **Память компании** — knowledge-граф (идеи, правила, решения, сигналы, сущности, темы) — *уже есть отдельной подгруппой, выносим на верхний уровень*
4. **Управление** — ролевые дашборды (Панель операций, Ежедневный/Недельный отчёт, Цели) — *видно только owner / admin / coo*
5. **Справочник** — структура и метаданные компании (структура, отделы, домены, документы, карты должностей, клоны…) — *collapsible, по умолчанию свёрнут*
6. **Настройки** — конфиг + админка (как было)

## Что уже есть в коде (не делать заново)

- `frontend/src/ui/components/app-shell/Sidebar.tsx` — 886 строк, 3 группы (COMPANY/OPERATIONS/SETTINGS) + механика collapsible subgroups с localStorage-персистом
- `SidebarSubgroup` с auto-expand при активном пункте
- `useMemoryAccess()` — RBAC + entitlement-фильтр для Памяти
- `useEntitlement()` — гейтинг по тарифу (lock-иконка)
- CTA «Создать встречу» в шапке Sidebar
- Auth context с `currentOrgRole` (owner/admin/manager/coo) + `isSuperAdmin`
- Динамическое добавление COO-пунктов (`canSeeOperationsCoo`) и «Входящих» (`canTriage`)
- Дашборды: `/dashboard` (DashboardRouter → DirectorDashboard или ManagerDashboard), `/dashboard/operations*`
- Личный кабинет `/me` + `/me/contributions`, `/me/social-contribution`, `/me/promises`
- `TrackerBottomNav` для мобильного трекера
- `OrgSwitcher` для переключения Org (роль пользователя зависит от текущей Org)

## Что меняем (минимально безопасные изменения)

**Единственный файл:** `frontend/src/ui/components/app-shell/Sidebar.tsx`

### Шаг 1: Перегруппировать константы NavGroup

Старые `COMPANY_GROUP` + `OPERATIONS_GROUP` распадаются на 5 новых:

- `DAILY_GROUP` («Каждый день») — `/dashboard`, `/meetings`, `/dump`, `/cards`, `/projects`, `/chat`. Сюда же динамически добавляются `/intake` (для canTriage) с бейджом.
- `ME_GROUP` («Моё пространство») — `/me`, `/me/contributions`, `/me/social-contribution`, `/me/promises`, `/feedback`.
- `MEMORY_GROUP` («Память компании») — `MEMORY_SUBGROUP_ITEMS` поднимается из подгруппы COMPANY на верхний уровень. Это уже smart-фильтрованный массив (`useMemoryAccess`).
- `MANAGEMENT_GROUP` («Управление») — `/dashboard/operations`, `/dashboard/operations/daily`, `/dashboard/operations/weekly`, `/goals`. **Вся группа условная — рендерится только если `canSeeOperationsCoo === true`** (owner/admin/coo). На самой группе фильтра по тарифу нет, но `/goals` остаётся с `gateFeature: feature.goals_strategy`.
- `REFERENCE_GROUP` («Справочник») — `/structure`, `/company`, `/departments`, `/domains`, `/maturity`, `/documents`, `/roles`, `/clones`, `/vendors`, `/events`, `/experiments`, `/brand-voice`. **Группа целиком collapsible (`defaultCollapsed: true`, storageKey: `sidebar.reference.open`)**, реализуется через единственную `collapsibleSubgroups` без `items`.

`SETTINGS_GROUP` оставляем как есть.

Подгруппа «Будет в следующей фазе» (`/processes`, `/policies`, `/metrics`) — переезжает внутрь `REFERENCE_GROUP` как вторая подгруппа (defaultCollapsed: true).

### Шаг 2: Адаптировать сборку `groups` в компоненте

```ts
const groups: NavGroup[] = [
  dailyGroup,         // с возможным /intake + бейджем
  meGroup,            // статика, всем видна
  memoryGroup,        // с фильтром useMemoryAccess
  ...(canSeeOperationsCoo ? [managementGroup] : []),
  referenceGroup,     // с showDot для /clones
  settingsGroup,      // как было
];
```

### Шаг 3: Перенести логику фильтров

- `canTriage` + `intakePendingCount` → в `dailyGroup` builder (вместо OPERATIONS_GROUP).
- `canSeeOperationsCoo` → определяет факт показа `managementGroup`. COO-пункты больше не подмешиваются в Оперативку.
- `useMemoryAccess` → фильтр items внутри `memoryGroup` (как было для подгруппы).
- `showDot` для `/clones` → теперь применяется к items в `referenceGroup`.

### Шаг 4: Группа как collapsible

Сейчас collapse — на уровне подгруппы. Для «Справочника» нужен collapse целой группы. Реализация: `REFERENCE_GROUP.items = []` + единственная `collapsibleSubgroups: [{ label: 'Справочник', defaultCollapsed: true, storageKey: 'sidebar.reference.open', items: [...] }]`. Заголовок группы остаётся в `group.label = 'Справочник'` (или скрываем, оставляя только заголовок подгруппы — TBD при реализации, по эстетике).

**Решение:** заголовок группы скрываем (через флаг `hideGroupLabel`), оставляем только collapsible-header подгруппы. Так визуально это будет одна сворачиваемая секция «Справочник», без двойного заголовка.

### Шаг 5: Сохранить порядок и backward-compat

- Порядок MEMORY_SUBGROUP_ITEMS — не менять.
- `storageKey` для Memory остаётся `sidebar.memory.open` (пользователи не теряют свои настройки).
- Все href, matchPrefix, gateFeature, badgeCount, showDot — переносятся без изменений.

## Что НЕ делаем в этом ТЗ

- **Новые дашборды** — `DirectorDashboard` / `ManagerDashboard` / `OperationsDashboard` уже есть. Меняем только их доступ через меню.
- **Top navigation** — текущий CTA «Создать встречу» + Sidebar уже выполняют функцию. Отдельный header пока не нужен (если позже понадобится — отдельное ТЗ).
- **Role switching UI** — `OrgSwitcher` уже переключает Org (а значит роль). Отдельного role-switcher не делаем.
- **Mobile-адаптация** — `TrackerBottomNav` уже работает на мобиле; Sidebar в `MobileHeader` рендерится из drawer.
- **Backend изменения** — нет.

## Фазы

- [ ] **Фаза 1** — Sidebar.tsx restructure: 5 новых констант групп + новая сборка `groups` в компоненте + `hideGroupLabel` для Reference.
- [ ] **Фаза 2** — QA: `cd frontend && bun run typecheck && bun run lint && bun run build`.
- [ ] **Фаза 3** — Обновление документации: `docs/user-guide/карта-кабинета.md` (если есть навигационный раздел) + `second-brain/01_projects/frontend-pages.md` если затронуто.
- [ ] **Фаза 4** — Коммит (без push, ждём подтверждения пользователя).

## Definition of Done

- ✅ В Sidebar — 6 групп по новой архитектуре в правильном порядке
- ✅ «Управление» видно только для owner/admin/coo
- ✅ «Справочник» свёрнут по умолчанию (с персистом в localStorage)
- ✅ Все существующие фильтры (Memory access, Intake badge, Clones dot, Tariff gating) работают как раньше
- ✅ Активный пункт по любому URL подсвечивается корректно (winnerHref logic)
- ✅ TypeScript + ESLint + build — зелёные
- ✅ Документация обновлена

## Статус

```
[ ] Не начиналось
[x] В процессе (начало: 2026-05-27)
[ ] Готово
```
