---
type: tz
status: ready-to-implement
date: 2026-06-02
updated: 2026-06-02
owner: sergrv80@gmail.com
relates_to:
  - second-brain/01_projects/admin.md
  - second-brain/02_architecture/module-map.md
  - second-brain/02_architecture/knowledge-core.md
  - backend/src/modules/curation/services/curation.service.ts
  - backend/src/modules/ai/services/multi-agent-debate.service.ts
  - backend/src/modules/conversational/conversational.service.ts
  - backend/src/modules/conversational/adapters/telegram-bot/telegram-digest.cron.ts
  - frontend/src/ui/components/app-shell/Sidebar.tsx
phases:
  - A0
  - A1
  - A2
  - B0
  - B1
  - B2
  - B3
  - B4
  - B5
---

> **Статус:** ТЗ готово к реализации (v2, 2026-06-02). Развилки закрыты и обоснованы. Стартовать с **Фазы A0**. Любая новая развилка по ходу — вопрос владельцу через issue, не решать «по-своему».
>
> **v2-изменение:** добавлена **Часть A — Лестница доверия** (сжать число подтверждений в источнике) перед **Частью B — Action Center** (сделать оставшийся остаток непропускаемым). Обоснование — раздел «Доказательство v2».

# Подтверждения в Z: меньше — и невозможно пропустить

## Зачем (проблема)

В Z есть места, где **человек — владелец, админ компании или назначенный куратор — обязан что-то подтвердить**, прежде чем знание станет авторитетным или задача поедет дальше. Аудит кода (2026-06-02) выявил два независимых дефекта:

**Дефект 1 — подтверждений слишком много, и большинство не нужны.** Триаж курации ([curation.service.ts:118-120](../../backend/src/modules/curation/services/curation.service.ts#L118)) гонит к человеку:
- всё, что ниже `autoThreshold` (0.85);
- **все `criticalTypes` — `regulation` / `process` / `decision` — всегда, независимо от уверенности.** Значит каждое решение из каждой встречи бьётся об это правило. При этом в пути курации **нет AI-проверки вообще** — это «порог + человек». А при 30 людях в админке человек начинает «соглашаться не глядя» (`feedback_no_human_in_loop_for_clone_learning`).

**Дефект 2 — оставшиеся подтверждения повисают молча.** ≥5 разрозненных очередей без единого источника правды; на desktop в [AppShell](../../frontend/src/ui/components/app-shell/AppShell.tsx) **нет колокольчика**; `expiresAt` у `CurationItem` — **мёртвое поле** (нет крона, который эскалирует/закрывает); дайджест эти очереди не показывает; страница `/curation` не в навигации.

Источники «ждёт человека»:

| Источник | Что висит | Кто должен | Видно сейчас? |
|---|---|---|---|
| `CurationItem(status=pending)` — [curation.service.ts:266](../../backend/src/modules/curation/services/curation.service.ts#L266) | Карточка знания на проверке (крит. типы — всегда) | куратор → fallback owner/admin | ❌ `/curation` не в навигации; уведомление **один раз** |
| `ConflictItem(status=open)` | Противоречие фактов | owner/admin | ❌ `/curation/conflicts` не в навигации |
| `IntakeIssue(status=pending)` | Задача из встречи (увер. < 0.92) | owner/admin | ✅ `/intake` с живым бейджем |
| `Notification(responseStatus=pending)` | probe-вопрос Коры | адресат | ❌ `/feed/probe-questions` не в навигации |

## Цель

1. **Часть A — Лестница доверия:** агент решает сам там, где это безопасно → число подтверждений падает до настоящего остатка.
2. **Часть B — Action Center:** единый контур, где оставшийся остаток **горит** (бейдж, колокольчик, красные плитки) и **напоминает** (Telegram каждые 3 ч батчем), с быстрым путём «тап → посмотрел → подтвердил».

Части комплементарны: A минимизирует число, B делает оставшиеся невозможными для пропуска. Без A каналы Части B шумят; без B остаток A теряется.

---

## Доказательство v2: почему «лестница доверия», а не «просто понизить порог»

Решение обязано одновременно удовлетворять **четырём** ограничениям; кто жертвует хоть одним — хуже:
1. меньше человеческих подтверждений; 2. без роста молчаливых ошибок; 3. ограниченная стоимость; 4. самокоррекция.

Состязательная проверка альтернатив:

| Альтернатива | Ломается на |
|---|---|
| **Просто понизить `autoThreshold` / убрать `criticalTypes`** | №2 — меняет подтверждения на тихие ошибки 1:1, игнорирует влияние карточки. |
| **Только Action Center (человек, но громче)** | №1 — число подтверждений не падает → усталость / слепое «да». |
| **Авто-принимать всё + только пост-фактум откат** | №2 — откат без **детектора** не есть безопасность: ошибку ловят, лишь если человек случайно наткнётся, а он не смотрит. |
| **AI-судья на ВСЁ (заменить человека дебатом)** | №3 (дорого на каждую) + №2 (судья делит слепые зоны с экстрактором → коррелированные ошибки → ложный консенсус). |

**Лестница доверия — единственная точка, проходящая все четыре**, потому что расцепляет три вещи, которые текущая система слила в один порог + бинарный флаг: *кто решает* / *пригодна ли карточка к использованию* / *какой уровень доверия показан*. Расцепив, можно дать агенту решать (№1), оставить карточку рабочей, **всё равно пометить и поймать ошибку дешёвым детектором** (№2), судить только среднюю полосу (№3), и подстраивать пороги по override-метрике (№4).

**Сильнейший аргумент:** понижать порог безопасно ⇔ уверенность калибрована **И** ошибки детектируемы **И** обратимы. Сегодня есть калибровка (`calibratedConfidence`, W2.2), но **нет детектора** и **нет маркировки доверия**. Лестница добавляет ровно эти два недостающих предусловия (детектор = AI-судья + аудит-выборка; маркировка = провизорный уровень). То есть лестница — **не альтернатива идее «понизить порог», а предусловие, делающее её корректной.**

**Встроенный kill-switch:** если override-rate на провизорном уровне для типа остаётся высоким после N наблюдений — система **сама** возвращает тип к человеку. Худший исход ошибочных допущений — откат к сегодняшнему поведению по конкретному типу, не катастрофа.

Все кирпичи существуют (связываем, не изобретаем): `MultiAgentDebateService.judge()` ([multi-agent-debate.service.ts](../../backend/src/modules/ai/services/multi-agent-debate.service.ts)) — мульти-голос с majority-verdict; `calibratedConfidence` уже считается в `triage()`; обратимость — история `CardVersion` + `recordDecision` («это неверно» → обучающий сэмпл); метрики `incCurationDecision` / `incCurationAutoCanonical` уже пишутся (источник override-rate).

## Развилки (закрыты)

1. **Лестница vs плоское понижение порога** → лестница (доказано выше).
2. **Где судит AI вместо человека** → только **средняя полоса** (провизорный уровень). Не на всё (дорого + коррелированные ошибки), не нигде (тогда нет детектора).
3. **Критические типы (`regulation`/`process`/`decision`)** → больше **не блокируются человеком безусловно**; уверенные проходят AI-судью и становятся **провизорно-каноническими с меткой «не подтверждено человеком»**, пригодны к использованию, легко оспариваются. К человеку (Часть B) идёт только: жёсткий конфликт, ИЛИ (низкая увер. И высокое влияние), ИЛИ AI-судьи разошлись.
4. **Дрейф калибровки** → выборочный человеческий аудит 5% авто/провизорных решений + мониторинг override-rate.
5. **Пороги** → ключатся на `calibratedConfidence`, **пер-типовые** (у `decision` свой, у мелких фактов свой), хранятся в `AdminSetting`, автоподстраиваются по override-rate в рамках guardrail'ов.
6. **One-tap подтверждение в Telegram** → только для light-review; критические/deep/конфликты — только deep-link (анти-штамповка). Курация — CRUD-решение, не probe-вопрос, поэтому запрет inline-кнопок probe (`feedback_probe_no_buttons_text_voice_only`) тут не действует.
7. **Snooze** → generic-таблица `PendingActionSnooze(userId, resourceType, resourceId, snoozedUntil)`, не поле в каждой модели.
8. **Скоуп источников Action Center (MVP)** → `CurationItem`, `ConflictItem`, `IntakeIssue`, probe-вопросы. Не входит: `OrgInvitation`, биллинг-подтверждения super_admin.

## Архитектура

```
 источники ──► ┌──────────────── Часть A: Лестница доверия ───────────────┐
 (специалисты   │ triage(calibratedConfidence × impact × reversibility)     │
  Слоя 3)       │   ├─ A: авто-доверие        → canonical (без метки)        │
                │   ├─ B: авто-провизорно     → MultiAgentDebateService.judge│
                │   │      └ consensus → canonical + метка «не подтв.»        │
                │   └─ C: человек             → CurationItem(pending) ──┐     │
                └─────────────────────────────────────────────────────│─────┘
                                                                        ▼
                       ┌──────────── Часть B: Action Center ────────────────┐
        PendingActionsService (агрегатор + providers) ◄── PendingActionSnooze│
                       │  count() / list()                                   │
        ┌──────────┬───┴────────┬──────────────┬─────────────────┐
        ▼          ▼            ▼              ▼                 ▼
   Sidebar badge  Bell    Dashboard tiles  Telegram cron    Daily digest
```

---

# ЧАСТЬ A — Лестница доверия (сжать число подтверждений)

## Фаза A0 — Калиброванные пер-типовые пороги (низкий риск, без удаления гейтов)

**Цель:** дать рычаги и начать мерить, ничего пока не ослабляя.

**Что входит:**
- Триаж ключить на `calibratedConfidence` (уже считается), а не на сыром `confidence`, для сравнения с порогами.
- **Пер-типовые** `autoThreshold` / `deepReviewThreshold` в настройках Org (`curationSettings` уже Json) — у `decision` свой порог, у мелких фактов свой. Дефолты — в `AdminSetting` (поток крутилок).
- Метрика override-rate: агрегатор по `incCurationDecision` (reject+edit / total) per `resourceType` + endpoint для дашборда наблюдаемости (внутренний/админский).

**Что НЕ входит:** изменение `criticalTypes`, AI-судья (Фаза A1), автоподстройка (Фаза A2).

**Acceptance:**
- [ ] triage использует `calibratedConfidence` при наличии, иначе fallback на raw (поведение совпадает с текущим при равных порогах).
- [ ] Пер-типовые пороги читаются/пишутся, валидируются (auto ≥ deep), дефолты из AdminSetting.
- [ ] override-rate считается per resourceType, доступен через endpoint, покрыт unit-тестом.
- [ ] `bun run typecheck` / `lint` зелёные; unit на пороги и калибровку.

## Фаза A1 — Уровень «авто-провизорно» + AI-судья для критических типов

**Цель:** критические типы перестают безусловно блокироваться человеком.

**Что входит:**
- В `triage()` для критических типов с уверенностью выше провизорного порога — вызвать `MultiAgentDebateService.judge()` (дешёвая модель, cache-friendly промпт). При AI-консенсусе — канонизировать как **провизорно** с меткой доверия; при расхождении судей — в человеческую очередь (`CurationItem`).
- Ввести **уровень доверия карточки** (`trustTier: auto | provisional | human` либо `humanVerified: boolean` + источник) — поле в `CardVersion` (`prisma:push`). Маркер прокидывается в UI Карты знаний/чат («не подтверждено человеком»).
- Провизорные карточки **пригодны к использованию** (граф/чат), но легко оспариваются существующей кнопкой «это неверно» (`recordDecision`).
- **Аудит-выборка 5%** авто/провизорных решений → создаётся лёгкий `CurationItem(level=light, reason=audit_sample)` для выборочной человеческой проверки (не блокирует карточку).

**Что НЕ входит:** автоподстройка порогов (A2), каналы доставки (Часть B).

**Acceptance:**
- [ ] Критический тип с высокой увер. + AI-консенсус → провизорно-каноническая карточка с меткой, без человека.
- [ ] Расхождение AI-судей или низкая увер. → human `CurationItem`.
- [ ] Метка доверия видна в UI/чате; «это неверно» откатывает и пишет сэмпл.
- [ ] 5% решений уходят в аудит-выборку (детерминированный сэмплинг, проверяемо тестом).
- [ ] Стоимость судьи ограничена средней полосой; промпт cache-friendly (раздел в ТЗ-комментарии prompt-key). `typecheck`/`lint`/тесты зелёные.

## Фаза A2 — Автоподстройка порогов по override-rate (с guardrail'ами и kill-switch)

**Цель:** система сама находит оптимальный порог на тип.

**Что входит:**
- Крон, который по накопленному override-rate per resourceType двигает пер-типовые пороги в `AdminSetting` в рамках guardrail'ов (min/max порога — крутилки).
- **Kill-switch:** если override-rate провизорного уровня для типа > `maxProvisionalOverride` после ≥ N решений — тип автоматически возвращается к человеку (повышение порога до блокировки), с записью в audit/лог.
- Всё движение порогов логируется (history) и видно super_admin.

**Acceptance:**
- [ ] Низкий override → порог опускается (в пределах guardrail); высокий → поднимается.
- [ ] Kill-switch срабатывает по порогу override + N, тип возвращается к человеку.
- [ ] Изменения порогов в history/audit. Unit-тесты на логику движения и kill-switch.

---

# ЧАСТЬ B — Action Center (сделать остаток непропускаемым)

`PendingActionsProvider` (интерфейс):
```ts
interface PendingActionsProvider {
  readonly source: 'curation' | 'conflict' | 'intake' | 'probe';
  countForUser(args: { tenantId: string; userId: string }): Promise<number>;
  listForUser(args: { tenantId: string; userId: string; limit: number }): Promise<PendingActionItem[]>;
}
interface PendingActionItem {
  source: string; resourceType: string; resourceId: string;
  title: string; severity: 'normal' | 'urgent'; ageDays: number;
  actionUrl: string; canQuickConfirm: boolean; // true только для light-review
}
```

## Фаза B0 — Backend-агрегатор `PendingActionsService`
**Цель:** единый источник правды «что требует действия пользователя».
**Что входит:** модуль `backend/src/modules/pending-actions/`; `PendingActionsService` + провайдеры (curation/conflict/intake/probe); модель `PendingActionSnooze` (`prisma:push`); эндпоинты `GET /pending-actions/count`, `GET /pending-actions`, `POST /pending-actions/snooze`; RBAC; учёт snooze.
**Acceptance:** count агрегирует 4 источника, исключает snoozed, `{ total, bySource }`; list нормализует `PendingActionItem` (severity=urgent по `expiresAt`/age); snooze скрывает до `snoozedUntil`; unit на провайдеры+агрегатор+snooze, e2e на 3 эндпоинта; typecheck/lint зелёные.

## Фаза B1 — Бейдж в сайдбаре + глобальный колокольчик
**Что входит:** хук `usePendingActionsCount` (образец `useIntakePendingCount`, polling 60с) → бейдж «Подтверждения» в сайдбаре (owner/admin/coo/куратор); глобальный колокольчик в `AppShell` (desktop+mobile) с числом + popover; страница `/actions` (список + «Открыть»/«Отложить»). Цвета — только парные токены (`feedback_paired_color_tokens`).
**Acceptance:** бейдж total (>99 → «99+», 0 скрыт), живое обновление; колокольчик на всех authenticated-страницах; `/actions` рендерит/snooze/пустое; frontend typecheck/lint + unit на хук и маппер.

## Фаза B2 — «Горит красным» на дашбордах
**Что входит:** блок `requiresAction` в `GET /dashboard/director` ([director-dashboard.dto.ts](../../backend/src/modules/dashboard/dto/director-dashboard.dto.ts)) + плитка-алерт на главном + баннер на «Панели операций». Срочное (overdue по `expiresAt`) — красным, обычное — янтарным; красного нет при N=0.
**Acceptance:** `requiresAction` в DTO заполняется из `PendingActionsService`; плитка/баннер считают и ведут на `/actions` (или на карточку при N=1); цвета через токены; backend+frontend unit.

## Фаза B3 — Telegram-напоминания + блок в дайджесте
**Что входит:** крон `PendingActionsReminderCron` (эталон [telegram-digest.cron.ts](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-digest.cron.ts)): каденция 09–21 шаг 3ч, **батч в одно сообщение, только при наличии pending**, уважение `quietHours`/`disabledUntil`, Redis-dedup на слот; eventType `actions.reminder` + Zod-схема в [event-payload.registry.ts](../../backend/src/modules/conversational/types/event-payload.registry.ts) + `EVENT_TYPE_CHANNEL_POLICY`; **эскалация** на owner если item старше `escalationDays` (AdminSetting, default 3); блок «Ждёт подтверждения» в daily-digest. Сообщение — детерминированный шаблон (без LLM; если LLM — cache-friendly + обоснование).
**Acceptance:** не чаще каденции, батч, только при pending, уважает quietHours/dedup; эскалация работает; daily-digest содержит блок; unit на gate по часам/dedup/пустой/эскалацию.

## Фаза B4 — Быстрый путь: deep-link + inline для light + snooze
**Что входит:** deep-link открывает конкретную карточку; inline-кнопки «✅ Подтвердить»/«🕒 Отложить» в Telegram **только для light-review** → `callback_query` в [telegram-bot.adapter.ts](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts) → `CurationService.decide` / `PendingActionsService.snooze`; критические — только deep-link; RBAC на callback.
**Acceptance:** light подтверждается из чата в один тап (→ `decided`, исчезает из count); у критических кнопок подтверждения нет; snooze из чата; RBAC на callback; unit/e2e на decide-через-callback и отказ при отсутствии прав.

## Фаза B5 — Оживить `expiresAt`: эскалация и закрытие просроченных
**Что входит:** крон `CurationItemLifecycleCron`: `pending` с `expiresAt < now` → `expired` + метрика + (опц.) финальное уведомление owner; перед истечением (`expiresAt - reminderLeadDays`) → `severity=urgent` (подхватывается всеми каналами через агрегатор); метрики `pending_actions_expired_total`, `pending_actions_age_seconds`.
**Acceptance:** просроченные → `expired`, уходят из count; urgent-окно подсвечивается во всех каналах; метрики экспортируются; unit на переход и urgent-окно.

---

## Параллельный поток — крутилки в AdminSetting

Через `AdminSetting` + `TypedConfigService.getDynamic`, **не ENV/код** (`feedback_admin_settings_not_env_or_code`), super_admin с history+audit. Зарегистрировать в `admin-setting-schema-registry.ts`:
- Часть A: `curation.autoThresholdByType.*`, `curation.deepThresholdByType.*`, `curation.provisionalThresholdByType.*`, `curation.thresholdMin/Max`, `curation.auditSampleRate` (0.05), `curation.maxProvisionalOverride`, `curation.minDecisionsForAutotune`.
- Часть B: `pendingActions.reminderWindowStartHour`/`EndHour` (9/21), `pendingActions.reminderStepHours` (3), `pendingActions.escalationDays` (3), `pendingActions.urgentAgeDays` (5), `pendingActions.reminderLeadDays` (3).

## Prod-deploy импликации

- A0: правки `curation.service.ts` (settings) → Шаг 12 (smoke); AdminSetting-поля → Шаг 1.
- A1: новое поле `CardVersion.trustTier`/`humanVerified` → **Шаг 4** (prisma:push); новый prompt-key для судьи → seed/patch (Шаг 7) если в registry.
- A2/B3/B5: новые `@Cron` → Шаг 12 (smoke grep).
- B0: модель `PendingActionSnooze` → Шаг 4; новый модуль/эндпоинты → Шаг 12.
- Полную инструкцию вести в `docs/operations/prod-deploy-log.md`.

## Second-brain импликации

- `02_architecture/knowledge-core.md` — лестница доверия / провизорный уровень / AI-судья в курации.
- `02_architecture/data-model.md` — `CardVersion.trustTier`, `PendingActionSnooze`.
- `01_projects/admin.md` — `/actions`, колокольчик, наблюдаемость override-rate.
- `01_projects/frontend-pages.md` / `frontend-contexts-hooks.md` — `/actions`, `usePendingActionsCount`.
- `01_projects/workers-queues.md` / `ai-jobs.md` — кроны автоподстройки, напоминаний, lifecycle; AI-судья в триаже.
- `02_architecture/module-map.md` — модуль `pending-actions`.

## Итог

Реализовано целиком — нет (план). Архитектура: Часть A сжимает число подтверждений в источнике (лестница доверия + AI-судья + обратимость + автоподстройка), Часть B делает оставшийся остаток непропускаемым (агрегатор + бейдж/колокольчик/плитки/Telegram). Все примитивы (`MultiAgentDebateService`, `calibratedConfidence`, `recordDecision`, `telegram-digest.cron`, `ChannelBindingPreferences`, inline-кнопки, `AdminSetting`) уже в коде — работа сводится к связыванию и аккуратной защите от спама/штамповки/дрейфа. Порядок строго последовательный A0→A1→A2→B0→B1→B2→B3→B4→B5; поток AdminSetting — рядом.
