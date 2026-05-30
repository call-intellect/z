---
title: ТЗ — Пакет коммерческой надёжности Z (4 фикса)
date: 2026-05-29
status: ready_for_execution
owner: Сергей
related:
  - plans/analysis/2026-05-29-processes-gaps-summary.md
  - plans/analysis/2026-05-29-business-processes-catalog.md
  - second-brain/03_processes/index.md
phases: 4
estimated_effort: 2-3 рабочих дня (одним разработчиком)
---

# Пакет «Коммерческая надёжность Z» — 4 фикса одним спринтом

## 0. Зачем это ТЗ

Каталог процессов (Волна 1-3, 2026-05-29) обнаружил 5 критических расхождений. После проверки кода 2026-05-29 и обсуждения с владельцем картина уточнилась:

- **Self-referral блок** оказался **уже реализован** ([business-metrics.service.ts:1367-1380](../../backend/src/common/metrics/business-metrics.service.ts#L1367)) — убираем из Фазы 2.
- **Auto-invite гостя** переосмыслен в **модель Zoom**: одна гостевая ссылка, гость представляется именем при входе (это уже работает в коде: [GuestNameForm.tsx:46](../../frontend/src/ui/components/lobby/GuestNameForm.tsx#L46)), хост может переименовать после встречи. Это **минимальная фаза**, не «новая модель Prisma + шаблон письма».
- **Маршрутизация специалистов 3.2/3.7** вынесена из пакета — передана другому сотруднику.

Итого пакет сократился с 5 фаз на 5-7 дней → **4 фазы на 2-3 дня**.

---

## 1. Принципы

- **Источник правды** — `plans/analysis/2026-05-29-processes-gaps-summary.md` + проверка по коду 2026-05-29.
- **Минимальное изменение.** Без рефакторингов, без новых моделей Prisma, без новых модулей.
- **Без feature-флагов.** Каждый фикс либо «работает», либо «нет».
- **Тесты обязательны.** Unit + integration по одному happy-path и одному edge-case на фазу.
- **Раскатка** — стандартный `docker-compose up -d --build`. Schema.prisma не меняется ни в одной фазе.
- **Acceptance** — после каждой фазы обновить раздел 8 затронутой карточки в `second-brain/03_processes/` и `last_audited`.

---

## 2. Карта фаз

| # | Фаза | Затронутые процессы | Цена |
|---|---|---|---|
| 1 | Telegram free-note handler | [[telegram-inbox-ingestion]], [[raw-event-to-graph]] | ~1 час |
| 2 | First-touch атрибуция | [[referral-program]] | ~3 часа |
| 3 | Zoom-модель встречи: переименование гостя после встречи | [[meeting-create-and-invite]] | ~1 день |
| 4 | Prometheus-метрики биллинга и рефералов + 3 алёрта | [[billing-cycle-tochka]], [[referral-program]] | ~1 день |

**Все 4 фазы независимы.** Можно паралеллить или делать в любом порядке.

---

## 3. Фаза 1 — Telegram free-note handler

### 3.1 Контекст
Свободная заметка от Telegram-бота попадает в `ConversationalService.dispatchInbound()` с `type='free_note'`, но **handler не зарегистрирован**. Сообщение пишется в DEBUG-лог и теряется. Подтверждено по [conversational.service.ts:741-766](../../backend/src/modules/conversational/conversational.service.ts#L741) — комментарий разработчика явно говорит «Для 'free_note' хотим хотя бы лог».

In-app цепочка через `POST /api/v1/me/notifications/free-note` работает — значит `ConversationalIngestAdapter.ingestFreeNote()` существует и не сломан.

### 3.2 Изменения

**Файл:** `backend/src/modules/conversational/conversational.module.ts` — добавить `OnApplicationBootstrap`-хук:

```ts
import { Module, OnApplicationBootstrap, Inject } from '@nestjs/common';
import { ConversationalService } from './conversational.service';
import { ConversationalIngestAdapter } from './adapters/conversational-ingest.adapter';

@Module({...})
export class ConversationalModule implements OnApplicationBootstrap {
  constructor(
    @Inject(ConversationalService) private readonly conversational: ConversationalService,
    @Inject(ConversationalIngestAdapter) private readonly ingest: ConversationalIngestAdapter,
  ) {}

  onApplicationBootstrap(): void {
    this.conversational.subscribeInbound('free_note', (msg) =>
      this.ingest.ingestFreeNote({
        userId: msg.userId,
        tenantId: msg.tenantId,
        text: msg.text,
        metadata: msg.metadata,
      }),
    );
  }
}
```

Если `ConversationalIngestAdapter` не экспортируется из ConversationalModule — добавить в `providers + exports`.

**Файл:** `backend/src/modules/conversational/conversational.service.ts:750` — поменять `logger.debug` на `logger.warn`:

```ts
// было:
this.logger.debug(`dispatchInbound: нет handlers для type=${msg.type}; ...`);
// стало:
this.logger.warn(`dispatchInbound: нет handlers для type=${msg.type}; ...`);
```

Чтобы регрессии (новый тип без handler'а) ловились.

### 3.3 Тесты

**Unit (новый `conversational.module.spec.ts`):**
- При старте модуля handler для `free_note` зарегистрирован.
- `dispatchInbound({type:'free_note', ...})` вызывает `ingestFreeNote` с корректными аргументами.

**Integration:**
- POST в `/api/v1/webhooks/telegram-bot` с реальным free-note текстом → в БД появляется `RawEvent(sourceType='conversational')`.

### 3.4 Acceptance Criteria
- ✅ Карточка [[telegram-inbox-ingestion]] Шаг 5: ❌ → ✅, `status_overall: partial → implemented`.
- ✅ `logger.warn` про `free_note` молчит после деплоя.
- ✅ Один сквозной интеграционный тест зелёный.

---

## 4. Фаза 2 — First-touch атрибуция

### 4.1 Контекст
В коде [attribution.service.ts:11-19](../../backend/src/modules/referrals/services/attribution.service.ts#L11) написан комментарий:
> attributeOrg() идемпотентно: если у Org уже есть pendingAttributionSlug

Но фактическая реализация на [attribution.service.ts:136-142](../../backend/src/modules/referrals/services/attribution.service.ts#L136) **безусловно перезаписывает** поле — это last-touch, не first-touch. **Bug в реализации, не дизайн.**

**Self-referral блок и ИНН-mismatch — уже реализованы** ([business-metrics.service.ts:1367-1380](../../backend/src/common/metrics/business-metrics.service.ts#L1367)) под audit Б6. Эту часть из пакета убираем.

### 4.2 Изменения

**Файл:** `backend/src/modules/referrals/services/attribution.service.ts:136-142`

```ts
// было:
await this.prisma.org.update({
  where: { id: input.tenantId },
  data: {
    pendingAttributionSlug: attribution.slug,
    pendingAttributionAt: now,
  },
});

// стало:
const result = await this.prisma.org.updateMany({
  where: {
    id: input.tenantId,
    pendingAttributionSlug: null,  // ← first-touch guard
  },
  data: {
    pendingAttributionSlug: attribution.slug,
    pendingAttributionAt: now,
  },
});

if (result.count === 0) {
  // Уже была first-touch атрибуция; не перезаписываем.
  this.logger.log(
    `attributeOrg ${input.tenantId}: first-touch уже зафиксирован, ` +
    `повторный клик по ${attribution.slug} проигнорирован`,
  );
  this.metrics.incReferralAttributionFirstTouchLocked();  // см. Фазу 4
  // Возвращаем существующую атрибуцию для логирования вызова.
  const pending = await this.resolvePendingForOrg(input.tenantId);
  return pending
    ? { referralId: pending.referralId, slug: pending.slug, attributionId: '' }
    : null;
}
```

**Семантика clearPendingForOrg сохраняется:** после оплаты и создания `ClientReferralLink` поле `pendingAttributionSlug` обнуляется (line 181-186) — если у того же пользователя позже появится новая Org, она получит свою first-touch атрибуцию.

### 4.3 Тесты

**Unit (`attribution.service.spec.ts` — расширить):**
1. Первый клик: `pendingAttributionSlug` IS NULL → атрибуция записана, `updateMany.count === 1`.
2. Повторный клик другим slug: `pendingAttributionSlug` IS NOT NULL → не перезаписана, метрика `referral_attribution_first_touch_locked_total` инкрементирована.
3. После `clearPendingForOrg` следующий клик снова first-touch.

**Integration:**
4. End-to-end: создать `Referral A` → клик `?ref=A` → создать `Referral B` → клик `?ref=B` → регистрация → оплата → `ClientReferralLink` указывает на A, не B.

### 4.4 Acceptance Criteria
- ✅ Карточка [[referral-program]] Раздел 8 §3.7 (last-touch): закрыт.
- ✅ `status_overall: partial → implemented`.
- ✅ Все 4 теста зелёные.

### 4.5 Метрики (используются в Фазе 4)
- `referral_attribution_first_touch_locked_total` — новый счётчик «повторный клик отброшен».

---

## 5. Фаза 3 — Zoom-модель встречи: переименование гостя

### 5.1 Контекст

**Что уже работает в коде** (проверено 2026-05-29):
- `POST /api/v1/meetings` — возвращает `{id, url: '/m/${id}'}`. **Одна гостевая ссылка** ([meetings.controller.ts:124-142](../../backend/src/modules/meetings/meetings.controller.ts#L124)).
- Гостевой вход на `/m/[id]` — публичная страница ([(public)/m/[id]/page.tsx](../../frontend/app/(public)/m/[id]/page.tsx)).
- Если гость залогинен в Z — автоопределение через cookie.
- Если не залогинен — `<Lobby>` показывает `<GuestNameForm>` с обязательным полем имени ([GuestNameForm.tsx:37-46](../../frontend/src/ui/components/lobby/GuestNameForm.tsx#L37)).
- Имя гостя отправляется в `/join` как `{ guest_name: trimmed }` и сохраняется в `Participant.name`.

**Что НЕ работает:** хост **не может переименовать гостя после встречи**. Если гость представился «Гость 1», в записи и AI-отчёте навсегда останется «Гость 1». Endpoint `PATCH .../participants/:pid/name` или подобный — отсутствует (проверено grep'ом по `updateName|rename|setName` в `meetings/` — нет совпадений).

**Решение владельца 2026-05-29:** делаем именно Zoom-модель — никаких email-приглашений, никакой модели `MeetingInvitation`. Только:
1. Возможность хосту переименовать `Participant.name` после встречи (inline-edit в UI результата).
2. AI-отчёт корректно показывает обновлённое имя.

### 5.2 Изменения

#### 5.2.1 Endpoint `PATCH /api/v1/meetings/:id/participants/:pid`

**Файл:** `backend/src/modules/meetings/meetings.controller.ts` — добавить метод (рядом с host-controls):

```ts
const UpdateParticipantSchema = z.object({
  name: z.string().min(1).max(120),
});
type UpdateParticipantBody = z.infer<typeof UpdateParticipantSchema>;

@Patch(':id/participants/:pid')
@RequireSubscription()
@HttpCode(HttpStatus.OK)
async updateParticipant(
  @Param('id') meetingId: string,
  @Param('pid') participantId: string,
  @Body(new ZodValidationPipe(UpdateParticipantSchema)) body: UpdateParticipantBody,
  @CurrentUser() user: CurrentUserPayload,
): Promise<{ id: string; name: string }> {
  const updated = await this.meetings.renameParticipant({
    meetingId,
    participantId,
    newName: body.name,
    actorUserId: user.id,
  });
  return { id: updated.id, name: updated.name };
}
```

**Файл:** `backend/src/modules/meetings/meetings.service.ts` — добавить метод:

```ts
async renameParticipant(args: {
  meetingId: string;
  participantId: string;
  newName: string;
  actorUserId: string;
}): Promise<Participant> {
  // 1. Проверка ownership: только хост встречи может переименовывать.
  await this.getForUser(args.meetingId, args.actorUserId);
    // ↑ бросит NotAuthorizedError если actor не хост

  // 2. Найти Participant в рамках meetingId (защита от path-traversal).
  const participant = await this.prisma.participant.findFirst({
    where: { id: args.participantId, meetingId: args.meetingId },
  });
  if (!participant) {
    throw new ParticipantNotFoundError(args.participantId);
  }

  // 3. Запретить переименование залогиненного пользователя
  //    (его имя берётся из User.name, переименовать через карточку встречи не логично).
  if (participant.isRegisteredUser) {
    throw new ForbiddenError(
      'Невозможно переименовать зарегистрированного участника. ' +
      'Его имя берётся из аккаунта.',
    );
  }

  // 4. Обновить.
  const updated = await this.prisma.participant.update({
    where: { id: args.participantId },
    data: { name: args.newName.trim() },
  });

  this.metrics.incParticipantRenamed();  // см. Фазу 4
  this.logger.log(
    `participant renamed: meeting=${args.meetingId} pid=${args.participantId} ` +
    `oldName="${participant.name}" newName="${args.newName.trim()}" by=${args.actorUserId}`,
  );

  return updated;
}
```

#### 5.2.2 UI inline-edit имени гостя на странице результата

**Файл:** `frontend/app/(public)/m/[id]/MeetingPageShell.tsx` или `MeetingFinishedPlaceholder.tsx` (в зависимости от того, где показывается список участников после встречи).

Логика:
- Если `role === 'host'` и `participant.isRegisteredUser === false` — рядом с именем показать карандашик (pencil icon).
- Клик по карандашику → input + кнопка «Сохранить» / Enter.
- На submit → `meetingsApi.updateParticipant(meetingId, pid, { name })`.
- Optimistic update + откат при ошибке.
- Refresh страницы НЕ нужен — обновляем локальный state.

UX-копия:
- Плейсхолдер input: «Введите имя участника»
- Tooltip на карандашик (host-only): «Переименовать гостя»
- Toast при успехе: «Имя обновлено»

#### 5.2.3 Обновление AI-отчёта

**Простое решение для MVP** — AI-отчёт уже хранит имена не как fixed-strings, а через ссылки на участников. Когда хост открывает страницу результата заново — она подгружает свежий `getResult()` → новые имена подставляются автоматически.

**Если** в `AiResult.structuredData` имена закэшированы как обычный текст и НЕ обновляются — тогда:
- На странице результата сделать **substitution**-слой на frontend: брать transcript-блоки с `participantId` и подставлять текущее `Participant.name` из `meeting.participants` map. Без regenerate.

Проверить локально, как ведёт себя текущий код, и если нужна fixed-string подстановка — добавить её. **Не делать regenerate AI-отчёта** — это дорого и нелогично (отчёт не меняется, меняется одна метка).

### 5.3 Тесты

**Unit (`meetings.service.spec.ts` — расширить):**
1. `renameParticipant` хостом → имя обновлено, метрика инкрементирована.
2. `renameParticipant` НЕ-хостом → `NotAuthorizedError`.
3. `renameParticipant` зарегистрированного участника → `ForbiddenError`.
4. `renameParticipant` несуществующего participantId → `ParticipantNotFoundError`.
5. `renameParticipant` participantId из другой встречи → `ParticipantNotFoundError` (защита от path-traversal).

**Integration:**
6. End-to-end: гость залогинился как «Гость 1» → встреча закончилась → хост вызвал `PATCH .../name { name: 'Иван Петров' }` → `GET .../result` показывает «Иван Петров».

### 5.4 Acceptance Criteria
- ✅ Endpoint `PATCH /api/v1/meetings/:id/participants/:pid` работает с RBAC (только хост).
- ✅ UI на странице результата позволяет хосту inline-редактировать имя гостя.
- ✅ Все 6 тестов зелёные.
- ✅ Карточка [[meeting-create-and-invite]] обновлена: §1.6 «auto-invite» закрыт **продуктовым решением Zoom-модели** (не email-инвайтом). `status_overall: partial → implemented`.

### 5.5 Метрики (используются в Фазе 4)
- `participant_renamed_total` — счётчик переименований гостя.

### 5.6 Что НЕ делаем в этой фазе
- ❌ Модель `MeetingInvitation` — не нужна.
- ❌ Шаблоны писем — не нужны.
- ❌ Per-guest JWT — текущий guest-flow и так работает.
- ❌ Опциональная фича «пригласить сотрудников галочкой» — отдельная задача, не сейчас.
- ❌ Auto-rebuild AI-отчёта при переименовании — переподстановка на чтении.

---

## 6. Фаза 4 — Prometheus-метрики биллинга/рефералов + 3 алёрта

### 6.1 Контекст
В `business-metrics.service.ts` (~50 KB) нет ни одной метрики `billing_*` / `invoice_*` / `subscription_*`. Из реферальных уже есть:
- `referral_self_referral_denied_total` ([line 1368](../../backend/src/common/metrics/business-metrics.service.ts#L1368))
- `referral_inn_mismatch_total` ([line 1374](../../backend/src/common/metrics/business-metrics.service.ts#L1374))

Остальные нужно добавить. Шаблон регистрации — `getOrCreateCounter` / `getOrCreateHistogram`, как сделано во всех существующих метриках.

### 6.2 Изменения

#### 6.2.1 Биллинг (6 новых метрик)

**Файл:** `backend/src/common/metrics/business-metrics.service.ts` — добавить регистрации и inc-методы по шаблону `tochkaWebhookReplayTotal`:

```ts
billing_invoice_created_total: Counter {
  labels: ['tenant_top', 'kind'] // kind: acquiring | bank | manual
}
billing_invoice_paid_total: Counter {
  labels: ['tenant_top', 'kind']
}
billing_subscription_renewed_total: Counter {
  labels: ['tenant_top', 'tier']
}
billing_subscription_cancelled_total: Counter {
  labels: ['tenant_top', 'reason'] // user_cancelled | payment_failed | manual_admin
}
billing_webhook_received_total: Counter {
  labels: ['provider', 'status'] // provider=tochka; status=ok|sig_fail|replay|invalid_payload
}
billing_provider_request_duration_seconds: Histogram {
  labels: ['provider', 'method', 'status']
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30]
}
```

#### 6.2.2 Рефералы (4 новых метрики)

```ts
referral_click_total: Counter { labels: ['partner_top'] }
referral_signup_total: Counter { labels: ['partner_top'] }
referral_payout_created_total: Counter { labels: ['cron_run_date'] } // YYYY-MM-DD
referral_payout_amount_rub_total: Counter {}
referral_attribution_first_touch_locked_total: Counter {} // ← из Фазы 2
```

`partner_top` = sha256 от slug первые 8 hex (как делается `tenant_top` в других метриках).

#### 6.2.3 Встречи (1 новая метрика)

```ts
participant_renamed_total: Counter {} // ← из Фазы 3
```

#### 6.2.4 Вызовы из бизнес-кода

Точечно добавить:
- `BillingService.createInvoice()` → `incBillingInvoiceCreated`
- `BillingService.markPaid()` → `incBillingInvoicePaid`
- `BillingCycleCron` → `incBillingSubscriptionRenewed` / `incBillingSubscriptionCancelled`
- `TochkaWebhookController.handle()` → `incBillingWebhookReceived` (status по результату verify)
- `TochkaProvider.callApi()` → `observeBillingProviderRequest` (wrapper)
- `ReferralsController.click()` → `incReferralClick`
- `AttributionService.attributeOrg` → `incReferralSignup` (при первой атрибуции, успешный insert) + `incReferralAttributionFirstTouchLocked` (при отброшенном повторном клике)
- `ReferralPayoutCron` → `incReferralPayoutCreated` + `incReferralPayoutAmountRub(amount)`
- `MeetingsService.renameParticipant` → `incParticipantRenamed`

#### 6.2.5 Alertmanager rules

**Файл:** `infra/prometheus/alerts/billing-referrals.rules.yml` (новый):

```yaml
groups:
  - name: billing-referrals
    interval: 1m
    rules:
      - alert: BillingNoPaymentsLong
        expr: rate(billing_invoice_paid_total[1h]) == 0
        for: 4h
        labels:
          severity: warning
          team: platform
        annotations:
          summary: "Биллинг: 4 часа никто не платит"
          description: "Проверь webhook-цепочку Точки и логи."

      - alert: BillingWebhookSignatureFailures
        expr: increase(billing_webhook_received_total{status="sig_fail"}[10m]) > 5
        for: 1m
        labels:
          severity: critical
          team: platform
        annotations:
          summary: "Точка прислала битые подписи (>5 за 10 мин)"
          description: "Проверь BillingProviderConfig и JWK."

      - alert: ReferralPayoutCronDidNotRun
        expr: sum(referral_payout_created_total) by (cron_run_date) == 0 and on() (day_of_month() == 11)
        for: 4h
        labels:
          severity: critical
          team: platform
        annotations:
          summary: "Cron выплат рефералов не отработал 10-го"
          description: "Проверь @Cron('0 0 10 * *') и прибей вручную если надо."
```

#### 6.2.6 Grafana-дашборд

**Файл:** `infra/grafana/dashboards/billing-referrals.json` (новый).

4 панели:
1. **Биллинг сегодня** — invoice_created/paid/cancelled за 24h.
2. **Webhook здоровье Точки** — status pie + 4h trend.
3. **Реферальная воронка** — click → signup → paid → payout по партнёрам (топ-10).
4. **Latency банка** — гистограмма по p50/p95/p99.

### 6.3 Тесты

**Unit:**
- Регистрация метрик в `BusinessMetricsService` не падает при двойной инициализации (для тестов).
- inc-методы корректно проксируют в Prometheus.

**Integration:**
- Сэмулировать pay-invoice → `billing_invoice_paid_total` инкрементится.

### 6.4 Acceptance Criteria
- ✅ Через `/metrics` доступны 11 новых счётчиков и 1 гистограмма.
- ✅ Alertmanager-конфиг подключён, тестовый алёрт «загорается» в staging.
- ✅ Grafana-дашборд сохранён в репо.
- ✅ Карточки [[billing-cycle-tochka]] и [[referral-program]] обновлены: observability gap (§5 сводного отчёта) закрыт.
- ✅ Запись в `docs/operations/prod-deploy-log.md` Шаг 12: smoke `/metrics | grep billing_`.

### 6.5 Что НЕ в скоупе
- Метрики observability для других модулей.
- SLO/SLI на бизнес-показатели.
- Логирование в Loki.

---

## 7. Roadmap (последовательность работ)

### День 1 (≤4 часов)
- **Фаза 1** — Telegram free-note handler (~1 час).
- **Фаза 2** — First-touch (~3 часа).

После Дня 1 — закрыты **2 самых критичных gap'а** (free-note, last-touch). Можно деплоить.

### День 2
- **Фаза 3** — Zoom-модель переименования гостя (1 день).

### День 3
- **Фаза 4** — Метрики и алёрты (1 день).

**Резерв:** 0.5 дня на отладку.

**Итого: 2.5-3 рабочих дня.**

---

## 8. Что НЕ в скоупе пакета

Намеренно вынесены — отдельные задачи:

- **Маршрутизация expertise/experience/competence → 3-2-knowledge-clone** (§2.1 сводного отчёта) — передано другому сотруднику, не в этом пакете.
- **Backfill старых блоков** — там же.
- **Tochka prod-OAuth** (Фаза 7 ТЗ 2026-05-27) — операция владельца, не разработка.
- **Объединение MailInboundModule ↔ ConversationalModule** (§3.5) — большой рефакторинг.
- **EventEmitter2 → Redis Streams** (§3.8) — только при горизонтальном масштабировании.
- **Унификация двух онбординг-блоков** (§3.11) — отдельная фаза с продактом.
- **Legacy-пути в 3-1 и 3-4** (§2.2) — отдельный план миграции.
- **Опциональная фича «пригласить своих сотрудников галочкой»** — для in-app встреч, отдельная задача после стабилизации Zoom-модели.

Эти 8 пунктов складываются в **следующий зонтик «Архитектурный долг»**.

---

## 9. Acceptance Criteria всего пакета

### Карточки процессов (status_overall)
- [[telegram-inbox-ingestion]] — `partial → implemented`
- [[referral-program]] — `partial → implemented`
- [[meeting-create-and-invite]] — `partial → implemented`
- [[billing-cycle-tochka]] — observability gap закрыт; общий статус остаётся `partial` (Фаза 7 Tochka prod-OAuth — операция владельца)

### Технические
- **11 новых счётчиков** + 1 гистограмма Prometheus.
- **3 алёрта** Alertmanager.
- **1 Grafana-дашборд** в репо.
- **1 новый REST-endpoint** `PATCH /api/v1/meetings/:id/participants/:pid`.
- **0 новых Prisma-моделей** (схема не меняется!).
- **Все unit + integration тесты зелёные** (~15 новых).

### Документы
- [[plans/analysis/2026-05-29-processes-gaps-summary]] — §1.1, §1.6, §3.7, §5 помечены `resolved`.
- `docs/operations/prod-deploy-log.md` обновлён Шаг 12 (smoke новых endpoint/metrics).
- Рефлексия в `second-brain/05_история/2026-MM-DD-commercial-reliability-pack.md`.

---

## 10. Закрытые открытые вопросы

| # | Вопрос | Решение | Источник |
|---|---|---|---|
| 1 | Гости на встречу — обязательно при создании? | ❌ Отказались от поля. Zoom-модель: одна гостевая ссылка, имя при входе. | Владелец 2026-05-29 |
| 2 | Лимит гостей? | N/A. Лимит участников встречи остаётся 10 (LiveKit-комната). | — |
| 3 | Уведомлять при изменении встречи? | Нет, Z вообще ничего гостям не шлёт. | Владелец 2026-05-29 |
| 4 | Cancel-link в письме? | N/A. Писем нет. | — |
| 5 | Куда `expertise/experience/competence`? | Вынесено, передано другому сотруднику. | Владелец 2026-05-29 |
| 6 | Backfill? | Вынесено вместе с (5). | Владелец 2026-05-29 |
| 7 | Warning vs critical для алёртов? | 4h без оплат = warning; sig_fail >5 = critical; реф-cron 11-го +4h = critical. | Главный агент по эвристике, владелец принял. |
| 8 | Окно алёрта реф-cron? | 11-го числа после 4ч простоя. | То же. |

**Все вопросы закрыты. ТЗ готов к старту.**

---

## 11. Связанные документы

- [Сводный отчёт расхождений](../analysis/2026-05-29-processes-gaps-summary.md) — источник 5 находок.
- [ТЗ каталога процессов](../analysis/2026-05-29-business-processes-catalog.md) — почему появился реестр.
- [Карточки процессов](../../second-brain/03_processes/index.md) — детальное описание каждого процесса.
- [ТЗ биллинга](2026-05-27-billing-tochka-referral-dadata-z.md) — родительский план для Фазы 7 Tochka.
