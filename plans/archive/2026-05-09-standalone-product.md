---
type: tz
status: done
feature: standalone-product
date: 2026-05-09
---

# ТЗ: Standalone-режим Z (свой кабинет, регистрация, дизайн-система)

> Базовое ТЗ MVP: `plans/tz/2026-05-08-mvp-fullstack-tz.md` (Фазы 0–9 закрыты)
> Архитектура: `plans/architecture/2026-05-08-z-architecture.md`

## Цель

Сделать Z самостоятельным продуктом, в который пользователь может зарегистрироваться без Crossmark, войти в личный кабинет с журналом своих встреч и создать встречу — при сохранении уже работающего Crossmark-flow и админки. Внешний вид — единая дизайн-система «строгий бизнес» на shadcn/ui.

## Scope

**Входит:**
- Lead-style регистрация: пользователь оставляет name + email, бэкенд генерирует временный пароль и присылает его на почту (proof-of-ownership = получение письма).
- Логин / выход / forced-смена-пароля при первом входе / восстановление пароля для конечных пользователей (отдельный поток от admin-login).
- Личный кабинет = AppShell с боковой навигацией (sidebar) и заголовком (header).
- Журнал встреч в master-detail (слева список с группировкой и фильтрами, справа карточка отчёта; URL-синхронизация).
- Страница профиля и смены пароля.
- Дизайн-система на shadcn/ui + bespoke-токены (цвета, типографика, отступы, радиусы, тени).
- Замена существующих ad-hoc Tailwind-страниц на компоненты из системы.
- Free-тариф по умолчанию (биллинг и платная подписка — вне scope).
- Проверка disposable-email на free (опционально, в одной фазе с регистрацией).

**Не входит:**
- Magic-link / OAuth (Yandex ID, Google) — отдельным ТЗ позже.
- OTP-подтверждение email на этапе регистрации (proof-of-ownership уже обеспечен временным паролем в письме).
- UTM-захват, реферальные коды, промо-плашки, партнёрские ссылки (специфика Crossmark, нам не нужно в MVP).
- Companies / CompanyProfile / роль `company` (у Z по-прежнему просто `User` с ролью `user`/`admin`).
- Биллинг, тарифы, лимиты, подписки.
- Команды / организации / приглашения внутри Z.
- Двухфакторная аутентификация и login-verification (OTP при подозрительных входах) — позже.
- Календарь / расписание (запланированные встречи в смысле «через 3 дня»).
- Перенос Crossmark-flow на standalone-учётки (lazy provisioning остаётся как есть).

## Технические изменения

### Backend

**Новый модуль `accounts` (отдельно от `auth`, который покрывает три потока MVP):**
- `POST /api/v1/accounts/register` (без авторизации) — `{ email, name }` → lead-style:
  - нормализуем email (`trim().toLowerCase()`);
  - если на free и почта в disposable-списке (`DisposableEmailService`) → 400 `disposable_email_blocked`;
  - генерируем временный пароль (12 символов из `crypto.randomBytes(9).toString('base64url')`), хешируем `argon2id`;
  - если пользователь с таким `(email, signupSource='standalone')` уже существует — обновляем `passwordHash`, ставим `mustChangePassword=true`, **НЕ создаём дубликат**;
  - иначе создаём нового `User` (`role='user'`, `signupSource='standalone'`, `passwordHash`, `mustChangePassword=true`);
  - отправляем письмо с темой «Доступ в Z» и телом: логин (= email), временный пароль, ссылка `${PUBLIC_FRONTEND_URL}/login`;
  - ответ: `{ status: 'ok', email_sent: true, email_error?: string }` (не палим, существовал ли пользователь до этого).
- `POST /api/v1/accounts/login` — `{ email, password }` → проверяет хеш, создаёт `UserSession`, выдаёт `z_session` cookie с `Domain=meet.crossmark.ru` (узко — в отличие от Crossmark deep-link обмена, у которого cookie ставится на `.crossmark.ru`). В ответе — `{ user: {...}, mustChangePassword: bool }`. **Логин разрешён даже при `mustChangePassword=true`** — фронт сам форсирует смену пароля до доступа к остальным разделам.
- `POST /api/v1/accounts/logout` — отзывает `UserSession.revokedAt`, чистит cookie.
- `POST /api/v1/accounts/password/forgot` — `{ email }` → если пользователь существует и у него `signupSource='standalone'`, создаём `UserVerificationToken(purpose=password_reset)`, шлём ссылку. Всегда возвращаем `{ ok: true }` независимо от существования email.
- `POST /api/v1/accounts/password/reset` — `{ token, newPassword }` → меняет пароль, отзывает все активные `UserSession` пользователя, помечает токен `usedAt`. Сбрасывает `mustChangePassword=false`.
- `GET /api/v1/accounts/me` — текущий профиль из cookie + флаг `mustChangePassword`.
- `PATCH /api/v1/accounts/me` — `{ name }`.
- `POST /api/v1/accounts/me/change-password` — `{ currentPassword, newPassword }` → сверяет текущий пароль, меняет, сбрасывает `mustChangePassword=false`. Все остальные сессии этого пользователя отзываются (текущая остаётся).

**Изменения в существующих:**
- `CookieAuthGuard`: после расшифровки JWT доп. проверка `UserSession.revokedAt is null`. Поле `emailVerifiedAt` НЕ проверяется (его нет — proof через получение временного пароля).
- `MeetingsService.getMeetingForUser` уже работает по `userId` — отдельных правок не нужно.
- `GET /api/v1/meetings` расширяем: фильтр `query` (поиск по title), `dateFrom/dateTo`, `status[]`, `type[]`. Сейчас там простая пагинация.

**Хеширование пароля:** `argon2id` (через `argon2` пакет). Параметры — стандартные OWASP defaults; выносим в `env.security.argonMemoryKb/iterations/parallelism`.

**Email-провайдер:** `nodemailer` поверх готового SMTP `mail.hosting.reg.ru:465 SSL` (`noreply@crossmark.ru`). Параметры из ENV: `MAIL_HOST`, `MAIL_PORT`, `MAIL_SSL`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM` — мапим на наш `TypedConfigService`. На dev — тот же SMTP с тестовым адресом, либо MailHog (выбор по `MAIL_HOST`).

`MailService` с двумя шаблонами:
- `register-temp-password.hbs` (тема: «Доступ в Z», тело: логин, временный пароль, CTA на `/login`);
- `password-reset.hbs` (тема: «Сброс пароля Z», тело: ссылка `${PUBLIC_FRONTEND_URL}/reset-password?token=...`).

**Rate-limiting:** на `/register`, `/login`, `/password/forgot` — `Throttler` 5 попыток в 15 минут на IP. На `/password/reset` — 3 попытки в 15 минут на IP+email.

**Защита от регистрации ботов:** на старте — простой honeypot-field в форме + минимальная проверка времени заполнения. Captcha не вводим (можно докинуть позже).

### База данных

Изменения в `User`:
- `passwordHash String?` (nullable: у Crossmark-провижененных пользователей пароля нет).
- `mustChangePassword Boolean @default(false)` — поднимается при регистрации (приходит временный пароль) и при reset через partner-восстановление; сбрасывается на `change-password` или `password/reset`.
- `signupSource UserSignupSource @default(crossmark)` — enum `{ crossmark, standalone }`.
- Снимаем существующий `@@unique` на `email` и заменяем на `@@unique([email, signupSource])` — позволяет один и тот же email одновременно у Crossmark-юзера и standalone-юзера. Кросс-учёток в MVP не делаем — это страховка от падения апдейтов.

Новые таблицы:
```prisma
model UserVerificationToken {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash   String   @unique          // sha256 от случайного токена; в письме — сам токен
  purpose     VerificationPurpose       // в MVP — только password_reset
  expiresAt   DateTime
  usedAt      DateTime?
  createdAt   DateTime @default(now())
  @@index([userId, purpose])
}

enum VerificationPurpose { password_reset }

model UserSession {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  jti         String   @unique          // session-id внутри JWT, для глобальной инвалидации
  userAgent   String?
  ip          String?
  createdAt   DateTime @default(now())
  expiresAt   DateTime
  revokedAt   DateTime?
  @@index([userId, revokedAt])
}
```

`UserSession` нужен, чтобы после смены пароля можно было пометить все старые сессии revoked и они перестали приниматься, даже если cookie ещё не истекло.

`CookieAuthGuard` после изменения: проверяет JWT-подпись + `UserSession.revokedAt is null`.

Применение через `bunx prisma db push` — никаких migrate (правило проекта).

### Frontend

**Дизайн-система (shadcn/ui + bespoke токены):**
- `bunx shadcn@latest init` (выбираем neutral colour-base, RSC-совместимый stack).
- В `frontend/src/ui/tokens.css` — CSS-переменные: brand colours (primary/secondary/accent/danger/warning/success), neutral scale, semantic (background, foreground, muted, border, ring), typography scale, spacing scale, radius scale, shadow scale.
- Через скилл `frontend-design` сформировать визуальную идентичность Z (логотип временно текстовый, цвета — определяет дизайн-эталон, который согласуем на одной странице).
- Подключить shadcn-компоненты: `button`, `input`, `label`, `form`, `dialog`, `dropdown-menu`, `select`, `tabs`, `toast`, `tooltip`, `avatar`, `badge`, `card`, `separator`, `sheet`, `command` (для поиска), `table`, `calendar`, `popover`.
- Заменить `frontend/src/ui/components/shared/Button.tsx`, `Modal.tsx`, `EmptyState.tsx`, `ErrorState.tsx`, `Skeleton.tsx` на компоненты shadcn (или адаптеры поверх них).

**Новый AppShell:**
- `frontend/src/ui/components/app-shell/AppShell.tsx` — `<Sidebar /> + <Header /> + <main />`.
- `Sidebar`: лого Z, навигация:
  - «Создать встречу» (CTA-кнопка сверху)
  - «Мои встречи» (`/meetings`)
  - «Настройки» (`/settings`)
  - «Интеграции» (`/integrations`) — видна, только если у пользователя есть API-ключи Crossmark (для админов и партнёров; в MVP standalone — пусть просто скрыта без выделения).
  - в самом низу — карточка пользователя с dropdown «Профиль / Сменить пароль / Выйти».
- `Header`: на десктопе свернётся; на мобилке — burger-меню для sidebar (через shadcn `Sheet`).
- Layout `(authenticated)/layout.tsx` оборачивает все защищённые страницы в AppShell.

**Новые страницы:**
- `/signup` — форма «Имя + Email» + honeypot-поле + чекбокс согласия. Submit → POST `/api/v1/accounts/register` → success-state «Письмо с временным паролем отправлено на {email}. Откройте его и вернитесь сюда для входа». Без редиректа в кабинет (мы пока не залогинены).
- `/login` — публичный логин для пользователей (только `role='user'`). Если по этому email уже существует `role='admin'` — отдаём 401 «неверный пароль» (не палим существование админ-аккаунта). Админы продолжают логиниться через **отдельную** страницу `/admin/login` (как сейчас) — она остаётся как есть.
- `/onboarding/change-password` — экран принудительной смены пароля. Доступен только аутентифицированному юзеру с `mustChangePassword=true`. До успеха другие защищённые страницы перекрываются.
- `/forgot-password`, `/reset-password?token=...`.
- `/meetings` — переделать в master-detail.
- `/settings` — профиль + смена пароля (для добровольной смены, не принудительной).
- (опционально) `/integrations` — список API-ключей Crossmark.

**Изменения существующих:**
- `frontend/app/page.tsx` (главная) — лендинг для незалогиненных + CTA «Создать встречу» / «Войти»; для залогиненных редиректит на `/meetings`.
- `frontend/app/(authenticated)/meetings/page.tsx` — master-detail layout.
- `frontend/src/ui/components/meetings-list/MeetingsTable.tsx` — преобразовать в `MeetingsList` (вертикальный список карточек с группировкой «Сегодня / На неделе / Ранее») + рядом `MeetingDetailPane.tsx`.
- `frontend/middleware.ts` — добавить публичные роуты (`/`, `/login`, `/signup`, `/forgot-password`, `/reset-password`).
- `frontend/src/contexts/auth-context.tsx` — расширить под новые поля (`mustChangePassword`, `signupSource`). Если `mustChangePassword=true` и текущий путь не `/onboarding/change-password` и не `/login`/`/logout` — форсированный редирект на `/onboarding/change-password` (через провайдер на корне `(authenticated)/layout.tsx`).

### Интеграции

- **SMTP** — `mail.hosting.reg.ru:465 SSL`, `noreply@crossmark.ru` (параметры в `.env`: `MAIL_HOST`, `MAIL_PORT`, `MAIL_SSL`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM`). На dev можно держать тот же reg.ru с тестовым адресом или поднять MailHog (`MAIL_HOST=mailhog`).
- shadcn/ui — внешняя зависимость на этапе scaffolding (компоненты копируются в наш репозиторий).

## Критерии готовности (DoD)

- [ ] Незалогиненный пользователь может оставить «Имя + Email», получить письмо с временным паролем, войти, сменить пароль, создать встречу, увидеть её в журнале — без какого-либо участия Crossmark.
- [ ] Письмо приходит с реального SMTP `mail.hosting.reg.ru` (тема, отправитель, ссылка на `/login`, читаемый текст с временным паролем).
- [ ] До смены пароля пользователь не может попасть никуда, кроме `/onboarding/change-password` и `/logout`.
- [ ] Восстановление пароля работает. После reset все старые сессии этого пользователя перестают приниматься.
- [ ] Crossmark-flow продолжает работать без изменений (deep-link, гостевой вход — регрессии нет).
- [ ] Журнал встреч на `/meetings` работает в master-detail, URL-параметр `?selected=<id>` восстанавливается при перезагрузке.
- [ ] Все защищённые страницы рендерятся внутри AppShell с sidebar.
- [ ] Все интерактивные элементы перешли на компоненты shadcn (нет голых `<button className="...">` в новом коде).
- [ ] `bun run typecheck` и `bun run test:unit` зелёные.
- [ ] Smoke-test: ручной чек-лист пройден (см. Фаза 7).
- [ ] Second Brain обновлён: `02_architecture/data-model.md`, `01_projects/api-layer.md`, `01_projects/frontend-pages.md` (создать), `01_projects/auth-and-accounts.md` (создать).

## Риски и ограничения

- **Email-доставка через `mail.hosting.reg.ru`** — у reg.ru известны жёсткие лимиты на отправку с не-крупных тарифов. Если упрёмся в throttle — заменим SMTP на отдельный транзакционный (Yandex Postmaster / SendPulse) без переписывания кода (только ENV).
- **Спам-фильтры на временный пароль в теле письма.** Пароли в тексте письма часто триггерят антиспам. Митигация: (а) однозначный From `noreply@crossmark.ru` с настроенными SPF/DKIM/DMARC; (б) тема без слов «password», на русском «Доступ в Z»; (в) тело без подозрительных ссылок, только наша.
- **Разделение admin- и user-логина.** Решение: оставляем `/admin/login` отдельной страницей для админов (как сейчас). Публичный `/login` — только для `role='user'`. Если по введённому email существует только админ-аккаунт — отдаём то же сообщение «неверный логин или пароль», чтобы не палить наличие админ-учёток через публичную форму.
- **Cookie-домен.** У cookie `z_session` две ветки выставления:
  - standalone-логин → `Domain=meet.crossmark.ru` (узко, чтобы сузить поверхность атаки: XSS на других поддоменах `crossmark.ru` не сможет украсть нашу сессию);
  - Crossmark deep-link обмен → `Domain=.crossmark.ru` (как сейчас — это часть Crossmark-сценария).
  Имя cookie одно (`z_session`), браузер различает версии по `Domain` и шлёт ту, чей домен включает текущий хост. Сервер читает любую из них.
- **Дизайн-эталон.** Пока не утверждена эталонная страница — остальные не делаем (иначе придётся переделывать). Это блокирующая зависимость для Фаз 4–6.
- **Ленивое провижение Crossmark-юзеров.** Если такой юзер позже захочет «зарегистрироваться» в standalone тем же email — мы создаём вторую учётку (`signupSource='standalone'`); UX-вопрос «как объединить» оставляем на отдельный план.
- **Disposable-email список** статичен (in-memory снимок популярных доменов). Свежие домены могут проходить — это осознанная цена против внешней зависимости от платных API.

## Фазы реализации

- [x] **Фаза 1 — Дизайн-система и AppShell**
  - shadcn/ui init, токены через скилл `frontend-design`.
  - AppShell (Sidebar + Header), единый layout `(authenticated)/`.
  - Эталонная страница: журнал встреч (master-detail) — на ней утверждаем стиль.
  - Замена общих primitives (`Button`, `Modal`, `EmptyState`, `ErrorState`, `Skeleton`).

- [x] **Фаза 2 — Backend: accounts-модуль и схема БД**
  - Изменения `User` (`passwordHash`, `mustChangePassword`, `signupSource`) + новые таблицы `UserVerificationToken`, `UserSession`.
  - Endpoints register (lead-style) / login / logout / forgot / reset / me / change-password.
  - `MailService` поверх `nodemailer` + SMTP `mail.hosting.reg.ru`. Шаблоны `register-temp-password`, `password-reset`.
  - `DisposableEmailService` (in-memory список).
  - Throttler на `/register`, `/login`, `/password/forgot`, `/password/reset`.
  - Юнит и e2e тесты (реальный SMTP в e2e не дёргаем — мокаем `MailService`).

- [x] **Фаза 3 — Frontend: auth-страницы и forced-onboarding**
  - `/signup`, `/login` (единый для user и admin), `/forgot-password`, `/reset-password`.
  - `/onboarding/change-password` + guard в `(authenticated)/layout.tsx`: если `mustChangePassword=true` — форсированно редиректим сюда.
  - Перевод `auth-context` на новые поля (`mustChangePassword`, `signupSource`).
  - Обновление `middleware.ts` (публичные роуты).
  - Уведомления (тосты) на ошибках/успехах.

- [x] **Фаза 4 — Журнал встреч (master-detail)**
  - Переработка `/meetings` в двухколоночный layout.
  - Группировка («Сегодня / На неделе / Ранее»), фильтры (тип, статус, диапазон дат, поиск по title).
  - URL-sync `?selected=<id>`.
  - `MeetingDetailPane` (preview отчёта, кнопки скачать/открыть полную страницу).
  - Backend: расширение `GET /api/v1/meetings` под фильтры.

- [x] **Фаза 5 — Кабинет: настройки и интеграции**
  - `/settings` (профиль + смена пароля).
  - `/integrations` (только если есть API-ключи) — переиспользует админский `IntegrationKeysTable`, режим read-only.

- [x] **Фаза 6 — Главная и онбординг**
  - `/` — лендинг для гостей с CTA, редирект для залогиненных.
  - Создание встречи (`/meetings/create`) — адаптация под новый shell, кнопка «Скопировать ссылку» после создания.

- [x] **Фаза 7 — Регрессии, доки, smoke-test**
  - Crossmark-flow (deep-link → cookie → /m/[id]) — ручной прогон.
  - Гостевой вход — ручной прогон.
  - Admin-login и админка — ручной прогон.
  - Обновление second-brain (`api-layer`, `data-model`, новые `auth-and-accounts`, `frontend-pages`).
  - Чек-лист релиза в README ТЗ ниже.

## Чек-лист smoke-test (Фаза 7)

- [ ] Регистрация (имя+email) → письмо доехало с `noreply@crossmark.ru` (не в спам) → логин по временному паролю → форсированная смена пароля → создание встречи → встреча появилась в журнале.
- [ ] Регистрация на одноразовый email (`mailinator.com` и т.п.) на free → 400 `disposable_email_blocked`.
- [ ] Logout → cookie удалён → защищённые страницы редиректят на `/login`.
- [ ] Forgot password → письмо со ссылкой → reset → старая сессия в другой вкладке отвалилась с 401.
- [ ] Crossmark API создаёт встречу → deep-link открывается в новой вкладке → cookie ставится → встреча видна.
- [ ] Гость по ссылке `/m/<id>` вводит имя → попадает в комнату.
- [ ] Admin логинится по тому же `/login` → редирект на `/admin`.
- [ ] Все ключевые страницы (signup, login, change-password, journal, settings, meeting room) выглядят согласованно по дизайн-системе.

## Итог

_Заполняется по факту: реализовано целиком или нет, что осталось._

## Ревизия от 2026-05-24

**Статус:** done
**Реализовано:**
- Модуль accounts с полным набором: `backend/src/modules/accounts/{accounts.controller,accounts.service,password.service,session.service,accounts.repository}.ts` + DTO (register / login / forgot-password / reset-password / change-password / update-profile).
- Lead-style регистрация с временным паролем (argon2id), forced password change, восстановление пароля через `UserVerificationToken`, сессии через `UserSession.revokedAt`.
- SMTP через `nodemailer` + шаблоны писем (включая `register-temp-password`, `password-reset`).
- Дизайн-система shadcn/ui + AppShell (Sidebar + Header) — `frontend/src/ui/components/app-shell/*`.
- Все auth-страницы: `frontend/app/signup`, `/login`, `/forgot-password`, `/reset-password`, `/(authenticated)/onboarding/change-password`.
- Журнал встреч в master-detail с фильтрами/поиском/тегами + меню `/settings` — `frontend/app/(authenticated)/meetings/page.tsx`, `frontend/app/(authenticated)/settings/page.tsx`.
- Crossmark-flow и гостевой вход (`/m/[id]`) сохранены и работают.
- Onboarding company-wizard (5 шагов) — выходит за рамки этого ТЗ, добавлен позже (`frontend/app/(authenticated)/onboarding/company/step-1..5`).
