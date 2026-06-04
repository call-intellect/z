---
created: 2026-05-29
status: draft
priority: P0
owner: TBD
related:
  - plans/tz/2026-05-28-paywall-no-trial.md
  - plans/tz/2026-05-29-unified-login.md
  - plans/tz/2026-05-29-admin-demo-workspace-creation.md
  - plans/tz/2026-05-27-tracker-subtasks-ui.md
  - plans/tz/2026-05-27-sprints.md
---

> 📦 **АРХИВ (аудит 2026-06-04): ✅ реализовано — 97%.**
> Реализовано практически полностью: все 15 блокеров + 17 высоких + 31 средний риск имеют отдельные fix(audit) коммиты, спот-проверка ~12 из них на уровне кода и схемы Prisma подтвердила реальные изменения (не пустые комми
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


# ТЗ: исправление находок аудита коммитов 2026-05-26 → 2026-05-29

**Источник:** многоагентный аудит 139 коммитов / 970 файлов / ~98K строк за 3 дня (биллинг 1-9, sprints 1-5, tracker-паритет, onboarding v2, credentials β-10, concierge dialog-layer, clones marketplace, LLM-migration на DeepSeek V4 Pro, Telegram через прокси, demo workspace, ребрендинг Z → Кора, unified-login + AdminDemoController).

**Автотесты на 2026-05-29 14:00:** backend typecheck/lint/test:unit — ✅ exit 0, frontend typecheck/lint — ✅ exit 0. **Но автотесты не покрывают то, что ломается в этом ТЗ.**

**Итого:** 15 блокеров, 17 высокий риск, ~20 средний.

---

## Фаза 0 — Pre-flight (договорённости перед началом)

- [ ] **НЕ катить `dev` на прод как есть.** До закрытия Фазы 1 — фриз на push в `main`.
- [ ] **Скрыть кнопку «Сбросить демо» в `/admin/demo`** для Org с `demoSeededAt: null` (фронт-only хотфикс, см. Фазу 1 #8).
- [ ] Завести отдельную ветку `fix/audit-2026-05-29` от `dev`.
- [ ] Для каждой задачи — отдельный коммит с префиксом `fix(audit): …`.
- [ ] Регрессионный smoke после каждого блокера на свежей dev-БД: signup → login → invite по email → принять → войти по credentials → сменить пароль → создать Org → оплата Точкой → реф-выплата → reset-demo на свежей Org.

---

## Фаза 1 — Критические блокеры (≤ 48 часов)

> Эти 7 блокеров либо рушат фичу функционально (β-10 credentials), либо позволяют потерю данных в один клик (reset-demo), либо приводят к двойной оплате/реф-выплате.

### Б1. Credentials-onboarding β-10 — sha256 vs argon2 mismatch

**Источник:** Agent 2, блокер №1.
**Файлы:**
- [backend/src/modules/orgs/org-invitations.service.ts:172-173](backend/src/modules/orgs/org-invitations.service.ts#L172-L173)
- [backend/src/modules/accounts/accounts.service.ts:521-527](backend/src/modules/accounts/accounts.service.ts#L521-L527)

**Проблема:** в `OrgInvitation.tempPasswordHash` пишется `sha256(tempPassword)`, при приёме инвайта этот хеш копируется напрямую в `User.passwordHash`. Логин и change-password проверяют через `argon2.verify` — `sha256`-хекс не argon2-конверт, `argon2.verify` бросает, login возвращает `LoginInvalidError`. **Пользователь из инвайта физически не может войти по credentials из письма.** После logout сессии — вход невозможен навсегда.

**Как фиксить:**
1. В `OrgInvitationsService.createInvitation` хранить `await passwords.hash(tempPassword)` (argon2id), а не `sha256`.
2. `acceptViaMagicLink` пробрасывает уже валидный argon2-hash в `upsertUserByEmail` (никаких преобразований).
3. Сравнить с `accounts.login` — он использует `PasswordService.verify(stored, plain)`, должен пройти.

**Параллельно — энтропия (Agent 2, риск #4):** поднять с `randomBytes(9).toString('base64url')` (72 бита) до `randomBytes(15)` (120 бит) в `org-invitations.service.ts:818-820`. NIST SP 800-63B compliant.

**Проверка:**
- Unit: `org-invitations.service.spec.ts` — после `createInvitation` `passwords.verify(invitation.tempPasswordHash, tempPassword) === true`.
- Integration: e2e flow «invite → email → login по логину/паролю из письма → mustChangePassword=true в `/me` → POST `/me/change-password` → logout → login со старым tempPassword отвергает, с новым — принимает».

**Риск регрессии:** существующие инвайты в БД, выданные до фикса, останутся со sha256-хешем и не сработают. Решение — `patch-rehash-pending-invitations.ts`: для `OrgInvitation` с `acceptedAt=NULL` пересоздать `tempPassword` + argon2-хеш + повторно отправить письмо. Зарегистрировать в `apply-prod-deploy.ts` STEPS.

---

### Б2. `mustChangePassword` enforced только на фронте

**Источник:** Agent 2, блокер №3.
**Файлы:**
- [backend/src/modules/accounts/accounts.service.ts:602-620](backend/src/modules/accounts/accounts.service.ts#L602-L620)
- [frontend/app/(authenticated)/AuthenticatedShell.tsx:44](frontend/app/(authenticated)/AuthenticatedShell.tsx#L44) (только редирект, бэк не проверяет)
- Новый: `backend/src/modules/auth/guards/must-change-password.guard.ts`

**Проблема:** любой REST-вызов с валидной cookie проходит, пока пароль не сменён. curl/postman/старая SPA-вкладка обходит редирект.

**Как фиксить:**
1. Создать `MustChangePasswordGuard` на уровне приложения (global guard в `app.module` после `CookieAuthGuard`).
2. Whitelist эндпоинтов:
   - `GET /me`
   - `POST /me/change-password`
   - `POST /me/set-initial-password`
   - `GET/POST /me/onboarding/*`
   - `POST /auth/logout`
   - `GET /entitlements/me`
3. Если `req.user.mustChangePassword === true` и path не в whitelist → 403 `must_change_password`.
4. Фронт перехватывает 403 → редирект на `/onboarding/change-password`.
5. Добавить метрику `auth_must_change_password_block_total{path}`.

**Проверка:**
- Unit: `must-change-password.guard.spec.ts` — все whitelist'ы пропускают, всё остальное 403.
- E2E: после Б1 — login по tempPassword → curl `/api/v1/meetings` → 403 → POST `/me/change-password` → curl `/api/v1/meetings` → 200.

---

### Б3. `POST /orgs/:orgId/reset-demo` уничтожает данные ЛЮБОЙ Org

**Источник:** Agent 2, блокер №2.
**Файлы:**
- [backend/src/modules/onboarding/onboarding.service.ts:263-342](backend/src/modules/onboarding/onboarding.service.ts#L263-L342)
- [backend/src/modules/onboarding/onboarding.controller.ts:110-122](backend/src/modules/onboarding/onboarding.controller.ts#L110-L122)
- [backend/src/modules/admin/controllers/admin-demo.controller.ts:88-101](backend/src/modules/admin/controllers/admin-demo.controller.ts#L88-L101) — **новый AdminDemoController дополнительно расширяет атаку через UI** (см. ef0cd60).

**Проблема:** `resetDemoWorkspace` для большинства таблиц делает `deleteMany({ where: { tenantId: orgId } })` БЕЗ фильтра `externalSource='demo'`. Сносит весь knowledge graph (`ideaBlock`, `entity`, `theme`, `ideaBlockLink`, `entityLink`), goal*, executablePersona, skillTrait, skillProfile, **`cloneAccessGrant`**, dailyCheckIn, weeklyOperationsDigest, chatV2Message, chatV2Conversation, notification, recognition, helpfulnessSpotlight, card, processStep, process, insight, decision, appointment, **`person`/`role`/`department`**, companyProfile, functionalDomain, projectDocument, board, issueState, cycle, label, project. RPO=∞. Теперь супер-админ один клик в `/admin/demo` → катастрофа.

**Как фиксить:**
1. **Precondition в `resetDemoWorkspace`:** `if (!org.demoWorkspaceSeededAt) throw new BadRequestException('no_demo_to_reset')`. Это останавливает и `/onboarding/demo-choice/reset`, и `/admin/demo/orgs/:id/reset` за один фикс.
2. **Фильтр `externalSource: 'demo'`** во ВСЕ `deleteMany`. Если поля нет в модели — добавить `externalSource String?` через `schema.prisma` + `bun run prisma:push` (skill `prisma-db-push-rules`). Backfill для существующих демо-данных через `patch-mark-demo-data.ts` (idempotent).
3. **Завернуть в одну `prisma.$transaction(...)`** — сейчас 30+ отдельных запросов; при падении посередине Org в полуубитом состоянии.
4. **Audit-event** `org.demo_reset` с `actorUserId`, `orgId`, `recordsDeleted: {table: count}` — для разбора инцидентов.
5. **Фронт-страж в `DemoClient.tsx`:** кнопка `reset` disabled для Org с `demoSeededAt: null`. Confirm-modal с явным набором имени Org (как у GitHub при удалении репо).

**Параллельно (Agent 2, риск #5):** `issueComment.deleteMany({ where: { issue: { project: { tenantId: orgId } } } })` без фильтра демо — добавить тот же `externalSource='demo'`. Аналогично `issueLabel`, `issueAssignee`, `issueRelation`.

**Проверка:**
- Unit: `onboarding.service.spec.ts` — reset на Org без `demoSeededAt` → BadRequest. Reset на демо-Org удаляет только записи с `externalSource='demo'`. Боевые `Person`/`Role` остаются.
- Integration: seed демо → создать боевую Person в той же Org → reset → boевая Person жива.

**Риск регрессии:** существующие demo-записи в проде без `externalSource='demo'` → backfill-скрипт обязателен (см. п.2). На pre-prod сначала.

---

### Б4. Webhook Точки — replay forever (нет проверки `exp`/`iat`/`jti`)

**Источник:** Agent 1, блокер №2.
**Файлы:**
- [backend/src/modules/billing/providers/tochka/tochka-webhook-verifier.service.ts:52-64](backend/src/modules/billing/providers/tochka/tochka-webhook-verifier.service.ts#L52-L64)
- [backend/src/modules/billing/billing-webhook.controller.ts:67-73](backend/src/modules/billing/billing-webhook.controller.ts#L67-L73)
- [backend/prisma/schema.prisma](backend/prisma/schema.prisma) — `BillingEventLog`

**Проблема:** `jsonwebtoken.verify(token, key)` проверяет подпись, но `exp`/`iat`/`nbf` не валидируются по строгому окну. Перехваченный JWT валиден неограниченно — replay-атака. Также JWK кэшируется без TTL и refetch при `kid mismatch` — ротация ключа Точкой = paralysis до рестарта.

**Как фиксить:**
1. `jwt.verify(token, key, { algorithms: ['RS256'], maxAge: '5m', clockTolerance: 30 })`.
2. Добавить колонку `jti String? @unique` в `BillingEventLog` + `bun run prisma:push`.
3. В `handleProviderWebhook` — `INSERT BillingEventLog { jti }`; если P2002 — `409 conflict` без обработки (replay).
4. JWK-cache: TTL 1 час + при `kid mismatch` — refetch.
5. Метрика `tochka_webhook_replay_total{reason}`.

**Проверка:**
- Unit: `tochka-webhook-verifier.service.spec.ts` — токен с `iat` старше 5 минут отвергается; токен без `iat` отвергается; повторный `jti` отвергается.
- Integration: рукой повторно отправить тот же webhook → второй раз 409.

---

### Б5. OAuth-токены Точки хранятся в plaintext

**Источник:** Agent 1, блокер №1.
**Файлы:**
- [backend/src/modules/billing/providers/tochka/tochka-oauth.service.ts:326-339](backend/src/modules/billing/providers/tochka/tochka-oauth.service.ts#L326-L339)
- [backend/src/common/crypto/crypto.service.ts](backend/src/common/crypto/crypto.service.ts)

**Проблема:** `BillingProviderConfig.valueJson { accessToken, refreshToken }` пишется в БД в открытом виде. Дамп БД (бэкап на S3, утечка через misconfig) = угон API Точки = списания со счёта Z и с карт клиентов.

**Как фиксить:**
1. `valueJson` для секций `tochka-oauth` обернуть в `CryptoService.encrypt(JSON.stringify(value))` перед `upsert`.
2. На чтении — `JSON.parse(CryptoService.decrypt(valueJson))`.
3. Backfill через `patch-encrypt-tochka-oauth.ts`: читаем все `BillingProviderConfig` с ключом `tochka-oauth`, если value — plain JSON, шифруем и пишем обратно. Идемпотентно (если уже base64+IV-конверт — skip). Зарегистрировать в `apply-prod-deploy.ts` STEPS.
4. ENV `BILLING_ENCRYPTION_KEY` (32 байта base64) в `env.schema.ts` + Шаг 1 в `prod-deploy-log.md`.

**Проверка:**
- Unit: `tochka-oauth.service.spec.ts` — после `saveTokens` `valueJson` начинается с конверта `enc:v1:...`. Чтение возвращает оригинал.

---

### Б6. Self-referral не блокируется, чужой ИНН проходит верификацию

**Источник:** Agent 1, блокер №3.
**Файлы:**
- [backend/src/modules/referrals/services/referrals.service.ts:75-91](backend/src/modules/referrals/services/referrals.service.ts#L75-L91) (`create`)
- [backend/src/modules/referrals/services/referrals.service.ts:122-147](backend/src/modules/referrals/services/referrals.service.ts#L122-L147) (`verifyInn`)
- [backend/src/modules/referrals/services/attribution.service.ts:64-94](backend/src/modules/referrals/services/attribution.service.ts#L64-L94) (`attributeOrg`)

**Проблема:**
- `create` НЕ проверяет, не является ли заявитель owner'ом/member'ом любой Org → схема: создаю Referral со своим slug → регаю Org B → attribute Org B → 20 000 ₽ × 12 месяцев × ∞.
- `verifyInn` ставит `innVerifiedAt=now` если lookup просто что-то нашёл — БЕЗ сравнения с владельцем User. Можно подать ИНН любого юрлица.

**Как фиксить:**
1. В `attribution.attributeOrg` отказывать, если `referral.ownerUserId === ownerOrMemberOf(orgId)`. Конкретно: `SELECT 1 FROM OrgMember WHERE userId=referral.ownerUserId AND orgId=:orgId LIMIT 1` → если найдено → throw `SelfReferralDeniedError`.
2. `verifyInn` — сравнить найденный `directorName` / `directorInn` с фамилией заявителя или потребовать загрузку doc-подтверждения. На MVP: ИНН User должен совпасть с ИНН найденным — иначе `pendingDocVerification`.
3. Метрики `referral_self_referral_denied_total`, `referral_inn_mismatch_total`.

**Проверка:**
- Unit: `attribution.service.spec.ts` — self-attribution возвращает denied. `referrals.service.spec.ts` — verifyInn с не совпадающим ИНН не ставит `innVerifiedAt`.

---

### Б7. Race condition двойной оплаты + двойной payout

**Источник:** Agent 1, блокеры №5, №6.
**Файлы:**
- [backend/prisma/schema.prisma](backend/prisma/schema.prisma) — `BillingEventLog`, `ReferralPayout`
- [backend/src/modules/billing/services/billing-event.service.ts:54-69](backend/src/modules/billing/services/billing-event.service.ts#L54-L69)
- [backend/src/modules/referrals/services/referral-payout.service.ts:84-93](backend/src/modules/referrals/services/referral-payout.service.ts#L84-L93)

**Проблема:** `BillingEventLog.externalEventId` — обычный `@@index`, не `@unique`. Дедуп через `findFirst` + `create` = TOCTOU. Параллельные webhook-ретраи Точки → два `handleProviderWebhook` одновременно → оба создают запись → `totalPaidKopecks` инкрементится дважды. Аналогично `ReferralPayout.triggerInvoiceId` без unique → 40 000 ₽ комиссии вместо 20 000 ₽.

**Как фиксить:**
1. `schema.prisma`:
   ```prisma
   model BillingEventLog {
     // ...
     @@unique([providerName, externalEventId], name: "uniq_provider_event")
   }
   model ReferralPayout {
     triggerInvoiceId String @unique
   }
   ```
2. `bun run prisma:push` + `bun run prisma:generate`.
3. В `billing-event.service.log()` — `create` без предварительного `findFirst`; ловить `P2002` → возвращать `existing record`. Это атомарно.
4. В `referral-payout.service` — то же: `create` + catch P2002 → skip.
5. Тест на конкуренцию: запускать два `handleProviderWebhook` параллельно с одинаковым `externalEventId` → второй должен получить дубль без двойного `markPaid`.

**Проверка:**
- Unit: `billing-event.service.spec.ts` + `referral-payout.service.spec.ts` с моком concurrent.
- Integration: руками двойной webhook → `Invoice.status='paid'`, `Subscription.totalPaidKopecks` = X (не 2X), `ReferralPayout` ровно один.

**Риск регрессии:** существующие дубли в БД (если уже двойные платежи прошли) — `prisma:push` упадёт на add unique. Сначала backfill `patch-dedupe-billing-event-log.ts` + `patch-dedupe-referral-payout.ts` (idempotent, dry-run).

---

## Фаза 2 — Оставшиеся блокеры (≤ 1 неделя)

### Б8. DoS-flood + fingerprint-сквоттинг public-referrals

**Источник:** Agent 1, блокер №4.
**Файл:** [backend/src/modules/referrals/controllers/public-referrals.controller.ts:43-65](backend/src/modules/referrals/controllers/public-referrals.controller.ts#L43-L65), [attribution.service.ts:64-94](backend/src/modules/referrals/services/attribution.service.ts#L64-L94)

**Фикс:**
- `@@unique([referralId, fingerprint, date])` в `ReferralAttribution`.
- Капча (hCaptcha/reCAPTCHA invisible) на лендинге `/r/:slug`.
- Не записывать без cookie от трастового домена (`Origin/Referer` whitelist).

### Б9. Race в `validateParentForIssue` подзадач (циклы и depth>2)

**Источник:** Agent 3, блокеры №1, №2.
**Файл:** [backend/src/modules/tracker/services/issues.service.ts:1343-1436](backend/src/modules/tracker/services/issues.service.ts#L1343-L1436)

**Фикс:**
1. Перенести валидацию ВНУТРЬ `prisma.$transaction(...)`.
2. `await tx.$queryRaw\`SELECT pg_advisory_xact_lock(hashtext(${parentId}))\`` для блокировки родителя на время проверки + update.
3. При update parent — проверять поддерево детей (BFS от `currentIssueId` вниз) + поддерево родителя (BFS вверх). Если суммарная глубина > 2 → reject.
4. Concurrent-test: два update'а с пересекающимися parent'ами → один проходит, второй throws `IssueParentConflictError`.

### Б10. Sprint-helper cron — global cap=50, кросс-тенантный

**Источник:** Agent 3, блокер №3.
**Файл:** [backend/src/modules/knowledge-core/workers/sprint-helper.cron.ts:34-49](backend/src/modules/knowledge-core/workers/sprint-helper.cron.ts#L34-L49)

**Фикс:** `groupBy tenantId` + `LIMIT 5 per tenant`. Альтернативно — BullMQ delayed jobs с round-robin по tenants.

### Б11. `requireItem` не учитывает soft-deleted checklist

**Источник:** Agent 3, блокер №4.
**Файл:** [backend/src/modules/tracker/services/checklists.service.ts:499-516](backend/src/modules/tracker/services/checklists.service.ts#L499-L516)

**Фикс:** включить `checklist: { deletedAt: null }` в `requireItem` либо отдельный `requireActiveChecklistForItem`. Test: PATCH item у soft-deleted checklist → 404.

### Б12. rollback-скрипт использует `new PrismaClient()` + не зарегистрирован

**Источник:** Agent 4, блокеры №1, №2.
**Файл:** [backend/scripts/patch-rollback-to-deepseek-flash.ts:55-61](backend/scripts/patch-rollback-to-deepseek-flash.ts#L55-L61), [backend/scripts/apply-prod-deploy.ts](backend/scripts/apply-prod-deploy.ts)

**Фикс:**
1. Заменить `new PrismaClient(...)` на `import { createPrismaClient } from './_lib/prisma'; const prisma = createPrismaClient();`.
2. Зарегистрировать в `apply-prod-deploy.ts` STEPS с `phase: 'rollback'` + `requireFlag: '--rollback'`. Документировать в комментарии что это incident-only.

### Б13. Утечка истории диалогов с клоном после revoke

**Источник:** Agent 4, риск №3 (на грани блокера — privacy-эскалация).
**Файл:** [backend/src/modules/chat-v2/services/conversations.service.ts:153-185](backend/src/modules/chat-v2/services/conversations.service.ts#L153-L185)

**Фикс:** в `getById` для conversations с `scope='card'` И `scopeRefId` указывающим на person/role-клона — дополнительно дёргать `RbacService.canAccessPersonClone/canAccessRoleClone` (cloneV2Enabled=v2). Revoked → 404.

### Б14. `attributeCurrentOrg` без `TenantGuard` — захват чужой Org через `X-Org-Id`

**Источник:** Agent 1, риск №13 (по факту блокер — деньги).
**Файл:** [backend/src/modules/referrals/controllers/referrals.controller.ts:171-190](backend/src/modules/referrals/controllers/referrals.controller.ts#L171-L190)

**Фикс:** `@UseGuards(CookieAuthGuard, TenantGuard)` + проверка membership через `rbac.isMember(user.id, tenantId)`. Test: вызвать с `X-Org-Id` чужой Org → 403.

### Б15. Tochka recurring-charge без локального Invoice

**Источник:** Agent 1, риск №10 (по факту блокер — подписка не продлится, клиент в PAST_DUE при успешном списании).
**Файл:** [backend/src/modules/billing/services/tochka-recurring-charge.cron.ts:104-121](backend/src/modules/billing/services/tochka-recurring-charge.cron.ts#L104-L121), [tochka-billing.provider.ts:167](backend/src/modules/billing/providers/tochka/tochka-billing.provider.ts#L167)

**Фикс:**
1. Cron создаёт `Invoice` ДО `chargeRecurringSubscription`.
2. `providerInvoiceId = response.operationId` (от Точки), не `${subId}:${Date.now()}`.
3. Webhook найдёт по `operationId` и `finalizePaidInvoice` отработает.

---

## Фаза 3 — Высокий риск (1-2 недели)

| # | Источник | Файл | Что |
|---|---|---|---|
| В1 | A1 риск №7 | `inn-lookup.service.ts:121,152` | Заменить `redis.keys()` на детерминированный ключ `inn-lookup:<inn>` |
| В2 | A1 риск №8 | `subscription.guard.ts:46-92` | Bypass для `req.user.isSuperAdmin`. Разделить status коды `DEMO` vs `EXPIRED` |
| В3 | A1 риск №9 | `billing.service.ts:362-369` | Сверка `customerCode` из webhook payload с `cfg.billing.tochka.customerCode` |
| В4 | A1 риск №11 | `tochka-billing.provider.ts:493` | `Number((amountKopecks/100).toFixed(2))` вместо `Math.round` |
| В5 | A1 риск №12 | `invoice.service.ts:103` | placeholder `invoiceNumber` через `cuid()` или nextval |
| В6 | A2 риск №4 | `org-invitations.service.ts:818-820` | Уже в Б1 — `randomBytes(15)` |
| В7 | A2 риск №6 | `rbac.service.spec.ts` | Тесты на coo: каждое правило из policy.csv проходит. + audit-action по логам пром май 23-27 |
| В8 | A2 риск №7 | `accounts/dto/register.dto.ts:16` | `phone` валидация формата + нормализация E.164 |
| В9 | A2 риск №9 | `seed-demo-workspace.ts` | Guard на «свежая ли Org» + идемпотентность (проверка `demoWorkspaceSeededAt` перед записью) |
| В10 | A3 риск №5 | `sprints.service.ts:392-395, 516-519` | `void prisma.org.updateMany(...).catch(err => logger.warn(...))` |
| В11 | A3 риск №6 | `boards.service.ts:450-460`, `checklists.service.ts:172-179, 366-373` | Reorder под `prisma.$transaction` с FOR UPDATE на затронутых строках |
| В12 | A3 риск №7 | `tracker.gateway.ts:140-172` | RBAC-чек на `subscribe.project/issue` (rbac.canRead) |
| В13 | A3 риск №8 | `sprint-review.service.ts:298-306` | Если `cardVersionId === null` → markFailed с reason='triage_failed' |
| В14 | A4 риск №4 | `clones.service.ts:1024-1064` | `assertCloneRefExists` после RBAC в `createCloneConversation` |
| В15 | A4 риск №5 | `clones-admin.service.ts:113-130` | Re-grant поверх revoked: `update` вместо `delete+create` |
| В16 | A4 риск №9 | `dialog-layer/services/dialog.service.ts` (вне аудита) | **Верифицировать tenant-scope в `AnswerCache`-ключе.** Если не tenant-scoped — добавить + миграция кеша |
| В17 | A4 риск №11 | `frontend/src/api/clones.api.ts:348-359` | Либо реализовать `/clones/:type/:id/access-grants/request` на бэке, либо скрыть кнопку «Запросить доступ» |

---

## Фаза 4 — Средний риск (по мере возможности, ≤ 1 месяц)

| # | Источник | Файл | Что |
|---|---|---|---|
| С1 | A1 | `tochka-oauth.service.ts:111` | Проверить PII-фильтр для `authorize URL` (consentId не критичен, но проверить) |
| С2 | A1 | `dadata.adapter.ts:103` | Маскировать ИНН в логе ошибки (последние 4 цифры) |
| С3 | A1 | `billing.service.ts:471-479` | Метрика `billing_emit_failed_total` для `safeEmit` |
| С4 | A1 | `referral-payout.service.ts:67` | BullMQ-job вместо in-process `@OnEvent` (потеря при рестарте) |
| С5 | A1 | `attribution.service.ts:82` | DTO-валидация длины fingerprint (минимум 32) |
| С6 | A1 | `tochka-webhook-verifier.service.ts:140` | TTL на JWK-cache (1ч) + refetch при `kid mismatch` |
| С7 | A1 | `subscription.service.ts:131-156` | Логировать ошибку `emitForTransition` (сейчас `void`) |
| С8 | A1 | `manual-billing.service.ts` | Проверить что admin-activate с bonus НЕ эмитит `INVOICE_PAID` (только `INVOICE_BONUS`) |
| С9 | A2 | `accounts.service.ts:535` | `noemail-${randomBytes(16).toString('hex')}@kora.local` + try/catch на P2002 |
| С10 | A2 | `seed-demo-workspace.ts:120` | Убрать бесполезный фильтр `content: { not: undefined }` |
| С11 | A2 | `onboarding.service.ts:286` | `participant`/`transcript`/`aiResult` каскадно через demo-meeting, не tenantId |
| С12 | A2 | `register.dto.ts:24` | `consentAcceptedAt` пишется только после refine (already OK, регресс-тест) |
| С13 | A2 | HMAC guard | `request.rawBody ?? Buffer.alloc(0)` — min-body для POST |
| С14 | A2 | `rbac.service.ts:413,445` | Defense-in-depth: проверка `tenantId === Person.tenantId` в `canAccess.*Clone` |
| С15 | A2 | `patch-rebrand-z-to-kora.ts` | Сверять `body` с code-константой, не только subject |
| С16 | A3 | `checklists.service.ts:398-428` | `recountCounters` в транзакции с advisory lock на `issueId` |
| С17 | A3 | `sprints.service.ts:113-122` | pg_trgm индекс на `Cycle.q` |
| С18 | A3 | `cycles.service.ts:145-205` | `complete` идемпотентность под advisory lock |
| С19 | A3 | `project-documents.service.ts:242-247` | Cycle-check при update parentId |
| С20 | A3 | `project-documents.service.ts:308-320` | Soft-delete каскадирует children (parentId=null или soft-delete) |
| С21 | A3 | `tracker.gateway.ts:443-461` | Реrefresh `displayName` на reconnect |
| С22 | A3 | `SprintCreateWizard.tsx:339` | TZ-aware парсинг даты (вместо UTC) |
| С23 | A4 | `concierge.service.ts:557-563` | Логировать первый catch + gauge `concierge_config_error_total` |
| С24 | A4 | `concierge.service.ts:606-616` | Defense-in-depth: tenantId в where conversation |
| С25 | A4 | `patch-migrate-clone-access.ts:220-241` | Hook `Role.created` для grants owner'ам, либо документировать |
| С26 | A4 | `concierge.service.ts:300-309` | После В16 — гарантия tenant-scope в `cachedAnswer.text` записи |
| С27 | A4 | Telegram | Согласовать с владельцем proxy: не логировать bodies |
| С28 | A4 | `telegram-proxy-health.cron.ts` | Timeout на `proxyAdmin.ping()` сверх default |
| С29 | A4 | LLM-migration rollback | Флаг `--include-feature-flagged` (auto-uncomment строк 126-127) |
| С30 | A4 | LLM-router | `Promise.race(dispatch, timeout=30s)` в `llm-router.service.ts:994` |
| С31 | A2 | UnifiedLoginController (свежий 93f2e04) | Audit-action: проверить, что нет user'ов с email одновременно в `User` (standalone) и `AdminUser` — иначе путаница ролей |

---

## Договорённости по реализации

### Инфра-правила (skill `core-engineering-standards`, `prisma-db-push-rules`, `safe-seed-rules`)

1. **Только `bun`**, никаких `npm/npx`. Все команды — через `docker compose exec backend bun run ...` для прод-операций.
2. **Только `prisma:push`**, никаких `prisma migrate*`. После любой правки моделей — `bun run prisma:generate`.
3. **ENV — только через `TypedConfigService` / `env.schema.ts`**, никаких `process.env.*`.
4. **PrismaClient в скриптах — только через `createPrismaClient()` из `_lib/prisma.ts`** (см. Б12).
5. Все новые `patch-*.ts` / `seed-*.ts` / `backfill-*.ts` / `migrate-*.ts` регистрировать в `backend/scripts/apply-prod-deploy.ts` STEPS.

### Skills для каждой фазы

- **Б1, Б2, Б3, Б14, В7, В8**: skill `nestjs-rules` (DTO + guards).
- **Б3 (фильтр externalSource), Б7 (unique), Б9 (race)**: skill `prisma-db-push-rules`.
- **Б1 (rehash), Б3 (backfill), Б5 (encrypt), Б7 (dedupe), Б12 (rollback)**: skill `safe-seed-rules`.
- **Все frontend-хотфиксы**: skill `frontend-rules`.

### Тесты

Каждый блокер фазы 1-2 — **обязательно** покрыть unit + (где race) — concurrent тестом. Скоп тестов:
- `must-change-password.guard.spec.ts` (Б2)
- `onboarding.service.spec.ts` — reset под `demoSeededAt` (Б3)
- `tochka-webhook-verifier.service.spec.ts` — replay/expiry (Б4)
- `tochka-oauth.service.spec.ts` — encrypt/decrypt (Б5)
- `referrals.service.spec.ts`, `attribution.service.spec.ts` — self-referral, INN-mismatch (Б6)
- `billing-event.service.spec.ts`, `referral-payout.service.spec.ts` — concurrent (Б7)
- `issues.service.spec.ts` — concurrent parent (Б9)
- `rbac.service.spec.ts` — все coo-правила из policy.csv (В7)

### Деплой (skill `prisma-db-push-rules`, CLAUDE.md «прод-инструкция»)

Изменения схемы в этом ТЗ:
- **Шаг 4 prod-deploy-log** (опасные изменения): add `BillingEventLog.jti` unique, add `BillingEventLog @@unique([providerName, externalEventId])`, add `ReferralPayout.triggerInvoiceId @unique`, add `@@unique([referralId, fingerprint, date])` в `ReferralAttribution`, add `externalSource String?` в demo-таблицы.
- **Шаг 1** (ENV): `BILLING_ENCRYPTION_KEY`.
- **Шаг 6** (patches): `patch-rehash-pending-invitations`, `patch-encrypt-tochka-oauth`, `patch-dedupe-billing-event-log`, `patch-dedupe-referral-payout`, `patch-mark-demo-data`. Все идемпотентные с `--dry-run`.

Backfill всегда: dry-run на staging → diff log → apply на prod.

---

## Acceptance criteria (для PR)

- [ ] Все 15 блокеров закрыты, с тестами.
- [ ] `bun run typecheck && bun run lint && bun run test:unit` зелёные на backend и frontend.
- [ ] E2E smoke на свежей dev-БД: signup → login (UnifiedLogin) → invite по email → принять → войти по credentials → `mustChangePassword` форсирует change-password → создать Org → оплата Точкой (mock) → реф-выплата (одна) → reset-demo на свежей Org → reset-demo на боевой Org возвращает 400.
- [ ] second-brain обновлён: `02_architecture/data-model.md` (новые unique), `01_projects/billing.md`, `01_projects/onboarding-v2.md`, `01_projects/clones.md`.
- [ ] `docs/operations/prod-deploy-log.md` обновлён (Шаги 1, 4, 6).
- [ ] Рефлексия в `second-brain/05_история/2026-MM-DD-audit-fixes.md`.

---

## Антипаттерны (что НЕ делать)

- ❌ Не править блокеры одним мегакоммитом — каждый блокер отдельным `fix(audit): …`.
- ❌ Не вводить feature-flag на исправление β-10 — фича сейчас сломана, фикс должен быть hard-cut.
- ❌ Не оставлять `@@deprecated` старые login-эндпоинты дольше 2 недель после UnifiedLoginController (свежий 93f2e04).
- ❌ Не делать прямой `delete` revoked-грантов (Б15, см. С25). Audit-trail обязателен.
- ❌ Не катить `prisma:push` с новыми unique до dedupe-patch — упадёт на существующих дублях.
