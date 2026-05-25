# Runbook — Outbound DataClass Gating (W4.3 KC-Temporal)

> **Codename:** KC-Temporal W4.3 (см. `plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md`).
> **Источник правды по правилам:** `docs/policies/dataclass-policy-v1.md`.
> **Owner:** @sergrv80.

## 1. Что такое outbound gating

В платформе четыре уровня класса данных:

| Уровень    | Кто видит                                            |
| ---------- | ---------------------------------------------------- |
| `public`   | Любой, в том числе вне Org                           |
| `internal` | Любой member Org                                     |
| `sensitive`| Owner / admin + roles по теме (стратегия, финансы)   |
| `private`  | Только subject-Person + owner / super_admin          |

«Outbound gating» — это запрет на отправку payload-а с классом, превышающим
потолок целевого канала. Четыре точки проверки (sinks):

1. **Conversational** — `ConversationalService.sendNotification`. Проверяет
   `min(Channel.maxDataClass, ChannelBinding.maxDataClass)` + subject-ACL для
   `private` (recipient = subject или owner / super_admin).
2. **Issue webhooks** — `WebhookDispatcher.dispatch` (модуль `tracker`).
   Проверяет `IssueWebhook.allowedDataClasses` (default `['public','internal']`).
3. **Export endpoints** — контроллеры `/admin/llm/preference-dataset?...` и
   аналогичные. `private` всегда reject; `sensitive` только owner.
4. **Public API / share** — `/api/public/*`. Принимают только `public`.

Все проверки идут через `DataClassPolicyService.canEmit(...)`.

## 2. Метрики и алерты

| Метрика                                       | Описание                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| `kc_dataclass_violation_blocked_total`        | Counter блокировок. Labels: `sink`, `requested`, `max_allowed`.                   |
| `kc_dataclass_canEmit_latency_ms`             | Histogram латенси одного вызова canEmit. Labels: `sink`, `outcome`.               |
| `ProbeStatus='dropped_dataclass_gate'`        | Probe-события, чьи доставки были отменены gating-ом (видно в `/admin/policy/dataclass`). |

**Алерт** (настраивается на уровне Prometheus, вне scope W4.3 кода):
> `increase(kc_dataclass_violation_blocked_total[5m]) > 0` → severity = page,
> назначение — on-call dev. Алерт указывает, что что-то пытается утечь через
> неподходящий канал.

## 3. Kill-switch

ENV `DATACLASS_OUTBOUND_GATING_ENABLED` (по умолчанию `true`).

```bash
DATACLASS_OUTBOUND_GATING_ENABLED=false  # срочный rollback
```

При `false` все вызовы `canEmit` возвращают `allowed=true` (метрика latency
пишется с `outcome=allowed_disabled`, метрика violation_blocked не растёт).
Включать **только** при инциденте (правила v1 заблокировали легитимный
трафик), на время — пока правится конфиг.

## 4. Как разбирать инцидент «blocked > 0»

### 4.1. Найти событие

В Grafana / `/metrics` посмотреть лейблы `sink`, `requested`, `max_allowed`
последних 5 минут. По логам backend искать строку:

```
DataClassPolicyService.canEmit: blocked outbound emit
```

Лог содержит: `sink`, `payloadDataClass`, `payloadSubjectPersonId`, `reason`,
`channel`. По `channel`-полю можно найти конкретный binding / webhook.

### 4.2. Определить тип блокировки

| `sink`            | Что значит                                                                |
| ----------------- | ------------------------------------------------------------------------- |
| `channel_binding` | Conversational канал отказал. Причина — потолок или subject-ACL.          |
| `issue_webhook`   | Outbound webhook отказал. Причина — `allowedDataClasses`.                 |
| `export`          | Endpoint админ-экспорта отказал. Причина — owner-only или `private`.      |
| `public_api`      | Публичный API получил non-public payload. **Обычно баг — расследовать!**  |

### 4.3. Действия

#### channel_binding

1. Открыть `/admin/policy/dataclass` → раздел «Потолок чувствительности по
   типу канала». Проверить, не слишком ли строгий default для этого `kind`.
2. Если ОК (default правильный), но конкретный пользователь должен получать
   `sensitive`/`private` — он сам поднимает `maxDataClass` в «Мои каналы»
   (radio «Включая чувствительные данные»). `private` через UI недоступен —
   приходит только в `in_app` и только субъекту.
3. Если payload должен был остаться `private` — fallback идёт на `in_app`
   автоматически. Если и `in_app` отвергнут → в `probe_events` появится
   `dropped_dataclass_gate`. Видно в «История нарушений».

#### issue_webhook

1. Найти webhook по `channel` лейблу (`<id>:<name>`).
2. В `/admin/integrations/webhooks` (или прямо в БД) проверить
   `allowedDataClasses`. По умолчанию `['public','internal']`.
3. Если webhook ДОЛЖЕН принимать `sensitive` — добавить в массив. **Никогда
   не добавлять `private` к internal webhook'у** — `private`-payload должен
   идти только в личку субъекту.

#### export

1. `private` → всегда reject. Расследовать, как `private`-данные попали в
   export endpoint (баг или попытка обхода).
2. `sensitive` без owner → расследовать. Endpoint должен или сделаться
   owner-only, или фильтровать запись по dataClass.

#### public_api

**Серьёзно.** Public endpoint принял payload `internal`/`sensitive`/`private`.
Это всегда баг логики. Действия:

1. Немедленно — kill-switch (`DATACLASS_OUTBOUND_GATING_ENABLED=false`
   НЕ помогает — оставить как есть; gating защищает).
2. Расследовать source code endpoint'а — где формируется payload.
3. Поправить логику (фильтр по `dataClass='public'` перед эмитом).

## 5. Откуда брать значения

- **Floors per kind** — `AdminSetting key='dataclass_policy:floors'`. Видно
  в `/admin/policy/dataclass` → раздел 1. Override через `/admin/settings`.
- **Channel defaults** — `AdminSetting key='dataclass_policy:channel_defaults'`.
  Раздел 2.
- **ChannelBinding.maxDataClass** — пользовательский radio в «Мои каналы».
- **IssueWebhook.allowedDataClasses** — admin в `/admin/integrations/webhooks`.

## 6. Backfill

Скрипт `backend/scripts/patch-channel-binding-defaults.ts`:

```bash
cd backend
bun run scripts/patch-channel-binding-defaults.ts --dry-run  # сухой прогон
bun run scripts/patch-channel-binding-defaults.ts            # apply
```

- `ChannelBinding.maxDataClass IS NULL` → `internal`.
- `IssueWebhook.allowedDataClasses` пуст → `['public','internal']`.

Идемпотентен — повторный запуск не меняет данные.

## 7. Что не покрыто в W4.3 (отложено)

- **LLM-провайдеры** — не gating'уются в W4.3 (решение №8: «пока всё можно
  отправлять, отдельно решу»). Поле `LlmProvider.maxDataClass` не добавлено.
- **Prometheus-alert rule** — определение алерта в `infra/prometheus/alerts.yml`
  делается командой infra (не входит в W4.3 backend-scope). Метрика собирается,
  алерт нужно поднять отдельно.
- **Edit floors из UI** — `/admin/policy/dataclass` сейчас read-only.
  Правка через `/admin/settings` с ключом `dataclass_policy:floors`.

## 8. Контакты

- Backend / схема правил — @sergrv80.
- Гейтинг каналов в Conversational — модуль `conversational/`.
- Webhook gating — модуль `tracker/services/webhook-dispatcher.service.ts`.
- Прометей / алерт — infra team.
