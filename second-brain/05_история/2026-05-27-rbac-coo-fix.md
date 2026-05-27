---
date: 2026-05-27
title: fix(rbac) — роль coo получала 403 на всех ресурсах
commit: 09e450d
distilled: false
---

## Что было поставлено

Пользователь с ролью `coo` видел страницу «Отделы» с ошибкой «Нет прав на это действие». В DevTools — 403 на `/api/v1/domains`, `/api/v1/company`, `/api/v1/experiments`.

## Как решал

1. Открыл `DepartmentsClient.tsx` — страница вызывает `functionalDomainsApi.list()` → `/api/v1/domains`. Контроллер проверяет `rbac.canRead(..., 'functional_domain')`.
2. В `policy.csv` для `coo` есть ~50 строк `p, coo, *, *, functional_domain, read` и т.д.
3. Нашёл `loadPolicies()` в `rbac.service.ts` — каждая строка проходит через `isMembershipRole(role)`. Функция:
   ```ts
   function isMembershipRole(s: string): s is MembershipRole {
     return s === 'owner' || s === 'admin' || s === 'manager';
   }
   ```
   `'coo'` не проходил → все `p, coo, ...` строки молча отбрасывались при старте сервиса.
4. Схема Prisma имеет `enum MembershipRole { owner, admin, manager, coo }` — роль есть в БД, в policy.csv, но не в guard.

## Фикс

Одна строка в `rbac.service.ts:612`:
```ts
- return s === 'owner' || s === 'admin' || s === 'manager';
+ return s === 'owner' || s === 'admin' || s === 'manager' || s === 'coo';
```

## Результат

- Typecheck чистый
- Коммит `09e450d`, запушен в `origin/dev`

## Урок

При добавлении новой роли в `MembershipRole` (Prisma enum) нужно синхронно обновлять три места:
1. `prisma/schema.prisma` — enum
2. `policy.csv` — правила
3. `rbac.service.ts` → `isMembershipRole()` — guard загрузки политик

Без п.3 роль в БД есть, политики написаны, но при старте они молча дропаются — диагностировать сложно, так как нет никаких warn/error логов.
