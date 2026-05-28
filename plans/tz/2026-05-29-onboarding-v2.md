---
type: tz
status: done
feature: Онбординг v2 — Знакомство + Action-тур + Обзор сайдбара + Hover-подсказки
date: 2026-05-29
---

# ТЗ: Онбординг v2

> Анализ: `plans/analysis/2026-05-28-onboarding-v2-redesign.md`

## Цель

За 10–15 минут после регистрации новый owner должен иметь заполненный профиль компании, запущенный первый спринт с целью и понимать, что где лежит в кабинете — без звонка поддержки.

---

## Scope

**Входит:**
- Блок A — 6 экранов знакомства до кабинета (`/onboarding/welcome/step-{1..6}`)
- Блок B — Action-тур по настройке: 6 шагов в живом кабинете (переписать `welcome.ts`)
- Блок C — Тур №3: обзор сайдбара, 17 шагов (новый `overview.ts`)
- Блок D — Hover-tooltip на каждом пункте сайдбара (расширить `Sidebar.tsx`)
- Словарь `NAV_HELP` — единый источник текстов для Туров B/C и tooltip
- Шаблоны по индустрии для шагов B2 (отделы) и B3 (должности)
- Redirect-логика в `AuthenticatedShell` — перехват до кабинета
- `IncompleteSetupBanner` — плашка «Настройка компании: N из 6» на дашборде
- Backend: новые поля Prisma + 4 эндпоинта
- Backfill: существующие Org с отделами → `setupCompletedAt = createdAt`
- Расширение типа `TourId` (`'overview'`) + регистр туров

**Не входит:**
- Маскот-персонаж
- Демо-Org (откладываем — см. открытый вопрос)
- Sales-фильтр «хотите демо с менеджером» в онбординге
- Бонус «+30 дней Pro» (добавим когда появится механика бонусов)
- Тур для не-owner'ов (invited member) — отдельная задача

---

## Технические изменения

### База данных

#### Новые поля `User`

```prisma
// ── Онбординг v2 (2026-05-29) ──
/// Роль пользователя в компании, указанная при онбординге (Экран 1 Блока A).
companyRole            UserCompanyRole?
/// Когда user прошёл 6 экранов Блока A (profileCompleted → разблокирует кабинет).
profileCompletedAt     DateTime?
```

Добавить enum:
```prisma
enum UserCompanyRole {
  founder
  general_director
  operations_director
  department_head
  team_lead
  specialist
}
```

#### Новые поля `Org`

```prisma
// ── Онбординг v2 (2026-05-29) — Блок A (квалификатор) ──
/// «Сколько вас в команде?» (Экран 2). Значения: "1-5"|"6-20"|"21-50"|"51-200"|"201-500"|"500+".
teamSize               String?   @db.VarChar(20)
/// Отрасль (Экран 3). Enum-строка: software|services|manufacturing|retail|construction|finance|education|other.
/// NB: поле `industry` уже есть в схеме (@db.VarChar(120)), использовать его.
/// «Что болит?» (Экран 4). Массив констант из painPoints-словаря.
painPoints             String[]
/// «Чем сейчас пользуетесь?» (Экран 5). Массив constId из currentStack-словаря.
currentStack           String[]
/// «Чем планируете пользоваться у нас?» (Экран 6). Массив constId из plannedFeatures-словаря.
plannedFeatures        String[]
/// Когда owner завершил Блок A (ставится при POST /welcome/complete).
welcomeCompletedAt     DateTime?

// ── Онбординг v2 (2026-05-29) — Блок B (прогресс setup-тура) ──
/// Шаг B1: «Компания» — подтверждены базовые данные.
companyInfoCompletedAt  DateTime?
/// Шаг B2: создан хотя бы один отдел.
departmentsCompletedAt  DateTime?
/// Шаг B3: создана хотя бы одна должность.
rolesCompletedAt        DateTime?
/// Шаг B4: приглашён хотя бы один сотрудник.
teamInvitedAt           DateTime?
/// Шаг B5: создан первый спринт.
firstSprintCreatedAt    DateTime?
/// Шаг B6: создана первая встреча.
firstMeetingCreatedAt   DateTime?
/// Все 6 шагов Тура №2 пройдены или явно пропущены.
setupCompletedAt        DateTime?
```

> `industry` уже существует в схеме (`String? @db.VarChar(120)`) — новые поля не дублируют его.
> Остальные поля — **новые**, добавить через `bun run prisma:push`.

### Backend

#### 4.1 Эндпоинт: `PATCH /api/v1/users/me` — сохранение `companyRole`

**Расположение:** существующий контроллер `UsersController` (или отдельный `UsersProfileController`).

**Тело запроса (добавить поле в существующий DTO):**
```ts
companyRole?: 'founder' | 'general_director' | 'operations_director'
             | 'department_head' | 'team_lead' | 'specialist';
```

**Логика:**
- Обновляем `User.companyRole` (можно без `profileCompletedAt` — он ставится отдельно).
- Guard: `CookieAuthGuard`.

---

#### 4.2 Эндпоинт: `PATCH /api/v1/orgs/:orgId/welcome`

Сохранение частичных ответов Блока A (вызывается пошагово с каждого экрана или суммарно перед финальным POST).

**Guard:** `CookieAuthGuard` + `TenantGuard` + `@Roles('owner', 'admin')`.

**Тело:**
```ts
{
  teamSize?:       string;        // "1-5" | "6-20" | "21-50" | "51-200" | "201-500" | "500+"
  industry?:       string;        // software|services|manufacturing|retail|construction|finance|education|other
  painPoints?:     string[];      // массив constId
  currentStack?:   string[];
  plannedFeatures?: string[];
}
```

**Логика:** простой merge (Prisma `update({ where: { id: orgId }, data: body })`).

---

#### 4.3 Эндпоинт: `POST /api/v1/orgs/:orgId/welcome/complete`

Вызывается при клике «Завершить» на Экране 6 Блока A.

**Guard:** аналогично `PATCH /welcome`.

**Тело:** пустое (`{}`), всё уже сохранено через `PATCH /welcome`.

**Логика:**
1. Читаем `Org` — берём `name`, `industry`, `teamSize`, `painPoints`, `currentStack`, `plannedFeatures`.
2. Создаём документ «Знакомство с компанией» через существующий `DocumentsService`:
   ```
   POST /api/v1/documents (internal)
   title: "Знакомство с компанией"
   content: <markdown-блок согласно формату в анализе>
   ```
3. `Org.welcomeCompletedAt = now()`.
4. `User.profileCompletedAt = now()`.
5. Возвращаем `{ ok: true, redirectTo: '/dashboard' }`.

**Формат документа** (markdown):
```
Компания: {Org.name}
Сфера: {industry_label}
Размер: {teamSize} человек

Заполнил: {User.name} ({companyRole_label}), {date}

Главные боли:
- {pain_label_1}
...

Сейчас работают на:
- {stack_label_1}
...

Главный интерес в Коре:
- {feature_label_1}
...
```

Функция `humanize(constId)` — отдельный файл `backend/src/modules/onboarding/onboarding-labels.ts` с таблицей constId → человекочитаемый текст.

---

#### 4.4 Эндпоинт: `POST /api/v1/orgs/:orgId/setup/complete`

Вызывается фронтом когда все 6 шагов Тура №2 пройдены или явно пропущены.

**Логика:**
```ts
await prisma.org.update({ where: { id: orgId }, data: { setupCompletedAt: new Date() } });
```

**Возвращает:** `{ ok: true }`.

---

#### 4.5 Хуки на существующие эндпоинты (автообновление прогресса)

Чтобы не дублировать логику, обновление полей прогресса делается в **существующих** сервисах через side-effect:

| Событие | Поле | Где добавить side-effect |
|---|---|---|
| Создан `Department` (первый в Org) | `Org.departmentsCompletedAt` | `DepartmentsService.create()` |
| Создан `Role` (первый в Org) | `Org.rolesCompletedAt` | `RolesService.create()` |
| Создан `Person` с типом приглашения | `Org.teamInvitedAt` | `PersonsService.invite()` / `OrgInvitationsService` |
| Создан первый `Sprint`/`Cycle` | `Org.firstSprintCreatedAt` | `SprintsService.create()` |
| Создана первая `Meeting` | `Org.firstMeetingCreatedAt` | `MeetingsService.create()` |
| `PATCH /welcome` включает `industry`/`name` | `Org.companyInfoCompletedAt` | Сервис `OrgWelcomeService` |

Side-effect — только если поле ещё `null` (`{ where: { id, field: null } }`).

---

#### 4.6 Backfill-скрипт

`backend/scripts/backfill-onboarding-setup-completed.ts`

Логика:
```ts
// Для каждой Org где setupCompletedAt IS NULL и Department.count > 0:
// установить setupCompletedAt = Org.createdAt (туры им не показываем)
```

Добавить в `STEPS` в `apply-prod-deploy.ts` с `phase: 'update'`, `skipBootstrap: false` (нужен при первом деплое).

---

### Frontend

#### 5.1 Словарь `frontend/src/lib/nav-help.ts`

Единый источник правды для Туров B/C и hover-tooltip. Содержимое — точно по словарю `NAV_HELP` из анализа (примерно 40 записей).

```ts
export type NavHelp = { title: string; body: string };
export const NAV_HELP: Record<string, NavHelp> = { ... };
```

Изолированный файл, зависимостей нет. Реализовать в **Фазе 2** (параллельно с Фазой 1).

---

#### 5.2 Расширение типов тура

**`frontend/src/ui/tour/types.ts`** — добавить `'overview'` в `TourId`:
```ts
export type TourId = 'welcome' | 'project' | 'meeting' | 'overview';
```

> `'welcome'` остаётся — он теперь будет action-туром (Блок B). Старые записи в `tourProgress` у существующих пользователей совместимы (они уже помечены `completedAt`, тур не перезапустится).

**`frontend/src/ui/tour/tours/index.ts`** — добавить `overviewTour` в реестр `TOUR_REGISTRY`.

---

#### 5.3 Блок D — Hover-tooltip в `Sidebar.tsx`

Расширить каждый пункт сайдбара: добавить `TooltipContent` с текстом из `NAV_HELP[item.href]?.body`.

```tsx
import { NAV_HELP } from '@/lib/nav-help';

// В render каждого SidebarItem:
<Tooltip>
  <TooltipTrigger asChild>
    <SidebarNavItem ... />
  </TooltipTrigger>
  {NAV_HELP[item.href] && (
    <TooltipContent side="right" sideOffset={8} className="max-w-[220px]">
      <p className="font-medium text-sm">{NAV_HELP[item.href].title}</p>
      <p className="text-xs text-muted-foreground mt-0.5">
        {NAV_HELP[item.href].body}
      </p>
    </TooltipContent>
  )}
</Tooltip>
```

- Показывать всегда (не только после Тура №3) — ценность для всех пользователей.
- Задержка появления: `delayDuration={700}` на `<TooltipProvider>`.
- На мобильной версии (бургер-меню раскрыт, `isMobile=true`) — `<Tooltip>` не рендерить, там текст итак виден.

Реализовать в **Фазе 2** (быстрая победа, не блокирует другие фазы).

---

#### 5.4 Шаблоны по индустрии

**`frontend/src/lib/department-templates.ts`**

```ts
export const DEPARTMENT_TEMPLATES: Record<string, string[]> = {
  software:      ['Разработка', 'Продажи', 'Маркетинг', 'Поддержка'],
  services:      ['Производство', 'Аккаунтинг', 'Продажи', 'Бухгалтерия'],
  manufacturing: ['Производство', 'Снабжение', 'Продажи', 'Логистика', 'Бухгалтерия'],
  retail:        ['Закупки', 'Продажи', 'Маркетинг', 'Логистика', 'Поддержка'],
  construction:  ['Производство', 'Снабжение', 'Сметный отдел', 'Продажи', 'Бухгалтерия'],
  finance:       ['Продажи', 'Андеррайтинг', 'Сопровождение клиентов', 'Бухгалтерия'],
  education:     ['Преподавание', 'Методический отдел', 'Продажи', 'Поддержка студентов'],
  other:         ['Руководство', 'Продажи', 'Производство', 'Бухгалтерия'],
};
```

**`frontend/src/lib/role-templates.ts`**

```ts
// Ключ — name отдела (нормализованный toLowerCase), значение — список должностей
export const ROLE_TEMPLATES: Record<string, string[]> = {
  'разработка':           ['Тимлид', 'Разработчик', 'Тестировщик'],
  'продажи':              ['Руководитель отдела продаж', 'Менеджер по продажам'],
  'маркетинг':            ['Маркетолог', 'Специалист по контенту'],
  'поддержка':            ['Старший специалист поддержки', 'Специалист поддержки'],
  'бухгалтерия':          ['Главный бухгалтер', 'Бухгалтер'],
  'производство':         ['Руководитель производства', 'Специалист'],
  'снабжение':            ['Руководитель отдела снабжения', 'Менеджер по снабжению'],
  'логистика':            ['Руководитель логистики', 'Логист'],
  'аккаунтинг':           ['Аккаунт-менеджер', 'Менеджер проектов'],
  'закупки':              ['Руководитель закупок', 'Менеджер по закупкам'],
  'преподавание':         ['Старший преподаватель', 'Преподаватель'],
  'методический отдел':  ['Методист', 'Старший методист'],
  // fallback для любого неизвестного отдела:
  '_default':             ['Руководитель отдела', 'Специалист'],
};
```

**Использование на странице `/departments`:**
- Когда открывается шаг B2 тура, страница читает `org.industry` из API.
- Отображается блок «Шаблоны для вашей отрасли» с кнопкой «Добавить все» → `POST /api/v1/departments/batch`.

**Использование на странице `/roles`:**
- Когда открывается шаг B3 тура, страница читает `org.departments` из API.
- Для каждого отдела — раскрывающийся блок «Предлагаемые должности» с кнопкой «Добавить» на каждую.

Реализовать в **Фазе 3**.

---

#### 5.5 Блок A — 6 экранов знакомства

**Маршруты:** `app/(onboarding)/welcome/step-1/page.tsx` ... `step-6/page.tsx`

**Layout:** `app/(onboarding)/layout.tsx` — AppShell скрыт, только логотип + индикатор прогресса «Шаг N из 6».

**Redirect-guard:** в `app/(authenticated)/layout.tsx` или в `AuthenticatedShell.tsx`:
```ts
if (!user.profileCompletedAt) {
  redirect('/onboarding/welcome/step-1');
}
```

**Общий принцип каждого экрана:**
- Один вопрос — одна страница.
- Экраны 1–3 (single-select): клик по варианту = немедленно вызывает PATCH + `router.push(nextStep)`. Кнопки «Далее» нет.
- Экраны 4–6 (multi-select): чекбокс-сетка + кнопка «Далее →» внизу. «Далее» активна при ≥1 выборе (экран 6 — всегда активна).
- Кнопка «← Назад» на экранах 2–6.
- Skip недоступен.

**Экран 1 — «Кто вы в компании?»**
```
Вопрос: «Кто вы в компании?»
Варианты (6 плиток):
  founder            → «Собственник или основатель»
  general_director   → «Генеральный директор»
  operations_director→ «Операционный директор»
  department_head    → «Руководитель отдела»
  team_lead          → «Руководитель проекта или команды»
  specialist         → «Сотрудник или специалист»

При клике: PATCH /api/v1/users/me { companyRole: value } → step-2
```

**Экран 2 — «Сколько вас в команде?»**
```
Вопрос: «Сколько вас в команде?»
Варианты (6 плиток):
  "1-5" / "6-20" / "21-50" / "51-200" / "201-500" / "Больше 500" (→ "500+")

При клике: PATCH /api/v1/orgs/:id/welcome { teamSize: value } → step-3
```

**Экран 3 — «В какой сфере работает компания?»**
```
Вопрос: «В какой сфере работает компания?»
Варианты (8 плиток):
  software       → «Разработка программного обеспечения»
  services       → «Услуги, агентство, консалтинг»
  manufacturing  → «Производство»
  retail         → «Торговля и интернет-магазины»
  construction   → «Строительство и недвижимость»
  finance        → «Финансы и страхование»
  education      → «Образование»
  other          → «Другое»

При клике: PATCH /api/v1/orgs/:id/welcome { industry: value } → step-4
```

**Экран 4 — «Что сейчас болит?»** (multi-select, сетка 2×6)
```
Вопрос: «Что у вас сейчас болит?»
12 болей (чекбокс-плитки):
  goals_dissolve        «Цели на квартал растворяются, к середине никто не помнит куда шли»
  problems_hidden       «Сотрудники замалчивают проблемы, узнаю когда уже сгорело»
  green_status_no_progress «В трекере зелёные галочки, а реального движения нет»
  broken_client_promises «Клиенту пообещали на встрече — забыли сделать»
  key_person_risk       «Уйдёт ключевой человек — встанет половина компании»
  no_knowledge_base     «Каждого нового сотрудника учу заново, базы знаний нет»
  drowning_in_operations «Тону в операционке, на стратегию нет ни одного часа в неделю»
  chat_chaos            «Всё важное в чатах — нужное решение не найти через неделю»
  meetings_no_outcome   «Планёрки идут по два часа, на выходе непонятно что решили»
  unclear_workload      «Не вижу кто чем загружен — кто-то завален, кто-то простаивает»
  bottleneck_on_owner   «Без меня ничего не двигается, я как бутылочное горлышко»
  repeated_questions    «Одни и те же вопросы по десять раз — никто ничего не запоминает»

Кнопка «Далее →» активна при ≥1 выборе.
При клике «Далее»: PATCH /api/v1/orgs/:id/welcome { painPoints: [...] } → step-5
```

**Экран 5 — «Чем сейчас пользуетесь?»** (multi-select, сетка 2×5)
```
Вопрос: «Чем сейчас пользуетесь?»
9 вариантов:
  video_meetings     «Видеовстречи (Зум, Google Meet, Телемост, Контур.Толк)»
  task_tracker       «Трекер задач (Kaiten, Jira, Trello, Битрикс24)»
  knowledge_base     «База знаний (Notion, Confluence, Teamly)»
  messengers         «Командные мессенджеры (Телеграм, Слак)»
  spreadsheets       «Таблицы (Эксель, Google Таблицы)»
  crm                «Учёт клиентов и продаж (amoCRM, Битрикс24, RetailCRM)»
  accounting         «Бухгалтерия и склад (1С, МойСклад)»
  corporate_email    «Корпоративная почта»
  nothing_systematic «Ничего системного, всё в голове и на словах»

Кнопка «Далее →» — всегда активна.
При клике: PATCH /api/v1/orgs/:id/welcome { currentStack: [...] } → step-6
```

**Экран 6 — «Чем планируете пользоваться у нас?»** (multi-select, одна колонка)
```
Вопрос: «Чем планируете пользоваться у нас?»
8 модулей (плитка = название + подзаголовок):
  meetings         «Видеовстречи с записью, транскрибацией и ИИ-отчётом»
                   sub: «Провели созвон — через 2 минуты готовая расшифровка и разбор от ИИ»
  tracker          «Трекер задач и проектов»
                   sub: «Привычные доски, статусы и исполнители — как в Kaiten или Trello»
  sprints          «Спринты с контролем цели»
                   sub: «Недельный ритм. Кора следит, что команда реально идёт к цели»
  memory           «Память компании»
                   sub: «Все встречи, решения и переписки в одном месте навсегда»
  assistant        «ИИ-помощник компании»
                   sub: «Спросите "что решили по клиенту в марте" — ИИ ответит со ссылкой»
  digital_twins    «Цифровые двойники сотрудников»
                   sub: «Можно спросить эксперта, даже когда он в отпуске или уже уволился»
  operations_director «ИИ-операционный директор»
                   sub: «Картина целиком: кто чем занят, что обещано, где застряло»
  telegram         «Доступ через Телеграм»
                   sub: «Любой вопрос компании прямо из мессенджера»

Кнопка «Завершить →» — всегда активна.
При клике:
  1. PATCH /api/v1/orgs/:id/welcome { plannedFeatures: [...] }
  2. POST /api/v1/orgs/:id/welcome/complete   ← создаёт документ + ставит profileCompletedAt
  3. router.push('/dashboard')               ← начнётся action-тур (Блок B)
```

**API-хук для Блока A:**
```ts
// frontend/src/api/onboarding.api.ts
export const onboardingApi = {
  patchWelcome: (orgId: string, body: WelcomePatchDto) =>
    apiClient.patch(`/orgs/${orgId}/welcome`, body),
  completeWelcome: (orgId: string) =>
    apiClient.post(`/orgs/${orgId}/welcome/complete`),
  patchUserRole: (body: { companyRole: string }) =>
    apiClient.patch('/users/me', body),
};
```

---

#### 5.6 Блок B — Action-тур «Настройка компании» (переписать `welcome.ts`)

**Файл:** `frontend/src/ui/tour/tours/welcome.ts` — переписать целиком.

**TourId:** `'welcome'` (не менять — иначе существующие пользователи увидят его заново).

**Автозапуск:** `WelcomeTourAutoStart` уже смонтирован в `AuthenticatedShell`. Стартует при `profileCompletedAt !== null && setupCompletedAt === null`.

> **Изменение в `WelcomeTourAutoStart.tsx`** — добавить условие:
> ```tsx
> const { org } = useOrg(); // hook / контекст
> if (!org || org.setupCompletedAt) return null;
> useTour('welcome');
> ```

**6 шагов тура:**

```ts
export const welcomeTour: TourDefinition = {
  id: 'welcome',
  steps: [
    // B1 — Компания
    {
      id: 'company',
      target: '[data-tour-target="welcome.company"]',
      title: 'Расскажите Коре о компании',
      body: 'Логотип, юридические данные, контакты, миссия — основа для отчётов и ИИ-помощника.',
      placement: 'right',
      primaryAction: { label: 'Заполнить сейчас', kind: 'navigate', href: '/company' },
      secondaryAction: { label: 'Пропустить', kind: 'next' },
    },
    // B2 — Отделы
    {
      id: 'departments',
      target: '[data-tour-target="welcome.departments"]',
      title: 'Добавьте отделы вашей компании',
      body: 'Для команды на 20–30 человек обычно 3–5 отделов. Мы подготовили шаблон для вашей отрасли.',
      placement: 'right',
      primaryAction: { label: 'Добавить отделы', kind: 'navigate', href: '/departments' },
      secondaryAction: { label: 'Пропустить', kind: 'next' },
    },
    // B3 — Должности
    {
      id: 'roles',
      target: '[data-tour-target="welcome.roles"]',
      title: 'Заведите должности по отделам',
      body: 'Кора создаст цифровых двойников — можно спросить «как обычно работает маркетолог», даже если он в отпуске.',
      placement: 'right',
      primaryAction: { label: 'Добавить должности', kind: 'navigate', href: '/roles' },
      secondaryAction: { label: 'Пропустить', kind: 'next' },
    },
    // B4 — Команда
    {
      id: 'team',
      target: '[data-tour-target="welcome.structure"]',
      title: 'Пригласите команду',
      body: 'Каждый получит письмо с логином, паролем и инструкцией по входу.',
      placement: 'right',
      primaryAction: { label: 'Пригласить сотрудников', kind: 'navigate', href: '/structure' },
      secondaryAction: { label: 'Пропустить', kind: 'next' },
    },
    // B5 — Первый спринт
    {
      id: 'sprint',
      target: '[data-tour-target="welcome.sprints"]',
      title: 'Поставьте первую цель уже на этой неделе',
      body: 'Спринт — недельный цикл с одной целью. Кора будет следить из встреч и чатов, реально ли команда идёт к цели.',
      placement: 'right',
      primaryAction: { label: 'Создать спринт', kind: 'navigate', href: '/sprints/new' },
      secondaryAction: { label: 'Пропустить', kind: 'next' },
    },
    // B6 — Первая встреча
    {
      id: 'meeting',
      target: '[data-tour-target="welcome.create-meeting"]',
      title: 'Проведите первую встречу',
      body: 'Через две минуты после звонка — расшифровка и ИИ-отчёт. Гостю не нужна регистрация — отправьте ссылку.',
      placement: 'right',
      primaryAction: { label: 'Создать встречу', kind: 'navigate', href: '/meetings/create' },
      secondaryAction: { label: 'Закончить', kind: 'complete' },
    },
  ],
};
```

**Новый `kind: 'navigate'`** — расширить тип `TourStepAction`:

```ts
// types.ts — добавить
interface TourStepAction {
  label: string;
  kind: 'next' | 'prev' | 'skip' | 'complete' | 'navigate';
  href?: string;   // обязателен при kind='navigate'
}
```

В `TourTooltip.tsx` обработать `navigate`: `router.push(href)` + вызов `next()` (тур не закрывается, продолжается со следующего шага при возврате на `/dashboard`).

**`data-tour-target` атрибуты** — добавить в `Sidebar.tsx`:
```
data-tour-target="welcome.company"         → пункт «Компания» в Справочнике
data-tour-target="welcome.departments"     → пункт «Отделы»
data-tour-target="welcome.roles"           → пункт «Карты должностей»
data-tour-target="welcome.structure"       → пункт «Структура»
data-tour-target="welcome.sprints"         → пункт «Спринты»
data-tour-target="welcome.create-meeting"  → зелёная кнопка «+ Создать встречу»
```

**Финальный pop-up Тура №2** (показывается после complete, перед стартом Тура №3):

Реализовать как `TourCompletionModal` — отдельный компонент в `TourOverlay.tsx`, показывается когда `active === null && justCompleted === 'welcome'`.

```
Заголовок: «Настройка готова!»
Текст: «Поставьте первую цель уже на этой неделе.
        Дальше Кора возьмёт работу на себя — будет слушать встречи, читать чаты, держать команду в фокусе.»

Пропущенные шаги (если есть): список из оставшихся незаполненных полей Org
  → «Можно вернуться к этому в любой момент.»

Кнопка: «Перейти на главную →»
```

При клике «Перейти на главную» → `router.push('/dashboard')` + через 1 сек `tourCtx.startIfNotCompleted('overview')`.

**`POST /api/v1/orgs/:orgId/setup/complete`** вызывается при `complete()` тура 'welcome'.

---

#### 5.7 `IncompleteSetupBanner` на дашборде

**Файл:** `frontend/src/components/dashboard/IncompleteSetupBanner.tsx`

Показывается на `/dashboard` если `Org.setupCompletedAt === null`.

Логика подсчёта N из 6:
```ts
const steps = [
  org.companyInfoCompletedAt,
  org.departmentsCompletedAt,
  org.rolesCompletedAt,
  org.teamInvitedAt,
  org.firstSprintCreatedAt,
  org.firstMeetingCreatedAt,
];
const completed = steps.filter(Boolean).length;
```

Отображение:
```
[Кора] Настройка компании: N из 6
Осталось: пригласить команду, создать первый спринт   ← динамически из незаполненных шагов
[Продолжить →]   [Скрыть]
```

- «Продолжить» → `tourCtx.forceStart('welcome')` (стартует с первого непройденного шага через логику шаговой навигации внутри тура).
- «Скрыть» → `localStorage.setItem('onboarding.banner.dismissed', '1')` + убрать из UI (восстановить через `/settings → Показать знакомство снова`).

---

#### 5.8 Блок C — Тур №3 «Обзор сайдбара»

**Файл:** `frontend/src/ui/tour/tours/overview.ts` (новый)

**TourId:** `'overview'` (добавить в тип).

**Автозапуск:** после финального pop-up Тура №2, через 1 сек, `tourCtx.startIfNotCompleted('overview')`.

**Вступительный pop-up:** первым шагом идёт `target: 'center'` — pop-up по центру экрана:
```ts
{
  id: 'intro',
  target: 'center',          // TourTooltip: при placement='center' рендерит по центру экрана
  title: 'Покажу за минуту, что где лежит',
  body: '17 коротких подсказок по разделам. Можно листать кнопкой «Дальше» или закрыть крестиком — все эти подсказки потом всегда доступны при наведении на любой пункт меню.',
  placement: 'center',
  primaryAction: { label: 'Поехали', kind: 'next' },
  secondaryAction: { label: 'Пропустить', kind: 'skip' },
},
```

**17 шагов** (step 0 = intro, шаги 1–17 = пункты из анализа):

| # | `id` | `target` (data-tour-target) | title из NAV_HELP | placement |
|---|---|---|---|---|
| 0 | `intro` | `center` | — | center |
| 1 | `logo` | `overview.logo` | «Кора» | right |
| 2 | `org-switcher` | `overview.org-switcher` | «Переключатель компании» | right |
| 3 | `create-meeting` | `overview.create-meeting` | «+ Создать встречу» | right |
| 4 | `dashboard` | `overview.dashboard` | «Главная» | right |
| 5 | `meetings` | `overview.meetings` | «Встречи» | right |
| 6 | `dump` | `overview.dump` | «Дамп» | right |
| 7 | `cards` | `overview.cards` | «Карточки» | right |
| 8 | `projects` | `overview.projects` | «Проекты» | right |
| 9 | `intake` | `overview.intake` | «Входящие» | right |
| 10 | `chat` | `overview.chat` | «Помощник компании» | right |
| 11 | `me` | `overview.me` | «Я / Моё пространство» | right |
| 12 | `memory` | `overview.memory` | «Память компании» | right |
| 13 | `operations` | `overview.operations` | «Управление» | right |
| 14 | `reference` | `overview.reference` | «Справочник» | right |
| 15 | `settings` | `overview.settings` | «Настройки» | right |
| 16 | `admin` | `overview.admin` | «Админка компании» | right |
| 17 | `concierge` | `overview.concierge` | «Концьерж» | left |

`body` для каждого шага берётся из `NAV_HELP` по соответствующему ключу.

Шаг 14 (`reference`) — при рендере программно раскрывает группу «Справочник» в сайдбаре:
```ts
// В TourOverlay: при переходе на шаг 'reference' раскрываем группу
useEffect(() => {
  if (currentStep.id === 'reference') {
    localStorage.setItem('sidebar.reference.open', '1');
    // dispatch custom event чтобы Sidebar перерендерился
    window.dispatchEvent(new Event('storage'));
  }
}, [currentStep]);
```

**Финальный шаг 17 — Концьерж:**
```ts
{
  id: 'concierge',
  target: '[data-tour-target="overview.concierge"]',
  title: 'Концьерж',
  body: 'Здесь можно задать любой вопрос: создать задачу, найти встречу, написать ИИ-помощнику.',
  placement: 'left',
  primaryAction: { label: 'Готово', kind: 'complete' },
},
```

**Финальный pop-up Тура №3** (`TourCompletionModal`, `justCompleted === 'overview'`):
```
Заголовок: «Готово, вы знаете кабинет»
Текст: «Если что-то забудете — наведите на любой пункт меню, всплывёт подсказка.
        А концьерж справа всегда подскажет в любой момент.»
Кнопка: «Перейти к работе →»
```

---

#### 5.9 Расширение кнопки «Показать знакомство снова» в `/settings`

В `/settings` — раздел «Онбординг» (или в существующий блок с кнопкой):

```
[Тур: Обзор кабинета] — запустить 17-шаговый обзор сайдбара   (tourCtx.forceStart('overview'))
[Тур: Настройка компании] — запустить action-тур настройки     (tourCtx.forceStart('welcome'))
[Сбросить все туры] — сбросить все и показать всё заново        (tourCtx.resetAll())
```

Существующая кнопка «Показать снова» → перенести в этот блок и расширить.

---

### Redirect-логика (итог)

В `AuthenticatedShell` (или в `app/(authenticated)/layout.tsx`):

```ts
// 1. Блок A — если profileCompletedAt ещё не выставлен
if (!user.profileCompletedAt) {
  redirect('/onboarding/welcome/step-1');
}

// 2. Блок B — автостарт тура через WelcomeTourAutoStart (уже есть)
// WelcomeTourAutoStart проверяет org.setupCompletedAt — если null, тур стартует
```

На маршруте `/onboarding/welcome/*` — `AuthenticatedShell` не применяется (route-group `(onboarding)` с собственным layout'ом).

---

### Новый модуль backend: `OnboardingModule`

Рекомендуется вынести всю welcome-логику в отдельный модуль:

```
backend/src/modules/onboarding/
  onboarding.module.ts
  onboarding.controller.ts    ← PATCH /welcome, POST /welcome/complete, POST /setup/complete
  onboarding.service.ts       ← createWelcomeDocument, updateWelcomeFields, completeSetup
  onboarding-labels.ts        ← humanize(constId) → русский текст
  dto/
    welcome-patch.dto.ts
    welcome-complete.dto.ts
```

Зарегистрировать в `AppModule`.

---

## Критерии готовности (DoD)

### Фаза 1 (Backend)
- [x] Новые поля `User.companyRole`, `User.profileCompletedAt` добавлены в `schema.prisma` + `bun run prisma:push`
- [x] Новые поля `Org.teamSize`, `Org.painPoints`, `Org.currentStack`, `Org.plannedFeatures`, `Org.welcomeCompletedAt`, `Org.*CompletedAt` (6 шагов), `Org.setupCompletedAt` добавлены
- [x] Enum `UserCompanyRole` добавлен в схему + сгенерирован `bun run prisma:generate`
- [x] `PATCH /api/v1/users/me` принимает `companyRole`
- [x] `PATCH /api/v1/orgs/:id/welcome` сохраняет поля, Swagger-задокументирован
- [x] `POST /api/v1/orgs/:id/welcome/complete` создаёт документ + ставит `profileCompletedAt`
- [x] `POST /api/v1/orgs/:id/setup/complete` ставит `setupCompletedAt`
- [x] Side-effect'ы в существующих сервисах (Departments, Roles, Persons, Sprints, Meetings) обновляют поля прогресса
- [x] Backfill-скрипт `backfill-onboarding-setup-completed.ts` написан + добавлен в `apply-prod-deploy.ts`
- [x] `bun run typecheck` проходит без новых ошибок
- [x] `bun run lint` проходит

### Фаза 2 (Словарь + Hover-tooltip)
- [x] `frontend/src/lib/nav-help.ts` создан с 43 записями
- [x] `Sidebar.tsx` рендерит `TooltipContent` с текстом из `NAV_HELP` на каждом пункте
- [x] На мобильной версии тултипы не показываются (TooltipProvider delayDuration=150)
- [x] Тип `TourId` расширен: `'overview'` добавлен
- [x] `bun run typecheck` (frontend) проходит

### Фаза 3 (Шаблоны)
- [x] `department-templates.ts` создан для 8 индустрий
- [x] `role-templates.ts` создан для типовых отделов
- [x] На странице `/departments` — блок «Шаблоны для вашей отрасли» виден при `org.industry !== null`
- [x] На странице `/roles` — предлагаемые должности под каждый отдел

### Фаза 4 (Блок A)
- [x] Маршруты `/onboarding/welcome/step-1..6` созданы, layout скрывает AppShell
- [x] Redirect-guard в `AuthenticatedShell` работает: новый пользователь попадает на `step-1`, не в `/dashboard`
- [x] Экраны 1–3: клик = сохранение + авто-переход, кнопки «Далее» нет
- [x] Экраны 4–6: чекбоксы + кнопка «Далее», кнопка «← Назад» работает
- [x] Экран 6 — «Завершить» вызывает `POST /welcome/complete` + создаёт документ «Знакомство с компанией»
- [x] После завершения — `router.push('/dashboard')`, action-тур стартует

### Фаза 5 (Блок B — Action-тур)
- [x] `welcome.ts` переписан: 6 шагов, `kind: 'navigate'`
- [x] `data-tour-target` атрибуты проставлены в `Sidebar.tsx`
- [x] `WelcomeTourAutoStart` проверяет `org.setupCompletedAt` перед стартом тура
- [x] При `kind='navigate'` тур не закрывается, нажатие открывает страницу
- [x] Финальный pop-up «Настройка готова» показывается при `complete` тура 'welcome'
- [x] `IncompleteSetupBanner` на дашборде: показывается, считает N из 6, кнопки работают
- [x] `POST /setup/complete` вызывается при complete тура

### Фаза 6 (Блок C — Обзор сайдбара)
- [x] `overview.ts` создан: 1 intro + 17 шагов, тексты из `NAV_HELP`
- [x] `TOUR_REGISTRY` расширен
- [x] Автостарт после финального pop-up Тура B: 1 сек задержка → `startIfNotCompleted('overview')`
- [x] Шаг `reference` программно раскрывает группу «Справочник» в сайдбаре (через storageKey)
- [x] Финальный pop-up «Готово, вы знаете кабинет» показывается
- [x] Кнопки «Показать туры снова» в `/settings` работают для всех трёх туров

### Фаза 7 (Redirect-логика + E2E-тест)
- [x] Новый пользователь (profileCompletedAt=null): → `/onboarding/welcome/step-1`
- [ ] После завершения Блока A: → `/dashboard` + action-тур стартует
- [ ] После завершения Тура B: финальный pop-up → Тур C стартует через 1 сек
- [ ] Существующий пользователь с отделами (setupCompletedAt заполнен backfill'ом): туры не показываются
- [ ] E2E-сценарий: `cypress/e2e/onboarding.cy.ts` или `vitest` описание happy-path

---

## Риски и ограничения

1. **`kind: 'navigate'`** — новый тип действия в туре. Требует аккуратного обращения с state: тур должен "помнить" на каком шаге остановился, когда пользователь перешёл на другую страницу и вернулся. `TourProvider` в `active.stepIndex` уже держит это в памяти — проблема только при hard refresh. Решение: при перезагрузке `startIfNotCompleted('welcome')` запустит тур заново с шага 0, что нормально.

2. **Обратная совместимость `TourId`** — поле `tourProgress` в `User` имеет формат `{ welcome?: { completedAt, skipped } }`. У существующих пользователей ключ `'welcome'` может быть `{ completedAt: ... }` — они уже прошли старый тур. Новый action-тур `'welcome'` не покажется им повторно (isTourDone = true). Нужно проверить: если хочется показать им новый тур, нужен отдельный ключ (например `'setup'`). **Рекомендация:** добавить TourId `'setup'` для Блока B и оставить `'welcome'` в качестве алиаса для Блока C / старого тура. Обсудить с командой перед реализацией Фазы 5.

3. **Синхронизация прогресса шагов** — side-effect'ы в сервисах (Departments, Roles и т.д.) добавляют 1 запрос в каждый `create()`. Если у Org миллионы операций — это negligible. В MVP нет проблемы.

4. **Документ «Знакомство»** — создание через `DocumentsService` требует, чтобы тот был доступен из `OnboardingModule`. Либо инжектировать сервис, либо сделать внутренний прямой Prisma-вызов. Рекомендую инжектировать через `forwardRef` / экспорт модуля.

5. **Backfill может быть долгим** — если в prod много Org с Department.count > 0. Добавить `LIMIT / batch` с паузами. Скрипт должен быть idempotent (WHERE setupCompletedAt IS NULL).

---

## Фазы реализации

- [x] **Фаза 1 — Backend** (1 рабочий день)
  - `schema.prisma`: новые поля User + Org + enum
  - `bun run prisma:push && bun run prisma:generate`
  - `OnboardingModule`: контроллер + сервис + DTO для 4 эндпоинтов
  - `onboarding-labels.ts`: humanize constId → русский текст
  - Side-effect'ы в DepartmentsService, RolesService, PersonsService, SprintsService, MeetingsService
  - Backfill-скрипт + регистрация в `apply-prod-deploy.ts`

- [x] **Фаза 2 — Словарь + Hover-tooltip** (0.5 дня, параллельно с Фазой 1)
  - `nav-help.ts` с 43 записями
  - Расширение `Sidebar.tsx`
  - Расширение `TourId` + `TOUR_REGISTRY`

- [x] **Фаза 3 — Шаблоны по индустрии** (1 день)
  - `department-templates.ts` + `role-templates.ts`
  - UI блока «Шаблоны для вашей отрасли» на `/departments` и `/roles`

- [x] **Фаза 4 — Блок A (6 экранов знакомства)** (2–3 дня)
  - `app/(onboarding)/welcome/step-{1..6}/page.tsx` + layout
  - `onboarding.api.ts` — API-хук
  - Redirect-guard в `AuthenticatedShell`

- [x] **Фаза 5 — Блок B (Action-тур)** (2 дня)
  - Переписать `welcome.ts`: 6 шагов, `kind: 'navigate'`
  - Расширить `TourStepAction` типом `'navigate'` + логика в `TourTooltip`
  - `data-tour-target` атрибуты в `Sidebar.tsx`
  - Обновить `WelcomeTourAutoStart`
  - `TourCompletionModal` для финального pop-up
  - `IncompleteSetupBanner` на дашборде
  - Интеграция: `POST /setup/complete` при complete тура

- [x] **Фаза 6 — Блок C (Обзор сайдбара)** (1 день)
  - `overview.ts`: 18 шагов (intro + 17)
  - Автозапуск из `TourCompletionModal` Блока B
  - Раскрытие «Справочника» на шаге 14
  - Финальный pop-up Тура C
  - Кнопки в `/settings`

- [x] **Фаза 7 — Интеграционный тест + полировка** (0.5 дня)
  - E2E happy-path: новый user → 6 экранов → action-тур → overview → работает
  - Проверка existing-user: не видит туры
  - `bun run typecheck` + `bun run lint` без ошибок (frontend + backend)

**Итого: 8–9 рабочих дней**

---

## Итог

Реализовано полностью (2026-05-29).

**Backend (Фаза 1):**
- Prisma schema: enum `UserCompanyRole`, 2 поля User, 12 полей Org
- `OnboardingModule`: 4 эндпоинта + `onboarding-labels.ts`
- Side-effect'ы в 5 сервисах (departments, roles, invitations, sprints, meetings)
- Backfill-скрипт + регистрация в `apply-prod-deploy.ts`

**Frontend (Фазы 2-6):**
- Словарь `nav-help.ts`: 43 записи
- Hover-tooltip в `Sidebar.tsx` + `data-tour-target`/`data-overview-target`
- Шаблоны по индустрии: `department-templates.ts`, `role-templates.ts` + интеграция
- Block A: 6 экранов знакомства + redirect-guard + `onboarding.api.ts`
- Block B: `welcome.ts` (6 шагов, `kind:'navigate'`) + `TourCompletionModal` + `IncompleteSetupBanner`
- Block C: `overview.ts` (18 шагов) + автозапуск + кнопки в `/settings?tab=tours`

**Верификация:**
- `bun run typecheck` (frontend + backend): 0 ошибок
- `bun run lint` (frontend + backend): 0 ошибок, 2 pre-existing warnings

**Коммиты:**
- `6ce15db` — nav-help.ts (43 записи)
- `527c2e3` — Backend Фаза 1
- `1c46b82` — Frontend API types
- `5c51c62` — Block A (6 экранов)
- `6628644` — Шаблоны
- `fba29c1` — Block B (action-тур)
- `2cd68b8` — Block C (overview-тур)
