---
date: 2026-06-30
feature: invite-password-fix-and-multi-org
branch: fix/invite-password-existing-user-multi-org
---

# Инвайт: пароль из письма не подходил + переход на multi-org

## Что поставлено

Жалоба владельца: при добавлении сотрудника в команду на почту приходит пароль, но он **не подходит** на `/login` («неверный пароль») — приходится запрашивать восстановление. В ходе разбора владелец уточнил, что корень глубже: пользователя `sadrtdinova.ainaz@gmail.com` **уже есть** в системе со своим паролем, а её приглашают в другую компанию и генерируется НОВЫЙ пароль — пользователь-то один. Требование: если юзер уже есть — пароль не трогать, слать уведомление; если нового — temp-пароль как при регистрации. Затем владелец отдельно решил: **разрешить multi-org** (один юзер в нескольких компаниях).

## Как решал

**Диагностика (vexp + чтение):** при e-mail-инвайте `OrgInvitationsService.createInvitation` генерил temp-пароль ВСЕГДА и клал только в `OrgInvitation.tempPasswordHash`; запись `User` под инвайт не создавалась до клика magic-link (`acceptViaMagicLink` → `upsertStandalone`). `AccountsService.login` ищет `User` по `findStandaloneByEmail` — его нет → `LoginInvalidError`. Для уже существующего юзера magic-link ещё и **сбрасывал** его пароль на temp (`upsertStandalone.update` всегда писал `passwordHash`).

**Фикс логики инвайта** ([org-invitations.service.ts](../01_projects/auth-and-accounts.md) §Поток 5):
- Детект существующего standalone-User по e-mail. Есть → `tempPasswordHash=null`, письмо `sendInviteNotification` (новый шаблон `INVITE_NOTIFICATION_TEMPLATE` + метод в `MailService`). Нет → temp-пароль + `sendInviteWithCredentials` (как было).
- `acceptViaMagicLink`/`acceptViaPassword` провижинят через новый `AccountsService.findOrCreateStandaloneForInvite` — существующему юзеру пароль НЕ меняется (find-or-create).
- Новый метод `OrgInvitationsService.acceptViaPassword`: вход по e-mail+temp-паролю находит pending-инвайт, сверяет с `tempPasswordHash`, провижинит `User`+`Membership`+сессию, `mustChangePassword=true`. Подключён фолбэком в `AccountsService.login` (`tryLoginViaInvitation`) — присланный пароль работает на `/login` сразу.

**Multi-org:**
- Убран `assertNoOtherActiveMembership` из всех accept-путей (`acceptInvitation`/`acceptViaMagicLink`/`acceptViaPassword`) + удалён сам метод. `Membership` стал настоящим many-to-many.
- `getMe(userId, activeOrgId?)` отдаёт роль по активной орге из `X-Org-Id` (контроллер `me` берёт через `@CurrentOrg()`), иначе фолбэк на первую свою → demo.
- Фронт: `OrgSwitcher.handleSwitch` теперь реально меняет `X-Org-Id` (`setApiClientOrgId`) + сохраняет выбор в `localStorage['z.activeOrgId']` + `refresh()` (раньше после `/switch-org` ничего не менялось — переключение визуально не срабатывало). `auth-context` восстанавливает активную орг из localStorage до первого `/me`; ключ вынесен в `api-client` (`ACTIVE_ORG_LS_KEY`).

## Что вышло

- Backend: `typecheck=0`, `lint=0` (1 предупреждение про порядок dto-импортов — пре-existing, не моё), `build=0`. Frontend: `typecheck=0`, `build=0`.
- Тесты: новый сценарный `accounts/auth-flows.scenario.spec.ts` (реальные `AccountsService`+`OrgInvitationsService`+`AccountsRepository`+`PasswordService` поверх in-memory Prisma — пароли реально хешируются argon2 и сверяются между шагами) покрывает 4 сценария владельца: регистрация→смена пароля→вход, восстановление, инвайт нового, инвайт существующего в другую компанию. + unit-кейсы в `accounts.service.spec`/`org-invitations.service.spec`. Все 115 тестов accounts/orgs зелёные.
- Ветка `fix/invite-password-existing-user-multi-org` запушена (коммит `b98f2288`).
- **Prod-операций нет:** ни миграций, ни ENV, ни seed/patch/backfill-скриптов (multi-org сделан без колонки — через `X-Org-Id`). Достаточно пересборки backend+frontend.

## Чему научился

- **Инвайт не создавал `User`** — провижининг был только в magic-link-ветке. Письмо вело основным путём на `/login`, который про инвайт ничего не знал. Урок: если письмо обещает «войти паролем здесь», путь логина обязан этот пароль принимать.
- **`upsertStandalone.update` безусловно перезаписывал `passwordHash`** — поэтому magic-link тихо менял пароль существующему юзеру. Для accept-флоу нужен find-or-create, а не upsert.
- **Multi-org уже был почти готов на фронте** (`OrgSwitcher`, `useMemberships`, `/auth/switch-org`, `TenantMiddleware` по `X-Org-Id`) — единственной стеной был один backend-гард `assertNoOtherActiveMembership`. Но `handleSwitch` не менял `X-Org-Id` после switch — переключение было сломано (TODO «Фаза 0a.3»). Снять гард было мало; чтобы реально заработало — починить фронтовый switch + `getMe` по активной орге.
- **Серверной персистентности активной орги нет** — закреплено в [не-сделано](../04_не-сделано/README.md) (Фаза 0a.3) + минор «новая орг не авто-фокусится после magic-link accept».
