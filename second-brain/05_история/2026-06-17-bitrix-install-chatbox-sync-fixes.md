---
name: 2026-06-17-bitrix-install-chatbox-sync-fixes
distilled: false
---

# 2026-06-17 — Bitrix24 SSR-установка из маркета + фиксы синка ChatBox/Bitrix + sync-state + разделение сотрудники/клиенты

## Что было поставлено
1. Довести установку тиражного приложения Bitrix24 из Маркета (через туннель
   `tunnel.agent-lia.ru` → localhost:3000) до рабочего теста: SSR-обработчик в iframe
   с логином/паролем, recovery-путь, визард настройки.
2. По ходу теста вскрылись баги ChatBox: синк сотрудников «не работает»,
   клиенты создаются как менеджеры, синк теряет состояние при уходе с вкладки.
3. UI: показывать какую сущность синхронизируем; разделить сотрудников/клиентов.

## Как решал (файлы/коммиты)
Ветка `bitrixNext`, коммиты `b25802e0`, `efb09fa5`, `1f7021f5`.

- **Bitrix install (SSR)** — `bitrix-install.controller.ts`: `@All('handler')` рендерит
  форму логина (member_id из POST), `@Post('bind')` → `AccountsService.login` →
  `bindInstall` (owner/admin org, авто/выбор); при `connected` — визард
  (`renderWizardPage`): AI-тумблер, **авто-синк менеджеров server-side** (handler сам
  ставит `syncQueue.enqueue('users')`), таблица сопоставления (`/users` + `link`),
  «Открыть Кору» = magic-link. Авто-авторизация менеджера на reopen:
  `resolveActingUser` (`user.current` по AUTH_ID → `BitrixUser.linkedPersonId` →
  `Membership.userId`), iframe-сессия cookie `SameSite=None; Secure`.
  Recovery: `claimByDomain` + OAuth-фолбэк (фронт `ConnectForm`).
  Magic-link вход: `AccountsService.issueLoginUrl/issueSession` + новая фронт-страница
  `app/accounts/magic-link/consume` (раньше отсутствовала → 404).
- **ENV** — переиспользован `PUBLIC_HOST_URL` (адрес бэка для Bitrix-URL; туннель в dev).
- **Корневой баг синка (бил Bitrix И ChatBox)** — фиксированный `jobId` +
  `removeOnComplete/Fail.age` ⇒ повторный `queue.add` молча игнорируется ⇒ синк не
  перезапускается ⇒ «менеджеры не найдены». Фикс: `queue.remove(jobId)` перед `add` в
  обоих queue-сервисах. Это была ПЕРВАЯ причина всех «0 пользователей».
- **Клиенты→менеджеры** — клиент материализовался в `Person` через
  `PersonsService.create()` (путь сотрудника) без `relationship`. Фикс: `relationship`
  в `CreatePersonSchema` + `create()` пишет его; chatbox `autoCreateForUnlinked`
  прокидывает 'employee' (members) / 'external' (customers/channelClients);
  `createPersonAndLink` → 'external'. + апгрейд `upgradePersonToEmployee` (узкий
  `updateMany WHERE relationship='external'`, без клоббера) при линковке менеджера к
  существующему Person (chatbox autoLinkMembers + bitrix autoLinkUsers/autoCreate).
- **sync-state (не теряется при уходе с вкладки)** — `getRunningScopes(tenantId)` в
  queue-сервисах через `queue.getJobState(jobId)` (только active/waiting/delayed/
  prioritized/waiting-children; completed/failed исключены — иначе баннер залипнет на
  час из-за age-ретеншена). Контроллеры status отдают `runningScopes`+`activeSyncScope`;
  фронт считает `serverSyncing`, баннер/поллинг восстанавливаются на маунте.
- **Разделение сотрудники/клиенты** — `persons.list` фильтр по `relationship` +
  `team-roster` несёт `relationship`; директория «Команда» — фильтр Все/Сотрудники/
  Клиенты + бейдж «Клиент». Пикеры ChatBox менеджеров/клиентов переведены с
  `knowledge/entities` (Entity.id, линковка была сломана — `linkMember` ждёт Person.id)
  на `personsDomainApi.list` с relationship-фильтром.
- **AGE-миграция** — `20260617130000_task_closure_candidate_to_public`:
  `ALTER TABLE IF EXISTS ag_catalog."TaskClosureCandidate" SET SCHEMA public` (см. ниже).

## Что вышло (верификация)
- Бэк typecheck 0 · lint 0 · 212 тестов (1 skip; +6 bitrix, +mock person.updateMany).
  Фронт typecheck 0 · lint 0.
- Живой тест через туннель: установка из demo-портала прошла (`pending → connected`),
  синк дал 2 пользователя Bitrix + 9 менеджеров / 44 клиента ChatBox.
- Прямые проверки (curl/psql/script): `user.get` отдаёт менеджеров+email на scope
  `user_basic`; refresh токена работает (нужны `BITRIX_CLIENT_ID/SECRET`); клиенты =
  44× `external`; менеджеры после ре-синка = 9× `employee`; `getJobState` корректно
  отдаёт `delayed`→detected / `unknown` после remove.
- Playwright (проектный chromium-MCP): директория «Команда» — 43 бейджа «Клиент»,
  «Только сотрудники» → 9 строк / 0 клиентов; пикер менеджеров → только сотрудники, 0 ботов.

## Чему научился (грабли)
- **BullMQ фиксированный jobId + age-ретеншен = повторный add игнорируется** — это
  бьёт по любому «перезапусти синк». Всегда `queue.remove(jobId)` перед `add`. Бил
  Bitrix и ChatBox одинаково. → `code-pitfalls`.
- **AGE search_path-трап** повторился на новой таблице (`TaskClosureCandidate` ушла в
  ag_catalog). Корректирующая миграция, а НЕ правка применённой (checksum).
- **Bitrix iframe-handler кладёт `DOMAIN` в query, а токены — в тело POST.** Без домена
  нет `clientEndpoint` → синк не достучится. Читать `DOMAIN` из query (+ referer-фолбэк).
- **Bitrix refresh обязателен** (`accessExpiresAt` протухает за ~1ч) → без
  `BITRIX_CLIENT_ID/SECRET` интеграция умирает после первого часа.
- **Локальный `bun run dev` только из КОРНЯ** (`scripts/dev.ts`); из `backend/` это
  `bun --watch` — сломан на этой машине. CWD Bash-тула надо держать в корне.
- **Два playwright-MCP**: плагинный (канал `chrome`, требует системный Chrome) vs
  проектный `.mcp.json` (`--browser chromium`, рабочий). Звать `mcp__playwright__*`.
- **chatbox-пикеры людей висели на `knowledge/entities` (Entity.id)**, а линковка ждёт
  Person.id — фактически были сломаны; перевод на `/persons` это и фикс, и фильтр.
