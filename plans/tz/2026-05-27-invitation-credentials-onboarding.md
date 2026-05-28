# ТЗ: Credentials-onboarding при приглашении сотрудника

**Дата:** 2026-05-27  
**Статус:** `[ ]` в работе  
**Ветка:** `feat/invitation-credentials-onboarding`

---

## Проблема

Сейчас, когда директор приглашает сотрудника по email:
1. Письмо содержит только magic-link («войти одним кликом»).
2. Сотрудник кликает → система автоматически логинит его.
3. **Сотрудник не знает:** ни что является его логином, ни что является паролем.
4. `mustChangePassword: false` → страница смены пароля не показывается.
5. Для повторного входа: нужен сброс пароля, потому что temp-пароль был сгенерирован внутри, не показан.

**Что нужно:** сотрудник получает письмо, в котором явно написано:
- «Ваш логин: your@email.com»
- «Ваш одноразовый пароль: Abc1Xyz2Qrs3»
- Кнопка / ссылка для входа на страницу `/login`
- Подсказка: «после первого входа система попросит сменить пароль»

---

## Ключевые принципы

- Одноразовый пароль генерируется **при создании приглашения** (не при принятии).
- Пароль — человекочитаемый: base64url от 9 байт = 12 символов без лишних знаков, 
  удобно скопировать из письма или ввести с телефона.
- `mustChangePassword: true` для всех аккаунтов, созданных через invitation.
- Magic-link сохраняется как **вторичный** способ: «или войдите одним кликом».
- Приглашения **без email** (линейный персонал) — отдельный упрощённый флоу 
  (фаза 2 ниже): magic link + страница установки пароля без старого пароля.

---

## Фазы

### Фаза 1: Schema — поле `tempPasswordHash` в `OrgInvitation`

**Файл:** `backend/prisma/schema.prisma`

Добавить поле в модель `OrgInvitation` после `magicTokenUsedAt`:

```prisma
/// β-10 (2026-05-27) — sha256(tempPassword) для credentials-onboarding.
/// tempPassword генерируется при создании приглашения и включается в письмо
/// (login + one-time password). Используется при acceptViaMagicLink для
/// создания аккаунта с известным паролем → mustChangePassword=true.
/// NULL для legacy-приглашений до β-10 (у них нет temp-пароля в письме).
tempPasswordHash   String?
```

Команда: `bun run prisma:push` из `backend/`.

- [x] Фаза 1 завершена

---

### Фаза 2: Backend — генерация temp-пароля при создании приглашения

**Файл:** `backend/src/modules/orgs/org-invitations.service.ts`

#### 2а. `createInvitation`

В методе `createInvitation`, после генерации `magicToken`:

```ts
// β-10: temp-пароль для credentials-onboarding.
// Генерируем только если есть email (линейный персонал без почты → не нужен).
const tempPassword = normalizedEmail
  ? AccountsService.generateTempPassword()
  : null;
const tempPasswordHash = tempPassword ? sha256Hex(tempPassword) : null;
```

Добавить `tempPasswordHash` в `prisma.orgInvitation.create`:
```ts
data: {
  // ...существующие поля...
  tempPasswordHash,
},
```

Изменить вызов `sendInviteGithubStyle` — передать `tempPassword` (или `null`):

```ts
if (normalizedEmail) {
  await this.mail.sendInviteWithCredentials({
    to: normalizedEmail,
    name: displayName,
    inviterName: invitation.inviter?.name ?? 'Руководитель',
    orgName: invitation.org.name,
    loginEmail: normalizedEmail,
    tempPassword: tempPassword!, // не null, т.к. normalizedEmail есть
    loginUrl: this.buildLoginUrl(),
    magicLinkUrl,           // вторичный способ
    telegramDeepLink,
    ttlDays,
  });
}
```

Добавить helper:
```ts
private buildLoginUrl(): string {
  const base = this.cfg.auth.publicFrontendUrl.replace(/\/+$/, '');
  return `${base}/login`;
}
```

#### 2б. `resendInvitation`

При перевыпуске — регенерировать `tempPassword` вместе с `magicToken`:

```ts
const tempPassword = updated.email ? AccountsService.generateTempPassword() : null;
const tempPasswordHash = tempPassword ? sha256Hex(tempPassword) : null;
```

Добавить в `prisma.orgInvitation.update`:
```ts
data: {
  // ...существующие поля...
  tempPasswordHash: updated.email ? tempPasswordHash : undefined,
},
```

Отправить email с новым паролем.

#### 2в. `acceptViaMagicLink`

Изменить `upsertUserByEmail` callback — использовать `invite.tempPasswordHash`
вместо генерации нового пароля, и установить `mustChangePassword: true`:

Текущий код (строки ~516–526):
```ts
upsertUserByEmail: async (args) => {
  const tempPassword = AccountsService.generateTempPassword();
  const passwordHash = await this.passwords.hash(tempPassword);
  const user = await this.repo.upsertStandalone({
    email: args.email,
    name: args.name,
    passwordHash,
    mustChangePassword: false,   // ← меняем
  });
  return { id: user.id, email: user.email, role: user.role };
},
```

Изменить на:
```ts
upsertUserByEmail: async (args) => {
  // β-10: если в инвайте есть tempPasswordHash (β-10+), используем его.
  // Если нет (legacy-инвайт до β-10), генерируем новый — пользователь
  // всё равно попадёт на страницу смены пароля (mustChangePassword=true).
  const passwordHash = invite.tempPasswordHash
    ?? await bcryptHashPlaceholder(this.passwords);
  const user = await this.repo.upsertStandalone({
    email: args.email,
    name: args.name,
    passwordHash,
    mustChangePassword: true,    // ← ИЗМЕНЕНО
  });
  return { id: user.id, email: user.email, role: user.role };
},
```

Где `bcryptHashPlaceholder` — вспомогательный inline:
```ts
// legacy path: пользователь всё равно увидит /onboarding/change-password;
// для смены пароля ему понадобится "Забыл пароль" — это приемлемо для
// legacy-инвайтов до β-10.
const bcryptHashPlaceholder = async (passwords: PasswordsService) =>
  passwords.hash(AccountsService.generateTempPassword());
```

Изменить `createUserWithoutEmail` callback — только `mustChangePassword: true`
(no-email пользователи не знают пароль, но фаза 3 добавит UI для них):

```ts
mustChangePassword: true,   // ← ИЗМЕНЕНО (было false)
```

- [x] Фаза 2 завершена

---

### Фаза 3: Email — новый шаблон с credentials

**Файл:** `backend/src/modules/mail/mail.templates.ts`

Добавить новый шаблон `INVITE_WITH_CREDENTIALS_TEMPLATE`:

```ts
/**
 * β-10 (2026-05-27) — приглашение сотрудника с явными реквизитами входа.
 * Заменяет `INVITE_GITHUB_STYLE_TEMPLATE` для email-инвайтов.
 * Цель: сотрудник с первого взгляда понимает логин и пароль.
 */
export const INVITE_WITH_CREDENTIALS_TEMPLATE = `Здравствуйте, {{name}}!

{{inviterName}} приглашает вас в компанию «{{orgName}}» в Коре —
системе памяти компании, которая помнит за всю команду.

━━━━━━━━━━━━━━━━━━━━━━━━
Ваши данные для входа:
  Логин:    {{loginEmail}}
  Пароль:   {{tempPassword}}
━━━━━━━━━━━━━━━━━━━━━━━━

Войти здесь:
{{loginUrl}}

После первого входа система попросит вас сменить пароль
на собственный — это займёт меньше минуты.

─────────────────────────
Или войдите одним кликом (без пароля, действует {{ttlDays}} дней):
{{magicLinkUrl}}

Присоединяйтесь к нашему боту для задач и заметок:
{{telegramDeepLink}}
─────────────────────────

Если вы не ждёте такого приглашения — просто проигнорируйте письмо.

— Команда Коры
`;
```

**Файл:** `backend/src/modules/mail/mail.service.ts`

Добавить интерфейс компилированного шаблона в `CompiledTemplates`:
```ts
inviteWithCredentials: HandlebarsTemplateDelegate<{
  name: string;
  inviterName: string;
  orgName: string;
  loginEmail: string;
  tempPassword: string;
  loginUrl: string;
  magicLinkUrl: string;
  telegramDeepLink: string;
  ttlDays: number;
}>;
```

Скомпилировать в `onModuleInit`:
```ts
inviteWithCredentials: Handlebars.compile(INVITE_WITH_CREDENTIALS_TEMPLATE),
```

Добавить метод `sendInviteWithCredentials`:
```ts
async sendInviteWithCredentials(input: {
  to: string;
  name: string;
  inviterName: string;
  orgName: string;
  loginEmail: string;
  tempPassword: string;
  loginUrl: string;
  magicLinkUrl: string;
  telegramDeepLink: string;
  ttlDays: number;
}): Promise<SendResult> {
  const text = this.templates.inviteWithCredentials(input);
  return this.send({
    to: input.to,
    subject: `${input.inviterName} приглашает вас в «${input.orgName}»`,
    text,
    template: 'invite-with-credentials',
  });
}
```

Метод `sendInviteGithubStyle` не удалять — он используется в `sendInviteReminder`
и в напоминаниях. Добавить `@deprecated` комментарий — убрать в следующем релизе.

- [x] Фаза 3 завершена

---

### Фаза 4: Backend — напоминания (cron) — обновить шаблон

**Файл:** `backend/src/modules/orgs/cron/org-invitation-reminders.cron.ts`

Напоминание (на 7-й день) отправляется через `sendInviteReminder`. Там нет пароля —
это корректно: напоминание говорит «вы ещё не приняли приглашение», и если
`tempPasswordHash` есть, нужно добавить в письмо текст:

> «Ваши данные для входа — в первом письме. Если потеряли — попросите руководителя
> перевыпустить приглашение.»

Изменить шаблон напоминания `INVITE_REMINDER_TEMPLATE` в `mail.templates.ts`:
добавить строку с этим текстом (без показа самого пароля — его нет в напоминании).

- [x] Фаза 4 завершена

---

### Фаза 5: Frontend — страница `/invite/[token]` после magic-link

**Файл:** `frontend/app/invite/[token]/AcceptInviteMagicClient.tsx`

Сейчас после принятия: "Вы вошли в Кору. Сейчас перенесём вас в кабинет…"
и редирект → `/dashboard`.

После изменений `mustChangePassword=true`, `AuthenticatedShell` автоматически
перенаправит на `/onboarding/change-password`. Страница смены пароля просит ввести
«Временный пароль (из письма)».

Нужно: в момент показа success-экрана явно напомнить пользователю, что потребуется
пароль из письма:

```tsx
if (accepted) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="mb-2 text-xl font-semibold">
        Здравствуйте, {accepted.userName}!
      </h1>
      <p className="text-sm text-fg-secondary">
        Вы вошли в Кору. Сейчас откроется страница смены пароля —
        введите одноразовый пароль из письма приглашения.
      </p>
    </div>
  );
}
```

- [x] Фаза 5 завершена

---

### Фаза 6: Frontend — страница `/onboarding/change-password` для no-email пользователей

**Файл:** `frontend/app/(authenticated)/onboarding/change-password/OnboardingChangePasswordForm.tsx`

No-email пользователи (линейный персонал без почты) тоже получают
`mustChangePassword=true` после β-10, но у них нет письма с паролем.
Они попадают на страницу «Установите постоянный пароль» и видят поле
«Временный пароль (из письма)» — что некорректно.

**Решение:** если у залогиненного `user.email` заканчивается на `@kora.local`
(placeholder), прятать поле «Временный пароль» и использовать специальный
API-эндпоинт `POST /me/set-initial-password` (фаза 7).

```tsx
const isNoEmailUser = user?.email?.endsWith('@kora.local') ?? false;
```

Если `isNoEmailUser`:
- Показать форму только с «Новый пароль» + «Подтвердить пароль».
- Вызывать `accountsApi.setInitialPassword({ newPassword })` вместо `changePassword`.
- Заголовок: «Установите пароль для входа» (без упоминания письма).

- [x] Фаза 6 завершена

---

### Фаза 7: Backend — эндпоинт `POST /me/set-initial-password`

**Файл:** `backend/src/modules/accounts/accounts.controller.ts`

Новый эндпоинт, доступный только если `mustChangePassword=true`:
```
POST /api/v1/me/set-initial-password
Body: { newPassword: string }
Auth: требует сессии (CookieAuthGuard)
```

Логика в `AccountsService.setInitialPassword`:
1. Проверить `user.mustChangePassword === true` — иначе `ForbiddenException`.
2. Захешировать `newPassword`, сохранить, сбросить `mustChangePassword=false`.
3. Остальные сессии не отзываем (пользователь только что вошёл, одна сессия).

Это путь **только** для no-email пользователей. Обычные email-пользователи
идут через `changePassword` (который требует old password).

- [x] Фаза 7 завершена

---

### Фаза 8: Тесты

**Файл:** `backend/src/modules/orgs/org-invitations.service.spec.ts`

Проверить:
- `createInvitation` с email → `tempPasswordHash` в БД не `null`.
- `acceptViaMagicLink` с `tempPasswordHash` → `upsertStandalone` вызван с этим хешем, `mustChangePassword=true`.
- `acceptViaMagicLink` без `tempPasswordHash` (legacy) → fallback placeholder, `mustChangePassword=true`.
- `resendInvitation` → новый `tempPasswordHash`, старый перетёрт.

**Файл:** `backend/src/modules/accounts/accounts.service.spec.ts`

- `setInitialPassword`: только если `mustChangePassword=true`, иначе `ForbiddenException`.

- [x] Фаза 8 завершена (typecheck backend + frontend — 0 ошибок; prisma:push OK)

---

## Схема флоу (после реализации)

```
Директор создаёт инвайт (email указан)
  → генерируется tempPassword (12 chars, base64url)
  → tempPasswordHash сохраняется в OrgInvitation
  → письмо: логин + tempPassword + ссылка /login + magic-link (вторичный)

Сотрудник получает письмо
  ├── [Путь А] Переходит на /login
  │     → вводит email + tempPassword
  │     → входит → mustChangePassword=true
  │     → AuthenticatedShell → редирект /onboarding/change-password
  │     → вводит tempPassword + новый пароль → сохраняет
  │     → редирект /meetings
  │
  └── [Путь Б] Кликает magic-link
        → POST /api/v1/accounts/invite/:token/accept
        → User создан с tempPasswordHash + mustChangePassword=true
        → сессия выдана → AcceptInviteMagicClient показывает reminder
        → AuthenticatedShell → редирект /onboarding/change-password
        → вводит tempPassword (из того же письма) + новый пароль
        → редирект /meetings

No-email сотрудник (линейный персонал)
  → получает только magic-link (Telegram deep-link или manual URL)
  → кликает → User создан с placeholder-email + mustChangePassword=true
  → AuthenticatedShell → /onboarding/change-password
  → UI видит @kora.local → форма без поля "старый пароль"
  → POST /me/set-initial-password → редирект /meetings
```

---

## Что НЕ меняется

- `sendInviteGithubStyle` и `INVITE_GITHUB_STYLE_TEMPLATE` — не удалять, 
  используются в напоминаниях и legacy-путях.
- `token`-based `acceptInvitation` (старый путь для уже-авторизованных) — 
  не трогать.
- Крон напоминаний `org-invitation-reminders` — только обновление текста письма 
  (фаза 4), логика не меняется.
- Директорское уведомление о таймауте — не трогать.

---

## Проверка (Definition of Done)

- [ ] `bun run prisma:push` в `backend/` — успешно
- [ ] `bun run typecheck` — 0 ошибок
- [ ] `bun run lint` — 0 ошибок
- [ ] `bun run test:unit` — все тесты зелёные
- [ ] Ручная проверка флоу А (email + пароль → смена → /meetings)
- [ ] Ручная проверка флоу Б (magic-link → смена → /meetings)
- [ ] В письме (MAIL_DRY_RUN=true, лог) видны логин + пароль
- [ ] No-email флоу: magic-link → форма без поля «старый пароль» → setInitialPassword
