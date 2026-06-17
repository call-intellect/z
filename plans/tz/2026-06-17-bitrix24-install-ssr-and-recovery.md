# ТЗ: Bitrix24 — SSR-установка из iframe + recovery-привязка по домену

> Контекст: фундамент установки/токенов и синк CRM/диалогов готовы
> ([archive/2026-06-17-bitrix24-source-sync.md](../archive/2026-06-17-bitrix24-source-sync.md)).
> Этот ТЗ — финальная подготовка к тесту установки тиражного приложения из Маркета
> через туннель. Туннель: `https://tunnel.agent-lia.ru` → `http://localhost:3000`.

## Цель

Дать два рабочих способа привязки портала Bitrix24 к компании Коры:
- **Способ 1 (iframe SSR):** бэк отдаёт страницу-обработчик установки прямо в iframe
  Битрикса; пользователь вводит логин+пароль Коры → портал привязывается к его
  компании. Без зависимости от third-party cookie.
- **Способ 2 (recovery с фронта):** если в iframe привязка не завершена, но хук
  `ONAPPINSTALL` уже создал `pending`-запись в БД — пользователь заходит в кабинет,
  на «Источник Битрикс» вводит домен своего портала → привязка `pending` к компании
  (claim-by-domain). Если `pending` нет — фолбэк на OAuth-коннект.

## Развилки (решены владельцем 2026-06-17)
- SSR-привязка: один owner/admin-org → авто; несколько → выбор на странице; привязывать
  может только owner/admin (роль membership `owner`/`admin`).
- Способ 2: домен→привязка `pending` + фолбэк OAuth (кнопку-deeplink на Маркет — позже).

## ENV
- Переиспользуем существующий `PUBLIC_HOST_URL` (`cfg.publicHostUrl`, фолбэк →
  `PUBLIC_FRONTEND_URL`) как публичный адрес бэка, по которому Битрикс достукивается.
  Для теста: `PUBLIC_HOST_URL=https://tunnel.agent-lia.ru`. В проде — публичный домен
  бэка. Новый ENV не вводим.
- На старте бэк логирует 3 URL для партнёрского кабинета (handler / install event /
  oauth callback), собранные из `publicHostUrl`.

## URL для партнёрского кабинета
- Обработчик установки (iframe) → `{PUBLIC_HOST_URL}/api/v1/bitrix/install/handler` (SSR с формой логина).
- Событие установки → `{PUBLIC_HOST_URL}/api/v1/bitrix/install/event` (`ONAPPINSTALL`/`ONAPPUNINSTALL`).
- redirect_uri (OAuth) → `{PUBLIC_HOST_URL}/api/v1/bitrix/oauth/callback`.
- scope (в кабинете): `crm`, `user`, `im` (диалоги).

## Бэкенд

- **`dto/bitrix-install.dto.ts`** — `BitrixBindSchema { email, password, memberId, orgId? }`,
  `BitrixClaimByDomainSchema { domain: BitrixDomainSchema }`.
- **`bitrix-install.controller.ts`**:
  - `@All('handler')` — на POST сохраняет `pending` (как сейчас), затем рендерит SSR
    HTML с формой логина (member_id внедряется server-side, фолбэк — `BX24.getAuth()`).
  - `@Post('bind')` (public, `@Throttle`) — `{email,password,memberId,orgId?}` → логин
    через `AccountsService.login` → `service.bindInstall(...)`. Ответы:
    `{status:'bound',portalDomain}` | `{status:'select_org',orgs:[{id,name}]}`; ошибки —
    401 (неверный логин), 403 (нет owner/admin-org), 404/409 (нет/конфликт привязки).
  - Логирование входящих хуков на входе (сделано в предыдущем коммите).
- **`bitrix-integration.service.ts`**:
  - `bindInstall({memberId,userId,orgId?})` — резолв owner/admin-memberships; 1 → авто-claim,
    несколько без orgId → `select_org`, с orgId → проверка membership + claim.
  - `claimByDomain(tenantId, domain)` — найти `pending` (tenantId=null) с этим
    `portalDomain` → `claim`; нет → `NotFoundException('bitrix_pending_not_found')`.
  - `onModuleInit()` — стартовый лог URL для кабинета.
- **`bitrix-integration.controller.ts`** — `@Post('claim-by-domain')` (manage+feature) →
  `service.claimByDomain(tenantId, domain)`.

## Фронтенд
- `api/bitrix.api.ts` — `claimByDomain(domain)`.
- `settings/integrations/BitrixIntegrationClient.tsx` → `ConnectForm`: «Подключить» сначала
  пробует `claimByDomain(domain)`; на 404 (`bitrix_pending_not_found`) — фолбэк на
  `getAuthorizeUrl` (OAuth-редирект); на успехе — `mutate`.

## Фазы
- [x] Ф1 — ENV (`PUBLIC_HOST_URL` в `.env` + стартовый лог URL в `onModuleInit`) + DTO `bitrix-install.dto.ts`.
- [x] Ф2 — SSR-обработчик (`@All('handler')` рендерит форму логина) + `@Post('bind')` + `bindInstall`.
- [x] Ф3 — `claimByDomain` (сервис) + `@Post('claim-by-domain')` (manage+feature).
- [x] Ф4 — фронт: `bitrixApi.claimByDomain` + `ConnectForm` пробует claim-by-domain → фолбэк OAuth.
- [x] Ф5 — тесты (+6 unit в service.spec) + verify.

## Верификация
- backend: `NODE_OPTIONS=--max-old-space-size=8192 bun run typecheck` · lint ·
  `bunx vitest run src/modules/bitrix/`.
- frontend: typecheck · lint.
- Ручной тест через туннель: установка из demo-портала Bitrix24 (iframe) + recovery по домену.

## Расширение (2026-06-17, по итогам живого теста): SSR-визард + упрощённый вход + авто-авторизация менеджера

Подтверждено доками Bitrix: iframe-handler POST несёт `AUTH_ID` (токен ТЕКУЩЕГО юзера) +
`member_id` + `DOMAIN`; `user.current` с `auth=AUTH_ID` опознаёт открывшего iframe.

- **Фикс (сделано):** handler при `connected` рендерит success-экран, а не форму (`getInstallView`).
- **Э1 — iframe-сессия:** на `bind` (и на авто-входе) выдаём cookie `z_session`
  `SameSite=None; Secure` (iframe = origin туннеля = origin бэка → same-origin fetch).
  `bind` возвращает `orgId` для заголовка `X-Org-Id`.
- **Э2 — авто-авторизация менеджера при повторном открытии:** handler (member `connected`) →
  `user.current(AUTH_ID)` → `BitrixUser(tenantId, externalId).linkedPersonId` →
  `Membership(personId).userId` → сессия Коры этому юзеру + визард от его имени.
  Неотмапленный → фолбэк (решается владельцем).
- **Э3 — упрощённый вход в Кору:** кнопка «Открыть Кору» = одноразовый magic-link
  (`accounts` verification token, purpose `magic_link`) → `/accounts/magic-link/consume?token=…`,
  открывает кабинет залогиненным без повторного ввода пароля.
- **Э4 — полный визард в iframe (TODO):** шаги «✓ привязано» → «AI-анализ (тумблер)» →
  «Запустить первую синхронизацию» → «Сопоставить сотрудников» → «Открыть Кору».
  Дёргает защищённые `bitrix/integration/*` с iframe-сессией + `X-Org-Id`.

### Статус расширения
- [x] Фикс success-экрана (`getInstallView`, handler не показывает форму при `connected`).
- [x] Э1 — iframe-сессия cookie `SameSite=None; Secure` на `bind`.
- [x] Э2 — авто-авторизация: `resolveActingUser` (`user.current`→`BitrixUser`→`Membership`);
  handler: binder-cookie → mapped-user → форма с notice (неотмапленный/«обратитесь к админу» + вход для админа).
- [x] Э3 — `AccountsService.issueLoginUrl` (magic-link по userId); «Открыть Кору» = одноразовая ссылка.
  - [x] Фронт-страница `/accounts/magic-link/consume` (раньше отсутствовала → 404): consume токен → редирект в кабинет.
- [x] Э4 — интерактивный визард в iframe (зеркало ChatBox onboarding шаг «Сотрудники»):
  приветствие + тумблер AI-анализа (PATCH analysis) + **авто-синхронизация менеджеров**
  (`POST sync?scope=users` → опрос `GET users`) + **таблица сопоставления** (Найден/Нет в Коре →
  Связать/Не связывать · Создать в Коре/Не создавать, `PATCH users/:id/link`) + «Применить» +
  «Открыть Кору». Работает на iframe-сессии (`issueSession`) + `X-Org-Id`; при 403 (не админ) —
  блок сопоставления прячется. Диалоги/CRM подтянутся авто-синком.

## Итог
Реализовано целиком (Ф1–Ф5). Бэк: typecheck 0, lint 0, vitest bitrix 42 теста (+6).
Фронт: typecheck 0, lint 0. Осталось — ручной тест через туннель + регистрация app в
партнёрском кабинете (URL/scope см. выше). Прод-действий миграций нет; новые публичные
эндпоинты `install/bind` и `integration/claim-by-domain` — Swagger-smoke (prod-deploy-log Шаг 12).
