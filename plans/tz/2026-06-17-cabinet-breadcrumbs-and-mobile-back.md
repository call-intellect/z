---
type: tz
status: ready-to-implement
feature: cabinet-breadcrumbs-and-mobile-back
date: 2026-06-17
owner: Сергей (svmazur@mail.ru)
relates_to:
  - frontend/src/ui/components/admin/AdminBreadcrumbs.tsx
  - frontend/src/ui/tracker/IssueBreadcrumb.tsx
  - frontend/src/ui/components/app-shell/nav-config.ts
---

> Анализ рынка не делался — паттерн стандартный (breadcrumbs + mobile back), решение выведено из текущего кода. · Статус согласования: 2026-06-17 (механизм/охват/подход приняты владельцем в чате).

# Сквозная навигация «на уровень выше» по всему кабинету: хлебные крошки + мобильная кнопка «назад»

## Принцип

Один **глобальный** механизм навигации вверх для всей route-группы `(authenticated)`, а не правка каждой страницы по отдельности. Хлебные крошки (breadcrumbs — кликабельный путь «раздел › подраздел › текущее») строятся автоматически из URL; человекочитаемые имена сущностей подставляют сами страницы-детали из уже загруженных данных. На десктопе — крошки в (пустующей сегодня) верхней панели; на мобильном — стрелка «назад» в шапке, ведущая на родительский уровень по иерархии.

**Не оптимизируй по-своему**: НЕ добавляй per-route `layout.tsx` на каждый сегмент (отвергнутый Проход B, см. «Доказательство выбора»), НЕ заставляй крошки самостоятельно дозагружать имена сущностей (двойной fetch — отвергнуто), НЕ трогай админскую route-группу `(admin)` (у неё свой layout и свои `AdminBreadcrumbs`).

## Цель и зачем

**Болезненное состояние (по факту, проверено в коде):** при проваливании вглубь (Проекты → проект → Доска → задача; Команда → человек → Пульс; и т.д.) внутри приложения нет ни одного способа подняться на уровень выше — только кнопка «назад» браузера. Боковое меню (`Sidebar`) переключает только разделы верхнего уровня. Глобальная верхняя панель десктопа существует, но почти пустая (в ней только колокольчик). Мобильная шапка кнопки «назад» не имеет вовсе.

**Чем решение лучше:** крошки строго мощнее «одной стрелки» — дают и «где я», и прыжок на любой уровень вверх; переиспользуют уже зарезервированный слот (нулевое изменение раскладки на десктопе) и существующий визуальный стиль `AdminBreadcrumbs`. Унифицируют разрозненный паттерн (сейчас крошки есть только в админке и в подзадачах трекера, в основном кабинете — дыра).

## REALITY-CHECK (фактическое состояние кода на 2026-06-17)

> ⚠️ Номера строк — на момент написания ТЗ. Перед правкой каждого файла **перечитать** и искать по указанному уникальному символу/тексту-якорю.

| Что | Статус по факту | Якорь (`path:line` + символ) |
|---|---|---|
| Глобальная верхняя панель десктопа | **Есть, почти пустая** — `div` с `justify-end`, внутри только `<PendingActionsBell />`. Готовый слот под крошки слева. | `frontend/src/ui/components/app-shell/AppShell.tsx:50` — текст-якорь `className="hidden h-header items-center justify-end gap-2 border-b border-border-subtle bg-bg-surface/60 px-4 backdrop-blur-glass md:flex"` |
| Мобильная шапка | **Есть, без кнопки «назад»** — лого + `OrgSwitcher` (flex-1) + `PendingActionsBell` + бургер. | `frontend/src/ui/components/app-shell/Header.tsx:21` — символ `export function MobileHeader()` |
| Каркас всех защищённых страниц | `AuthenticatedShell` → `AppShell` оборачивает `children`. | `frontend/app/(authenticated)/AuthenticatedShell.tsx:106` — текст `<AppShell>{children}</AppShell>` |
| Глобальный контекст заголовка / крошек / `PageTitleContext` | **НЕ существует** (греп 0). Контексты: auth/subscription/entitlement/toast. | `frontend/src/contexts/*` |
| Общий компонент «шапка страницы» (PageHeader) | **НЕ существует** в кабинете. Каждый раздел рисует `<h1>` инлайн. Единственный шаблон с общей структурой — `AdminSection` (только админка). | `frontend/src/ui/components/admin/AdminSection.tsx:30` |
| Единый источник навигации (десктоп+мобилка) | **Есть** — `nav-config.ts` с `NavConfigItem { href, label, matchPrefix, ... }`. Активный пункт = «победитель по самому длинному `matchPrefix`». Метки **роль-зависимы** (один и тот же href имеет разные label по роли). | `frontend/src/ui/components/app-shell/nav-config.ts:91` — символ `export interface NavConfigItem` |
| Реестр названий разделов | **Есть, крошечный** — `SECTION_LABELS = { structure, referrals, regulations }`. Неполный, не годится как источник для крошек напрямую. | `frontend/src/lib/section-labels.ts:3` |
| Крошки сегодня | `AdminBreadcrumbs` (только `(admin)`, items руками) + `IssueBreadcrumb` (только parent/child подзадачи в теле страницы). | `frontend/src/ui/components/admin/AdminBreadcrumbs.tsx:31`, `frontend/src/ui/tracker/IssueBreadcrumb.tsx:27` |
| Шапка+табы проекта | `ProjectViewShell` рендерит `<h1>{projectShortLabel(project)}</h1>` через `useProjectBySlug` — **проект уже загружен в этом компоненте**, имя для крошки брать отсюда. | `frontend/app/(authenticated)/projects/[slug]/ProjectViewShell.tsx:58` (`useProjectBySlug`), `:82` (`projectShortLabel(project)`) |
| Имена сущностей | Грузятся **разрозненными** SWR-хуками с разными ключами (`['goal', id]` vs `['tracker.project.by-slug', orgId, slug]` vs `['theme', id]` …). Единого способа прочитать имя по маршруту нет → имя должна отдавать сама страница. | `useProjectBySlug.ts:18`, `useIssue.ts:20`, `useProjectDocument.ts:18`, прямые `useSWR` в `GoalDetailClient`/`ThemeDetailClient`/`IdeaDetailRouteClient` |
| Маршрут `/issues/[id]` | **Плоский, но логически вложен в проект** (нет страницы-списка `/issues`). URL-родитель `/issues` = 404. Нужен parentHref-override на проект. | `frontend/app/(authenticated)/issues/[id]/IssueDetailClient.tsx` (`issue.projectId`, `issue.parentId`) |

**Вывод по scope:** фича пишется с нуля (механизма нет), но опирается на готовые слот/стиль/единый nav-config. Остаток = новый конфиг + хук + контекст + 2 UI-компонента + ~15 однострочных регистраций на страницах-деталях. Никакой существующий механизм не переделывается; `(admin)` и `IssueBreadcrumb` остаются нетронутыми (см. «Граничные контракты»).

## Принятые решения владельца (не пересматривать)

| # | Решение | Обоснование (Почему) |
|---|---|---|
| Р1 | Механизм = **хлебные крошки на десктопе + стрелка «назад» на мобильном** | Крошки дают «где я» + прыжок на любой уровень; стрелка на узком экране — компактный возврат на шаг. Чат с владельцем 2026-06-17. |
| Р2 | Охват = **весь кабинет** `(authenticated)`, не только проекты | Проблема воспроизводится на каждой ветке с вложенностью. «Чинить класс, а не случай» ([[feedback_fix_the_whole_class_not_the_case]]). |
| Р3 | Подход = **один глобальный механизм**, путь из URL автоматически; имена сущностей отдают страницы | Минимум изменений, нет дублирования; правка каждой страницы по отдельности = тот же баг-класс заново. |
| Р4 | Мобильная стрелка ведёт на **родительский уровень по иерархии** (детерминированно), НЕ `history.back()` | `history.back()` может увести на внешнюю страницу/неожиданное место; навигация вверх по пути предсказуема. |

## Доказательство выбора (два прохода + challenge-loop)

**Проход A (выбран):** URL-derived путь + центральный реестр меток сегментов + контекст, в который страница-деталь регистрирует имя сущности (которое она и так уже загрузила). Один глобальный компонент в верхней панели.

**Проход B (отвергнут):** идиоматичный App Router — вложенные `layout.tsx` на каждый сегмент маршрута, каждый отдаёт своё звено (через slot/`generateMetadata`).

**Проход C (отвергнут):** чисто URL, без имён сущностей — показывать сырые сегменты.

| Критерий (ограничение фичи) | A: глобальный компонент + реестр + контекст | B: per-segment layouts | C: чистый URL без имён |
|---|---|---|---|
| Охват всего кабинета одной точкой | ✓ один компонент в `AppShell` | ✗ нужно тронуть ~178 маршрутов | ✓ |
| Человекочитаемые имена («VKHOD · Входящие», заголовок задачи) | ✓ страница отдаёт уже загруженное | ⚠️ двойной fetch или серверная загрузка на сегмент | ✗ показывает `vkhod`, uuid |
| Без двойной загрузки данных | ✓ читает из уже загруженного объекта | ✗ | ✓ |
| Плоские-но-вложенные маршруты (`/issues/[id]`) | ✓ parentHref-override | ✗ структура папок ≠ логика | ✗ |
| Объём правок | низкий (новые файлы + ~15 однострочников) | очень высокий | низкий |
| Соответствие Р3 «один механизм» | ✓ | ✗ (механизм размазан по дереву) | ✓ |

A отличается от B по **оси точки интеграции** (один компонент vs дерево layout-ов) и **оси данных** (страница отдаёт имя vs пер-сегментный fetch). C отвергнут решением Р3 (владелец хочет реальные имена).

**Challenge-loop по A:**
1. *Корень, не симптом?* — Да: один механизм закрывает весь класс «нет навигации вверх», а не только проекты. Унифицирует разрозненные крошки.
2. *Самое эффективное?* — Да: переиспользует пустой слот (0 изменений раскладки), стиль `AdminBreadcrumbs`, `usePathname()`. Регистрация имени — однострочник на странице, которая объект уже держит. Не преждевременная оптимизация.
3. *Нет кода ради кода?* — Нет мёртвого задела. Отказались от «резолвера, который сам дозагружает имя по типу» (двойной fetch + реестр резолверов) в пользу регистрации из страницы.

## Scope

### Входит
- Центральный конфиг меток сегментов + fallback-метки типов сущностей + поддержка parentHref-override.
- Хук вычисления пути крошек из `usePathname()` + контекст-провайдер регистрации имён (`BreadcrumbProvider` / `useRegisterBreadcrumb`).
- Десктоп-компонент `<Breadcrumbs>` в левой части верхней панели `AppShell` (сворачивание длинного пути, скелетон конечного звена).
- Мобильная кнопка «назад» + заголовок текущего уровня в `MobileHeader`.
- Регистрация реальных имён на страницах-деталях основных сущностей (список — Фаза 4); fallback-метка типа для остальных динамических маршрутов (всегда корректна, никогда не сырой id).

### Не входит (судьба каждого хвоста)
- **Удаление/слияние `IssueBreadcrumb`** (parent/child подзадачи в теле страницы) — остаётся как есть; глобальные крошки покажут «Задачи › … › задача», `IssueBreadcrumb` дублирует частично, но не конфликтует. Дедуп → vNext (отдельное ТЗ, низкий приоритет).
- **`AdminBreadcrumbs` и вся route-группа `(admin)`** — не трогаем: у админки свой layout, она не использует `AppShell`-панель.
- **Замена инлайновых `<h1>` страниц на общий PageHeader** — отдельный рефактор, не нужен для навигации вверх.
- **Регистрация реальных имён для длинного хвоста** (curation, experiments, orchestrator-runs, support-tickets, import-sessions, entities, vendors и пр.) — закрыто fallback-меткой типа сущности из конфига (корректно, но обобщённо: «Обращение», «Эксперимент»…). Адресная регистрация по мере надобности → vNext.
- **`document.title` / SSR-метаданные** из имени сущности — вне scope (крошки клиентские).

## Граничные контракты с другими частями

- **`(admin)` route-группа:** breadcrumbs рендерятся ТОЛЬКО внутри `(authenticated)` (в `AppShell`). Админка имеет собственный layout и `AdminBreadcrumbs` — на неё фича не распространяется и её не ломает.
- **`IssueBreadcrumb`:** не удаляется, не вызывается из нового механизма. Сосуществует.
- **`nav-config.ts`:** новый конфиг крошек **не импортирует** роль-зависимые метки оттуда (они меняются по роли — недетерминированно для крошек). Заводим собственный детерминированный реестр; три пересекающихся значения (`structure`→«Команда», `regulations`→«Правила и стандарты», `referrals`) **переиспользуют константы `SECTION_LABELS`** во избежание расхождения.
- **`projectShortLabel(project)`** (`@/domain/tracker`): источник имени проекта для регистрации — тот же, что в `ProjectViewShell`, чтобы крошка и `<h1>` совпадали.

## Контракт-first (дословные сниппеты)

> Имена файлов и API ниже — канон для копипасты. Реализатор не выбирает свои.

### 1. Конфиг: `frontend/src/ui/components/breadcrumbs/breadcrumb-config.ts` (новый, pure `.ts`, без JSX)

```ts
import { SECTION_LABELS } from '@/lib/section-labels';

/**
 * Метка статического сегмента URL в контексте крошек. Ключ — имя сегмента
 * пути (НЕ полный href). Детерминированно (не зависит от роли), в отличие
 * от nav-config. Источник правды о текстовках крошек.
 */
export const SEGMENT_LABELS: Record<string, string> = {
  // верхний уровень разделов
  projects: 'Проекты',
  meetings: 'Встречи',
  goals: 'Цели',
  themes: 'Темы',
  ideas: 'Идеи',
  decisions: 'Решения',
  roles: 'Должности',
  clones: 'Клоны',
  teams: 'Группы',
  structure: SECTION_LABELS.structure, // «Команда»
  regulations: SECTION_LABELS.regulations,
  documents: 'Документы',
  tables: 'Таблицы',
  sprints: 'Спринты',
  curation: 'Курация',
  issues: 'Задачи',
  me: 'Я',
  settings: 'Настройки',
  support: 'Поддержка',
  // вложенные сегменты проекта
  overview: 'Обзор',
  board: 'Доска',
  list: 'Список',
  calendar: 'Календарь',
  cycles: 'Спринты',
  gantt: 'Гант',
  intake: 'Входящие',
  integrations: 'Приложения',
  workload: 'Загруженность',
  review: 'Ревью',
  // … полный список заполнить из карты маршрутов (см. Фаза 1)
};

/**
 * Динамические сегменты ([slug]/[id]/...) → метка ТИПА сущности (fallback,
 * когда имя ещё не зарегистрировано страницей). Ключ — имя РОДИТЕЛЬСКОГО
 * статического сегмента, в котором лежит динамический.
 * Никогда не показываем сырой id/slug — только это.
 */
export const DYNAMIC_FALLBACK_BY_PARENT: Record<string, string> = {
  projects: 'Проект',
  issues: 'Задача',
  goals: 'Цель',
  themes: 'Тема',
  ideas: 'Идея',
  decisions: 'Решение',
  roles: 'Должность',
  clones: 'Клон',
  teams: 'Группа',
  persons: 'Человек',
  documents: 'Документ',
  tables: 'Таблица',
  sprints: 'Спринт',
  cycles: 'Спринт',
  boards: 'Доска',
  curation: 'Запись',
  // … остальные по карте
};

/** Сегменты, по которым нельзя кликнуть (нет реальной страницы) — звено-текст. */
export const NON_NAVIGABLE_SEGMENTS: ReadonlySet<string> = new Set<string>([
  // напр. промежуточный сегмент-обёртка без своей страницы; заполнить по карте
]);
```

### 2. Контекст регистрации: `frontend/src/ui/components/breadcrumbs/BreadcrumbContext.tsx` (новый, `'use client'`)

```ts
export interface BreadcrumbOverride {
  /** Человекочитаемое имя для конечного (или указанного) звена. */
  label: string;
  /** Опц. переопределение родителя для плоских-но-вложенных маршрутов
   *  (напр. /issues/[id] → href доски проекта). Если задан — кнопка «назад»
   *  и предпоследнее звено используют его вместо URL-родителя. */
  parentHref?: string;
  /** Опц. явная метка родителя при parentHref (напр. имя проекта). */
  parentLabel?: string;
}

/** Регистрирует имя/override для ТЕКУЩЕГО маршрута. Вызывается со страницы-детали,
 *  которая уже загрузила сущность. Снимает регистрацию при размонтировании.
 *  Пустой/undefined label — no-op (пока грузится). */
export function useRegisterBreadcrumb(override: BreadcrumbOverride | null): void;

/** Провайдер вешается в AuthenticatedShell поверх AppShell. */
export function BreadcrumbProvider(props: { children: React.ReactNode }): JSX.Element;
```

Внутренняя модель: `Map<pathname, BreadcrumbOverride>` (ключ — текущий `usePathname()`), set/delete по mount/unmount. Это исключает двойной fetch: имя берётся из объекта, который страница уже держит.

### 3. Хук пути: `frontend/src/ui/components/breadcrumbs/useBreadcrumbTrail.ts` (новый, `'use client'`)

```ts
export interface BreadcrumbItem {
  label: string;
  href?: string;       // отсутствует у текущего (последнего) звена и у non-navigable
  isCurrent: boolean;
  isLoading?: boolean; // динамический лист, имя ещё не зарегистрировано
}

/** Чистая функция-ядро (юнит-тестируется без React): pathname + реестры +
 *  карта override → массив звеньев. */
export function buildBreadcrumbTrail(
  pathname: string,
  overrides: ReadonlyMap<string, BreadcrumbOverride>,
): BreadcrumbItem[];

/** React-обёртка: usePathname() + useContext(Breadcrumb) → BreadcrumbItem[]. */
export function useBreadcrumbTrail(): BreadcrumbItem[];
```

**Алгоритм `buildBreadcrumbTrail` (канон):**
1. Разбить `pathname` на сегменты (отбросить пустые).
2. Для каждого сегмента собрать накопительный href (`/projects`, `/projects/vkhod`, …).
3. Метка звена по приоритету: (а) `overrides.get(accumulatedHref)?.label` → (б) если сегмент статический — `SEGMENT_LABELS[segment]` → (в) если сегмент динамический — `DYNAMIC_FALLBACK_BY_PARENT[предыдущийСегмент]` с `isLoading: true` пока имя не пришло (для известного динамического листа) → (г) если ничего не найдено — звено пропускается (служебный сегмент).
4. `href` у звена = накопительный href, кроме: последнего (isCurrent → без href) и сегмента из `NON_NAVIGABLE_SEGMENTS`.
5. Если для текущего pathname в `overrides` задан `parentHref` — вставить/заменить предпоследнее звено на `{label: parentLabel ?? <метка по href>, href: parentHref}` и НЕ строить URL-родителя (кейс `/issues/[id]`).

**Негативные примеры (для юнит-теста):**
- `/projects` → `[{label:'Проекты', isCurrent:true}]` (длина 1 → крошки не рендерятся).
- `/projects/vkhod/board` + override(`/projects/vkhod`→'VKHOD · Входящие') → `['Проекты'(/projects)] › ['VKHOD · Входящие'(/projects/vkhod)] › ['Доска'(current)]`.
- `/projects/vkhod/cycles/abc123/review` + overrides → `Проекты › VKHOD · Входящие › Спринты › <имя спринта|"Спринт" loading> › Ревью`.
- `/issues/7f3a-uuid` + override(label='Добавить крошки', parentHref='/projects/vkhod/board', parentLabel='VKHOD · Входящие') → `Задачи?` нет → `VKHOD · Входящие(/projects/vkhod/board) › Добавить крошки(current)`. (override родителя замещает URL-родителя `/issues`.)
- `/curation/xyz` без регистрации → `Курация(/curation) › Запись(current, fallback, НЕ "xyz")`.

### 4. Десктоп: `frontend/src/ui/components/breadcrumbs/Breadcrumbs.tsx` (новый, `'use client'`)
Визуальный стиль — как `AdminBreadcrumbs` (разделитель `ChevronRight size={12}`, `text-fg-tertiary`, последний `font-medium text-fg-secondary aria-current="page"`). Рендерит `useBreadcrumbTrail()`. Правила: не рендерить при длине <2; при длине ≥5 — сворачивать (`первое › … › предпоследнее › текущее`), «…» = `DropdownMenu` (Radix, уже в зависимостях) со скрытыми звеньями; для звена с `isLoading` — `<span className="inline-block h-3 w-16 animate-pulse rounded bg-bg-overlay" />`.

### 5. Мобильная кнопка «назад»: правка `frontend/src/ui/components/app-shell/Header.tsx`
При `trail.length >= 2`: слева рендерить кнопку-стрелку (`ChevronLeft`, `aria-label="Назад"`), ведущую на `trail[trail.length - 2].href`; рядом — заголовок = `trail[trail.length - 1].label` (truncate); лого+`OrgSwitcher` на вложенных экранах скрываются ради места. При `trail.length < 2` — текущий вид (лого+OrgSwitcher+bell+бургер), кнопки «назад» нет.

## Границы автономии суб-агента

- **✅ Always:** создавать файлы в `frontend/src/ui/components/breadcrumbs/`; добавлять однострочные `useRegisterBreadcrumb(...)` в указанные страницы-детали; перечитывать файл перед правкой и грепать якорь; гонять `bun run typecheck && bun run lint && bun run build` во `frontend/`.
- **⚠️ Ask first:** менять структуру/раскладку `AppShell` сверх вставки `<Breadcrumbs/>` в существующий слот; трогать `nav-config.ts` (только чтение для справки); менять видимый текст разделов вне реестра крошек.
- **🚫 Never:** трогать route-группу `(admin)`/`AdminBreadcrumbs`; удалять `IssueBreadcrumb`; вводить `history.back()` для мобильной стрелки; показывать сырой id/slug как метку; жёсткие hex/`slate`-классы или английские слова в UI.

## Фазы

Граф зависимостей: **Ф1 → (Ф2 ∥ Ф3 ∥ Ф4)**. Ф2/Ф3/Ф4 независимы между собой (одна волна после Ф1). Ф5 — приёмка после всех.

### Фаза 1 — Ядро: конфиг + хук-ядро + контекст `[ ]`
**Цель:** детерминированное вычисление пути крошек и механизм регистрации имён, без UI.
**Картография:** новые файлы в `frontend/src/ui/components/breadcrumbs/`; источник полного списка сегментов — карта маршрутов из REALITY-CHECK + дерево `frontend/app/(authenticated)/**/page.tsx`; `SECTION_LABELS` из `frontend/src/lib/section-labels.ts:3`.
**Что входит:** `breadcrumb-config.ts` (полный `SEGMENT_LABELS` по всем верхним разделам и вложенным сегментам проекта; `DYNAMIC_FALLBACK_BY_PARENT`; `NON_NAVIGABLE_SEGMENTS`); `BreadcrumbContext.tsx` (`BreadcrumbProvider` + `useRegisterBreadcrumb`); `useBreadcrumbTrail.ts` (`buildBreadcrumbTrail` + хук). Подключить `<BreadcrumbProvider>` в `AuthenticatedShell` поверх `<AppShell>` (рядом с `EntitlementProvider`/`SubscriptionProvider`, `AuthenticatedShell.tsx:102-112`).
**Что НЕ входит:** любой рендер крошек/стрелки; правки страниц-деталей.
**Acceptance:**
- Файлы существуют, экспортируют `buildBreadcrumbTrail`, `useBreadcrumbTrail`, `BreadcrumbProvider`, `useRegisterBreadcrumb`, `SEGMENT_LABELS`, `DYNAMIC_FALLBACK_BY_PARENT` (греп символов).
- Юнит-тест `useBreadcrumbTrail.spec.ts` покрывает все 5 примеров из «Контракт-first §3» (вкл. негативные: длина 1; fallback вместо сырого id; parentHref-override). `bunx vitest run frontend/src/ui/components/breadcrumbs/useBreadcrumbTrail.spec.ts` зелёный.
- `buildBreadcrumbTrail('/projects/vkhod/board', map)` НЕ содержит звена с label, равным сырому сегменту `vkhod` (без override → `'Проект'`).
- `bun run typecheck && bun run lint` зелёные.

Закрывает: R1, R2, R7, R10 (частично — модель данных звена).

### Фаза 2 — Десктоп: `<Breadcrumbs>` в верхней панели `[ ]`
**Цель:** видимые крошки слева в глобальной панели десктопа.
**Картография:** слот — `AppShell.tsx:50` (`div ... justify-end ... md:flex`, внутри `<PendingActionsBell/>`); стиль-образец — `AdminBreadcrumbs.tsx:31-69`; `DropdownMenu` — `@/ui/shadcn/dropdown-menu`.
**Что входит:** `Breadcrumbs.tsx`; вставить `<Breadcrumbs />` в начало слота и сменить `justify-end` на `justify-between` (крошки слева, колокольчик справа). Сворачивание ≥5 звеньев через «…»-dropdown; скелетон для `isLoading`-звена; не рендерить при длине <2.
**Что НЕ входит:** мобильная шапка; регистрация имён.
**Acceptance:**
- На `/projects/<slug>/board` в панели виден путь `Проекты › <проект> › Доска`, каждое не-последнее звено — `<a href>` (грепаемый `aria-label="Хлебные крошки"` на `<nav>`).
- На `/projects` (длина 1) `<nav>` крошек не рендерится; панель визуально как раньше.
- Путь из ≥5 звеньев показывает `первое › … › предпоследнее › текущее`; «…» открывает список скрытых.
- `bun run typecheck && bun run lint && bun run build` зелёные.

Закрывает: R3, R8, R9, R10.

### Фаза 3 — Мобильная кнопка «назад» + заголовок `[ ]`
**Цель:** на вложенных экранах в мобильной шапке — стрелка на родителя + заголовок уровня.
**Картография:** `Header.tsx:21` (`MobileHeader`); `ChevronLeft` из `lucide-react`; `useBreadcrumbTrail()` из Ф1; навигация — `useRouter().push(parentHref)` или `<Link>`.
**Что входит:** условный рендер: `trail.length >= 2` → `[‹ Назад][заголовок=trail.at(-1).label, truncate][bell][бургер]`, лого+`OrgSwitcher` скрыты; иначе — текущий вид. Стрелка ведёт на `trail.at(-2).href` (НЕ `history.back()`).
**Что НЕ входит:** десктоп; bottom-nav (`MobileTabBar`/`TrackerBottomNav`) не трогаем.
**Acceptance:**
- На мобильном (<md) на `/projects/<slug>/board` слева видна стрелка `aria-label="Назад"`, ведущая на `/projects/<slug>`; виден заголовок «Доска».
- На `/projects`, `/me`, `/dashboard`, `/week`, `/actions`, `/memory`, `/chat` (мобильные вкладки, длина <2) стрелки нет, шапка как раньше.
- Клик по стрелке на `/issues/<id>` (после Ф4-override) ведёт на доску проекта, а не на 404 `/issues`.
- `bun run typecheck && bun run lint && bun run build` зелёные.

Закрывает: R4, R5, R7 (мобильная сторона).

### Фаза 4 — Регистрация реальных имён на страницах-деталях `[ ]`
**Цель:** конечные звенья показывают человекочитаемые имена, без повторного fetch.
**Картография и точки вставки (по одному `useRegisterBreadcrumb` на компонент, имя — из УЖЕ загруженного объекта):**

| Маршрут | Файл | Что регистрировать |
|---|---|---|
| `/projects/[slug]/*` | `projects/[slug]/ProjectViewShell.tsx` (`project` уже загружен, `:58`) | `{ label: projectShortLabel(project) }` |
| `/issues/[id]` | `issues/[id]/IssueDetailClient.tsx` | `{ label: issue.title, parentHref: '/projects/<slug>/board', parentLabel: <имя проекта> }` (slug проекта — из issue/проекта; если недоступно — без override, fallback на URL) |
| `/goals/[id]` | `goals/[id]/GoalDetailClient.tsx` | `{ label: goal.title }` |
| `/themes/[id]` | `themes/[id]/ThemeDetailClient.tsx` | `{ label: theme.title ?? theme.name }` |
| `/ideas/[id]` | `ideas/[id]/IdeaDetailRouteClient.tsx` | `{ label: idea.title }` |
| `/decisions/[id]` | `decisions/[id]/*Client.tsx` | `{ label: decision.title }` |
| `/structure/persons/[id]`, `/persons/[id]/*` | `*/PersonCardClient.tsx`, `persons/[id]/*Client.tsx` | `{ label: person.name }` |
| `/roles/[id]/*` | `roles/[id]/RoleDetailClient.tsx` (+ map/clone) | `{ label: role.name }` |
| `/clones/[roleId]` | `clones/[roleId]/CloneDetailClient.tsx` | `{ label: <имя роли клона> }` |
| `/teams/[id]` | `teams/[id]/TeamDetailClient.tsx` | `{ label: team.name }` |
| `/documents/[id]` | `documents/[id]/DocumentDetailClient.tsx` | `{ label: document.title }` |
| `/projects/[slug]/documents/[docId]` | `projects/[slug]/documents/[docId]/ProjectDocumentEditorClient.tsx` | `{ label: document.title }` |
| `/tables/[id]` | `tables/[id]/TableClient.tsx` | `{ label: table.title ?? table.name }` |
| `/sprints/[id]`, `/projects/[slug]/cycles/[cycleId]` | соответств. Client | `{ label: <имя спринта/цикла> }` |

**Что НЕ входит:** длинный хвост (curation/experiments/orchestrator/support/import/entities/vendors) — остаётся на fallback-метке типа из Ф1 (корректно, обобщённо).
**Acceptance:**
- На `/projects/<slug>/board` конечный родитель-проект в крошке = `projectShortLabel(project)` (совпадает с `<h1>` в `ProjectViewShell`).
- На `/goals/<id>` последнее звено = заголовок цели, НЕ id (грепнуть, что в компоненте есть вызов `useRegisterBreadcrumb({ label: goal.title })` или эквивалент).
- На `/issues/<id>` предпоследнее звено ведёт на доску проекта (override применился).
- Network-проверка: открытие страницы-детали НЕ порождает дополнительного запроса ради имени крошки (имя из уже загруженного объекта).
- `bun run typecheck && bun run lint && bun run build` зелёные.

Закрывает: R6, R7 (данные override).

### Фаза 5 — Приёмка `[ ]`
**Цель:** визуальная и поведенческая проверка на проде/деве (скилл `qa-tester`, Playwright).
**Что входит:** обход 5 веток (проект→доска→задача; цель; человек→пульс; тема; документ) на десктопе и мобильном вьюпорте; проверка кликов по звеньям и стрелке «назад»; длинный путь со сворачиванием; верхний уровень без крошек.
**Acceptance:** все сценарии R1–R11 воспроизводятся; нет английских слов в крошках; нет прыжка вёрстки (скелетон отрабатывает).

Закрывает: сквозная проверка R1–R11.

## Требования (трассировка)

- **R1** — Когда пользователь на любом маршруте `(authenticated)`, система shall вычислять путь крошек как массив звеньев из накопительных префиксов сегментов URL.
- **R2** — Если сегмент статический и есть в `SEGMENT_LABELS`, then метка из реестра; если динамический и зарегистрирован — из регистрации; иначе fallback-метка типа сущности; система shall **никогда** не показывать сырой id/uuid/slug.
- **R3** — Когда звеньев ≥2, система shall на десктопе (md+) рендерить `<Breadcrumbs>` слева в верхней панели; при <2 — не рендерить.
- **R4** — Когда звеньев ≥2, система shall на мобильном (<md) рендерить кнопку «назад» на `href` предпоследнего звена и заголовок = метка последнего.
- **R5** — Если звеньев <2 (раздел верхнего уровня), then мобильная шапка в текущем виде, без кнопки «назад».
- **R6** — Страницы-детали основных сущностей (Фаза 4) shall регистрировать имя из уже загруженного объекта, без повторного запроса.
- **R7** — Если страница задаёт `parentHref`-override, then соответствующее звено и кнопка «назад» используют его вместо URL-родителя.
- **R8** — Когда звеньев ≥5, система shall сворачивать средние в «…» (раскрываемый список), показывая первое + «…» + последние два.
- **R9** — Если имя динамического конечного звена ещё не зарегистрировано (загрузка), then на его месте скелетон; статические звенья — сразу.
- **R10** — Каждое не-последнее звено кликабельно (свой href); последнее — текст с `aria-current="page"`.
- **R11** — Крошки/стрелка используют существующие токены (`text-fg-*`, `ChevronRight/Left`, `h-header`), без жёстких hex/`slate`; вся текстовка русская.

## Допущения (LOW-impact, видимые для вето на ревью)
- `[ASSUMPTION]` Порог сворачивания пути — **≥5 звеньев** (показываем первое + «…» + 2 последних). Глубже 4 уровней в кабинете почти не бывает.
- `[ASSUMPTION]` На **мобильных вложенных** экранах лого+`OrgSwitcher` **скрываются**, освобождая место под стрелку+заголовок; на верхнем уровне — без изменений. (Альтернатива — оставить лого и ужать — хуже по месту.)
- `[ASSUMPTION]` Десктоп-крошки **не показываются на верхнем уровне** раздела (длина <2) — панель остаётся как сейчас. (Показывать одинокое «Проекты» — визуальный шум.)
- `[ASSUMPTION]` Слот меняем `justify-end` → `justify-between` (крошки слева, колокольчик справа) — единственная правка раскладки панели.

## Риски / Pre-mortem
- **Рассинхрон метки крошки и `<h1>` страницы.** Митигация: для проекта берём тот же `projectShortLabel(project)`; для прочих — тот же объект, что рендерит заголовок.
- **`usePathname()` и закодированные сегменты** (slug с не-ASCII/`%`-кодированием). Митигация: декодировать сегмент для метки-fallback, href строить из исходного (закодированного) сегмента.
- **Память контекста при быстрой навигации** (override от размонтированной страницы протекает). Митигация: cleanup в `useEffect`-return по ключу-pathname; ключ = `usePathname()` на момент регистрации.
- **Скрытие лого на мобильном** может сбить привычный возврат «на главную». Митигация: стрелка «назад» + заголовок дают более точную навигацию; лого доступно из бургер-меню.

## Аспекты для ревью-гейта (`strict-production-review-gate`)
- Нет `history.back()` для мобильной стрелки (Р4).
- Нет сырого id/slug в метках ни на одном маршруте (R2) — проверить fallback-ветку.
- `useRegisterBreadcrumb` снимает регистрацию при unmount (нет утечки между маршрутами).
- Соблюдены парные цветовые токены, нет английского текста, нет жёстких hex/`slate` ([[feedback_paired_color_tokens]], [[feedback_admin_ui_russian_only]]).
- Крошки рендерятся только в `(authenticated)`, не ломают `(admin)`.

## Совместимость с prompt caching
Не релевантно — фича чисто фронтовая, LLM не затрагивает.

## Idempotency / feature-flag / prod-deploy
- **Feature-flag:** не требуется. Ship-On — навигационный chrome, выкатывается **включённым**, низкий риск, откат = revert. Не kill-switch и не решение владельца (ничего необратимого/денежного) → флаг «на всякий случай» не вводим (CLAUDE.md принцип 8).
- **Prod-deploy:** изменения только во `frontend/` (новые компоненты/хук/контекст + однострочники + правка двух shell-файлов). Нет правок schema.prisma / scripts / ENV / очередей / эндпоинтов. Прод-инструкция: обычная сборка и выкат фронтенда, отдельных шагов нет.
- **Idempotency:** н/д (нет seed/patch/backfill/migrate).

## DoD (общий чек качества)
- `bun run typecheck` (вкл. `.spec`) · `bun run lint` · `bun run build` во `frontend/` — зелёные.
- Юнит-тест `useBreadcrumbTrail.spec.ts` зелёный (5 сценариев из §3).
- Приёмка `qa-tester` (Фаза 5) пройдена на десктопе и мобильном вьюпорте.
- second-brain обновлён: `second-brain/01_projects/frontend-contexts-hooks.md` (новый контекст `BreadcrumbProvider`/`useRegisterBreadcrumb` + хук `useBreadcrumbTrail`); при необходимости `02_architecture/module-map.md` (новый UI-узел `breadcrumbs/`).
- Рефлексия в `second-brain/05_история/` после push.
- prod-deploy-log: прод-операций нет (фронт-онли) — зафиксировать явно в чате блоком «Prod-инструкция (B)».

## Итог
_(заполняет tz-orchestrator по завершении: что реализовано целиком, что осталось, ссылки на коммиты)_
