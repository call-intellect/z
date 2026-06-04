---
title: Org / Membership / RBAC
status: actual
updated: 2026-05-10
---

# Org / Membership / RBAC

Введено в Фазе 0 ТЗ knowledge-core ([plans/tz/2026-05-10-knowledge-core-tz.md](../../plans/tz/2026-05-10-knowledge-core-tz.md), Шаги 1-5).

## Зачем

До Фазы 0 ресурсы в Z (встречи, карточки, задачи) принадлежали `User` напрямую через `ownerId`. Это блокировало многопользовательские сценарии — менеджер не мог увидеть встречу коллеги, owner не мог делегировать.

После Фазы 0 любой ресурс принадлежит **Org** (через `tenantId`), а доступ внутри Org регулируется **RBAC** (роли + visibilityMode).

## Сущности

### Org

```
Org {
  id, name, slug @unique, ownerId (FK User),
  visibilityMode: open|strict (default open),
  tier: basic|pro|enterprise (default basic — placeholder для Фазы 12),
  createdAt, deletedAt?
}
```

- Создаётся автоматически при `POST /api/v1/accounts/register` (см. [auth-and-accounts.md](./auth-and-accounts.md)).
- Можно создать дополнительную через `POST /api/v1/orgs`.
- Slug = `slugify(name) + '-' + 6 hex` (collision-resistant).

### Membership

```
Membership {
  orgId, userId, role: owner|admin|manager,
  invitedBy?, joinedAt, @@unique([orgId, userId])
}
```

Один юзер может быть в нескольких Org с разными ролями. На фронте при наличии нескольких Org — селектор в `/settings/organization` и заголовок `X-Org-Id` для запросов.

### OrgInvitation

```
OrgInvitation {
  orgId, email, role, token UNIQUE (nanoid 40),
  status: pending|accepted|revoked|expired,
  invitedBy, expiresAt (TTL 7д), acceptedAt?, acceptedByUserId?
}
```

- Создаётся owner/admin Org через `POST /api/v1/orgs/:id/invitations`.
- Письмо через `MailService.sendPlain` (inline-шаблон в `org-invitations.service.ts`).
- Принимается через `POST /api/v1/orgs/invitations/:token/accept` (Prisma-транзакция: status→accepted + Membership).

## RBAC модель

`backend/src/modules/rbac/policies/policy.csv` — Casbin-совместимый формат, читается RbacService при старте.

| Роль | visibilityMode | Что может |
|---|---|---|
| `super_admin` (User.isSuperAdmin) | — | bypass всех проверок |
| `owner` Org | любой | read/write/delete всё в Org, manage-настройки Org |
| `admin` Org | любой | read/write/delete всё в Org (кроме owner-only действий) |
| `manager` Org | `open` | read всех ресурсов Org, write только своих (`ownerUserId == self`) |
| `manager` Org | `strict` | read/write только своих ресурсов |

**Защита owner'а:** последнего owner'а нельзя ни понизить, ни удалить.

## API

### Endpoints (под `CookieAuthGuard`)

| Метод | URL | Кто может |
|---|---|---|
| POST | `/api/v1/orgs` | любой авторизованный (создаёт доп. Org) |
| GET | `/api/v1/orgs/me` | любой авторизованный |
| GET | `/api/v1/orgs/:id` | member |
| PATCH | `/api/v1/orgs/:id` | только owner |
| GET | `/api/v1/orgs/:id/members` | member |
| PATCH | `/api/v1/orgs/:id/members/:userId` | owner/admin |
| DELETE | `/api/v1/orgs/:id/members/:userId` | owner/admin |
| POST | `/api/v1/orgs/:id/invitations` | owner/admin |
| GET | `/api/v1/orgs/:id/invitations` | owner/admin |
| DELETE | `/api/v1/orgs/:id/invitations/:invitationId` | owner/admin |
| POST | `/api/v1/orgs/invitations/:token/accept` | любой авторизованный |

### TenantGuard

`backend/src/modules/rbac/guards/tenant.guard.ts` — извлекает `tenantId` из:
1. Заголовка `X-Org-Id` (приоритет, для multi-org аккаунтов).
2. URL-параметра `:orgId`.
3. Тела запроса (`tenantId` или `orgId`).
4. Дефолта — единственная активная Org юзера.

Кладёт `req.tenantId` для downstream-кода. На отсутствие tenant'а или членства — `403`.

В Фазе 0 TenantGuard НЕ применяется ко всем существующим контроллерам (Meetings/Cards/Tasks/etc) — это будет в Фазе 1+ при переходе на полноценный multi-tenant. Сейчас TenantGuard готов для использования в новых контроллерах (orgs/, ingest/, search/).

## Frontend

- `/settings/organization` — только вкладка «Информация» (owner-only) с 2026-06-04. **Управление участниками и приглашениями переехало в раздел «Команда» (`/structure`)** — ростер `GET /orgs/:id/team-roster`, inline-смена роли / удаление / приглашение / перевыпуск / отзыв, карточка сотрудника `/structure/persons/[id]` (включая персональные override доступа). См. [[frontend-pages]] §«Команда».
- `/invitations/[token]` — кнопка «Принять приглашение» → редирект на `/dashboard`.
- Middleware: `/invitations` в `PROTECTED_PREFIXES` — неавторизованный редиректится на `/login?next=…` и после логина возвращается.
- API-слой: `frontend/src/api/orgs.api.ts` — единый orgsApi с типизированными DTO.

## Ключевые файлы

- `backend/src/modules/rbac/` — RbacService, TenantGuard, @CurrentOrg, policies/.
- `backend/src/modules/orgs/` — OrgsService, OrgInvitationsService, controller, DTO.
- `backend/scripts/backfill-orgs-fase0.ts` — backfill для production-проката.
- `backend/scripts/smoke-orgs-fase0.ts` — smoke-тест на DB-уровне.

## Открытые вопросы (vNext)

- Multi-org переключение в UI: пока селектор только в `/settings/organization`. В будущем — глобальный (header) и заголовок `X-Org-Id` через axios-interceptor.
- SuperAdminAccessLog — Фаза 7 (Z-Admin).
- Casbin-миграция: формат policy.csv совместим с @nestjs/casbin, при необходимости (например, динамические policy через UI) — заменить evaluate() на enforcer.enforce().
