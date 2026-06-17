---
name: signup-and-onboarding-wizard
title: Регистрация, онбординг и знакомство с компанией
trigger_type: user_action
status_overall: partial
last_audited: 2026-05-29
owners_human:
  - продакт онбординга
  - продакт аккаунтов
related_plans:
  - plans/archive/2026-05-27-billing-tochka-referral-dadata-z.md
  - plans/archive/2026-05-21-phase-0c-onboarding-wizard-frontend.md
related_projects:
  - 01_projects/onboarding-wizard.md
  - 01_projects/accounts.md
  - 01_projects/role-profile-agent.md
---

# Регистрация, онбординг и знакомство с компанией

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов синхронизированы.

## 1. О чём это (бытовой рассказ)

Когда новый человек впервые попадает на платформу, она встречает его коротким лидерским сценарием: «оставьте имя, почту и телефон — мы сами вышлем временный пароль». Никаких сложных форм, никаких выборов тарифа на старте. Чтобы избавиться от роботов-спамеров, на форме есть скрытое поле-ловушка и счётчик попыток на пять регистраций в пятнадцать минут с одного устройства.

После клика «Зарегистрироваться» платформа делает три вещи разом: создаёт учётную запись с временным паролем, открывает для этого человека отдельную компанию (всё, что он делает дальше, видно только ему и его людям), и отправляет письмо «вот ваш временный пароль, заходите». Если человек указал ссылку партнёра — она запоминается, чтобы партнёру потом начислили вознаграждение.

При первом входе платформа ведёт человека по обязательной короткой экскурсии «Знакомство с компанией». Это шесть простых шагов: расскажите про индустрию, размер команды, главные боли, что планируете использовать. Шаги делают две вещи: настраивают платформу под клиента и формируют первый документ-самоописание компании, который AI потом использует как фундамент памяти. Пока эта экскурсия не пройдена, к остальному кабинету человека не пускают — это сделано специально, чтобы новый клиент не «застрял» в пустом интерфейсе.

После завершения экскурсии человек попадает на главный дашборд. Отдельный, более глубокий мастер «структура компании» (отделы → должности → сотрудники → должностные инструкции) сейчас доступен как добровольный пятишаговый сценарий — он не обязателен и в этой версии не запускается автоматически.

## 2. Что запускает (триггер)

- **Тип:** действие пользователя.
- **Кто инициирует:** новый человек на форме регистрации.
- **Технический источник:** `POST /api/v1/accounts/register` (лид-style, throttle 5/15 мин на IP).

## 3. Шаги процесса (общий список)

1. **Человек заполняет форму регистрации** на странице `/signup` — имя, почта, телефон (опц.), название компании (опц.), два чекбокса согласий.
2. **Платформа создаёт учётную запись** с временным паролем (12 символов base64url) и **отдельную компанию для этого человека** в одной общей транзакции; владелец компании получает роль `owner`. Слот подписки переводится в статус «демо».
3. **На почту уходит письмо с временным паролем** и ссылкой на вход.
4. **Человек заходит по `/login`** — сессия выдаётся cookie `z_session` (httpOnly, 30 дней по умолчанию).
5. **При первом входе платформа форсирует смену пароля** на странице `/onboarding/change-password` (пока пароль не сменён, остальные страницы недоступны).
6. **Сразу после смены пароля** платформа форсирует экскурсию «Знакомство с компанией» (`/onboarding/welcome/step-1..6`) — шесть шагов: companyRole → industry → teamSize → painPoints → currentStack → plannedFeatures.
7. **На завершении шестого шага** платформа сохраняет ответы, создаёт документ «Знакомство с компанией» в библиотеке организации (с этого момента у AI есть фундамент памяти про компанию), и ставит флаг `profileCompletedAt`.
8. **Человек попадает на `/dashboard`** — единый стартовый экран для всех ролей. Отдельной landing-страницы по роли сейчас нет.
9. **Опционально**, владелец может пройти отдельный мастер «структура компании» (`/onboarding/company/step-1..5`) для создания отделов / должностей / сотрудников / инструкций. Сейчас этот мастер не запускается автоматически — это задумано-но-не-связано (см. раздел 8).
10. **По мере накопления данных** агент `role-profile` (cron каждые 4 часа) автоматически строит карты должностей по тем `Role`, у которых набралось хотя бы 5 релевантных блоков знаний.

## 4. Что получается на выходе

- **Учётная запись** в `User` (`signupSource='standalone'`, `mustChangePassword=true`, `consentDataProcessing/Marketing`, `signupRef`).
- **Компания** в `Org` (`ownerId`, `tier='basic'`, `slug`) + `Membership(role='owner')` + дефолтный `Source(type='meeting')` + `Subscription(status='DEMO')`.
- **Письмо с временным паролем** через SMTP `mail.hosting.reg.ru` (адрес отправителя — `noreply@crossmark.ru` / по конфигу).
- **Документ «Знакомство с компанией»** в `Document(kind='text', name='Знакомство с компанией')` — основа памяти AI про компанию.
- **Флаги:** `Org.welcomeCompletedAt`, `User.profileCompletedAt`.
- **Где это видно пользователю:** страница `/dashboard` (стартовый экран после онбординга); сам документ — в библиотеке знаний компании.

## 5. Технический разрез (по шагам)

| # | Шаг (бытовой) | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Форма регистрации | Honeypot `hp_field`, `ref` из URL, два чекбокса согласий; на success — экран «проверьте почту» без редиректа | `frontend/app/signup/SignupForm.tsx:25..81`, `frontend/app/signup/page.tsx` | `POST /api/v1/accounts/register` | — | ✅ |
| 2 | Создание User + Org + Membership | Argon2id-hash пароля (12 байт base64url), `prisma.$transaction` с `upsertStandalone` + `OrgsService.createForOwner` (идемпотентно — повторная регистрация на тот же email не создаёт вторую Org); slug Org генерится из `companyName` или «Компания {name}»; в той же транзакции — `Membership(owner)` + дефолтный `Source(type='meeting', name='Встречи Z')` + `Subscription(status='DEMO')` через `SubscriptionService.ensureDemo` | `backend/src/modules/accounts/accounts.service.ts:138..215` (`register`), `backend/src/modules/orgs/orgs.service.ts:70..111` (`createForOwner`), `backend/src/modules/billing/services/subscription.service.ts:83..106` (`ensureDemo`) | `POST /api/v1/accounts/register` | `User`, `Org`, `Membership`, `Source`, `Subscription`, `SubscriptionEvent('created')` | ✅ |
| 3 | Письмо с временным паролем | `MailService.sendTempPassword({ to, name, tempPassword, loginUrl })`; на отказе SMTP возвращает `{ emailSent: false, emailError }` — пользователю показывается warning-toast | `backend/src/modules/accounts/accounts.service.ts:194..212`, `backend/src/modules/mail/mail.service.ts` | inline через `nodemailer` (SMTP `mail.hosting.reg.ru`) | — | ✅ |
| 4 | Вход в систему | `AccountsService.login` → `passwords.verify` (argon2id) → `SessionService.issue` (JWT + `UserSession+jti` запись) → cookie `z_session` (httpOnly, sameSite=lax, TTL `auth.sessionTtlSeconds`) | `backend/src/modules/accounts/accounts.controller.ts:84..109`, `backend/src/modules/accounts/accounts.service.ts:219..256`, `frontend/app/login/LoginForm.tsx` | `POST /api/v1/accounts/login` (throttle 5/15 мин) | `UserSession` | ✅ |
| 5 | Форсированная смена пароля | Клиентский guard в `AuthenticatedShell.tsx`: если `mustChangePassword=true` и путь не `/onboarding/*` — `router.replace('/onboarding/change-password')`; backend — `AccountsService.changePassword` (отзывает остальные сессии через `SessionService.revokeAllExcept(currentJti)`) | `frontend/app/(authenticated)/AuthenticatedShell.tsx:35..55`, `frontend/app/(authenticated)/onboarding/change-password/OnboardingChangePasswordForm.tsx`, `backend/src/modules/accounts/accounts.service.ts:570..596` | `POST /api/v1/accounts/me/change-password` | `User.passwordHash`, `User.mustChangePassword=false`, revoke `UserSession.revokedAt` | ✅ |
| 6 | Экскурсия «Знакомство с компанией» (Блок A, 6 шагов) | Клиентский guard в `AuthenticatedShell` (строка 51): `if (!profileCompletedAt && !isOnboardingPath && !isSuperAdmin) → /onboarding/welcome/step-1`; шаги PATCH'ат `Org.{industry,teamSize,painPoints,currentStack,plannedFeatures}` и `User.companyRole` через `OnboardingService.patchWelcome`; на шаге 1 ставится `companyInfoCompletedAt` (по факту первого `industry`) | `frontend/app/(authenticated)/onboarding/welcome/step-{1..6}/page.tsx`, `frontend/app/(authenticated)/onboarding/welcome/OnboardingShell.tsx`, `backend/src/modules/onboarding/onboarding.service.ts:30..55`, `backend/src/modules/onboarding/onboarding.controller.ts:52..64` | `PATCH /api/v1/orgs/:orgId/welcome` + `PATCH /api/v1/users/me` | `Org`, `User.companyRole` | ✅ |
| 7 | Завершение Блока A + создание документа | `OnboardingService.completeWelcome`: ищет `Person(userId=current)`, собирает markdown по шаблону `buildWelcomeDocument` (компания + сфера + размер + боли + стек + интересы), пишет `Document(kind='text', name='Знакомство с компанией')` если Person есть, в одной `$transaction` ставит `Org.welcomeCompletedAt` + `User.profileCompletedAt`; возвращает `{ redirectTo: '/dashboard' }` | `backend/src/modules/onboarding/onboarding.service.ts:58..124`, `backend/src/modules/onboarding/onboarding.controller.ts:66..80`, `frontend/app/(authenticated)/onboarding/welcome/step-6/page.tsx:36..47` | `POST /api/v1/orgs/:orgId/welcome/complete` | `Document`, `Org.welcomeCompletedAt`, `User.profileCompletedAt` | ✅ |
| 8 | Переход на `/dashboard` | Прямой `router.push('/dashboard')` после `completeWelcome`; единый стартовый экран независимо от роли; **отдельной landing-page по роли нет** | `frontend/app/(authenticated)/onboarding/welcome/step-6/page.tsx:43`, `frontend/app/(authenticated)/dashboard/page.tsx` | redirect | — | ⚠️ частично — нет дифференциации landing по роли |
| 9 | Опциональный мастер «структура компании» (Блок B, 5 шагов) | `/onboarding/company/step-1..5` — отделы → должности → сотрудники → должностные инструкции → готово; гард в `WizardShell.tsx`: только owner, на step-1 редиректит на `/dashboard` если `Department.count > 0`; **AppShell не скрыт системно** (контролируется только наличием отдельного layout); **не форсируется** — пользователь должен сам зайти по ссылке | `frontend/app/(authenticated)/onboarding/company/{step-1..5}/{page,Step{N}Client}.tsx`, `frontend/app/(authenticated)/onboarding/company/WizardShell.tsx:37..141` | `POST /api/v1/departments`, `POST /api/v1/roles`, `POST /api/v1/persons`, `POST /api/v1/documents` | `Department`, `Role`, `Person`, `Document` | ⚠️ частично — не запускается forced, нет точки входа |
| 10 | RoleProfileAgent — автопостроение карт должностей | Cron `0 */4 * * *` метит `RoleProfile` `forming/stale` → enqueue в очередь `core.role-profile` (BullMQ, concurrency=1); воркер дёргает `RoleProfileService.build`, который тянет ≥5 связанных IdeaBlock'ов, дёргает LLM (DeepSeek primary), пишет результат с `buildVersion`; второй cron `0 * * * *` метит `ready` профили как `stale` если в графе новые блоки; идемпотентность через jobId `role_profile_<roleId>_v<buildVersion>` | `backend/src/modules/knowledge-core/workers/role-profile.cron.ts`, `backend/src/modules/knowledge-core/workers/role-profile.worker.ts`, `backend/src/modules/role-profiles/services/role-profile.service.ts` | cron `0 */4 * * *` + `0 * * * *`, очередь `core.role-profile` | `RoleProfile` | ✅ |

### 5.1 Структура данных, через которые проходит процесс

```
POST /accounts/register
  ↓ prisma.$transaction
User(signupSource='standalone', mustChangePassword=true, signupRef?, consent*)
  + Org(ownerId, tier='basic', slug)
  + Membership(role='owner')
  + Source(type='meeting', name='Встречи Z')
  + Subscription(status='DEMO') + SubscriptionEvent('created')
  ↓ MailService.sendTempPassword
SMTP mail.hosting.reg.ru → noreply@crossmark.ru
  ↓ POST /accounts/login → cookie z_session (JWT+jti)
UserSession(userId, jti)
  ↓ AuthenticatedShell guard: mustChangePassword → /onboarding/change-password
POST /accounts/me/change-password → User.mustChangePassword=false + revoke other sessions
  ↓ AuthenticatedShell guard: !profileCompletedAt → /onboarding/welcome/step-1
PATCH /orgs/:orgId/welcome × 6 → Org.{industry, teamSize, painPoints, currentStack, plannedFeatures}
PATCH /users/me                  → User.companyRole
  ↓ POST /orgs/:orgId/welcome/complete
Document(kind='text', name='Знакомство с компанией') + Org.welcomeCompletedAt + User.profileCompletedAt
  ↓ router.push('/dashboard')
  ⋮ (asynch) cron role-profile.cron.builds (раз в 4 часа) — для каждой Role при ≥N IdeaBlock'ов
RoleProfile(status='ready')
```

### 5.2 LLM-вызовы внутри процесса

| Шаг | taskType | Primary модель | Фолбэк | Где промпт |
|---|---|---|---|---|
| 10 | `role-profile-build` | DeepSeek V4 Pro | OpenAI gpt-5.4 → Ollama qwen3.5:9b | `backend/src/modules/knowledge-core/prompts/role-profile-build.prompt.ts` |

(Шаги 1–9 — без LLM, чистая бизнес-логика.)

## 6. Точки отказа и наблюдаемость

**Prometheus метрики (`BusinessMetricsService`):**
- `magic_link_request_total{outcome}` — magic-link через email (Phase β-9)
- `magic_link_consume_total{outcome}` — прожигание magic-link
- `invite_accepted_total{path}` — принятие приглашений (`magic_link|password|telegram_first`)
- `invite_created_total{has_email}`, `invite_reminder_sent_total{day}`, `invite_expired_total`
- `bot_login_command_total{outcome}` — `/login` через Telegram-бот

**Метрик регистрации (`/accounts/register`) и шагов онбординга НЕТ** — это пробел.

**BullMQ очереди:**
- `core.role-profile` — построение карт должностей (для шага 10).

**Тумблеры:**
- Throttle: `@Throttle({ default: { limit: 5, ttl: 900_000 } })` на `/accounts/register`, `/login`, `/password/forgot`; `{ limit: 3, ttl: 900_000 }` на `/password/reset`.
- Defensive ENV: `auth.sessionTtlSeconds`, `auth.cookieDomain`, `invites.magicLinkTtlMinutes`, `invites.magicLinkRateLimitPerHour`.

**Логи:** `AccountsService`, `OnboardingService`, `WizardShell` (frontend через toast).

**Известные грабли:**
- Гард `mustChangePassword` стоит **только на frontend** (`AuthenticatedShell`) — backend сам по себе не запрещает использовать API с истёкшим временным паролем (кроме самого `/change-password`, который требует знать `currentPassword`). Для большинства endpoint'ов это не критично, но это нужно держать в голове.
- Гард `!profileCompletedAt` тоже клиентский — backend не блокирует `/api/v1/*` для непрошедших Блок A. Это компромисс, не дыра.
- `User.profileCompletedAt` ставится **только** в `OnboardingService.completeWelcome` — поэтому пользователь, который вошёл, но НЕ дошёл до шага 6, при следующем входе снова попадёт на welcome/step-1 (с сохранёнными ответами в `Org.*`).
- Старая страница `/settings/billing` показывает entitlements (legacy QuotaService), не новый billing с `tier_standard` — это создаёт путаницу UX (см. также [[billing-cycle-tochka]] раздел 8).

**Кнопки админки:**
- Принудительное завершение онбординга: `POST /api/v1/orgs/:orgId/setup/complete` (требует owner/admin/super_admin).
- Семя демо-данных (опционально): `POST /api/v1/orgs/:orgId/demo-workspace` — наполняет Org «ТехноСтримом».

## 7. Связанные процессы

- [[billing-cycle-tochka]] — следует за завершением онбординга: после `profileCompletedAt` владелец может выбрать тариф и оплатить подписку. Связь через факт владения Org (запись в `Subscription` уже создана со статусом `DEMO` на шаге 2).
- [[referral-program]] — `signupRef` из URL сохраняется в `User.signupRef` на шаге 2, а beacon атрибуция (если был переход по `?ref=`) — в `ReferralAttribution`; реальная активация партнёрской ссылки происходит **только** при первой `paid` оплате (см. [[billing-cycle-tochka]] и [[referral-program]]).
- [[notification-dispatch]] — общий dispatcher для письма с временным паролем (шаг 3) и magic-link (шаги поверх `accounts.requestMagicLink`).
- [[specialist-gamma-1-skill-clone]] — Role-Profile агент из шага 10 — это базовый слой клонов должностей (Skill Profile + ExecutablePersona).

## 8. Расхождения «задумано vs реализовано»

**Заложено в ТЗ — реализовано иначе:**
- В `01_projects/onboarding-wizard.md` описан **5-шаговый wizard «Знакомство с компанией»** для owner с принудительным запуском (AppShell скрыт, гарды по `Department.count`). В реальном коде это две разные сущности:
  - **Блок A — экскурсия `/onboarding/welcome/step-1..6`** (6 шагов: companyRole/industry/teamSize/painPoints/currentStack/plannedFeatures) — это и есть реальный «forced onboarding», запускается клиентским гардом по `!profileCompletedAt`. Создаёт документ «Знакомство с компанией» в библиотеке.
  - **Блок B — мастер `/onboarding/company/step-1..5`** (отделы/должности/сотрудники/инструкции) — это и есть «5-шаговый wizard» из задумки. Но **не форсируется**, в `AuthenticatedShell` нет редиректа на него, и в текущем UI нет точки входа.
  Поэтому slug `signup-and-onboarding-wizard` описывает **полный** flow, объединяя оба блока. `01_projects/onboarding-wizard.md` нужно осовременить.

**Заложено в ТЗ, но не реализовано:**
- **Default landing page по роли** (упомянуто в задаче): сейчас все попадают на `/dashboard` независимо от роли (owner/admin/coo/manager). По продуктовой задумке у каждой роли свой стартовый экран.
- **Backend-валидация `profileCompletedAt` для защищённых эндпоинтов** — сейчас гард только клиентский (`AuthenticatedShell`).
- **Гард `Department.count === 0` для Блока B** есть только на step-1; на step-2..5 проверки нет, иначе после первого создания отдела wizard сразу выкидывал бы наружу (см. комментарий в `WizardShell.tsx:60..73`).

**Реализовано, но не описано в ТЗ:**
- **Honeypot `hp_field` и lead-style регистрация** (12-символьный временный пароль по почте вместо «выбора пароля» на форме) — продуктовое решение в коде, в задумке не отражено.
- **`Subscription(status='DEMO')` создаётся сразу при регистрации Org** — это нужно для `SubscriptionGuard` paywall'а (см. plans/archive/2026-05-28-paywall-no-trial.md).
- **`Source(type='meeting', name='Встречи Z')` создаётся в той же транзакции** — нужно для knowledge-core ingest pipeline.
- **Магик-линк для входа без пароля** (`POST /accounts/magic-link/request|consume`) — Phase β-9, заодно используется для Telegram-бот команды `/login`.
- **Семя демо-данных «ТехноСтрим»** через `POST /orgs/:orgId/demo-workspace` — опциональный «полный воркспейс» для демонстрации возможностей.

**Связи с другими процессами:**
- Backend хук «после регистрации запускается RoleProfileAgent» — **на самом деле нет**: агент запускается своим cron'ом `0 */4 * * *` независимо от регистрации; первый запуск для новой Org произойдёт в течение 4 часов после того, как в Role появятся ≥5 IdeaBlock'ов. Это значит, что в первые часы/дни у новой Org карт должностей нет вообще — это нормально, не баг.

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-29 | Карточка создана | этот документ |
| 2026-05-27 | β-10: magic-link без email + setInitialPassword | `accounts.service.ts:setInitialPassword` |
| 2026-05-25 | β-9: magic-link через email + Telegram-бот /login | `accounts.service.ts:requestMagicLink*` |
| 2026-05-21 | Phase 0c: 5-шаговый wizard «структура компании» (Блок B) | plans/archive/2026-05-21-phase-0c-onboarding-wizard-frontend.md |
| 2026-05-21 | Phase 0d: RoleProfileAgent (cron + worker) | plans/archive/2026-05-21-phase-0d-role-profile-agent.md |
