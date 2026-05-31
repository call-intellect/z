---
type: tz
status: draft
feature: Вынос Z-Admin в отдельную route-группу — собственный layout без пользовательского AppShell
date: 2026-05-31
owner: sergrv80@gmail.com
relates_to:
  - frontend/app/(authenticated)/layout.tsx
  - frontend/app/(authenticated)/AuthenticatedShell.tsx
  - frontend/app/(authenticated)/admin/layout.tsx
  - frontend/app/(authenticated)/admin/AdminShell.tsx
  - frontend/app/(admin)/admin/login/layout.tsx
---

# ТЗ: Z-Admin — отдельная route-группа без пользовательского кабинета

## 0. Контекст

Сейчас `/admin/*` физически лежит внутри Next.js route-группы [`frontend/app/(authenticated)/admin/`](frontend/app/(authenticated)/admin/). Группа `(authenticated)` имеет собственный layout, который оборачивает страницу в `AuthenticatedShell` → `AppShell` (пользовательский сайдбар «Кора»), `EntitlementProvider`, `SubscriptionProvider`, `TourProvider`, `AssistantSidebar`, авто-старт онбординг-тура.

Из-за этого в админке появляется «кабинет в кабинете»:
- слева — обычный пользовательский сайдбар (Главная / Встречи / Дамо / Карточки / …),
- в центре — узкий мини-сайдбар Z-Admin внутри `max-w-7xl`-контейнера.

Это:
1. Отбирает половину экрана у админских таблиц (а админка уже разрослась до ~90 страниц).
2. Запускает на админе всё то, что админу не нужно: онбординг-тур, виджеты ассистента, EntitlementGate, SWR-fetch'и подписки.
3. Захламляет навигацию у супер-админа: ему не нужны разделы «Мой вклад» и «Мои обещания».

Группа `(admin)` в проекте уже есть — там [страница логина](frontend/app/(admin)/admin/login/). Этим ТЗ переносим **всю** админку в эту группу и даём ей свой layout.

## 1. Цель

После реализации:
1. URL'ы `/admin/*` остаются прежними — пользователь не замечает разницы в адресах.
2. На любой `/admin/*`-странице (кроме `/admin/login`) рендерится только `AdminShell`: широкий сайдбар Z-Admin (8 категорий) слева на всю высоту, content-area на остаток ширины. Никакого `AppShell` пользователя.
3. Auth-проверка: cookie `z_session` валидна + у пользователя есть роль `super_admin`. Если нет — редирект на `/admin/login?next=<path>`.
4. На админских страницах не подключаются: `EntitlementProvider`, `SubscriptionProvider`, `TourProvider`, `WelcomeTourAutoStart`, `AssistantSidebar`. Они не нужны и съедают трафик.
5. Существующий `/admin/login` остаётся в `(admin)/admin/login/` и работает как раньше.

## 2. Scope

**Входит:**

| Слой | Что меняется | Файлы |
|---|---|---|
| Frontend / роутинг | Перенос всех `(authenticated)/admin/*` → `(admin)/admin/*` (кроме `login`, который уже там) | ~90 директорий со страницами `admin/*` |
| Frontend / layouts | Новый `frontend/app/(admin)/layout.tsx` (root для всей группы) + новый `frontend/app/(admin)/admin/layout.tsx` (превращается в обёртку `<AdminShell>`) | 2 файла |
| Frontend / guards | Перенос `AuthenticatedShell` логики `useAuth`/redirect в новый `AdminAuthGuard` (минимальная версия — только login-check + super_admin-check) | 1 новый компонент |
| Frontend / middleware | [`frontend/middleware.ts`](frontend/middleware.ts) — добавить `/admin` в protected matcher (если не уже) и редирект на `/admin/login` (а не `/login`) при отсутствии cookie | 1 файл |
| Frontend / клиентский API | Никаких изменений: `apiClient` ходит на бэк по тем же путям, бэк отдаёт 403 при отсутствии прав | — |
| Frontend / тесты | Подправить snapshot'ы и e2e (если есть), которые опираются на наличие user-сайдбара на админке | по факту обнаружения |
| Backend | Никаких изменений (auth-проверки уже на бэке через RBAC `super_admin`) | — |
| БД | Никаких изменений | — |

**Не входит:**
- Редизайн сайдбара Z-Admin (внешний вид остаётся — только теперь он на всю высоту экрана).
- Изменение состава пунктов меню админки (это отдельным ТЗ при необходимости).
- Перенос `/admin/login` — он уже в нужной группе.
- ТЗ на «один тариф + доп. сотрудники» — это [соседнее ТЗ от 2026-05-31](2026-05-31-admin-plans-collapse-to-standard.md).

## 3. Решения

### 3.1. Группа и layout-цепочка

```
app/
  (admin)/
    layout.tsx              ← root-layout группы: <html>-обёртки нет (наследуется
                              от app/layout.tsx), только <AdminAuthGuard>{children}</AdminAuthGuard>.
                              EntitlementProvider / SubscriptionProvider / TourProvider
                              сюда НЕ подключаются.
    admin/
      layout.tsx            ← <AdminShell>{children}</AdminShell> — без изменений по содержимому,
                              просто переезжает сюда.
      login/                ← как есть, своя страница без AdminShell (логин — публично).
        layout.tsx
        page.tsx
      orgs/, prompts/, ai/, … ← всё переезжает из (authenticated)/admin/
```

`app/layout.tsx` (root) остаётся единственным владельцем `<html>`, `<body>`, глобальных провайдеров (`AuthProvider`, `Toaster`, темы). Это важно: иначе Next.js падает с "two `<html>` elements".

### 3.2. AdminAuthGuard

Новый минимальный компонент `frontend/app/(admin)/AdminAuthGuard.tsx`:

```tsx
'use client';
import { useAuth } from '@/contexts/auth-context';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

export function AdminAuthGuard({ children }: { children: ReactNode }) {
  const { user, isLoading, isSuperAdmin } = useAuth();
  const pathname = usePathname() ?? '/admin';
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (!isSuperAdmin) {
      // Не super_admin зашёл по прямой ссылке /admin/... — отправляем на свой кабинет
      router.replace('/dashboard');
    }
  }, [user, isLoading, isSuperAdmin, pathname, router]);

  if (isLoading || !user || !isSuperAdmin) {
    return null; // или AdminLoading-скелетон
  }
  return <>{children}</>;
}
```

`useAuth` уже доступен из root-layout-провайдера (`AuthProvider` живёт в самом верху `app/layout.tsx` — проверить, и если нет — поднять).

### 3.3. Что НЕ переносится в (admin)

- `EntitlementProvider` — фичегейт для пользовательских страниц, на админке не нужен.
- `SubscriptionProvider` — то же.
- `TourProvider` + `WelcomeTourAutoStart` — онбординг-туры пользователя.
- `AssistantSidebar` — правый виджет помощника пользователя.

Все они остаются в `(authenticated)/AuthenticatedShell.tsx` и работают для остальных пользовательских разделов как раньше.

### 3.4. Middleware

Сейчас [`frontend/middleware.ts`](frontend/middleware.ts) проверяет cookie на `(authenticated)`. Нужно:

1. Добавить `/admin` в matcher.
2. Для `/admin` редирект при отсутствии cookie → `/admin/login?next=<path>` (а не общий `/login`).
3. `/admin/login` исключить из проверки (как и сейчас исключён `/login`).

### 3.5. Внутренние ссылки

После переноса URL'ы те же → внутренние `Link href="/admin/..."` правок не требуют. Проверить только относительные импорты внутри перенесённых страниц (типа `import '../AdminStateViews'`) — Next.js при перемещении папок сохраняет относительность, но удобнее всё перепрописать через alias `@/`.

## 4. Фазы

### Фаза 1. Подготовка root-layout и guard. `[ ]`
1. Создать `frontend/app/(admin)/layout.tsx` со структурой из §3.1.
2. Создать `frontend/app/(admin)/AdminAuthGuard.tsx` по §3.2.
3. Убедиться, что `AuthProvider` находится в `app/layout.tsx`. Если он в `(authenticated)/layout.tsx` — поднять выше.
4. Проверить, что `/admin/login` продолжает открываться без auth-guard (логин-страница рендерится в обход guard'а; либо AdminAuthGuard внутри `(admin)/admin/layout.tsx`, а `(admin)/admin/login/layout.tsx` его игнорирует).

### Фаза 2. Перенос файлов. `[ ]`
Перенести содержимое `frontend/app/(authenticated)/admin/` (всё **кроме** уже существующего `login/`) в `frontend/app/(admin)/admin/`:
- `AdminShell.tsx`, `AdminStateViews.tsx`, `useAdminQuery.ts`, `navigation.ts` и прочие support-файлы.
- Все подпапки страниц: `orgs/`, `prompts/`, `ai/`, `analytics/`, `economics/`, `platform/`, `media/`, `content/`, `integrations/`, `feedback/`, `audit/`, `incidents/`, `clones/`, `policy/`, `referrals/`, `webhooks/`, `meetings/`, `recordings/`, `health/`, `experiments/`, `ai-models/`, `llm/`, `llm-prices/`, `llm-routes/`, `ai-usage/`, `integration-keys/`, `helpfulness-overview/`, `team-templates/`, `projects/`, `org/`, `usage/`, `system/`, `billing-overview/`, `skill-trait-concepts/`, `demo/`, `prompts/`.

Перенести `frontend/app/(authenticated)/admin/layout.tsx` → `frontend/app/(admin)/admin/layout.tsx`. Содержимое — `<AdminShell>{children}</AdminShell>` без изменений.

Удалить пустую папку `frontend/app/(authenticated)/admin/`.

### Фаза 3. Особый кейс `settings/admin/*`. `[ ]`
Под `(authenticated)/settings/admin/` лежат **не** super-admin страницы — это «org-admin» панель для владельца тенанта (`settings/admin/meetings`, `settings/admin/members`, `settings/admin/sources`, `settings/admin/usage`, `settings/admin/knowledge-core`, `settings/admin/memory-access`). Это **другая роль** (org-owner, не super_admin) и она правильно лежит под пользовательским кабинетом.

Решение Фазы 3: **не трогаем `settings/admin/*`**. Все эти страницы остаются в `(authenticated)/settings/admin/`. Зафиксировать в комментарии нового `(admin)/admin/layout.tsx`:

```tsx
// Z-Admin = super_admin платформы Z. Org-admin (владелец тенанта) живёт в
// (authenticated)/settings/admin/ — это разные роли и разные сайдбары.
```

### Фаза 4. Middleware. `[ ]`
1. Обновить `frontend/middleware.ts`: для путей `/admin` (кроме `/admin/login`) при отсутствии `z_session` — `redirect('/admin/login?next=...')`.
2. Не пускать на `/admin/login`, если пользователь уже залогинен **и** `super_admin=true` — редирект на `/admin` (косметика, не обязательно в первой волне).

### Фаза 5. Очистка `AuthenticatedShell`. `[ ]`
Из `AuthenticatedShell` убрать любые ветки/хаки, написанные под админку (если есть — например, какой-то `pathname.startsWith('/admin')`-чек). Раз админ теперь не проходит через этот шелл — код упрощается.

### Фаза 6. Сборка и тесты. `[ ]`
1. `bun run typecheck` (frontend) — все импорты через `@/` должны резолвиться.
2. `bun run lint` (frontend).
3. `bun run build` (frontend) — `next build` валидирует структуру route-групп.
4. `bun run test:unit` (frontend).
5. Если есть e2e на админку — прогнать.

### Фаза 7. Ручная верификация. `[ ]`
В dev:
- Открыть `/admin` под super_admin: виден только сайдбар Z-Admin на всю высоту, нет «Кора → Главная / Встречи …», нет ассистента справа.
- Открыть `/admin` без cookie: редирект на `/admin/login?next=/admin`.
- Открыть `/admin` под обычным юзером: редирект на `/dashboard`.
- Открыть `/dashboard` под super_admin: сайдбар «Кора» как раньше, ассистент справа, тур.
- Открыть `/settings/admin/members` (org-admin): сайдбар «Кора», как было.

## 5. Файлы, на которые повлияет

```
frontend/
  app/
    (admin)/                       ← было: только login/. Становится корнем всей админки.
      AdminAuthGuard.tsx           NEW
      layout.tsx                   NEW
      admin/
        layout.tsx                 MOVED (был в (authenticated)/admin/layout.tsx)
        AdminShell.tsx             MOVED
        AdminStateViews.tsx        MOVED
        useAdminQuery.ts           MOVED
        navigation.ts              MOVED
        page.tsx                   MOVED (главная админки)
        orgs/ ai/ prompts/ …       MOVED (90 страниц)
        login/                     UNCHANGED — уже здесь
    (authenticated)/
      admin/                       DELETED (пустая после переноса)
      AuthenticatedShell.tsx       MAYBE-CLEAN (убрать админские хаки если были)
  middleware.ts                    UPDATED — /admin protected matcher
```

## 6. Риски и mitigations

| Риск | Mitigation |
|---|---|
| Битые относительные импорты после move | Перед началом — пройти grep'ом по `(authenticated)/admin/**` на `../`-импорты и сразу заменить на `@/` |
| `AuthProvider` оказался ниже root и админка не видит `useAuth` | Фаза 1 шаг 3 — явная проверка; при необходимости поднять провайдер в `app/layout.tsx` |
| Дублирование `<html>` от двух root-layouts | В `(admin)/layout.tsx` НЕТ `<html>/<body>` — только wrapper-component |
| Кеш браузера у текущих супер-админов | После выката — попросить hard refresh на `/admin` (есть в smoke-инструкции) |
| Кто-то в коде делал `pathname.startsWith('/admin')` для каких-то условий в общем AppShell | Прогнать grep — заменить/удалить |
| e2e/playwright тесты ломаются | Фаза 6 — обновить selector'ы для /admin (если опирались на ListItem общего сайдбара) |

## 7. Prod-deploy-log — что обновить

Этот push **не требует** prod-операций кроме пересборки фронта. Соответственно в [docs/operations/prod-deploy-log.md](../../docs/operations/prod-deploy-log.md) добавить запись:

```
### 🌊 2026-05-31 — Z-Admin standalone route group

План: plans/tz/2026-05-31-z-admin-standalone-route-group.md.

**Изменения:** только frontend — перенос /admin/* в свою route-группу + новый AdminAuthGuard.
Backend / БД / ENV — без изменений.

**Шаги прод-инструкции:**
- **Шаг 1 — ENV** — без новых.
- **Шаг 4 — Prisma** — не требуется.
- **Шаг 11 — Docker image rebuild** — обязательно (frontend image меняется).
  ```bash
  docker compose up -d --build frontend
  ```
- **Шаг 12 — Smoke**:
  ```bash
  # Под super_admin: должен открыться /admin без пользовательского сайдбара
  curl -i -H 'Cookie: <super_admin_session>' https://prod.host/admin
  # Без cookie — 307/redirect на /admin/login
  curl -i https://prod.host/admin
  # Под обычным юзером — redirect на /dashboard
  curl -i -H 'Cookie: <user_session>' https://prod.host/admin
  ```
- **Откат:** `git revert <hash>` + `docker compose up -d --build frontend`. Бэкенд не трогали — откат бесплатный.
```

Так как меняется frontend-маршрутизация (новая route-группа) — Шаг 11 (rebuild) обязателен.
В `apply-prod-deploy.ts STEPS` ничего не добавляется — нет новых seed/patch/backfill/migrate-скриптов.

## 8. Definition of Done

- [ ] Все 90 страниц перенесены в `(admin)/admin/`, старая папка пуста и удалена.
- [ ] `frontend/app/(admin)/layout.tsx` + `AdminAuthGuard` созданы.
- [ ] `frontend/app/(admin)/admin/layout.tsx` рендерит только `<AdminShell>{children}</AdminShell>`.
- [ ] `bun run typecheck && bun run lint && bun run build && bun run test:unit` зелёные.
- [ ] Ручная верификация: `/admin` под super_admin показывает только Z-Admin (без «Кора»-сайдбара), `/dashboard` под super_admin показывает «Кора»-сайдбар как раньше, обычный юзер на `/admin` редиректится на `/dashboard`.
- [ ] Запись в `docs/operations/prod-deploy-log.md` добавлена (§7).
- [ ] Затронутые заметки `second-brain/`: `01_projects/admin.md`, `01_projects/frontend-pages.md`, `02_architecture/module-map.md` — обновлены.

## Итог

Реализовано: нет. ТЗ создано, ожидает реализации.
