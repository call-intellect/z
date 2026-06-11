---
title: ТЗ — онбординг/навигация (Sidebar UX) + прод-ретесты (хвост retest3 Ф9)
date: 2026-06-10
status: ready-to-implement — выделено из retest3 Ф9 (решения Р10/Р11 уже приняты)
type: tz
source:
  - plans/tz/2026-06-10-bugfix-fleet-retest3.md   # родительское ТЗ, Ф9
---

# ТЗ — хвост retest3 Ф9: Sidebar UX + прод-ретесты

> **Почему отдельно.** В retest3 Ф9 закрыты #18 (правило пароля) и #15 (роль
> Telegram-бота). #20 и #24 — связная перестройка `Sidebar.tsx` (1106 строк) и
> mobile-nav; вынесены сюда, чтобы не крамить рискованный рефактор в конце
> большого свипа и пройти отдельное ревью. #17 требует прод-доступа. Решения
> владельца Р10/Р11 уже приняты (см. родительское ТЗ) — открытых вопросов нет.

## Ф1 — #20 когнитивная нагрузка новичка (Р10) · S–M

- **Корень:** свежий пользователь видит ~35 пунктов меню (все группы развёрнуты).
  Механизм сворачивания уже есть: `NavGroup.collapsibleSubgroups` + `NavSubgroup`
  (`defaultCollapsed` + `storageKey` + localStorage; авто-раскрытие при активном
  пункте — `hasActive` в `SidebarSubgroup`, `Sidebar.tsx:769-798`). «Справочник»
  (`REFERENCE_GROUP`, `:382`) уже реализован этим паттерном.
- **Шаги:**
  1. Перевести группы **CHATS_GROUP** (`:312`), **MANAGEMENT_GROUP** (`:357`) и
     **memoryGroup** (динамическая, `:577`) в default-collapsed: `items: []` +
     `hideGroupLabel: true` + единственная `collapsibleSubgroups: [{ label: <та
     же>, defaultCollapsed: true, storageKey: 'sidebar.<key>.open', items: [<те
     же items>] }]` — как у REFERENCE. Новый пользователь (нет localStorage-ключа)
     видит их свёрнутыми; после раскрытия — persist. Role-gating сохранить
     (items строятся как сейчас, меняется только обёртка). `allItems` (`:626`)
     по-прежнему включает `collapsibleSubgroups.items` → winnerHref не ломается.
  2. **Welcome-тур уже есть** (`src/ui/tour/tours/welcome.ts`, `TourProvider`,
     `tour-progress.service`) — non-blocking, со «Пропустить», прогресс
     персистится через PATCH. Проверить, что он автозапускается ОДИН раз
     (`startIfNotCompleted`) и НЕ блокирует UI; если автозапуск не подключён к
     первому входу — добавить ненавязчивый автозапуск, гейтить по tour-progress
     (НЕ заводить новый серверный first-login флаг — достаточно «тур не пройден»).
     Форс-тур (убран 28.05) НЕ возвращать.
- **Приёмка:** новый пользователь видит ≤~15 пунктов (4 второстепенные группы
  свёрнуты); раскрытие группы persist'ится; активный пункт авто-раскрывает свою
  группу; тур показывается один раз, «Пропустить» работает, прогресс сохраняется.
  typecheck+build+test:unit зелёные.

## Ф2 — #24 mobile≠desktop nav (Р11) · S–M

- **Корень:** desktop `Sidebar.tsx` (~35 пунктов, групповая модель) и mobile
  `TrackerBottomNav.tsx` (`ITEMS`, `:36-42`: `/me/inbox`, `/projects`, `/feed`,
  `/me/check-ins`, `/me`) — независимые хардкод-списки. `/me/inbox` и
  `/me/check-ins` покрыты desktop через `/me` (matchPrefix `/me`, `Sidebar:289`),
  `/projects` есть (`:280`), **`/feed` в desktop отсутствует**.
- **Шаги (единый источник, две проекции):**
  1. Создать `frontend/src/ui/components/app-shell/primary-nav.ts` с
     `PRIMARY_NAV_ITEMS` (5 ежедневных пунктов: inbox/projects/feed/check-ins/me)
     — тип `{ href, label, icon }`.
  2. `TrackerBottomNav` строит свои кнопки из `PRIMARY_NAV_ITEMS` (сохранить
     `withInboxBadge` для `/me/inbox` через флаг в элементе).
  3. Добавить `/feed` (Лента) в desktop Sidebar (в DAILY-группу или meGroup),
     чтобы mobile ⊆ desktop. Экспортировать из Sidebar статический набор
     desktop-роутов (или helper) для теста.
  4. **Гард-тест** `nav-subset.spec.ts`: каждый `PRIMARY_NAV_ITEMS[].href`
     «достижим» в desktop — есть desktop-пункт с тем же href ИЛИ его matchPrefix
     покрывает mobile-href (напр. `/me` покрывает `/me/inbox`).
- **Приёмка:** набор bottom-nav ⊆ desktop (тест сверяет с общим источником);
  desktop и mobile берут пункты из одного `PRIMARY_NAV_ITEMS`; рендер Sidebar.tsx
  не переписан целиком. typecheck+build+test зелёные.

## Ф3 — #17 прод-ретест принудительной смены пароля · S · ТРЕБУЕТ ПРОД-ДОСТУПА

- **Код есть** (audit Б2, 29.05): `accounts.service.ts:177,561,580`
  (`mustChangePassword=true`), `unified-login.controller.ts:80`,
  `AuthenticatedShell.tsx:45-48` (редирект), глобальный
  `must-change-password.guard.ts` (`app.module.ts:684-685`). Картография не нашла
  пропущенных путей — фикс кода, вероятно, не нужен.
- **Шаги:** прод-прогон (нужен «можно в прод» владельца): инвайт → вход временным
  паролем → редирект `/onboarding/change-password` → `403 must_change_password`
  на API мимо whitelist → смена → доступ открыт. Проверить, что
  `/auth/exchange` (гостевой meeting-flow, `auth.controller.ts:75`) НЕ затронут.
- **Приёмка:** прод-ретест зелёный; если падает — точечно добавить флаг в
  выпавший путь (НЕ ломая гостевой `/auth/exchange`).

## Вне scope
- Светлая тема Sidebar, редизайн навигации сверх Р10/Р11.
