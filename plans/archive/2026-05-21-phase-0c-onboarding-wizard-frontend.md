---
type: tz
status: done
feature: Фаза 0c — Мастер знакомства + личный кабинет (frontend)
date: 2026-05-21
parent_tz: tz/2026-05-21-phase-0-roles-and-onboarding.md
depends_on:
  - tz/2026-05-21-phase-0a-data-model-and-graph-infra.md (API группы А, ResourceType, RBAC, /api/v1/search)
  - tz/2026-05-21-phase-0b-document-ingest.md (Document API + статусы парсинга + text.adapter для /dump)
  - tz/2026-05-21-phase-0d-role-profile-agent.md (POST /role-profiles/:id/rebuild, 409 при job в очереди)
sources:
  - analysis/2026-05-21-user-cabinet-design.md (полная аналитика ЛК — карта навигации, контракты страниц, wizard)
  - analysis/2026-05-21-ontology-process-regulation.md §6 (Role-first onboarding)
covers_matrix_rows: [32, 33, 34, 35, 36, 67, 68, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79 (UI), 80, 81, 82 (UI), 83 (UI)]
---

# ТЗ 0c: Мастер знакомства + личный кабинет Фазы 0 (frontend)

> **Это sub-TZ.** Зонтичный документ — [`plans/tz/2026-05-21-phase-0-roles-and-onboarding.md`](2026-05-21-phase-0-roles-and-onboarding.md). Источник продуктовых решений — [`plans/analysis/2026-05-21-user-cabinet-design.md`](../analysis/2026-05-21-user-cabinet-design.md). **При расхождениях этого ТЗ и аналитики приоритет у аналитики.** Этот файл — план реализации, не источник правды по продуктовым развилкам.
>
> **Контекст для исполнителя:**
> - Стек frontend — Next.js 14 App Router + LiveKit React Components + Radix + Tailwind + SWR. Слоистая модель `ApiDto → DomainModel → UiModel` (см. skill `frontend-rules`).
> - Все строки UI — на русском, без английских слов в пользовательских лейблах (правило `feedback_admin_ui_russian_only.md`). Глоссарий новых терминов — §10 этого ТЗ + дополнения в [`second-brain/13_glossary/ui-glossary.md`](../../second-brain/13_glossary/ui-glossary.md).
> - Изменения в Prisma-схеме и API — **не часть этого ТЗ**. Все нужные endpoint'ы должны быть готовы к моменту старта работ по 0c (см. §7 «Контракты API»).

---

## 1. Цель

После 0c у пилотной компании Z работает **полноценный личный кабинет Фазы 0**:

- Owner проходит wizard «Знакомство с компанией» за ≤15 минут и приземляется на дашборд с виджетом «Структура компании» и виджетами knowledge-core.
- Member заходит и сразу видит свою должность, отдел, документы и встречи на странице `/me`.
- Sidebar читается как «кабинет памяти компании», а не «приложение для встреч с добавкой», с заделом под Фазу γ через visible-but-disabled пункты.
- Команда консультантов с несколькими Org может переключаться между ними через switcher в шапке.
- Пользователь свободно дамитит мысли в `/dump`, они попадают в knowledge-core тем же путём, что встречи и документы.

Граница: только frontend. Backend API группы А — sub-TZ 0a. Document-ingest и `text.adapter` — sub-TZ 0b. `RoleProfileAgent` и 409 на rebuild — sub-TZ 0d.

---

## 2. Scope

### Входит в 0c

**A. Пересборка каркаса ЛК:**
- Группировка [`Sidebar.tsx`](../../frontend/src/ui/components/app-shell/Sidebar.tsx) на 3 смысловые группы: «Компания», «Оперативка», «Настройки» (включая подгруппу «Админка»).
- Новое состояние `disabled-γ` для `SidebarNavLink` (иконка часов, opacity, переход на preview-страницу).
- Свёрнутая подгруппа «Будет в следующей фазе» внутри «Компании» с 4 disabled-пунктами.
- Переименования лейблов: «Мои встречи» → «Встречи», «Дамп мысли» → «Дамп», «AI-чат» → «Помощник компании».
- CTA «Создать встречу» **остаётся** на Фазу 0 (без переключения на «⊕ Дамп»).
- Multi-org switcher в шапке (см. §5.2 — нюанс с MobileHeader).

**Б. 5 новых рабочих страниц:**
- `/structure` — табы Отделы / Должности / Сотрудники с CRUD и действиями (пригласить, переназначить, удалить, загрузить должностную инструкцию на конкретную должность).
- `/documents` + `/documents/:id` — список и детальная страница документа со статусом парсинга и readonly-провенансом группы Б.
- `/roles` + `/roles/:id` — список и детальная страница должности с превью `RoleProfile.summaryCache`.
- `/me` — минимальный личный кабинет: моя должность + отдел + документы + встречи.
- `/dump` — минимальный capture: textarea + сохранить (через `text.adapter` из 0b).

**В. 4 preview-страницы через единый компонент:**
- `/processes`, `/regulations`, `/policies`, `/metrics` — все четыре через `<ComingSoonPage section=...>`.

**Г. Wizard «Знакомство с компанией»:**
- 5 шагов на `/onboarding/company/step-{1..5}` без AppShell.
- Однократен (доступ только при `Department.count = 0` в Org).
- Состояние — по реально созданным сущностям, без отдельной модели `OnboardingState`.

**Д. Расширения существующих страниц:**
- `/dashboard` для admin — виджет «Структура компании» + виджет «Знакомство» (доминирующий до прохождения wizard'а).
- `DashboardRouter` — member fallback на `/me`.
- `CommandPalette` — расширение на `Role`, `Department`, `Person`, `Document`, `RoleProfile` через `/api/v1/search`.

**Е. Документация:**
- Пополнение [`second-brain/13_glossary/ui-glossary.md`](../../second-brain/13_glossary/ui-glossary.md) и `second-brain/13_glossary/copy-strings.ru.md` новыми терминами (см. §10).
- Заметка в [`second-brain/01_projects/onboarding-wizard.md`](../../second-brain/01_projects/) — что это, как устроено, состояния, edge cases (создаётся в момент закрытия sub-TZ 0c).

### Не входит в 0c

- Все Prisma-модели и API-эндпоинты — 0a/0b/0d. К моменту старта 0c должны быть готовы (см. §7).
- Полная `/me` с обещаниями, настроением, Employee Clone — γ/δ/ζ.
- Голос/файлы/AI-feedback в `/dump` — γ.
- Иерархия отделов в UI (дерево) — γ. В 0c — плоский список.
- Иерархия должностей (`has_subordinate`) — γ.
- CRUD-страницы для сущностей группы Б — γ. На странице документа в 0c — только readonly-провенанс.
- Полная `/today`, `/week`, `/month`, `/map`, `/decisions`, `/ideas`, `/risks`, `/knowledge` из delivery/06 — γ.
- Замена CTA «Создать встречу» на «⊕ Дамп» — γ.
- Telegram-бот для дампов — γ/ε.

---

## 3. Структура и зависимости

```
0a (модели + API + RBAC + /api/v1/search) ─┐
0b (document-ingest + text.adapter)        ├─→  0c (этот ТЗ)
0d (RoleProfileAgent + 409 на rebuild)     ─┘
```

**Не начинать 0c пока:**
- Не готово `/api/v1/roles`, `/structure` API (departments, persons), `/documents` (CRUD + список извлечённых сущностей), `/role-profiles`, `/dump → text.adapter`, `/search` (расширенный).
- Не работает Casbin на новых ResourceType (`role`, `department`, `job-description`, `skill`, `document`, `role-profile`).
- Owner может вручную дёрнуть API из Postman, и они отвечают корректно.

**Внутри 0c можно дробить на заходы** (см. §11 «Фазирование»).

---

## 4. Карта изменений (artifact-list)

| Артефакт | Тип | Где | Зависит от |
|---|---|---|---|
| [`Sidebar.tsx`](../../frontend/src/ui/components/app-shell/Sidebar.tsx) | edit | frontend/src/ui/components/app-shell/ | — |
| [`MobileHeader.tsx`](../../frontend/src/ui/components/app-shell/Header.tsx) | edit | frontend/src/ui/components/app-shell/ | OrgSwitcher |
| `OrgSwitcher.tsx` | new | frontend/src/ui/components/app-shell/ | `useAuth().memberships` API |
| `ComingSoonPage.tsx` + конфиг секций | new | frontend/src/ui/components/coming-soon/ | API `/api/v1/structure/coming-soon-counts` или индивидуальные `count` API |
| Wizard страницы `step-{1..5}` + общий layout | new | frontend/app/(authenticated)/onboarding/company/ | API 0a + 0b |
| `/structure/page.tsx` + табы | new | frontend/app/(authenticated)/structure/ | API 0a |
| `/documents/page.tsx`, `/documents/[id]/page.tsx` | new | frontend/app/(authenticated)/documents/ | API 0a + 0b |
| `/roles/page.tsx`, `/roles/[id]/page.tsx` | new | frontend/app/(authenticated)/roles/ | API 0a + 0d |
| `/me/page.tsx` | new | frontend/app/(authenticated)/me/ | API 0a |
| `/dump/page.tsx` | new | frontend/app/(authenticated)/dump/ | API 0b (text.adapter) |
| 4 preview-страницы — обёртки над `<ComingSoonPage>` | new | frontend/app/(authenticated)/{processes,regulations,policies,metrics}/page.tsx | ComingSoonPage |
| Виджет «Структура компании» + «Знакомство» | new + edit | frontend/app/(authenticated)/dashboard/ | API 0a |
| `DashboardRouter.tsx` — fallback на `/me` для member | edit | frontend/app/(authenticated)/dashboard/ | `/me` готов |
| API-слой | new | frontend/src/api/ + frontend/src/domain/ | API 0a/0b/0d |
| `CommandPalette.tsx` | edit | frontend/src/ui/components/command-palette/ | расширение `/api/v1/search` |
| `second-brain/13_glossary/ui-glossary.md`, `second-brain/13_glossary/copy-strings.ru.md` | edit | delivery/ | — |
| `second-brain/01_projects/onboarding-wizard.md` | new | second-brain/01_projects/ | — (создаётся в DoD) |

---

## 5. Изменения в каркасе ЛК

### 5.1. `Sidebar.tsx` — пересборка на группы

Текущий код в [Sidebar.tsx:70-100](../../frontend/src/ui/components/app-shell/Sidebar.tsx#L70-L100) — плоский `NAV_ITEMS: NavItem[]`. Заменяется на массив групп:

```ts
type NavGroup = {
  label: string;          // "Компания" / "Оперативка" / "Настройки"
  items: NavItem[];
  collapsibleSubgroup?: {
    label: string;        // "Будет в следующей фазе"
    items: NavItem[];
    defaultCollapsed: boolean;  // true
  };
};

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  matchPrefix?: string;
  gateFeature?: FeatureKey;      // как сейчас (Lock)
  comingSoon?: boolean;          // НОВОЕ (Clock4)
  comingSoonCount?: number | null;  // НОВОЕ — для admin, если applicable
};
```

**Итоговый порядок (см. также §6 аналитики ЛК):**

| Группа | Пункт | href | matchPrefix | gateFeature | comingSoon |
|---|---|---|---|---|---|
| Компания | Главная | `/dashboard` | `/dashboard` | — | — |
| Компания | Структура | `/structure` | `/structure` | — | — |
| Компания | Документы | `/documents` | `/documents` | — | — |
| Компания | Карты должностей | `/roles` | `/roles` | — | — |
| Компания | Темы | `/themes` | `/themes` | `feature.theme` | — |
| Компания | Цели и стратегия | `/goals` | `/goals` | `feature.goals_strategy` | — |
| Компания → подгруппа «Будет в следующей фазе» | Процессы | `/processes` | `/processes` | — | true |
| то же | Регламенты | `/regulations` | `/regulations` | — | true |
| то же | Политики | `/policies` | `/policies` | — | true |
| то же | Метрики | `/metrics` | `/metrics` | — | true |
| Оперативка | Встречи | `/meetings` | `/meetings` | — | — |
| Оперативка | Дамп | `/dump` | `/dump` | — | — |
| Оперативка | Карточки | `/cards` | `/cards` | — | — |
| Оперативка | Задачи | `/tasks` | `/tasks` | — | — |
| Оперативка | Помощник компании | `/chat` | `/chat` | `feature.chat_org` | — |
| Оперативка | Я | `/me` | `/me` | — | — |
| Настройки | Шаблоны | `/settings/templates` | `/settings/templates` | — | — |
| Настройки | Интеграции | `/settings/integrations` | `/settings/integrations` | — | — |
| Настройки | Настройки | `/settings` | `/settings` | — | — |
| Настройки → подгруппа «Админка» (owner/admin/super_admin) | Админка Org | `/settings/admin` | `/settings/admin` | — | — |
| то же | Z-Admin (super_admin) | `/admin` | `/admin` | — | — |

**Заголовок группы** — рендерится как маленький `text-xs uppercase tracking-wider text-fg-tertiary` с верхним отступом + `<Separator />`. Между группами — Separator.

**Свёрнутая подгруппа «Будет в следующей фазе»** — клик по заголовку раскрывает/сворачивает список. По умолчанию свёрнута. Состояние свёрнутости — `useState` (per-сессия, без persistence, не критично).

### 5.2. `SidebarNavLink` — новое состояние `comingSoon`

Расширяется существующий компонент [`SidebarNavLink`](../../frontend/src/ui/components/app-shell/Sidebar.tsx#L222) в [Sidebar.tsx:222](../../frontend/src/ui/components/app-shell/Sidebar.tsx#L222):

- Новый пропс `comingSoon?: boolean`.
- Если `comingSoon === true` — `href` остаётся реальным (например, `/processes`), но визуально:
  - `opacity-60`,
  - `text-fg-tertiary` вместо `text-fg-secondary`,
  - иконка `Clock4` 16px в правом краю (как сейчас `Lock`),
  - tooltip «Появится в Фазе γ».
- Кликабелен — ведёт на preview-страницу `/processes` через `<Link>`, а не на `/settings/billing` (как делает `locked`).
- **Не путать с `locked`/`gateFeature`** — это два независимых состояния. Если когда-нибудь раздел станет одновременно `comingSoon` и `gated`, гейтинг по тарифу не показывается (раз функционала ещё нет — гейтинг бессмыслен). Порядок проверки: `comingSoon → locked → enabled`.

### 5.3. MobileHeader и desktop-шапка — multi-org switcher

**Нюанс.** Сейчас в [`Header.tsx`](../../frontend/src/ui/components/app-shell/Header.tsx) живёт только `MobileHeader` (`md:hidden`). На desktop отдельной шапки нет — её роль играет верх Sidebar. Multi-org switcher не может «жить в Header» как буквально написано в аналитике §5.

**Решение:**
- На desktop — `<OrgSwitcher />` интегрируется в **верх Sidebar**, между логотипом Z и CTA «Создать встречу». Это даёт ему всегда-видимое место без новой полосы.
- На mobile — `<OrgSwitcher />` в `MobileHeader`, справа от логотипа, перед бургером.
- В Sheet'е с Sidebar на mobile — switcher тоже виден (наследуется из общего Sidebar.tsx).

**Контракт `<OrgSwitcher />`:**

```tsx
type OrgSwitcherProps = {
  variant: 'sidebar' | 'mobile';
};

// Поведение:
// - useAuth().memberships → если 0 (super_admin без org) → текст «Режим Z-Admin».
// - 1 membership → текст с именем Org, truncate 20 симв, tooltip с полным именем. Не dropdown.
// - 2+ memberships → DropdownMenu: chevron + имя текущей Org. В dropdown — список других Org с полными именами.
// - Внутри wizard'а (pathname.startsWith('/onboarding/company')) — компонент не отрисовывается (early return null).
// - super_admin без org-membership — текст «Режим Z-Admin», не dropdown.
```

**Soft-reload при переключении** (см. §13.3 аналитики):
1. POST `/api/v1/auth/switch-org` (или PATCH `/api/v1/me/active-org` — финальный путь утверждается в 0a) — backend меняет активную Org в сессии.
2. `mutate(undefined, { revalidate: true })` через `useSWRConfig()` — инвалидирует все SWR-кеши, ключи которых начинаются с `/api/v1/` (`(key) => typeof key === 'string' && key.startsWith('/api/v1/')`).
3. `router.replace(pathname)` — остаёмся на текущей странице, она перерендерится с данными новой Org.
4. Toast «Переключились в компанию: {name}».

Full reload — fallback на случай ошибки шага 1 (показать toast «Не удалось переключиться, обновите страницу» + кнопка `window.location.reload()`).

### 5.4. `AuthenticatedShell.tsx` — поведение для wizard'а

Текущий код [`AuthenticatedShell.tsx`](../../frontend/app/(authenticated)/AuthenticatedShell.tsx) уже умеет скрывать AppShell для `/onboarding/change-password` (см. зонтичный ТЗ + аналитика §13.4). Логика — расширяется:

```tsx
const HIDE_SHELL_PREFIXES = ['/onboarding/change-password', '/onboarding/company'];
const hideShell = HIDE_SHELL_PREFIXES.some((p) => pathname.startsWith(p));
```

Если возможно — извлечь в массив-константу, чтобы не дублировать строку.

---

## 6. Новые страницы — контракты

Везде:
- API-слой в `frontend/src/api/<feature>.api.ts` через единый `api-client.ts`.
- Domain-mappers в `frontend/src/domain/<feature>.ts` (`ApiDto → DomainModel → UiModel`).
- Data-fetching — SWR.
- Empty / loading / error состояния обязательны.

### 6.1. Wizard `/onboarding/company/*`

**Структура:** [`frontend/app/(authenticated)/onboarding/company/layout.tsx`](../../frontend/app/(authenticated)/onboarding/) + 5 страниц `step-{1..5}/page.tsx`. Layout — общая обвязка: прогресс-бар 1/5..5/5, кнопка «Прервать и вернуться позже» (закрывает wizard, редиректит на `/dashboard` с баннером «Незавершённое знакомство»), сохранение состояния — по факту created entities (см. §13.1 аналитики).

**Гард доступа** — в [`layout.tsx`](../../frontend/app/(authenticated)/onboarding/) (server component или middleware):
- Только `owner` (не admin даже).
- Если `Department.count > 0` для активной Org → `redirect('/dashboard')`.
- Если `Department.count = 0` и owner попал не на ту страницу шага → `redirect` на актуальный шаг (по числу созданных сущностей).

**Шаг 1: Отделы** (`step-1/page.tsx`)

UI:
```
Шаг 1 из 5: Заведите отделы

[ Название отдела            ]  [×]
[ Название отдела            ]  [×]
[+ Добавить ещё]

                          [Назад] [Далее →]
```

Сабмит:
- POST `/api/v1/departments` для каждого нового отдела (batch endpoint желателен, см. §7).
- На успех → `router.push('/onboarding/company/step-2')`.
- На ошибку — inline-валидация (имя не пустое, уникально в рамках Org).

Минимум 1 отдел для перехода. CSV-импорт — открытый вопрос §12.

**Шаг 2: Должности** (`step-2/page.tsx`)

```
Шаг 2 из 5: Заведите должности

[ Название должности ] [ Отдел ▼ ]  [×]
[ Название должности ] [ Отдел ▼ ]  [×]
[+ Добавить ещё]
```

- Dropdown «Отдел» наполняется GET `/api/v1/departments`.
- Минимум 1 должность.
- Сабмит: POST `/api/v1/roles` для каждой.

**Шаг 3: Сотрудники** (`step-3/page.tsx`)

```
Шаг 3 из 5: Заведите сотрудников

[ Имя ] [ Email ] [ Должность ▼ ]  [×]
...
[+ Добавить ещё]

Email обязателен. Приглашение мы отправим позже — на странице «Структура».
```

- Email validation — стандартная (zod на форме + backend).
- Сабмит: POST `/api/v1/persons` для каждого (создаёт `Person` с `userId = NULL`).
- Информационный микро-баннер про то, что приглашение — позже.
- CSV-импорт — открытый вопрос §12.

**Шаг 4: Должностные инструкции** (`step-4/page.tsx`)

```
Шаг 4 из 5: Загрузите должностные инструкции (необязательно)

Менеджер по продажам      [Перетащите файл или нажмите]
Старший разработчик       [✓ uploaded, парсится]
Бухгалтер                 [пропустить]

                      [Назад] [Пропустить шаг] [Далее →]
```

- Список должностей из шага 2.
- Drag-drop зона на каждую — загружает один файл.
- На каждую можно «Пропустить» — это не создаёт `JobDescription`.
- Загрузка идёт асинхронно через POST `/api/v1/documents` с привязкой `roleId`. Wizard НЕ ждёт завершения парсинга — переходит к шагу 5 сразу после успешного `201 Created` (статус `uploaded` или `parsing`).
- Connection между `JobDescription → derived_from → Document` создаёт backend (sub-TZ 0b логика, в 0c фронт только передаёт `roleId`).

**Шаг 5: Готово** (`step-5/page.tsx`)

```
Готово!

Заведено:
• N отделов
• M должностей
• K сотрудников
• L документов на парсинге

[Открыть дашборд →]
```

Числа — из GET `/api/v1/structure/summary` (или из локального state, если хочется не дёргать API).

Кнопка → `router.push('/dashboard')` + сброс состояния wizard'а (по сути ничего — он завершён фактом наличия `Department.count > 0`).

**Прерывание wizard'а:**
- Кнопка «Прервать и вернуться позже» в layout → `router.push('/dashboard')`.
- На `/dashboard` показывается баннер «Незавершённое знакомство» (см. §6.8) с кнопкой «Продолжить» → `router.push('/onboarding/company/step-{N}')`, где N — первый незавершённый шаг (по логике §13.1 аналитики).

### 6.2. `/structure` — 3 таба

`frontend/app/(authenticated)/structure/page.tsx` + клиентский компонент `StructureClient.tsx`.

URL для табов: `/structure?tab=departments|roles|persons`. Default — `departments`.

**Гард:** доступна всем members. Создание / редактирование / удаление — только `owner`/`admin` (RBAC на backend, фронт скрывает кнопки если `currentOrgRole !== 'owner' && currentOrgRole !== 'admin'`).

**Таб «Отделы»:**
- Таблица: Название, Кол-во сотрудников, Действия (Переименовать, Удалить).
- Кнопка «+ Добавить отдел» вверху.
- Empty: «Заведите первый отдел» + кнопка.
- Иерархия в UI — **плоская** (зонтичный ТЗ §2 «Не входит»).

**Таб «Должности»:**
- Фильтр по отделу (select).
- Таблица: Название, Отдел, Кол-во сотрудников, Статус карты (`формируется` / `✓ собрана`), Действия (Переименовать, Назначить отдел, **Загрузить должностную инструкцию**, Удалить).
- «Загрузить должностную инструкцию» — открывает Dialog с drag-drop, после загрузки — toast «Документ загружен, парсится» и ссылка в `/documents/:id`.
- Empty: «Сначала заведите отделы» или «Заведите первую должность».

**Таб «Сотрудники»:**
- Фильтры: отдел, должность, статус приглашения.
- Таблица: Имя, Email, Должность, Отдел, **Статус приглашения** (`не приглашён` / `приглашение отправлено` / `активен`), Действия:
  - **Пригласить** — Dialog с подтверждением, POST `/api/v1/orgs/:orgId/invitations` (или другой существующий endpoint модуля `orgs/invitations`); на успех — статус сменяется на `приглашение отправлено`.
  - **Переназначить должность** — Dialog с select. На submit — PATCH `/api/v1/persons/:id` с `roleId`, backend сам закрывает старую связь `executes_role` `validTo=now` и создаёт новую.
  - **Удалить из компании** — Dialog с confirmation, DELETE `/api/v1/persons/:id` (soft-delete).
- Empty: «Сначала заведите должности» или «Заведите первого сотрудника».

### 6.3. `/documents` + `/documents/:id`

**Список (`/documents/page.tsx`):**
- Таблица: Имя, Тип (PDF/DOCX/MD), Кем загружен, К должности (если есть), **Статус парсинга** (`uploaded → parsing → parsed → blocks-extracted → failed`), Дата.
- Действия в шапке: Загрузить документ (Dialog с drag-drop + опциональный select «привязать к должности»).
- Polling статуса парсинга — раз в 2 секунды для документов в статусе `uploaded`/`parsing`. Останавливать polling после достижения `parsed`/`blocks-extracted`/`failed`.
- Empty: «Загрузите первый документ» + drag-drop зона.

**Детальная (`/documents/[id]/page.tsx`):**
- Шапка: имя файла, тип, статус, размер, кем загружен.
- Левая колонка: парсенный текст (`Document.parsedText`) с пагинацией / скроллом.
- Правая колонка (вкладки):
  - **Блоки идей** — список `IdeaBlock`, извлечённых из документа. Каждый блок — карточка с типом (`signalType`), текстом, ссылками на темы.
  - **Извлечённые сущности (провенанс)** — readonly-список группы Б:
    ```
    Процессы (3)
      • Обработка входящего лида        confidence: 0.87
      • Согласование коммерческого ...  confidence: 0.72
      • ...
    Решения (2)
      • Снизили порог скидки до 5%      confidence: 0.91
      • ...
    Регламенты (1)
      • ...
    ```
    Каждая строка — текстовая, **без ссылки на отдельную страницу сущности**. Идентификатор сущности можно скопировать через context menu (для отладки). Это provenance, а не UI группы Б — он появится в γ (см. §7.4 аналитики).
- На `failed` — баннер с текстом ошибки парсинга + кнопка «Удалить и загрузить заново» (если есть права).

### 6.4. `/roles` + `/roles/:id`

**Список (`/roles/page.tsx`):**
- Карточки (а не таблица — больше места для превью карты):
  ```
  ┌──────────────────────────────────────────┐
  │ Менеджер по продажам                     │
  │ Отдел: «Продажи»  •  3 сотрудника        │
  │ Карта формируется (12 блоков идей,       │
  │ ждём ≥N для генерации)                   │
  └──────────────────────────────────────────┘
  ```
- Группировка по отделам (опционально, открытый вопрос §12).
- Фильтр по отделу.

**Детальная (`/roles/[id]/page.tsx`):**

Структура секций:
1. **Шапка:** название, отдел, число сотрудников.
2. **Назначенные сотрудники** — таблица с действиями «Снять с должности» (закрывает `executes_role`).
3. **Должностная инструкция (`JobDescription`):** превью markdown + ссылка на исходный документ. Если нет — «Должностная инструкция не загружена» + CTA «Загрузить» (открывает тот же Dialog, что в `/structure?tab=roles`).
4. **Карта должности (`RoleProfile.summaryCache`):**
   - Ответственности (`responsibilities[]`).
   - Навыки (`skills[]`).
   - Типичные решения (`decision_patterns[]`).
   - Типичные грабли (`common_pitfalls[]`).
   - Стиль работы (`style_profile`).
   - Каждый блок — collapsed по умолчанию, expand на клик. Длинные списки — с «Показать ещё».
5. **Источники (провенанс):** какие встречи, документы, блоки идей участвовали — компактный список со ссылками.
6. **Кнопка «Пересобрать карту»** (только `owner`/`admin`):
   - POST `/api/v1/role-profiles/:roleId/rebuild`.
   - После клика — кнопка `disabled` на 60 секунд, лейбл «Карта собирается…».
   - Если API вернул `409 Conflict` с body `{ status: 'queued'|'running', since: ISO8601 }` → кнопка `disabled`, лейбл «Карта уже собирается с {since}», сообщение остаётся пока через polling (`GET /api/v1/role-profiles/:roleId/build-status` каждые 10 секунд) не вернётся `idle`.

**Empty карты должности:**
> Карта формируется. Заполнится автоматически после {N} встреч/документов с этой ролью. Сейчас собрано: {M}.

Порог `N` приходит от backend в ответе `/api/v1/role-profiles/:roleId`.

### 6.5. `/me`

`frontend/app/(authenticated)/me/page.tsx`. Доступна всем member'ам с `Person.userId = currentUser.id`. Admin'у тоже доступна — он Person.

```
┌─ Шапка ─────────────────────────────────┐
│ Иван Петров                              │
│ Должность: «Менеджер по продажам»   →    │  ← ссылка на /roles/:id
│ Отдел: «Продажи»                    →    │  ← ссылка на /structure?tab=departments
└──────────────────────────────────────────┘

┌─ Моя карта должности ───────────────────┐
│ (превью RoleProfile.summaryCache или     │
│  статус «формируется»)                   │
│ [Открыть полностью →]                    │
└──────────────────────────────────────────┘

┌─ Мои документы ──────────────────────────┐
│ Список Document, uploaderId = currentUser│
│ [Загрузить документ]                     │
└──────────────────────────────────────────┘

┌─ Мои встречи ────────────────────────────┐
│ Последние 5 встреч, где я участник       │
│ [Все мои встречи →]                      │
└──────────────────────────────────────────┘
```

**Empty-states:**
- `Person.userId` не существует (нет Person) или `Person.roleId IS NULL` → баннер «Вашу должность ещё не назначили. Попросите администратора.» Секции «Мои документы» и «Мои встречи» отрисовываются как обычно (могут быть пустые тоже).
- `RoleProfile.summaryCache` пустой → карточка «Карта должности формируется. Заполнится автоматически после нескольких встреч и документов с этой ролью.»

**API:**
- GET `/api/v1/me/profile` — Person, Role, Department, RoleProfile.
- GET `/api/v1/documents?uploaderId=me`.
- GET `/api/v1/meetings?participantId=me&limit=5`.

### 6.6. `/dump` (минимальный)

`frontend/app/(authenticated)/dump/page.tsx`.

```
┌──────────────────────────────────────────┐
│ Расскажи всё, что хочешь зафиксировать  │
│                                           │
│ ┌────────────────────────────────────┐   │
│ │ ▌                                  │   │
│ │                                    │   │
│ │                                    │   │
│ └────────────────────────────────────┘   │
│                                           │
│ Подсказка: записываем в граф знаний       │
│ компании. AI разберёт автоматически.     │
│                                           │
│                              [Сохранить]  │
└──────────────────────────────────────────┘

После сохранения toast: «Записал»
```

- Textarea — `min-height: 240px`, авто-расширение.
- Кнопка «Сохранить» — disabled пока пусто, после клика disabled на время request'а.
- POST `/api/v1/dumps` (или `/api/v1/ingest/text` — финальный путь утверждается в 0b) с body `{ content: string }`. Backend создаёт `RawEvent` через `text.adapter`, дальше обычный pipeline.
- После успешного сохранения — toast «Записал» + очистка textarea + фокус остаётся на textarea (можно сразу писать следующий дамп).
- Нет голоса, файлов, AI-feedback — это γ (зонтичный ТЗ §2 «Не входит»).

### 6.7. Preview-страницы через `<ComingSoonPage>`

**Компонент `ComingSoonPage.tsx`:**

```tsx
type SectionConfig = {
  title: string;
  description: string;        // markdown-разрешён (например, через react-markdown)
  planLink?: string;          // ссылка на plans/tz/...
  countApi: string;           // путь к API для счётчика
  countLabel: (n: number) => string;  // (3) => '3 процесса', '5 процессов'
};

const SECTIONS: Record<SectionKey, SectionConfig> = {
  processes:    { title: 'Процессы',   description: '...', countApi: '/api/v1/processes/count',    countLabel: (n) => declension(n, ['процесс', 'процесса', 'процессов']) },
  regulations:  { title: 'Регламенты', description: '...', countApi: '/api/v1/regulations/count',  countLabel: (n) => declension(n, ['регламент', 'регламента', 'регламентов']) },
  policies:     { title: 'Политики',   description: '...', countApi: '/api/v1/policies/count',     countLabel: (n) => declension(n, ['политика', 'политики', 'политик']) },
  metrics:      { title: 'Метрики',    description: '...', countApi: '/api/v1/metrics/count',      countLabel: (n) => declension(n, ['метрика', 'метрики', 'метрик']) },
};

export function ComingSoonPage({ section }: { section: SectionKey }) { ... }
```

Каждая страница — обёртка:
```tsx
// frontend/app/(authenticated)/processes/page.tsx
export default function ProcessesPage() {
  return <ComingSoonPage section="processes" />;
}
```

**Поведение:**
- Запрос счётчика только если `currentOrgRole === 'owner' | 'admin' | 'super_admin'`.
- Если `N === 0` — секция со счётчиком вообще не рендерится (см. §7.7 аналитики).
- Текст description — из конфига; пока в Фазе 0 — заглушки (1-2 предложения), детальный текст пишется при формировании контента delivery/06.

### 6.8. Расширения `/dashboard`

Текущий код — [`DashboardRouter.tsx`](../../frontend/app/(authenticated)/dashboard/DashboardRouter.tsx) делит по роли + [`DirectorDashboardClient.tsx`](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx) для admin.

**Правки:**

1. **`DashboardRouter.tsx`** — для `member` (роль ≠ owner/admin/super_admin) добавить fallback на `/me`:
   ```tsx
   if (currentOrgRole === 'member') {
     redirect('/me');
   }
   ```
   (Дальше в `DirectorDashboardClient` оставляем поведение для owner/admin).

2. **`DirectorDashboardClient.tsx`** — добавить два новых виджета:

   **Виджет «Знакомство»** (только если `Department.count === 0` ИЛИ wizard был прерван):
   - Если wizard ещё не начат (`Department.count === 0`) — большой CTA «Пройти знакомство с компанией» → `/onboarding/company/step-1`.
   - Если прерван (есть `Department.count > 0`, но `RoleProfile.count = 0` И прошло <24ч с создания первой Department — эвристика) — баннер «Незавершённое знакомство» + кнопка «Продолжить» → переход на актуальный шаг.
   - Иначе виджет не рендерится.

   **Виджет «Структура компании»:**
   - Карточки-счётчики: N отделов, M должностей, K сотрудников, L документов, P карт должностей (в т.ч. «формируется» отдельно).
   - Каждая карточка кликабельна → переход в соответствующий раздел/таб.
   - API: GET `/api/v1/structure/summary` (новый endpoint в 0a, см. §7).

   **Размещение виджетов:**
   - «Знакомство» — на всю ширину наверху, доминирует.
   - «Структура компании» — в существующей сетке виджетов, рядом со «Согласованность стратегии» и др.

3. **Виджет «Согласованность стратегии» и другие knowledge-core виджеты** — оставить как есть. Если данных мало (компания только что зашла) — они сами показывают empty-state «накапливаем данные».

---

## 7. Контракты API (что должно быть готово от 0a/0b/0d)

Список endpoint'ов, на которые опирается 0c. **Это контракт, а не реализация — реализация в соответствующих sub-TZ.** Финальные пути могут отличаться, но логически нужно ровно это.

### От 0a (модели + CRUD группы А + RBAC + search):

| Endpoint | Назначение |
|---|---|
| `GET /api/v1/departments` | список отделов Org |
| `POST /api/v1/departments` | создать отдел (один или batch — желательно поддержать batch для wizard'а) |
| `PATCH /api/v1/departments/:id` | переименовать |
| `DELETE /api/v1/departments/:id` | удалить (с проверкой что нет сотрудников) |
| `GET /api/v1/roles` (фильтры: departmentId) | список должностей |
| `POST /api/v1/roles` | создать должность |
| `PATCH /api/v1/roles/:id` | переименовать / назначить отдел |
| `DELETE /api/v1/roles/:id` | удалить |
| `GET /api/v1/persons` (фильтры: departmentId, roleId, invitationStatus) | сотрудники |
| `POST /api/v1/persons` | создать Person (с `userId = NULL`) |
| `PATCH /api/v1/persons/:id` | переназначить роль (закрытие связи `executes_role` + новая) |
| `DELETE /api/v1/persons/:id` | soft-delete |
| `POST /api/v1/orgs/:orgId/invitations` (или существующий путь) | пригласить — связывает `Person.userId` после accept'а |
| `GET /api/v1/me/profile` | Person + Role + Department + RoleProfile текущего user'а |
| `GET /api/v1/structure/summary` | `{ departments: N, roles: M, persons: K, documents: L, roleProfiles: { total, building, ready } }` |
| `GET /api/v1/{processes,regulations,policies,metrics}/count` | счётчики для preview-страниц (RBAC: только admin) |
| `GET /api/v1/search?q=...&types=role,department,person,document,role-profile,...` | расширенный search |
| `POST /api/v1/auth/switch-org` | переключение активной Org (multi-org switcher) |

### От 0b (document-ingest + text.adapter):

| Endpoint | Назначение |
|---|---|
| `GET /api/v1/documents` (фильтры: uploaderId, roleId, status) | список |
| `POST /api/v1/documents` (multipart: file + roleId?) | загрузить |
| `GET /api/v1/documents/:id` | детальная инфо: статус, parsedText, извлечённые `IdeaBlock`-и и группа Б (readonly, см. §6.3) |
| `DELETE /api/v1/documents/:id` | удалить (для `failed` или с правами) |
| `POST /api/v1/dumps` (или `/api/v1/ingest/text`) — body `{ content: string }` | сохранить дамп через text.adapter |

### От 0d (RoleProfileAgent):

| Endpoint | Назначение |
|---|---|
| `GET /api/v1/role-profiles/:roleId` | карта должности с порогом `N` в metadata |
| `POST /api/v1/role-profiles/:roleId/rebuild` | пересборка; `409 Conflict` если уже в очереди |
| `GET /api/v1/role-profiles/:roleId/build-status` | `{ status: 'idle'|'queued'|'running', since?: ISO8601 }` |

**Если какой-то endpoint не готов — sub-TZ 0c не может стартовать в полной мере.** Допустимо начинать с UI-каркаса (Sidebar, OrgSwitcher, ComingSoonPage) и mock'ов, но критический функционал (wizard, /structure, /documents, /roles) — нет.

---

## 8. CommandPalette ⌘K

[`CommandPalette.tsx`](../../frontend/src/ui/components/command-palette/CommandPalette.tsx) сейчас ищет по карточкам/встречам/задачам через `/api/v1/search`. Расширяется на новые сущности:

- `Role` — переход на `/roles/:id`.
- `Department` — переход на `/structure?tab=departments` (без anchor — список плоский).
- `Person` — переход на `/structure?tab=persons` + подсветка строки (опционально).
- `Document` — переход на `/documents/:id`.
- `RoleProfile` — переход на `/roles/:id` (RoleProfile живёт на странице должности, отдельной страницы нет).

Изменение фронта — добавление новых типов в фильтр поиска + рендер карточки результата (иконка + лейбл + контекст: отдел / должность / тип документа). Backend `/api/v1/search` должен быть расширен в 0a.

---

## 9. Pixel-detail (визуальный язык)

Деталь визуала — на уровень design-system, не аналитики. Но фиксирую базовые правила, чтобы не было разночтений:

- **Иконка `comingSoon`:** `Clock4` из `lucide-react`, 16px, `text-fg-tertiary/70`. Не `Lock`.
- **opacity comingSoon-пункта:** `opacity-60` (через Tailwind utility), активный hover убирает opacity.
- **Заголовок группы Sidebar:** `text-xs uppercase tracking-wider text-fg-tertiary mt-3 mb-1 px-3`.
- **Свёрнутая подгруппа «Будет в следующей фазе»:** заголовок с chevron справа, кнопка `Button variant=ghost size=sm`; раскрытие — стандартный disclosure (можно `<details>` нативно или Radix Collapsible).
- **OrgSwitcher truncate:** `max-w-[160px]` + `truncate` + tooltip с полным именем при overflow.

Финальная вёрстка — на этапе реализации, ориентир — существующие компоненты `shadcn/*` в [`frontend/src/ui/shadcn/`](../../frontend/src/ui/shadcn/).

---

## 10. Глоссарий — что добавляется в `second-brain/13_glossary/ui-glossary.md`

Полный список новых терминов UI Фазы 0c. Каждый — добавляется в [`second-brain/13_glossary/ui-glossary.md`](../../second-brain/13_glossary/ui-glossary.md) и [`second-brain/13_glossary/copy-strings.ru.md`](../../second-brain/13_glossary/copy-strings.ru.md) (в существующих форматах этих файлов).

| Термин (русский) | Значение | Не путать с |
|---|---|---|
| Знакомство с компанией | Wizard первого входа owner'а (`/onboarding/company`) | Онбординг (это смена пароля) |
| Структура | Раздел ЛК: Отделы + Должности + Сотрудники (`/structure`) | «Структура компании» в маркетинге |
| Отдел | Сущность `Department` | — |
| Должность | Сущность `Role` (бизнес) | `Membership.role` (это права доступа в Z: owner/admin/member) |
| Должностная инструкция | Сущность `JobDescription` — declared-форма должности | Карта должности (это observed) |
| Карта должности | `RoleProfile` — материализованный кеш «что роль делает на самом деле» | Должностная инструкция |
| Сотрудник | `Person`, связан с Role + Department | Пользователь Z (User — это аккаунт; Person может существовать без User) |
| Сотрудник на должности | Person с активной связью `executes_role` | Person без активной должности |
| Документ | `Document` — загруженный файл | Должностная инструкция (это конкретный тип Document'а) |
| Дамп | Свободный capture в `/dump` (текст → граф знаний) | Карточки (структурированные `IdeaBlock`) |
| Помощник компании | UI-лейбл `/chat` (диалог над knowledge-core) | AI-чат (просторечие; в UI Z — только «Помощник компании») |
| Активная компания | Org, в контексте которой пользователь работает | Все Org с membership |
| Карта формируется | Статус `RoleProfile` без `summaryCache` или с устаревшим | «Карта готова» |
| Появится в Фазе γ | Лейбл для disabled-γ пунктов | «Не работает» / «Скоро» |

---

## 11. Фазирование внутри 0c (порядок реализации)

0c — это ≈5-7 дней frontend (см. §11 аналитики, итог). Дробится на 4 захода, которые можно делать последовательно или местами параллельно (разные люди).

### 0c.1 — Каркас и переключатель (1-2 дня)
- Пересборка `Sidebar.tsx` на группы + новое состояние `comingSoon` для `SidebarNavLink`.
- `OrgSwitcher` (sidebar + mobile варианты).
- Обновление `AuthenticatedShell` для `/onboarding/company/*`.
- Глоссарий — добавление новых терминов.

**Артефакт после 0c.1:** Sidebar читается как «кабинет памяти», switcher работает, четыре disabled-γ-пункта видны и ведут на 404 (ещё нет страниц).

### 0c.2 — `ComingSoonPage` + статические страницы (0.5 дня)
- Компонент `<ComingSoonPage>` + конфиг секций.
- 4 страницы-обёртки.

**Артефакт:** preview-страницы рабочие, счётчики опционально (если API готов).

### 0c.3 — Wizard и `/structure` (2-3 дня)
- Wizard 5 шагов + layout + гард доступа.
- `/structure` с 3 табами + действиями (пригласить, переназначить, удалить, загрузить должностную).
- Расширение `/dashboard` (виджеты «Знакомство» + «Структура компании»).

**Артефакт:** owner проходит wizard от начала до конца, после — видит дашборд с реальными числами и может редактировать структуру.

### 0c.4 — `/documents`, `/roles`, `/me`, `/dump` (2-3 дня)
- `/documents` + детальная страница (с polling парсинга + readonly-провенансом группы Б).
- `/roles` + детальная страница (с пересборкой карты, debounce + 409).
- `/me` — минимальная страница.
- `/dump` — минимальная страница.
- `DashboardRouter` — fallback на `/me` для member.
- Расширение `CommandPalette` на новые сущности.

**Артефакт:** весь функциональный набор Фазы 0c работает; member заходит на `/me`, видит карту своей должности (или статус «формируется»), может загрузить документ или дамп.

---

## 12. Открытые вопросы

| № | Вопрос | Гипотеза | Когда решить |
|---|---|---|---|
| 12.1 | CSV-импорт в wizard шагов 1/2/3 — реализуем сейчас или только Excel-batch insert через копи-пейст? | Только текстовый ввод в MVP; CSV — добавляем после первого пилота если bottleneck >10 минут | Перед стартом 0c.3 (wizard) |
| 12.2 | Конкретное число шагов в wizard'е для счётчика прогресса (если шаг 4 необязательный, считаем «4 из 5» или «4 из 4 + пропуск»?) | Всегда «N из 5», шаг 4 — обычный шаг, но с кнопкой «Пропустить» | На старте 0c.3 |
| 12.3 | Группировка карточек должностей в `/roles` по отделам — сразу или после фидбека? | По умолчанию плоский список; группировка по `?groupBy=department` — позже | 0c.4 |
| 12.4 | `OrgSwitcher` на mobile — отдельный пункт в MobileHeader или часть бургер-меню? | Отдельный пункт в MobileHeader (справа от логотипа); в бургер-меню (Sheet) — переключатель тоже виден через Sidebar | 0c.1 |
| 12.5 | Polling парсинга документа — 2 секунды на детальной странице. На странице списка тоже polling? | На списке polling работает только пока пользователь на странице, останавливается на blur (`Page Visibility API`). Конкретный интервал и стратегия — на старте 0c.4 | 0c.4 |
| 12.6 | Что показывать в виджете «Структура компании» на дашборде, если в Org только что зашёл первый сотрудник, и `Person.count = 1, Role.count = 0`? | Виджет показывается всегда, числа реальные. Если они выглядят странно — это сигнал «доделай wizard» | 0c.3 |
| 12.7 | Логика прерванного wizard'а — какой шаг считать «незавершённым»? Что если owner создал отделы и должности, но не сотрудников — это шаг 2 или 3? | Первый шаг с `count = 0` нужной сущности. Если шаг 4 (должностные) — обязательно `count > 0`, иначе считается пропущенным | 0c.3 |
| 12.8 | Действия «Удалить из компании» — что делать с `IdeaBlock`-ами / `Decision`-ами, где Person указан как `decidedByPersonId`? Сохраняем ссылки или обнуляем? | Сохраняем (Person soft-deleted, ссылка остаётся валидной); UI показывает имя удалённого Person курсивом с пометкой «удалён» | Backend в 0a, UI учитывает в 0c.3 |

---

## 13. DoD (критерии готовности 0c)

### Технические

- [ ] `bun run typecheck` чистый по `frontend/`.
- [ ] `bun run lint` чистый по `frontend/`.
- [ ] `bun run test:unit` зелёный по затронутым модулям. Минимум — unit-тесты на `<ComingSoonPage>` (рендеринг counter / no-counter в зависимости от роли и N), `<OrgSwitcher />` (one/many/super_admin states), guards wizard'а (redirect на `/dashboard` если уже пройден).
- [ ] `bun run build` собирает фронт без ошибок.
- [ ] Прогон skill `frontend-rules` на новых страницах (проверка слоистости `ApiDto → DomainModel → UiModel`).

### Функциональные

- [ ] Owner с нулевой структурой проходит wizard от начала до конца за ≤15 минут на 1 реальной компании (зонтичный ТЗ DoD «Бизнес-критерии»).
- [ ] После wizard'а owner попадает на дашборд с реальными числами в виджете «Структура компании».
- [ ] Owner может прервать wizard, через час вернуться через баннер «Незавершённое знакомство» и продолжить с актуального шага.
- [ ] Owner может в `/structure?tab=persons` пригласить сотрудника — тот получает email, регистрируется/логинится, после accept'а `Membership` создаётся, `Person.userId` обновляется, в `/structure` статус меняется на `активен`.
- [ ] Owner может загрузить должностную инструкцию для конкретной должности из `/structure?tab=roles` (после wizard'а).
- [ ] Member заходит на `/dashboard` → редиректится на `/me`, видит свою должность / отдел / документы / встречи (или соответствующий empty-state).
- [ ] Admin на `/roles/:id` нажимает «Пересобрать карту» → кнопка disabled 60 сек; повторный клик в течение 60 сек ничего не делает; следующий клик показывает «Карта уже собирается» при 409.
- [ ] Пользователь с 2+ Org переключается через `OrgSwitcher` без full reload — SWR-кеши инвалидируются, текущая страница перерисовывается с данными новой Org.
- [ ] Disabled-γ-пункты в Sidebar ведут на preview-страницы; для admin виден счётчик «N собрано» если N > 0, иначе скрыт.
- [ ] CommandPalette ⌘K находит Role / Department / Person / Document; клик ведёт на соответствующую страницу.

### Документация

- [ ] Обновлены `second-brain/13_glossary/ui-glossary.md` и `second-brain/13_glossary/copy-strings.ru.md` всеми терминами из §10.
- [ ] Создана заметка `second-brain/01_projects/onboarding-wizard.md` с описанием wizard'а, состояний, edge cases.
- [ ] Обновлена `second-brain/01_projects/frontend-pages.md` (или эквивалент) — список новых страниц.
- [ ] Обновлена `second-brain/01_projects/frontend-contexts-hooks.md` — добавление `OrgSwitcher` / нового состояния `comingSoon` в Sidebar.
- [ ] Запись рефлексии в `second-brain/05_история/2026-MM-DD-0c-онбординг-и-лк-итог.md`.

### Матрица прослеживаемости зонтичного ТЗ

- [ ] Строки 32, 33 (если CSV — иначе помечается как «решено: nice-to-have отложено»), 34, 35, 36, 67, 68, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79 (UI-часть), 80, 81, 82 (UI-часть), 83 (UI-часть) — все `[x]` в зонтичном.

---

## 14. Риски и митигации

| Риск | Тяжесть | Митигация |
|---|---|---|
| Wizard ломается посреди шага 3 — owner создал 7 сотрудников, на 8-м падает; куда возвращаться? | средняя | Каждое POST `/api/v1/persons` атомарно; если падает — 7 уже созданы, owner возвращается к шагу 3, видит 7 в форме (через `GET /api/v1/persons`), продолжает с 8-го |
| Polling парсинга на `/documents` создаёт нагрузку при 50+ документах в статусе `parsing` | низкая | Polling на детальной странице — точечный по `:id`. На списке — `WHERE status IN ('uploaded','parsing')`, если таких >20 — polling по агрегированному endpoint `/api/v1/documents/processing` (только статусы, не весь объект). Триггер на оптимизацию — если на 1-м пилоте видим >10 документов в `parsing` одновременно |
| OrgSwitcher soft-reload не инвалидирует кеши не-SWR (Zustand-сторы, локальный state контекстов) | средняя | Аудит на 0c.1 — какие сторы зависят от `tenantId`; для каждого добавить reset action; вызывать в момент switcher'а вместе с `mutate` |
| Wizard глобально доступен только owner — admin зашёл первым в новую Org, не может пройти wizard | низкая | По дефолту первый user при создании Org — owner (см. `orgs` модуль). Admin без owner-а — это аномалия, в Фазе 0 не оптимизируем. В UI: если `Department.count = 0` и `currentOrgRole !== 'owner'` → `/dashboard` показывает «Ждём, пока владелец компании пройдёт знакомство». |
| `<ComingSoonPage>` счётчик на 4 страницах = 4 параллельных запроса при заходе на `/processes` | низкая | Каждая страница запрашивает только свой счётчик. Если хочется — на 0c.2 сделать один endpoint `/api/v1/coming-soon/counts` возвращающий всё за раз; решение — на старте 0c.2 |
| Состояние свёрнутости подгруппы «Будет в следующей фазе» сбрасывается на каждой странице | низкая | `useState` → `useLocalStorage('sidebar.coming-soon.collapsed', true)`. Мелочь, но улучшает UX |
| Существующий Sidebar используют активные пилоты — пересборка ломает их привычки | средняя | URL не меняются (см. зонтичный §11). Лейблы меняются только 3 («Встречи», «Дамп», «Помощник компании»). Группировка — новая, но это улучшение, а не регрессия |
| `Header.tsx` на самом деле только `MobileHeader` — буквально следовать аналитике §5 нельзя | низкая | Решение зафиксировано в §5.3 этого ТЗ: switcher идёт в верх Sidebar (desktop) + MobileHeader (mobile) |

---

## 15. Итог

_Заполняется по факту, когда 0c.1–0c.4 закрыты._

- **Реализовано полностью / частично:** _TBD_
- **Что осталось:** _TBD_
- **Ссылка на рефлексию:** _TBD_

## Ревизия от 2026-05-24

**Статус:** done

**Реализовано:**
- Wizard 5 шагов: `frontend/app/(authenticated)/onboarding/company/{step-1..step-5}/` + `WizardShell.tsx`, `WizardStepNav.tsx`, `layout.tsx` (без AppShell).
- Каркас ЛК: `frontend/src/ui/components/app-shell/Sidebar.tsx` (группы + comingSoon), `OrgSwitcher.tsx`, `Header.tsx`, `useMemberships.ts`.
- 5 рабочих страниц: `/structure` (DepartmentsTab/RolesTab/PersonsTab + StructureClient), `/documents` + `[id]/`, `/roles` + `[id]/`, `/me` (MeClient + sub-routes channels/check-ins/clone/dashboard/inbox/knowledge-profile/notifications), `/dump` (DumpClient).
- 4 preview-страницы: `frontend/app/(authenticated)/{processes,regulations,policies,metrics}/page.tsx` — реальные (ProcessTemplatesClient, RegulationsListClient уже работают, не stub).
- `<ComingSoonPage>` компонент: `frontend/src/ui/components/coming-soon/ComingSoonPage.tsx`.

**Осталось:** —

Примечание: 4 «coming-soon» секции фактически уже превратились в реальный UI (γ-фаза в коде запущена), что превышает scope 0c — но MVP-задача (доступность preview по ссылке) выполнена.
