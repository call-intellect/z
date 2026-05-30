---
title: Пакет «Коммерческая надёжность Z» — 4 фикса одним спринтом
date: 2026-05-30
type: reflection
plan: plans/tz/2026-05-29-commercial-reliability-package.md
distilled: false
---

# Рефлексия: коммерческая надёжность Z (4 фазы)

## Что было поставлено

ТЗ `plans/tz/2026-05-29-commercial-reliability-package.md`: 4 точечных фикса за 2.5–3 рабочих дня, без рефакторингов и новых Prisma-моделей:

1. **Фаза 1** — Telegram free-note handler (баг с потерей данных): свободная заметка от Telegram-бота не попадала в граф знаний, потому что handler типа `'free_note'` не был зарегистрирован в `ConversationalService.dispatchInbound`.
2. **Фаза 2** — First-touch атрибуция реферальной программы: `AttributionService.attributeOrg` делал безусловный `prisma.org.update`, фактически last-touch (повторный клик по чужому slug перетирал первую атрибуцию).
3. **Фаза 3** — Zoom-модель встречи: продуктовое доделывание — хост не мог переименовать гостя после встречи. Решение владельца — никаких email-приглашений, просто endpoint `PATCH .../participants/:pid` + inline-edit карандашиком в UI результата.
4. **Фаза 4** — Prometheus-метрики для биллинга и рефералов: 11 счётчиков + 1 гистограмма + 3 алёрта + Grafana-дашборд.

Все четыре фазы независимы; делал последовательно.

## Как решал

**Фаза 1 — bridge inline в модуле** (commit `7cacf5f`).

Изначально ТЗ предложил `OnApplicationBootstrap`-хук на самом `ConversationalModule`. Проверил соседний модуль `chat-v2`: там тот же приём реализован через отдельный `@Injectable()` bridge с `OnModuleInit` (`ChatV2OmnichannelBridge`). Скопировал паттерн — получился `ConversationalFreeNoteBridge`, который в `onModuleInit` регистрирует handler `subscribeInbound('free_note', ingest.ingestFreeNote)`. Дополнительно поменял `logger.debug` → `logger.warn` в самой `dispatchInbound` ловушке отсутствующего handler'а — если в будущем кто-то введёт новый `InboundMessage.type` и забудет handler, будет видно в проде.

Тестов написал 4 (подписка, корректный вызов, defensive guard на чужой type, не пробрасывает exception).

**Фаза 2 — `updateMany WHERE pendingAttributionSlug IS NULL`** (commit `e452aa0`).

Минимальное изменение: безусловный `prisma.org.update` → `prisma.org.updateMany WHERE pendingAttributionSlug IS NULL`. При `count === 0` — лог + новая метрика `referral_attribution_first_touch_locked_total` + возвращаем существующую атрибуцию через `resolvePendingForOrg` (для трассировки).

Метрику зарегистрировал сразу (в Фазе 2, а не Фазе 4) — без неё код бы не скомпилировался.

**Фаза 3 — Zoom-rename: endpoint + UI + spec** (commit `acc5477`).

Backend:
- `domain-errors.ts`: 2 новые ошибки — `ParticipantNotFoundError` (404), `ParticipantRenameForbiddenError` (403).
- `meetings.service.ts`: метод `renameParticipant` с трёхуровневой защитой (host через `getForUser`, `findFirst by {id, meetingId}` — path-traversal, `isRegisteredUser=true` отдельная ошибка).
- `meetings.controller.ts`: endpoint `PATCH /api/v1/meetings/:id/participants/:pid` с Zod-схемой `{name: 1..120 chars}`.
- Расширил `getResult.participants` полем `isRegisteredUser` — нужно UI чтобы показать карандашик только у гостей.

Frontend:
- `meetings.api.ts`: метод `renameParticipant` + `isRegisteredUser` в `ResultApiResponse.participants`.
- `MeetingResultPageReal.tsx`: добавил `ParticipantsSection` и `ParticipantRow` — карандашик-кнопка показывается только при `!isRegisteredUser`, клик → input + Enter/Escape + optimistic refresh через `mutateResult`.

5 unit-тестов для backend service.

**Фаза 4 — метрики + алёрты + дашборд** (commit `cf5adfe`).

Зарегистрировал в `BusinessMetricsService` 10 Counter и 1 Histogram + 9 inc-методов и 1 observe. Inc-вызовы подключил в самых критичных местах:
- `AttributionService.record` (success) → `incReferralClick`
- `AttributionService.attributeOrg` (count > 0) → `incReferralSignup`
- `BillingService.finalizePaidInvoice` → `incBillingInvoicePaid` + `incBillingSubscriptionRenewed`
- `ReferralPayoutService.onInvoicePaid` → `incReferralPayoutCreated` + `incReferralPayoutAmountRub`

`tenant_top`/`partner_top` использовал через готовую утилку `tenantTopOf` (cardinality-safe, top-100 buckets через fnv1a). Остальные inc-вызовы (`incBillingInvoiceCreated`, `incBillingSubscriptionCancelled`, `incBillingWebhookReceived`, `observeBillingProviderRequest`) — метрики зарегистрированы, серии появятся при первом вызове.

3 алёрта в `infra/prometheus/alerts/billing-referrals.rules.yml` + Grafana-дашборд `infra/grafana/dashboards/billing-referrals.json` с 4 панелями.

## Что вышло

**Технические:**
- 11 новых счётчиков + 1 гистограмма зарегистрированы.
- 1 новый REST endpoint (`PATCH /api/v1/meetings/:id/participants/:pid`).
- 4 новых файла: bridge spec, rename-participant spec, alerts YAML, Grafana JSON.
- 0 изменений в Prisma schema.
- Все unit-тесты на затронутых модулях зелёные: 4 (bridge) + 8 (attribution) + 5 (rename) + 118 (billing) + 36 (referrals в сумме) ≈ 50+ моих тестов + регрессов нет.

**Карточки процессов:**
- `[[telegram-inbox-ingestion]]`: partial → implemented.
- `[[referral-program]]`: partial → implemented.
- `[[meeting-create-and-invite]]`: partial → implemented (Zoom-model).
- `[[billing-cycle-tochka]]`: observability gap закрыт; общий статус остаётся partial (Tochka prod-OAuth — операция владельца).
- Сводка `03_processes/index.md`: было 18/9, стало 21/6.

**Что не сделано (out of scope намеренно):**
- Маршрутизация expertise/experience/competence → 3-2-knowledge-clone (передано другому).
- Backfill старых блоков знаний.
- Tochka prod-OAuth (операция владельца).
- MailInboundModule ↔ ConversationalModule.
- EventEmitter2 → Redis Streams.
- Email-приглашения / MeetingInvitation / per-guest JWT.
- Опциональная «пригласить сотрудников галочкой».
- Полная обвязка биллинг-метрик инкрементами (subscription cancelled, webhook received, provider duration) — это Phase 7 Tochka prod-OAuth.

## Чему научился

1. **Параллельные сессии нужно проверять перед каждой стейджинг-операцией.** В этом репозитории одновременно работала другая сессия, которая делала свои правки в `dialog-layer`, `operations`, `clones`, `chat-v2.service.ts`. Несколько раз получал `error TS2304` (clones.service.ts), это были чужие незавершённые изменения. Я грепал каждый раз и убеждался что мои файлы чисты. Один раз чужая сессия успела сделать `git add` на всё подряд — пришлось расстейдживать чужие файлы перед коммитом. Память [[feedback_parallel_sessions_git_check]] и [[feedback_git_index_hygiene]] подтверждены: `git status` перед каждым `add`/`commit` обязателен.

2. **Linter / Edit-hook может откатывать мои изменения.** В Фазе 3 несколько раз получил system-reminder «файл изменён линтером» и при следующей проверке оказывалось, что мои новые методы/импорты пропали (`renameParticipant`, `ParticipantNotFoundError`, контроллер endpoint). Восстанавливал заново, перепроверял grep'ом ключевые маркеры до commit. Это подтверждает [[feedback_agents_can_lie_about_edits]] — после Edit делать re-Read/Grep и не доверять «success» в выводе.

3. **Bridge-паттерн в Conversational и chat-v2 — стандарт.** Когда модуль хочет подписаться на чужой inbound через `subscribeInbound`, не пишем хук на самом модуле, а делаем отдельный `@Injectable() class XBridge implements OnModuleInit`. Инкапсуляция чище и тестируется отдельно.

4. **`tenantTopOf` — общая утилка для cardinality-safe лейблов.** Лежит в `src/modules/dialog-layer/utils/tenant-top.ts`. Используется и для `tenant_top` (по `tenantId`) и для `partner_top` (по `slug`) — она просто хеш+modulo, ей всё равно что в неё передавать.

5. **Histogram registration cardinality важна.** Гистограмма `billing_provider_request_duration_seconds` имеет 3 лейбла + 7 buckets — это до ~50 серий на каждого. Достаточно компактно, но хранить в `BusinessMetricsService` не как Counter, а как Histogram (`getOrCreateHistogram`).

## Связанные документы

- ТЗ: [plans/tz/2026-05-29-commercial-reliability-package.md](../../plans/tz/2026-05-29-commercial-reliability-package.md)
- Контекст: [plans/analysis/2026-05-29-processes-gaps-summary.md](../../plans/analysis/2026-05-29-processes-gaps-summary.md)
- Карточки: [[telegram-inbox-ingestion]], [[referral-program]], [[meeting-create-and-invite]], [[billing-cycle-tochka]]

## Коммиты

| # | Хеш | Subject |
|---|---|---|
| 1 | `7cacf5f` | feat(conversational): подписка free_note → ingestFreeNote через ConversationalFreeNoteBridge |
| 2 | `e452aa0` | fix(referrals): first-touch атрибуция через updateMany WHERE pendingAttributionSlug IS NULL |
| 3 | `acc5477` | feat(meetings): Zoom-rename — PATCH /meetings/:id/participants/:pid + UI inline-edit |
| 4 | `cf5adfe` | feat(observability): biller+referral metrics (11+1) + 3 alerts + Grafana dashboard |
