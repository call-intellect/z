---
status: draft
created: 2026-05-26
type: tz
feature: clones-marketplace-frontend
priority: high
effort: 3-4 дня
owner: @sergrv80
depends_on:
  - plans/tz/2026-05-26-clone-access-grant-admin-api.md
related:
  - plans/tz/2026-05-25-clones-role-based-rebrand.md       # Ф4 уже задеплоила /clones и /roles/[id]/clone — переписываем
  - plans/tz/2026-05-25-llm-architecture-changes-from-experiments.md  # §9 clone-respond v2 + CloneAccessGrant
  - plans/analysis/2026-05-26-llm-migration-followup-prompt.md         # источник задачи 3
---

# ТЗ: Маркетплейс клонов — frontend (member + admin + чат)

> **Кодовое имя:** «Витрина клонов».
> **Цель:** реализовать публичную витрину ролевых клонов для члена Org (`/clones`), отдельную CRUD-страницу управления грантами для админа (`/admin/clones`) и полноценный чат с боковой панелью диалогов (`/clones/[roleId]/chat/[conversationId]`).
> **Что НЕ ломаем:** backend endpoints уже готовы (Phase 7 миграции LLM, коммит `f897d99`). Существующие `/clones` (Ф4 Clones=Roles) и `/roles/[id]/clone` переписываем поверх — пути сохраняем, верстку и состояния расширяем.

---

## §0. Контекст

### 0.1 Что было до

После рефакторинга `Clones=Roles` (коммит `9379fd8`) на фронте появились:
- `/clones` — `ClonesListClient.tsx`: плоская карточная сетка ролевых клонов с фильтрами `status` / `q` / `confidenceMin`, сортировка по `lastBuildAt` / `confidence`. Карточка ведёт на `/roles/:id/clone`.
- `/roles/[id]/clone` — `RoleCloneClient.tsx`: шапка клона + top traits + сотрудники на роли + инлайн-чат (одна сессия, ничего не сохраняется в боковой панели).
- `/roles/[id]/clone/history` — версионная история (read-only список v1, v2, …).

### 0.2 Что добавилось в Фазе 7 миграции LLM (`f897d99`)

Backend endpoints для **многодиалогового** общения с клоном:

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/api/v1/clones` | Список ролевых клонов Org (уже использует `ClonesListClient`). |
| `GET` | `/api/v1/clones/:roleId/history` | История версий клона роли. |
| `POST` | `/api/v1/clones/persons/:personId/conversations` | Создать новый пустой диалог с person-клоном. Возвращает `{ conversationId }`. |
| `POST` | `/api/v1/clones/roles/:roleId/conversations` | То же для role-клона. |
| `POST` | `/api/v1/clones/persons/:personId/ask` | Спросить person-клона (опц. `conversationId` — продолжить диалог). Ответ — `AskCloneResponseDto` с `mode: 'clone_style'`, `refused?`, `refusalReason?`. |
| `POST` | `/api/v1/clones/roles/:roleId/ask` | То же для role-клона. |
| `GET` | `/api/v1/clones/roles/:roleId/skill-profile` | Top traits + список людей на роли. |

Появилась модель `CloneAccessGrant`:
```prisma
model CloneAccessGrant {
  id, tenantId,
  grantedToUserId,                        // кому
  cloneType,                              // 'person' | 'role'
  cloneRefId,                             // personId или roleId
  grantedById, grantedAt
  @@unique([tenantId, grantedToUserId, cloneType, cloneRefId])
}
```
Под флагом `CLONE_V2_ENABLED` — единственный источник правды о доступе к клону.

### 0.3 Что добавит Задача 4 (зависимость)

ТЗ `plans/tz/2026-05-26-clone-access-grant-admin-api.md` (пишется параллельно) добавит:
- `GET /api/v1/admin/clones/access-grants` — список грантов (фильтры).
- `POST /api/v1/admin/clones/access-grants` — выдать.
- `DELETE /api/v1/admin/clones/access-grants/:id` — отозвать.
- `GET /api/v1/me/clone-access` — что доступно мне (карта grant-ов для оптимистичного UI member'а).
- (опц.) `POST /api/v1/clones/:roleId/access-grants/request` — запросить доступ (in-app сигнал админу).

**Эта зависимость — мягкая:** мы фронтим скелет страницы `/admin/clones` и хуки `useMyCloneAccess()` сразу, мокируя контракт через типы. Если бэк не успевает — секцию `AdminCloneAccessGrantManager` выкатываем заглушкой с пометкой «доступно после деплоя API», но карточки `/clones` уже умеют состояние «без гранта».

### 0.4 Решения владельца (НЕ перепридумывать)

- **Видимость**: `/clones` видна **всем member'ам Org**. Показывается **вся** сетка карточек. Без `CloneAccessGrant` карточка серее, вместо «Спросить» — кнопка «Запросить доступ».
- **Две раздельные страницы**: `/clones` (member) и `/admin/clones` (admin). НЕ одна страница с toggle.
- **Аватар клона** — SVG, БЕЗ фото человека. Инициал роли (1–2 буквы) в круге фирменного цвета, цвет привязан к департаменту (детерминированный hash от `departmentId` → одна из 12 палитр).
- **Cmd+K** — НЕ интегрируем.
- **Фильтры**: только поиск по названию роли + группировка по departments. Без `status` / `confidence` / `pinned`.
- **Сравнение версий (split-view)** — НЕ делаем.
- **Архивация / historical clones** — НЕ делаем. UI не показывает `status='archived'` / `superseded` вообще (фильтруем на клиенте).
- **Mobile-first** — обязательно. Адаптивная сетка.
- **Уведомление при выдаче гранта** — in-app (на главной появляется значок-точка). Telegram отложен.
- **Язык UI** — только русский (см. CLAUDE.md и feedback `admin_ui_russian_only`).

---

## §1. Цели и не-цели

### 1.1 Цели (DoD)

1. Любой member Org может зайти на `/clones`, увидеть карточки всех ролевых клонов своей Org (с поиском и группировкой по департаментам).
2. Member, у которого есть `CloneAccessGrant` на клон, кликает «Спросить» и попадает в чат `/clones/[roleId]/chat/[conversationId]` с боковой панелью своих диалогов с этим клоном и кнопкой «+ Новый диалог».
3. Member без гранта видит карточку «приглушённую», вместо «Спросить» — «Запросить доступ»; клик отправляет hook-запрос (бэк может ещё не реализовать — fronend дёргает `request-access` endpoint, обрабатывает 404 как «функция временно недоступна»).
4. Member внутри чата создаёт новые диалоги (изолированные), переключается между ними, видит историю сообщений (вопрос + ответ + citations + бейдж `refused` при отказе клона).
5. Admin/owner Org заходит на `/admin/clones`, видит таблицу всех текущих грантов, может выдать новый грант (выбор пользователя + клона) и отозвать существующий. Действия записываются в audit (фронт лишь дёргает endpoint).
6. Mobile (≤640px): карточки в 1 столбец, sidebar чата — Drawer (off-canvas).
7. Все надписи — на русском. Английские слова — только бренды (LiveKit, Telegram).

### 1.2 Не-цели (явно НЕ делаем)

- ❌ Архивация / показ archived / superseded клонов.
- ❌ Сравнение версий split-view.
- ❌ Cmd+K интеграция (поиск клонов в command palette).
- ❌ Уведомления по Telegram при выдаче гранта (only in-app точка).
- ❌ Фото / аватарка человека-носителя на карточке клона.
- ❌ Голосовой вывод чата (feedback `concierge_text_only_output`).
- ❌ Реализация бэка для `request-access` (фронт лишь дёргает endpoint и обрабатывает 404).
- ❌ Удаление существующего `RoleCloneClient.tsx` — он остаётся как fallback-страница «детали клона» (см. §2 ниже про маршруты).

---

## §2. Маршруты

| Путь | Аудитория | Что показывает |
|---|---|---|
| `/clones` | member | Маркетплейс — карточки сгруппированы по departments, поиск по `roleName`. |
| `/clones/[roleId]` | member | **Карточка клона** — описание роли (`roleName`, `departmentName`), bearer, confidence, top traits (5–7 шт.), список диалогов member'а, кнопки «+ Новый диалог» / «Запросить доступ». **Заменяет** прежний `/roles/[id]/clone` как канонический URL клона. (`/roles/[id]/clone` оставляем 301 redirect на `/clones/[roleId]`, без ломки старых ссылок.) |
| `/clones/[roleId]/chat/[conversationId]` | member (нужен grant) | Главный чат с боковой панелью диалогов. |
| `/clones/[roleId]/history` | member | История версий (просто 301 redirect на старый `/roles/[id]/clone/history`, или копи-страница). Решение: 301 redirect. |
| `/admin/clones` | admin/owner | Управление грантами `CloneAccessGrant` (таблица + add/revoke). |

**Замечание про `/roles/[id]/clone`:** существующий `RoleCloneClient` имеет инлайн-чат с одной сессией. После релиза `/clones/[roleId]` мы:
1. Перевешиваем `app/(authenticated)/roles/[id]/clone/page.tsx` на `redirect(\`/clones/\${id}\`)`.
2. Содержимое `RoleCloneClient.tsx` переезжает в `app/(authenticated)/clones/[roleId]/CloneDetailClient.tsx` (с правками: убрать инлайн-чат, добавить список диалогов и кнопку «+ Новый диалог»).
3. Файл `RoleCloneClient.tsx` удаляем.

---

## §3. Компоненты (с props)

Все новые компоненты — в `frontend/src/ui/clones/`, страницы — в `frontend/app/(authenticated)/clones/` и `frontend/app/(authenticated)/admin/clones/`. Слой ApiDto → DomainModel → UiModel сохранён.

### 3.1 `CloneMarketplaceClient` — главная сетка

**Путь:** `frontend/app/(authenticated)/clones/ClonesListClient.tsx` (переписываем существующий — старая логика фильтров/сортировки уезжает).

**Props:** нет (страница-клиент, всё из контекстов).

**Внутри:**
- `useClones()` — список всех клонов Org (без фильтра status, server отдаёт только active).
- `useMyCloneAccess()` — карта grant-ов для пометки карточек.
- Локальный state: `searchQuery: string`, `collapsedDepartments: Set<string>`.
- Группирует items по `departmentName` (null → секция «Без отдела»), рисует `<DepartmentSection>` за каждый отдел.
- При `searchQuery` непустом — фильтр по `roleName.toLowerCase().includes(q)` (case-insensitive), пустые секции скрываются.
- Header: `<h1>Клоны должностей</h1>` + краткое объяснение (1 строка) + `<CloneSearchInput>`.
- Footer (мобильно): подсказка «Нажмите на карточку, чтобы спросить клона».

**Состояния:** loading (skeleton 6 карточек), empty (`/clones` пустой — текст: «В вашей организации ещё нет клонов должностей. Они появятся, когда RoleClonePersonaBuild соберёт первые v1.»), error (с кнопкой «Повторить»).

### 3.2 `CloneCard` — карточка клона

**Путь:** `frontend/src/ui/clones/CloneCard.tsx`.

**Props:**
```ts
interface CloneCardProps {
  item: CloneListUiItem;
  hasGrant: boolean;
  onRequestAccess?: (cloneType: 'role', cloneRefId: string) => void;
}
```

**Содержимое:**
- Слева: `<CloneAvatar>` (48×48 mobile / 64×64 desktop).
- Справа: `roleName` + `Клон <publicName>` (vN) + bearer line («Сейчас: Иван И.» или «Носитель не назначен»).
- Снизу: 1 строка — `traitsCount` черт · `Обновлён <дата>`.
- Если `hasGrant === false`: карточка приглушена (`opacity-60`), CTA — `<Button variant="outline">Запросить доступ</Button>` (вызывает `onRequestAccess`).
- Если `hasGrant === true`: CTA — `<Button>Спросить</Button>` → `router.push(\`/clones/\${item.roleId}\`)`.
- Без хвостовых ссылок «История» / «Обновить» — это перенесли в `/clones/[roleId]`.

**A11y:** card обёрнута в `<article role="link">` с `aria-label="\${publicName}. \${hasGrant ? 'Спросить клона' : 'Запросить доступ'}"`.

### 3.3 `CloneAvatar` — SVG-аватар

**Путь:** `frontend/src/ui/clones/CloneAvatar.tsx`.

**Props:**
```ts
interface CloneAvatarProps {
  roleName: string;
  departmentId?: string | null;
  size?: number;           // px, default 48
  className?: string;
}
```

**Логика:**
- Инициал — первая буква `roleName`. Если `roleName` начинается с цифры/символа — берём первую буквенную позицию. Если две словесные единицы (например, «Главный бухгалтер») — берём первые буквы первых двух слов (длина ≤ 2).
- Цвет фона — детерминированный hash от `departmentId ?? roleName` → один из 12 цветов палитры (см. ниже). Цвет текста — белый.
- Форма — круг (`rounded-full`).
- Типографика инициала — `font-semibold`, размер = `Math.round(size * 0.42)`px, `text-white`, центрировано.
- SVG чистый, без `<img>` / внешних ассетов.

**Палитра** (12 цветов, согласованных с Tailwind tokens проекта — оттенки `600` для контраста с белым текстом):
```
[
  '#dc2626', // red-600
  '#ea580c', // orange-600
  '#d97706', // amber-600
  '#65a30d', // lime-600
  '#16a34a', // green-600
  '#0d9488', // teal-600
  '#0891b2', // cyan-600
  '#2563eb', // blue-600
  '#4f46e5', // indigo-600
  '#7c3aed', // violet-600
  '#c026d3', // fuchsia-600
  '#db2777', // pink-600
]
```

**Hash:** простой `djb2`-style:
```ts
function hashIndex(key: string, mod: number): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = (h * 33) ^ key.charCodeAt(i);
  return Math.abs(h) % mod;
}
```

### 3.4 `DepartmentSection` — сворачиваемая секция группировки

**Путь:** `frontend/src/ui/clones/DepartmentSection.tsx`.

**Props:**
```ts
interface DepartmentSectionProps {
  departmentName: string;        // «Маркетинг», «Без отдела»
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;           // CloneCard[]
}
```

**Содержимое:**
- Header — `<button>` с иконкой `<ChevronDown />`/`<ChevronRight />` + название + бейдж количества.
- Body — `<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>`. При `collapsed === true` — `hidden`.

### 3.5 `CloneSearchInput` — поиск

**Путь:** `frontend/src/ui/clones/CloneSearchInput.tsx`.

**Props:**
```ts
interface CloneSearchInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;          // default «Поиск по названию должности»
}
```

**Реализация:** обёртка над `<Input>` из shadcn + иконка `<Search />` слева + `<X />` справа при непустом значении (clear). Без debounce — фильтрация локальная (≤ 200 карточек, мгновенно).

### 3.6 `CloneDetailClient` — карточка клона

**Путь:** `frontend/app/(authenticated)/clones/[roleId]/CloneDetailClient.tsx`.

**Props:**
```ts
interface CloneDetailClientProps {
  roleId: string;
}
```

**Логика:**
- `useClones()` + `find(roleId)` → `CloneListUiItem` (если нет — empty state «Клон ещё не собран»).
- `clonesApi.getRoleSkillProfile(orgId, roleId)` — top traits + people (как сейчас).
- `clonesApi.listConversations({ cloneType: 'role', cloneRefId: roleId })` — список диалогов этого пользователя с этим клоном. **Замечание про API:** такого endpoint'а на бэке пока нет. Backend Phase 7 добавил только `createConversation`. Нужно либо:
  - **(А, рекомендую):** добавить в этом ТЗ требование к бэку — `GET /api/v1/clones/conversations?cloneType=role&cloneRefId=:roleId&limit=50` — возвращает `ChatV2Conversation[]` отфильтрованные по `scope='clone'` и matched refId. Это **меньше работы**, чем переиспользовать `chat-v2/conversations` с фильтром (потому что нужны scoped поля).
  - **(B, fallback):** использовать существующий `chatV2Api.listConversations({ scope: 'clone', limit: 50 })` (если scope поддерживается) и фильтровать на клиенте по metadata. Хрупко.

  → **Решение для ТЗ:** заложить вариант А, в Roadmap добавить пункт «согласовать с автором Phase 7 контракт endpoint». Если согласования не будет — выкатываем без списка диалогов (показываем только «+ Новый диалог», навигация туда генерит новую conversation).

- Шапка: `<CloneAvatar>` 80×80 + `publicName` + bearer + confidence bar + `traitsCount` черт.
- Кнопка «+ Новый диалог» (primary): вызывает `clonesApi.createRoleConversation(roleId)` → редирект `/clones/[roleId]/chat/[conversationId]`.
- Если `!hasGrant`: кнопка disabled + бейдж «Доступ ограничен» + ссылка «Запросить доступ».
- Блок «Топ черт» — как в текущем `RoleCloneClient` (5–7 traits максимум).
- Блок «Сотрудники на роли» — оставляем как есть (текущий код).
- Блок «Мои диалоги» (если есть): список последних N=20 диалогов с этим клоном. Клик → `/clones/[roleId]/chat/[conversationId]`. Empty state: «У вас пока нет диалогов с этим клоном.»
- Линк «История версий клона» (внизу).

### 3.7 `CloneChatSidebar` — боковая панель диалогов

**Путь:** `frontend/src/ui/clones/CloneChatSidebar.tsx`.

**Props:**
```ts
interface CloneChatSidebarProps {
  roleId: string;
  publicName: string;              // «Клон Маркетолога v2» — для заголовка
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onCreateConversation: () => Promise<void>;  // делает createRoleConversation + редирект
}
```

**Содержимое:**
- Header: `<CloneAvatar size={32}>` + `publicName` (truncate) + кнопка «← Назад» (`/clones/[roleId]`).
- Кнопка «+ Новый диалог» (full-width, primary).
- Список диалогов (data из `useCloneConversations(roleId)`), скроллится:
  - Превью: title (или «Без названия» если NULL), `updatedAt` (формат «сегодня 14:23» / «вчера» / «23 мая»), бейдж активности.
  - Active item — `bg-accent/10`.

**Адаптив:** на desktop — sticky слева 320px. На mobile — Drawer (open via gesture или `<Menu>`-кнопка в Header чата).

### 3.8 `CloneChatClient` — главный чат

**Путь:** `frontend/app/(authenticated)/clones/[roleId]/chat/[conversationId]/CloneChatClient.tsx`.

**Props:**
```ts
interface CloneChatClientProps {
  roleId: string;
  conversationId: string;
}
```

**Логика:**
- `useCloneConversationMessages(conversationId)` — поток сообщений.
- `useClones()` + `find(roleId)` — `publicName`, `confidence`, `bearer` для шапки.
- `useMyCloneAccess()` — если `hasGrant === false` → редирект на `/clones/[roleId]` с toast «Доступ к клону отозван».
- Layout: 2 колонки — `<CloneChatSidebar>` слева + `<main>` справа.

**Main:**
- Sticky header: `<CloneAvatar size={40}>` + `publicName` + бейдж «в стиле роли». Mobile: дополнительно `<Menu>`-кнопка для открытия sidebar.
- Лента сообщений:
  - User-сообщения — справа, `bg-accent/10`, `max-w-[80%]`.
  - Assistant-сообщения — слева, `max-w-[85%]`.
  - При `refused === true`: вместо текста — карточка с иконкой `<ShieldAlert />`, заголовок «Клон отказался отвечать», подзаголовок — `refusalReason` (например, «topic_starved» → «В архиве недостаточно обсуждений по теме»).
  - Citations — `<CitationsList>` под assistant-сообщением.
- Composer внизу: `<Textarea>` (autosize 1-6 строк) + кнопка «Спросить» (`<Send />`-иконка). Ctrl/Cmd+Enter — отправить.
- Состояние «клон думает» — карточка-плейсхолдер с `<Loader2 className="animate-spin" />`.
- Error toast при ошибке `askRole`.

**Optimistic update:** добавляем user-сообщение в локальный state до ответа сервера, при ошибке откатываем.

### 3.9 `AdminCloneAccessGrantManager` — управление грантами

**Путь:** `frontend/app/(authenticated)/admin/clones/AdminCloneAccessGrantManager.tsx`.

**Props:** нет.

**Логика (требует endpoints из Задачи 4):**
- `useSWR('admin/clones/access-grants', () => adminClonesApi.listGrants(...))` — список грантов с фильтрами.
- Таблица: `Кому` (user) | `Тип` (role/person) | `Клон` (publicName) | `Кто выдал` | `Когда` | `Действие` («Отозвать»).
- Фильтры (тулбар): поиск по user-email, выбор клона (dropdown), filter `cloneType`.
- Кнопка «+ Выдать доступ» → диалог:
  - Поле «Пользователь» — autocomplete по `usersApi.search`.
  - Поле «Клон» — autocomplete по `clonesApi.listClones` (для role) или `peopleApi.search` (для person).
  - Кнопка «Выдать» → `adminClonesApi.createGrant(...)`.
- «Отозвать» — `<AlertDialog>` подтверждения → `adminClonesApi.revokeGrant(id)` → optimistic remove из таблицы.

**Empty state:** «Грантов пока нет. Выдайте первый — нажмите «+ Выдать доступ».»

**Если Задача 4 ещё не задеплоена:** компонент рендерит баннер «Доступно после обновления API. Ожидаемый релиз — ...», без таблицы. Чтобы это работало, в `clones-admin.api.ts` оборачиваем вызовы в try/catch — на 404 показываем баннер вместо ошибки.

---

## §4. State (SWR ключи + контексты)

### 4.1 SWR hooks (новые)

**Файл:** `frontend/src/hooks/useClones.ts`.

| Hook | Ключ | Контракт |
|---|---|---|
| `useClones()` | `['clones-list', orgId]` | Список всех role-клонов Org (`status='active'`, без q). Возвращает `{ items: CloneListUiItem[], isLoading, error, mutate }`. |
| `useCloneByRoleId(roleId)` | derived от `useClones` | `CloneListUiItem \| null`. |
| `useCloneConversations(roleId)` | `['clone-conversations', orgId, roleId]` | Список диалогов текущего пользователя с клоном этой роли. Требует endpoint **GET `/api/v1/clones/conversations?cloneType=role&cloneRefId=:roleId`** (см. §3.6 — зависимость). |
| `useCloneConversationMessages(conversationId)` | `['clone-conversation', conversationId]` | `{ messages: CloneMessage[], pending: boolean, error }`. Использует `chatV2Api.getConversation(conversationId)` (диалоги клонов хранятся в той же `ChatV2Conversation`). |
| `useMyCloneAccess()` | `['me-clone-access', userId]` | Карта `Record<\`\${cloneType}:\${cloneRefId}\`, true>` — оптимистичная фильтрация. Использует `GET /api/v1/me/clone-access` (Задача 4). |

Все хуки — `revalidateOnFocus: false`, `dedupingInterval: 5000`.

### 4.2 Domain-маперы (расширение `frontend/src/domain/clone.ts`)

Новые типы:
```ts
export interface CloneConversationUiItem {
  id: string;
  title: string | null;
  updatedAt: Date;
  cloneType: 'person' | 'role';
  cloneRefId: string;
  messageCount: number;
}

export interface CloneMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: Date;
  citations: CloneCitation[];
  refused: boolean;
  refusalReason: string | null;
}

export interface MyCloneAccessMap {
  // key = `${cloneType}:${cloneRefId}` → true
  grants: Record<string, true>;
  has(cloneType: 'person' | 'role', cloneRefId: string): boolean;
}
```

Маперы: `mapCloneConversationDto → CloneConversationUiItem`, `mapChatV2MessageDto → CloneMessage`.

### 4.3 API клиент

**Файл:** `frontend/src/api/clones.api.ts` (расширяем).

Добавить:
```ts
createRoleConversation: (orgId, roleId) =>
  apiClient.post<{ conversationId: string }>(
    `/api/v1/clones/roles/${encodeURIComponent(roleId)}/conversations`,
    {},
    { headers: orgHeaders(orgId) },
  ),
createPersonConversation: (orgId, personId) =>
  apiClient.post<{ conversationId: string }>(
    `/api/v1/clones/persons/${encodeURIComponent(personId)}/conversations`,
    {},
    { headers: orgHeaders(orgId) },
  ),
listMyConversations: (orgId, params: { cloneType: 'role' | 'person'; cloneRefId: string; limit?: number }) =>
  apiClient.get<{ items: CloneConversationApi[]; total: number }>(
    `/api/v1/clones/conversations${buildQuery(params)}`,
    { headers: orgHeaders(orgId) },
  ),
requestAccess: (orgId, cloneType: 'role' | 'person', cloneRefId: string) =>
  apiClient.post<{ ok: true } | { ok: false; reason: string }>(
    `/api/v1/clones/${cloneType}s/${encodeURIComponent(cloneRefId)}/access-grants/request`,
    {},
    { headers: orgHeaders(orgId) },
  ),
```

**Новый файл:** `frontend/src/api/me-clone-access.api.ts`:
```ts
export const meCloneAccessApi = {
  list: (orgId) => apiClient.get<{ grants: Array<{ cloneType, cloneRefId, grantedAt }> }>(
    '/api/v1/me/clone-access',
    { headers: orgHeaders(orgId) },
  ),
};
```

**Новый файл:** `frontend/src/api/admin-clones.api.ts` (для `/admin/clones`):
```ts
export const adminClonesApi = {
  listGrants: (orgId, params) => apiClient.get<{ items, total }>(
    `/api/v1/admin/clones/access-grants${buildQuery(params)}`,
    { headers: orgHeaders(orgId) },
  ),
  createGrant: (orgId, body) => apiClient.post(`/api/v1/admin/clones/access-grants`, body, ...),
  revokeGrant: (orgId, id) => apiClient.del(`/api/v1/admin/clones/access-grants/${id}`, ...),
};
```

### 4.4 Context (опционально)

`CloneAccessContext` — НЕ создаём отдельным провайдером. `useMyCloneAccess()` — обычный SWR-hook, кешируется по ключу. Если нужна оптимистичная мутация после `requestAccess` — `mutate()` глобально по ключу.

---

## §5. UX-карта и состояния

### 5.1 `/clones` (member)

| Состояние | UI |
|---|---|
| loading | Skeleton — header + 6 серых карточек 1/2/3 в столбце адаптивно. |
| empty (Org без клонов) | Большая иконка `<Bot>` + текст «В вашей организации ещё нет клонов должностей. Они появятся автоматически, когда RoleClonePersonaBuild соберёт первые v1.» |
| empty (поиск ничего не нашёл) | Под поиском — «По запросу «\<q\>» ничего не найдено. Попробуйте другое название должности.» |
| error | Карточка с текстом ошибки + кнопка «Повторить». |
| normal | Группировка по departments, поиск, карточки. |

### 5.2 `/clones/[roleId]` (карточка клона)

| Состояние | UI |
|---|---|
| loading | Skeleton header + 3 skeleton-блока. |
| not_found | «Клон должности не найден. Возможно, он был удалён.» + ссылка «Все клоны». |
| no_grant | Шапка показывается полностью, чат-блок заменён карточкой «Доступ ограничен. Запросить у администратора?» с кнопкой. |
| has_grant + no_conversations | Шапка + блок «Мои диалоги» с empty: «У вас пока нет диалогов с этим клоном» + кнопка «+ Новый диалог». |
| has_grant + has_conversations | Полная карточка с списком диалогов. |
| pending_rebuild | Бейдж «Клон обновляется» рядом с publicName + сообщение «Клон сейчас перестраивается, ответы могут быть неполными». |

### 5.3 `/clones/[roleId]/chat/[conversationId]` (чат)

| Состояние | UI |
|---|---|
| loading messages | Skeleton-карточки в ленте. |
| empty (new conversation) | Подсказка по центру: «Задайте первый вопрос — клон ответит, опираясь на накопленные обсуждения этой роли.» |
| sending | Composer disabled + placeholder «Клон думает…». |
| message refused | Карточка с `<ShieldAlert>`-иконкой + ru-readable причина. |
| conversation not found | Редирект на `/clones/[roleId]` + toast. |
| access revoked mid-session | Toast + редирект на `/clones/[roleId]`. |

### 5.4 `/admin/clones` (admin)

| Состояние | UI |
|---|---|
| api not deployed | Баннер «Доступно после обновления API» + дисейбленные кнопки. |
| loading | Skeleton-таблица. |
| empty | Empty state. |
| forbidden | `<AdminForbidden>` (member пришёл по прямой ссылке). |
| normal | Таблица + тулбар + диалог «выдать». |

### 5.5 In-app уведомление о выдаче гранта

**Hook в UI:**
- В `frontend/src/ui/components/layout/Sidebar.tsx` (или в `Header.tsx`) — рядом с пунктом «Клоны» рисуется красная точка, если в `useMyCloneAccess()` появилась новая grant (с `grantedAt > localStorage['last-seen-clone-grants']`).
- При заходе на `/clones` — `localStorage['last-seen-clone-grants'] = new Date().toISOString()`, точка исчезает.
- **Bell-icon notification — не делаем сейчас.** Только бейдж-точка возле пункта «Клоны» в навигации. Расширенная нотификационная инфраструктура — отдельная фича.

---

## §6. Адаптивность (mobile-first)

| Брейкпоинт | `/clones` | `/clones/[roleId]` | `/clones/[roleId]/chat/[id]` | `/admin/clones` |
|---|---|---|---|---|
| **<640px** (mobile) | 1 col grid; поиск sticky сверху; departments — accordion. | Стек вертикально; «+ Новый диалог» — sticky bottom-bar. | Sidebar — Drawer (off-canvas, открывается из `<Menu>`-иконки в header); чат full-width. | Таблица превращается в карточки (1 col). |
| **640-1024px** (tablet) | 2 col grid. | 2 col (карточка слева + диалоги справа). | Sidebar 280px sticky слева + чат. | Таблица скроллится горизонтально. |
| **>1024px** (desktop) | 3 col grid. | 2 col, более широкие карточки. | Sidebar 320px + чат. | Полная таблица. |

**Composer чата на mobile:** sticky `bottom-0`, учитывать safe-area-inset для iOS.

**Drawer на mobile:** реализация через `<Sheet>` из shadcn/ui (уже есть в проекте).

---

## §7. Acceptance criteria

### Member happy path
- [ ] `/clones` показывает все клоны Org (≥ 1 карточка), сгруппированные по departments.
- [ ] Поиск «маркет» фильтрует до «Клон Маркетолога».
- [ ] Карточка с grant — кнопка «Спросить»; без grant — «Запросить доступ», карточка приглушена.
- [ ] Клик «Спросить» → `/clones/[roleId]` → клик «+ Новый диалог» → `/clones/[roleId]/chat/[conversationId]` (новый conversationId).
- [ ] Отправка вопроса → ответ клона приходит, показывается в ленте, citations отрисованы.
- [ ] При `refused === true` — карточка отказа вместо текста.
- [ ] Боковая панель показывает все мои диалоги с этим клоном, переключение между ними меняет URL без перезагрузки.
- [ ] Кнопка «+ Новый диалог» в sidebar создаёт новый диалог и переключает на него.

### Member no-grant path
- [ ] Карточка без grant — клик «Запросить доступ» вызывает `requestAccess` endpoint, при успехе — toast «Запрос отправлен», при 404 — toast «Функция временно недоступна».
- [ ] Прямой переход на `/clones/[roleId]/chat/[conversationId]` без grant → редирект на `/clones/[roleId]` + toast.

### Admin path
- [ ] `/admin/clones` доступна только owner/admin.
- [ ] Таблица грантов рендерится с фильтрами.
- [ ] «+ Выдать доступ» → диалог → выбор user + clone → создаёт grant → таблица обновляется.
- [ ] «Отозвать» → confirmation → grant пропадает.
- [ ] Member, которому выдали grant, после рефреша `/clones` видит CTA «Спросить» (был «Запросить доступ»).

### Mobile
- [ ] `/clones` на iPhone SE 1 column, поиск работает, карточки кликабельны.
- [ ] Чат на mobile: открыть sidebar через `<Menu>`, выбрать другой диалог, sidebar закрывается.

### Тесты
- [ ] Unit-тест на `CloneAvatar` — детерминированный hash, инициалы для роли с пробелами / без.
- [ ] Unit-тест на `useMyCloneAccess.has(...)`.
- [ ] Snapshot-тест на `CloneCard` (with/without grant).
- [ ] Snapshot-тест на `DepartmentSection` (collapsed/expanded).
- [ ] E2E (Playwright) — happy path member, опционально.

### Не-функциональные
- [ ] `bun run typecheck` зелёный.
- [ ] `bun run lint` без новых warning'ов.
- [ ] `bun run test:unit` зелёный.
- [ ] Все надписи — на русском (никаких «Loading», «Error» в visible-text).
- [ ] `second-brain/01_projects/frontend-pages.md` обновлён — новые маршруты в реестре.

---

## §8. Roadmap (фазы / коммиты)

### Фаза 1 — Каркас и типы (≈0.5 дня)

**Цель:** создать структуру файлов, типы, API-клиенты, hooks. Без UI.

- `frontend/src/api/clones.api.ts` — добавить `createRoleConversation` / `createPersonConversation` / `listMyConversations` / `requestAccess`.
- `frontend/src/api/me-clone-access.api.ts` — новый.
- `frontend/src/api/admin-clones.api.ts` — новый.
- `frontend/src/domain/clone.ts` — расширить `CloneConversationUiItem`, `CloneMessage`, `MyCloneAccessMap` + маперы.
- `frontend/src/hooks/useClones.ts` — `useClones`, `useCloneByRoleId`, `useCloneConversations`, `useMyCloneAccess`.

**DoD:** `typecheck` зелёный.

**Commit:** `feat(clones-fe): API/domain/hooks scaffolding для маркетплейса клонов`.

### Фаза 2 — Маркетплейс member (`/clones`) (≈1 день)

**Цель:** новая сетка с группировкой и поиском.

- `frontend/src/ui/clones/CloneAvatar.tsx` — SVG-аватар + палитра + хеш.
- `frontend/src/ui/clones/CloneCard.tsx` — карточка (с/без grant).
- `frontend/src/ui/clones/CloneSearchInput.tsx`.
- `frontend/src/ui/clones/DepartmentSection.tsx`.
- `frontend/app/(authenticated)/clones/ClonesListClient.tsx` — переписать на `CloneMarketplaceClient`.
- Unit-тесты на `CloneAvatar`, snapshot на `CloneCard`.

**DoD:** карточки видны, поиск/группировка работают, член без grant видит приглушённую карточку и «Запросить доступ».

**Commit:** `feat(clones-fe): маркетплейс с группировкой по департаментам и поиском`.

### Фаза 3 — Карточка клона + чат с sidebar (≈1.5 дня)

**Цель:** `/clones/[roleId]` и `/clones/[roleId]/chat/[conversationId]`.

- `frontend/app/(authenticated)/clones/[roleId]/page.tsx` + `CloneDetailClient.tsx` — переезд логики из `RoleCloneClient` + список диалогов.
- `frontend/app/(authenticated)/clones/[roleId]/chat/[conversationId]/page.tsx` + `CloneChatClient.tsx`.
- `frontend/src/ui/clones/CloneChatSidebar.tsx`.
- `frontend/app/(authenticated)/roles/[id]/clone/page.tsx` → `redirect('/clones/[roleId]')`.
- `frontend/app/(authenticated)/roles/[id]/clone/RoleCloneClient.tsx` — удалить.
- `frontend/app/(authenticated)/roles/[id]/clone/history/page.tsx` → `redirect('/clones/[roleId]/history')` ИЛИ оставить как было (т.к. это сторонний редкий маршрут — оставляем, без копи-страницы).

**DoD:** member может зайти в карточку, создать новый диалог, спросить, получить ответ; на mobile sidebar — Drawer.

**Commit:** `feat(clones-fe): карточка клона и чат с боковой панелью диалогов`.

### Фаза 4 — Admin CRUD грантов (`/admin/clones`) (≈1 день, в зависимости от готовности Задачи 4)

**Цель:** управление `CloneAccessGrant`.

- `frontend/app/(authenticated)/admin/clones/page.tsx` + `AdminCloneAccessGrantManager.tsx`.
- Диалог «+ Выдать доступ» (с autocomplete по users + clones).
- AlertDialog «Отозвать».
- Если Задача 4 не задеплоена — компонент рендерит баннер «Доступно после релиза API».
- Обновить sidebar навигацию: добавить пункт «Клоны и доступы» в группе «Admin» для `/admin/clones`.

**DoD:** admin видит таблицу, может выдать/отозвать. Member после выдачи рефрешит `/clones` и видит «Спросить».

**Commit:** `feat(clones-fe): admin-страница управления грантами клонов`.

### Фаза 5 — In-app уведомление + финал (≈0.5 дня)

**Цель:** бейдж-точка возле пункта «Клоны» в sidebar; обновить second-brain.

- `frontend/src/ui/components/layout/Sidebar.tsx` — бейдж-точка через `useMyCloneAccess()` + `localStorage`.
- Обновить `second-brain/01_projects/frontend-pages.md`.
- Обновить `second-brain/01_projects/frontend-contexts-hooks.md` — новые hooks.
- E2E happy path (опц.).

**Commit:** `feat(clones-fe): in-app уведомление о новых грантах + второй мозг`.

---

## §9. Открытые вопросы

1. **Endpoint `GET /api/v1/clones/conversations?cloneType=...&cloneRefId=...`** — нужно подтвердить с автором Phase 7 / владельцем backend, что он добавляется в этот же спринт. Если нет — Фаза 3 деградирует: без списка диалогов в карточке (только «+ Новый диалог»), история конкретного conversation подгружается через существующий `chatV2Api.getConversation(id)`. **Решение для исполнителя**: уточнить у владельца до старта Фазы 3.
2. **Bell-icon notifications глобально (для других фич — invites, assignments и т.д.)** — отложено как отдельная фича (см. §5.5). Сейчас — только бейдж-точка возле пункта «Клоны».
3. **Перенос `/clones/[roleId]/history`** — оставляем 301 redirect на старый `/roles/[id]/clone/history` без копи-страницы. Если в Фазе 5 решим вынести историю под /clones — это +0.5 дня; пока не критично.
4. **`createPersonConversation` использовать или нет?** Person-клоны на UI не выставляются (Clones=Roles рефакторинг). Endpoint остаётся в API-клиенте для admin-debug, но в маркетплейсе не используется. Подтвердить, что НЕ нужно делать карточки person-клонов.
