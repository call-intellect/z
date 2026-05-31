---
title: Волна 2 — Z-Admin Тариф + Партнёрский кабинет (оркестрация двух ТЗ параллельно)
date: 2026-05-31
distilled: false
---

# Рефлексия — Волна 2: два ТЗ за одну сессию

## Что было поставлено

Оркестрация двух параллельных ТЗ:

1. **ТЗ №3 — admin-plans-collapse-to-standard** ([plan](../../plans/tz/2026-05-31-admin-plans-collapse-to-standard.md)): свернуть CRUD `/admin/orgs/plans` к одному `tier_standard`, цена через `AdminSetting`, страница админки — одна карточка с редактируемыми полями + калькулятор.
2. **ТЗ №4 — referrals-cabinet-revamp** ([plan](../../plans/tz/2026-05-31-referrals-cabinet-revamp.md)): партнёрский кабинет — снять блокеры (ИНН/реквизиты опц.), маскировать клиентов, добавить аналитику (income chart + funnel + 30d-метрики), промо-стрип в AppShell.

Промпт-оркестратор пришёл от пользователя в виде `\temp\readonly\Agent tool input` — детальная инструкция как параллелить и где разводить под-агентов.

## Как решал

**Декомпозиция:** разбил на 7+6 фаз. Запускал параллельно там, где нет пересечений по файлам:

| Волна | №3 фаза | №4 фаза |
|---|---|---|
| 1 | Фаза 0 (inline grep call-сайтов SeatService) + Фаза 1 (AdminSetting registry + seed billing) | Фаза 1.1 (schema.prisma optional + prisma:push) |
| 2 | Фаза 2 (SeatService + MeetingsBalanceService → async + getDynamic) | Фазы 1.2-1.6 (ReferralsService переработка, маскированные DTO, новые методы getIncomeChart/getFunnel, новые контроллеры) |
| 3 | Фаза 3 (await на call-сайтах + восстановить export YEARLY_MONTHS) | Фаза 2a backend (promo-event endpoint + 3 Prometheus-метрики, через `@nestjs/throttler`) |
| 4 | Фаза 4 (упразднение CRUD plans → один GET /current) | Фаза 2 frontend (10 компонентов: MarketingHero, CreateLinkCard, IncomeChart на recharts, ClientsTableMasked, PayoutDetailsCard, WithdrawButton, …) |
| 5 | Фаза 5 (frontend PlansClient — одна карточка с AdminSettingField + AdminSettingHistoryDrawer + калькулятор) | Фаза 2a frontend (ReferralPromoStrip + useReferralPromoVisibility + useEffectiveOrgRole + AppShell) |
| 6 (sequential) | Фаза 6 — `// LEGACY` над model Plan + second-brain | — |

**Fact-check после каждого под-агента:** грепом по ключевым маркерам, читал реально изменённые файлы (memory `feedback_agents_can_lie_about_edits` — без верификации не доверять). За всю сессию ни один под-агент не соврал про edit'ы, но один (Фаза 1.2-1.6) сделал side-effect — изменил поведение `AdminReferralsController.detail()` через шаренный `listClients()`. Регрессия найдена мной при fact-check на admin-controller и закрыта **моим Edit'ом** (добавил `listClientsForAdmin()` рядом с маскированным `listClients()`).

**Развилки решал сам:**
- Фаза 2 ТЗ №3: Вариант А (делегирование `calculateMeetingsGrant` в `MeetingsBalanceService`) vs Б (дублирование в `SeatService`). Выбрал А — изоляция ответственности.
- Регрессия admin-controller — `listClientsForAdmin()` (отдельный метод) vs параметризовать `listClients(masked)`. Выбрал первый — семантически чище.
- Throttle для promo-event — `@nestjs/throttler` уже используется в проекте (`inn-lookup.controller.ts`), под-агент сам выбрал.
- `qrcode.react` — добавил новой зависимостью (~3 KB, прямо в ТЗ §11 п.6 уже разрешено).
- `clientCode` маскировки — `'C' + crc32(id).toString(36)` через `node:zlib.crc32` (есть в Bun). Длина ~7 символов.
- `getIncomeChart` — Prisma + in-memory группировка, не raw SQL (совместимо с моками spec'ов).

**Технический долг от Волны 1 — НЕ чинил намеренно** (по инструкции оркестратор-промпта):
- `parseInt(process.env.X, defaultValue)` в `typed-config.service.ts` — известный долг.
- `CLONE_ASK_PER_USER_PER_DAY` deprecated ENV — safety-net для отката.
- ~5 упоминаний `(authenticated)/admin/` в second-brain — отдельный sweep.

Дал явную инструкцию под-агенту Фазы 2 ТЗ №3 — «увидишь рядом legacy-`parseInt`, НЕ копируй паттерн, используй `getDynamic`». Сработало.

## Что вышло

**Backend:**
- `bun run typecheck`: 0 ошибок.
- `bun run build`: exit 0.
- `bunx vitest run` на тронутых модулях (`billing`, `meetings-balance`, `referrals`, `admin/plans`): **183/183 passed** (15 файлов).
- `bun run lint`: 73 warnings (большинство — `Unexpected console statement` в скриптах, по сути намеренные); **1 error** в `tracker/webhooks.controller.ts:24` (pre-existing, не моя зона). Auto-fix починил 50 warnings.
- Prisma `db push` + `generate`: зелёные.

**Frontend:**
- `bun run typecheck` / `bun run lint` / `bun run test:unit` (115/115) / `bun run build`: всё зелёное.
- Новая зависимость `qrcode.react@4.2.0` установлена.

**Файлов изменено/создано:** ~30 (12 backend, 1 schema, 1 seed-новый, 2 admin/plans backend, 6 referrals backend, 2 admin/settings/registry+apply-prod-deploy, 1 metrics, 7 frontend referrals + AppShell + 3 hooks + 2 admin/plans frontend + 2 collateral frontend pages обновлены под удалённый `adminPlansApi.list`).

**Принятые мной развилки** (без эскалации пользователю):
1. Вариант А делегирования calculateMeetingsGrant (Фаза 2 №3).
2. Регрессия admin-controller → отдельный `listClientsForAdmin()`.
3. Side-effect от Фазы 5: подагент №3 обнаружил и **сам** починил собмежные call-сайты `adminPlansApi.list()` в `EntitlementsOverviewClient` и `LimitsClient` — без этого frontend typecheck сломался бы. Это правильный выход за scope, в духе оркестратор-инструкции.

## Чему научился

**Технические грабли — для `code-pitfalls.md`:**

1. **`bun run prisma:push` тихо проходит** при превращении required-поля в optional → tsc-ошибки могут возникнуть в callers, которые сейчас обращаются к `referral.inn.trim()`. Подагент Фазы 1.1 правильно зафиксировал список tsc-ошибок и оставил их **подагенту следующей фазы** — это хороший паттерн контракта между фазами.
2. **`Array.isArray` в JSON-валидации** — лучше явно: `payoutDetails != null && typeof === 'object' && !Array.isArray && Object.keys > 0`. Без `!Array.isArray` массивы прошли бы как valid (а Object.keys на массиве вернёт индексы строками — баг).
3. **Promise<T> в `Prisma.InputJsonValue`** — типчек ловит, но сообщение «Index signature for type 'string' is missing in type 'Promise<T>'» неочевидно. Лечится вытащив `await` на уровень выше в локальную переменную.
4. **`YEARLY_MONTHS = 12` НЕ цена** — это бизнес-формат, должен `export const`, иначе чужие модули (`manual-billing.service.ts:54`, `billing.service.ts:54`) сломаются. Урок: при удалении `export` грепать сначала.
5. **`@Global()` ConfigModule** — `TypedConfigService` доступен без `imports: [...]` в каждом модуле. Подагент Фазы 2 это знал и не добавлял лишний импорт.

**Оркестрационные грабли — для будущих сессий:**

1. **Sub-агент имеет право на side-effect, если он часть полного скоупа.** Подагент Фазы 5 нашёл 2 файла вне списка ТЗ (`EntitlementsOverviewClient`, `LimitsClient`) и сам их починил — это правильно, иначе typecheck бы сломался. ТЗ §6 предупреждало, и подагент применил `Grep "adminPlansApi.(list|create|update|remove)"` перед удалением методов.
2. **Sub-агент может неявно поломать соседний контроллер через шаренный сервис.** `listClients()` стал маскированным — `AdminReferralsController.detail()` потерял `org.name/id`. Регрессия найдена только при моём явном грепе `ReferralsService|referralsService\.` по `backend/src/modules/admin`. **Урок: после переписывания публичного метода сервиса всегда грепать все call-site'ы вне модуля сервиса.**
3. **PowerShell + bun.exe** — stderr через `bun.ps1:14` маркер не означает ошибку, это просто артефакт исполнения. Финальная пустая строка stdout от `tsc --noEmit` = «ноль ошибок». Не пугаться `RemoteException` в выводе.
4. **Параллельный запуск двух под-агентов в одном сообщении** работает чисто, если файлы не пересекаются. Конфликт `git status` (M в файлах чужого агента) — не проблема, главное чтобы каждый агент знал «свои» файлы.

**Бизнес-наблюдения:**

1. **Юридический приоритет маскировки** — нельзя дать партнёру `org.name`/`org.id`. ТЗ §6.4 жёстко это формулирует. Тест в `referrals.service.spec.ts` проверяет отсутствие этих полей в DTO. Контракт: super_admin через отдельный метод видит всё.
2. **AdminSetting + `getDynamic` для billing-параметров** — теперь правка прайса не требует релиза. LRU TTL 30s + Redis pub/sub дают live-update <1s. Активные подписки НЕ пересчитываются (юр.акт, цена зафиксирована в Subscription.monthlyPriceKopecks).
3. **Кэш-friendly promo-флоу:** `localStorage` для dismiss (30 дней) + 24-часовой кэш проверки hasProfile. Без них баннер дёргал бы `referralsApi.getMe()` на каждой странице.

## Незакрытое (для следующих сессий)

- `01_projects/referrals.md` — отсутствующий файл, упомянут в `related_projects` у `03_processes/referral-program.md`. Не создал, чтобы не расширять scope. Кандидат для следующей правки second-brain.
- `text-white` в `ReferralPromoStrip` CTA-кнопке на тёмно-зелёном фоне — частично нарушает memory `feedback_paired_color_tokens` (которое говорит «никогда text-white на цветных»). Подагент обосновал контрастом ≥ 4.5:1. Если будет правка дизайн-системы — заменить на парный токен типа `text-emerald-50`.
- На фронте `payoutDetailsAreFilled` проверяется через `inn !== null && legalForm !== null` как прокси к настоящим банковским реквизитам (они не приходят на фронт ради приватности). Это может не совпадать с backend-проверкой `Object.keys(payoutDetails) > 0`. Кандидат: добавить computed `hasPayoutDetails: boolean` в `Referral`-response DTO (минимально, без раскрытия реквизитов).
- `manual-billing.service.ts:343` имеет `unitKopecks: 100_000 // PER_EXTRA_SEAT_KOPECKS` — захардкоженное значение в DocumentLine счёта. Это **юридический акт** (цена фиксируется на момент Invoice), намеренно не пересчитывается. Кандидат: добавить snapshot price в Invoice-creation flow.

## Связь со второй мозгом

Обновлены:
- `01_projects/admin-settings.md` — добавлена секция «`billing.*` — единый тариф `tier_standard` (2026-05-31)» с таблицей 6 ключей.
- `01_projects/admin-z-global.md` — строка `/admin/orgs/plans` в разделе «Тенанты».
- `01_projects/api-layer.md` — две новые секции: «Партнёрский кабинет — обновление» и «Z-Admin / Тариф — упразднение CRUD».
- `03_processes/referral-program.md` — блок «Обновление 2026-05-31» в начале документа.

Обновлён prod-deploy-log: новая запись «🌊 2026-05-31 — Волна 2: Z-Admin Тариф + Партнёрский кабинет» в разделе «Накоплено к выкату» (выкат не сделан — поедет общим cut'ом вместе с Волной 1).
