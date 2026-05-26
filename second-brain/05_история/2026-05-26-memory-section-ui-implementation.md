---
type: reflection
date: 2026-05-26
distilled: false
---

# 2026-05-26 — Реализация раздела «Память компании» (6 UI-задач)

## Постановка

ТЗ `plans/tz/2026-05-26-memory-section-ui.md` — 6 фронтенд-задач + минимальный
backend для разграничения доступа. Задачи:

1. `/regulations` — master-detail для Regulation/Process/Policy.
2. `/ideas` — tabs (Все/Кластеры/Мои) + master-detail.
3. `/entities` — новая страница (список + детали + связи).
4. `/me/knowledge-profile` → таблица скиллов (`SkillsTable`).
5. Подгруппа «Память» в Sidebar с localStorage-collapse.
6. Backend entitlements + frontend `useMemoryAccess` + admin-страница.

В ТЗ было заявлено что backend готов — это в основном подтвердилось, но
с нюансами (см. ниже).

## Что сделал

Сделал все 3 волны за одну сессию. Коммит `8c35614` на ветке `dev`.

**Frontend:**
- `Sidebar.tsx` — расширил тип `NavGroup`: `collapsibleSubgroup` → массив
  `collapsibleSubgroups[]`, добавил `storageKey` для localStorage-collapse.
  Подгруппа «Память компании» содержит /ideas, /regulations, /decisions,
  /insights, /entities, /themes. Фильтруется через `useMemoryAccess`.
- `SkillsTable.tsx` (новый shared) — таблица с раскрывающимися строками,
  индикатор уровня ●●●/●●○/●○○, relative-time через `Intl.RelativeTimeFormat`.
- `KnowledgeProfileClient` и `PersonKnowledgeProfileClient` переписаны
  через `SkillsTable` (read-only режим если нет `onMarkWrong`).
- `RegulationsListClient` — заменил inline-chips на компонент `<Chip>`,
  добавил severity-chip для policy, секцию «Шаги процесса»,
  collapsible-history, supersede через `<ConfirmDialog>`, toast через
  `sonner`, debounce поиска 300мс.
- `IdeasListClient` — переписал: 3 вкладки, `IDEA_STATUS_TRANSITIONS`
  (показываем только разрешённые переходы), `<ConfirmDialog>` с textarea
  для причины, `<EmptyState>`, дедуп логики `selectIdea`.
- `entities.api.ts`, `domain/entity.ts`, `entities/page.tsx`,
  `EntitiesListClient.tsx` — новая master-detail страница: pill-tabs по
  типу + search + pagination «Показать ещё».
- `useMemoryAccess.ts` — manager+ всегда true, на будущий `member` —
  entitlement-флаги.
- `/settings/admin/memory-access/` — page + Client с двумя
  переключателями + блок «Идеи — нельзя закрыть».
- `admin-memory-access.api.ts` — GET/PATCH клиент.
- `domain/entitlement.ts` — добавил 2 новых FeatureKey.
- `SettingsSidebar.tsx` — пункт «Доступ к памяти».

**Backend:**
- `tier-config.ts` — добавил 2 FeatureKey (default false на всех тирах).
- `policy.csv` — `manager` read на `regulation`/`process`/`process-step`/`policy`.
- `org-admin-memory-access.controller.ts` (новый) — GET/PATCH под
  `CookieAuthGuard + TenantGuard + OrgAdminGuard`. Тонкая обвязка над
  `EntitlementService.setOverride('feature', ...)`.
- `admin.module.ts` — регистрация контроллера.

**Verification:**
- `bun run typecheck` — 0 errors (frontend + backend).
- `bun run lint` frontend — 0 errors.
- `bun run lint` backend — 0 errors (1 не связанный warning).

## Что вышло

Всё реализовано. Перед коммитом был один цикл доработки:
- lint поймал `useMemoLinks` (хук после раннего return) — перенёс useMemo
  внутрь компонента до return.
- lint поймал `<a href="/clones">` в `KnowledgeProfileClient` — заменил
  на `<Link>` из `next/link`.

## Чему научился

1. **Термин «member» в ТЗ ≠ роль `member` в Z.**
   В ТЗ это Teamly-роль рядового сотрудника, а в Z есть только
   `owner/admin/manager/coo` (`schema.prisma:174`). Решение: реализовать
   как «manager+ всегда видит, для будущего member — entitlement-флаги».
   policy.csv обновил так, чтобы `manager` действительно имел read на
   regulation/process/policy (раньше — только admin/owner).
   В будущем: при работе по ТЗ, написанным под другой продукт-аналог
   (Teamly, Notion, Confluence), сначала проверять роли в `schema.prisma`,
   потом маппить термины.

2. **`useMemo` нельзя обернуть в свой хук-функцию после раннего return.**
   У меня было `function useMemoLinks(links)` вызываемый после `if (!detail)
   return null`. lint правильно заматерил. Правило rules-of-hooks
   распространяется на любые функции, начинающиеся с `use*`. Решение:
   либо переносить `useMemo` непосредственно в компонент до return, либо
   называть функцию без `use`-префикса (но тогда rules-of-hooks внутри
   тоже не разрешит).

3. **Sidebar с несколькими subgroups** — единственное расширение типа
   потребовало `collapsibleSubgroup?` → `collapsibleSubgroups?: NavSubgroup[]`.
   Если бы оставил singular — пришлось бы рисовать Memory руками отдельно
   от COMPANY_GROUP. Маленькое API-изменение, но сделало два subgroup в
   одной group чистыми (Memory + «Будет в следующей фазе»).

4. **Existing вилки vs новый код.** Перед началом работы выяснил, что
   `/regulations` и `/ideas` уже существовали в черновом виде. Это
   сэкономило время — переиспользовал API/domain. Урок: всегда сначала
   `ls` целевых директорий — даже если ТЗ написано как «создать с нуля»,
   реальность часто иная.

5. **Entitlement-флаги без tier-привязки.** Эти два новых `feature.*` —
   admin-toggles, не tier-фичи. Сделал default `false` для всех тиров,
   но `FEATURE_MIN_TIER` поставил `tier_basic` (доступ через override на
   любом тарифе). Это нестандартный кейс для tier-config, но он
   разрулился аккуратно через существующий механизм featureOverrides.

## Что осталось

- ТЗ упомянул «Если внутри ТЗ - подгруппа `/processes/templates`» —
  отложено в отдельное ТЗ (как ТЗ и предусматривал).
- Граф-визуализация сущностей — отложено.
- На странице `/entities/[id]/graph` (существующая, не трогал) можно
  добавить ссылку «Назад к списку» — но это вне scope.

## Прод-команды

Не нужны. Изменения чисто кодовые:
- Новые feature-ключи активируются автоматически после деплоя (default
  `false`, существующие Org не теряют поведения).
- policy.csv читается при старте — рестарт backend применит новые правила.
- Новый admin endpoint доступен после деплоя.

Никаких миграций, seed-скриптов, env-переменных, кронов не добавлено.
