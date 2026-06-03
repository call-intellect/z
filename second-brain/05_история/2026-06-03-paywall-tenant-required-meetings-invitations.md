---
type: reflection
date: 2026-06-03
distilled: false
---

# 2026-06-03 — Paywall сломал create встречи и приглашение сотрудника (tenant_required)

## Постановка

Два прод-бага после раскатки paywall (`@RequireSubscription`, 2026-05-28):
1. Создание встречи (`POST /api/v1/meetings`) → 403 `tenant_required`.
2. Приглашение сотрудника (`POST /api/v1/orgs/:id/invitations`) → 403 `tenant_required`.

Оба — «Не передан заголовок X-Org-Id… невозможно определить организацию для
проверки подписки». Найти, починить, протестировать.

## Что сделал

**Общий корень.** Глобальный `SubscriptionGuard` (APP_GUARD) гейтит мутирующие
`@RequireSubscription` эндпоинты и резолвит tenant ТОЛЬКО из `req.tenantId`,
который ставит `TenantMiddleware` (header / orgId в пути / body). Эмпирически
(мини-e2e) установил два неочевидных факта:

- **Глобальные guard'ы выполняются ДО controller-scoped `CookieAuthGuard`** →
  в `SubscriptionGuard` `req.user` ещё `undefined`. Значит серверный single-org
  fallback по user-у там невозможен — бэкенд-фикс «в guard» отпадает.
- Баги расходятся по слою:

**Баг 1 — встречи (нет orgId в пути).** `meetings.api` (и весь lifecycle:
finish/record/regenerate/host-controls, 12 `@RequireSubscription` эндпоинтов) не
слал X-Org-Id. Фикс на фронте: `api-client` добавляет `X-Org-Id` по умолчанию из
текущей Org (`setApiClientOrgId`, синк из `auth-context` через useEffect),
per-call header имеет приоритет. Один change чинит весь класс. Коммит `f016bd27`.

**Баг 2 — приглашения (orgId В пути `/orgs/:id/invitations`).** Path-резолвинг
должен был сработать, но `TenantMiddleware.parseOrgIdFromUrl` парсил `req.url`.
Замерил, что видит middleware при `forRoutes('api/v1/*')`: **`req.url` = `/`**
(Express монтирует на под-роутер, `req.baseUrl` = полный путь), а `req.originalUrl`
стабильно полный. Фикс: парсить из `req.originalUrl`. Теперь `/orgs/:id/*`
self-sufficient без заголовка. Коммит `1028c6f9`.

Обе грабли записал в `02_architecture/code-pitfalls.md` (раздел «Paywall:
tenant_required…»).

## Что вышло

- Backend: e2e `tenant.middleware.e2e.spec.ts` (резолв из пути + приоритет header,
  2 теста). 170 rbac-тестов зелёные, typecheck/lint чисты.
- Frontend: e2e `api-client.org-header.spec.ts` (дефолт на POST/GET, отсутствие
  при null, приоритет явного header, 4 теста). api+contexts 8/8 зелёные,
  typecheck/lint затронутых файлов чисты.
- Запушено в `dev` двумя логическими коммитами.

## Чему научился

1. **Один симптом `tenant_required` — два разных корня и слоя.** Не лечить
   «по симптому»: эндпоинты без orgId в пути лечатся фронтом (header), с orgId
   в пути — бэком (резолв из пути). Сначала классифицируй эндпоинт.
2. **`req.url` в Nest-middleware через `forRoutes` обрезан до `/`.** Для парсинга
   пути в middleware всегда брать `req.originalUrl`, не `req.url`. Цена незнания —
   молча неработающий path-резолвинг, замаскированный тем, что фронт слал header.
3. **Глобальные APP_GUARD идут до controller-scoped guard'ов** → `req.user` в них
   недоступен. Это определяет, какие фиксы вообще возможны в guard-слое. Проверять
   порядок эмпирично (мини-e2e за минуту), а не по интуиции.
4. **Paywall-раскатка — классовый регресс.** Добавление глобального гейта по
   `req.tenantId` сломало весь мутирующий surface, где tenant не доезжал. При
   вводе глобального guard'а проверять ВСЕ пути доставки его входных данных.

## Что осталось

- Хвостов нет. Оба фикса — defense in depth друг для друга (приглашения
  починились бы и фронтовым дефолтом, встречи — нет).
- Возможный фоновый аудит: другие `@RequireSubscription` вне meetings/orgs, если
  появятся, теперь покрыты дефолтным X-Org-Id.

## Прод-команды

Не нужны — пересборка `backend` и `frontend` образов. Миграций/seed/ENV нет.
