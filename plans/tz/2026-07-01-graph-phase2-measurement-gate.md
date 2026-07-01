---
type: tz
status: ready-to-implement
feature: graph-phase2-measurement-gate
date: 2026-07-01
owner: sergrv80@gmail.com
relates_to:
  - plans/architecture/2026-07-01-graph-phase2-measurement-gate.md
  - plans/analysis/2026-07-01-graph-phase2-when-and-cost-decision-review.md
  - plans/analysis/2026-06-23-knowledge-graph-ingestion-audit/99-synthesis.md
---

> Архитектура (одобрена владельцем): [`plans/architecture/2026-07-01-graph-phase2-measurement-gate.md`](../architecture/2026-07-01-graph-phase2-measurement-gate.md) · Разбор решения: [`plans/analysis/2026-07-01-graph-phase2-when-and-cost-decision-review.md`](../analysis/2026-07-01-graph-phase2-when-and-cost-decision-review.md) · Согласовано: 2026-07-01

# ТЗ — Гейт-замер формы запросов (триггер фазы 2 графа)

**Принцип.** Сделать триггер «пора включать граф-обход» видимым по данным, не строя сам граф. Минимальное безопасное изменение поверх уже существующей классификации запросов. Схему НЕ трогаем, поведение ответа НЕ меняем — только наблюдаемость + операционное правило.

## Цель + Зачем

Правило фазы 2 из ADR — «включаем граф-обход, когда доля широких/multi-hop запросов вырастет» — сейчас **не измеряется**: метрика `z_router_query_class_total` не отделяет точечный факт от агрегата. Момент «пора» приходится угадывать. Даём разрез `aggregation` + операционное правило-порог, чтобы решение принималось по графику, а не на глаз. Полный контекст цены/выбора — в разборе (`relates_to`).

## REALITY-CHECK (проверено по коду 2026-07-01)

| Факт | Где | Вывод для scope |
|---|---|---|
| Метрика `z_router_query_class_total{class}` инкрементится ровно в 1 месте | [dialog.service.ts:253](../../backend/src/modules/dialog-layer/services/dialog.service.ts#L253) | Единственная точка правки инкремента |
| `queryPlan.aggregation` (boolean) в скоупе там же | [dialog.service.ts:250](../../backend/src/modules/dialog-layer/services/dialog.service.ts#L250) | Разрез добавляется без нового вычисления |
| Регистрация метрики + обёртка `incRouterQueryClass` | [business-metrics.service.ts:1447](../../backend/src/common/metrics/business-metrics.service.ts#L1447), [:4268](../../backend/src/common/metrics/business-metrics.service.ts#L4268) | Правим `labelNames` + сигнатуру обёртки |
| `QueryClass = 'list'\|'topic'\|'temporal'\|'overview'\|'fact'` | [query-classifier.service.ts:25](../../backend/src/modules/dialog-layer/services/query-classifier.service.ts#L25) | Значения `class` не меняем |
| Concierge → `chatV2.askEphemeral` → `resolveAnswer` → `dialog.process` | [concierge.service.ts:488](../../backend/src/modules/concierge/services/concierge.service.ts#L488), [chat-v2.service.ts:317](../../backend/src/modules/chat-v2/chat-v2.service.ts#L317) | Concierge покрыт автоматически — **новый замер не нужен**, только acceptance-проверка |
| `RawEvent.sourceTitle` есть; `EntityLink` уже bi-temporal (`validFrom`/`validUntil`) | schema.prisma:3297, :4305 | Крючки ADR Q5 **на месте — схему не трогаем, ноль миграций** |

**Пересчёт scope по факту:** из 4 исходных пунктов остаётся работа только по одному (разрез метрики) + один документ (правило-гейт). Пункты «покрыть concierge» и «крючки схемы» закрыты находками — становятся acceptance-проверками, а не фазами.

## Принятые решения владельца

| # | Решение | Обоснование | Дата |
|---|---|---|---|
| Б1 | Разрез метрики — лейбл `aggregation` со значениями `yes\|no\|unknown` (`unknown` = `queryPlan` отсутствует, fail-open) | Fail-open не должен маскироваться под `no` и занижать долю широких | 2026-07-01 |
| Б2 | Только `aggregation`, без `personScope` | Гейт про форму hop; `class`+`aggregation` достаточно; `personScope` не про hop (не код ради кода) | 2026-07-01 |
| Б3 | Порог-ориентир: доля широких/агрегатных ≥ 20% на окне 30д при ≥ 200 вопросов — **сигнал человеку, не автотриггер** | Пока single-hop >80% — граф не окупается (ADR); ничего в проде не меняет | 2026-07-01 |
| Б4 | Наблюдение — правило-док + `/metrics`, без нового алерта/Grafana | Alert-инфры нет; заводить ради одного гейта преждевременно | 2026-07-01 |

**Не пересматривать без явного запроса владельца.**

## Доказательство выбора (два прохода + challenge)

- **A (выбран):** добавить лейбл `aggregation` в существующую `z_router_query_class_total`. Переиспользует готовую классификацию и точку инкремента; доля считается PromQL по `class`+`aggregation`.
- **B (отвергнут):** новая метрика `z_query_shape_total{shape="single_hop|multi_hop"}` с отдельной классификацией. Дублирует уже существующие `class`/`aggregation`, вводит вторую точку истины формы запроса.
- **Сведение:** A ✓ переиспользование ✓ одна точка правки ✓ ноль новой классификации; B ✗ дубль ✗ вторая точка истины. → A.
- **Challenge:** корень (слепой гейт) закрывается — да, разрез даёт долю. Эффективнее — да, +1 лейбл vs новая метрика. Код ради кода — нет, переиспользуем существующее.

## Scope

**Входит:**
- Лейбл `aggregation` (`yes|no|unknown`) в метрике `z_router_query_class_total` + проброс из `dialog.process`.
- Операционное правило-гейт (порог/окно/действие) + PromQL + «куда смотреть» в док.
- Acceptance-подтверждение покрытия concierge и наличия крючков схемы (без изменений кода/схемы).

**Не входит (вне scope):**
- Горячий граф-слой (community-summaries, Cypher-обход) → отдельное ТЗ по срабатыванию гейта.
- Любые изменения `schema.prisma` (крючки уже есть) и логики ответа.
- Новый алерт/Grafana-дашборд (Решение Б4).
- Изменение классификатора `queryClass`/`aggregation`.

## Границы фичи

- ✅ Always: правка только метрики (labelNames + обёртка + 1 вызов) и операционного дока.
- ⚠️ Ask first: любое желание расширить разрез (personScope и т.п.) или тронуть схему.
- 🚫 Never: менять поведение `dialog.process`/ответа; заводить AdminSetting/ENV под порог (это правило наблюдения, не рантайм-крутилка); трогать горячий граф-слой.

---

## Фаза 1 — Разрез `aggregation` в метрике `z_router_query_class_total`

**Ценность.** Как владелец/техлид, получаю в `/metrics` разрез «точечный факт vs агрегат», чтобы видеть долю широких запросов и не угадывать момент включения графа.

**Мини-картография (перед правкой перечитать — номера строк дрейфуют, якорь по символу):**
- [business-metrics.service.ts:1447](../../backend/src/common/metrics/business-metrics.service.ts#L1447) — регистрация `this.routerQueryClassTotal = this.getOrCreateCounter({ name: 'z_router_query_class_total', … labelNames: ['class'] })`.
- [business-metrics.service.ts:4268](../../backend/src/common/metrics/business-metrics.service.ts#L4268) — обёртка `incRouterQueryClass({ class })`.
- [dialog.service.ts:253](../../backend/src/modules/dialog-layer/services/dialog.service.ts#L253) — вызов `this.metrics.incRouterQueryClass({ class: queryClass })`; `queryPlan` в скоупе (строка 250).

**Что входит — три точечные правки (дословный контракт):**

1. Регистрация — добавить лейбл `aggregation` в `labelNames` и обновить `help`:
```ts
this.routerQueryClassTotal = this.getOrCreateCounter({
  name: 'z_router_query_class_total',
  help: 'Слой источника Ф3 — распределение запросов к памяти по 5 классам (list/topic/temporal/overview/fact) × разрез aggregation (yes/no/unknown). Разрез — гейт фазы-2 графа (доля широких/агрегатных), см. plans/architecture/2026-07-01-graph-phase2-measurement-gate.md.',
  labelNames: ['class', 'aggregation'] as const,
});
```

2. Обёртка `incRouterQueryClass` — расширить сигнатуру и `inc`:
```ts
incRouterQueryClass(args: {
  class: 'list' | 'topic' | 'temporal' | 'overview' | 'fact';
  aggregation: 'yes' | 'no' | 'unknown';
}): void {
  this.routerQueryClassTotal.inc({ class: args.class, aggregation: args.aggregation });
}
```

3. Вызов в `dialog.service.ts:253` — прокинуть `aggregation` из плана (Решение Б1: `unknown` при отсутствии плана):
```ts
this.metrics.incRouterQueryClass({
  class: queryClass,
  aggregation:
    queryPlan == null
      ? 'unknown'
      : queryPlan.aggregation === true
        ? 'yes'
        : 'no',
});
```
> ⚠ Проверить по факту имя поля: `queryPlan.aggregation` — булев из understand-плана ([understand.prompt.ts:278](../../backend/src/modules/dialog-layer/prompts/understand.prompt.ts#L278), ось 6). Если поле недоступно на типе `queryPlan` напрямую — взять из того же объекта, что уже даёт `queryPlan.queryClass` на строке 250 (тот же источник).

**Что НЕ входит:** новые значения `class`; `personScope`; любые изменения синтеза ответа; отдельная метрика для concierge.

**Acceptance (машинно-проверяемо):**
- `grep -n "labelNames: \['class', 'aggregation'\]" backend/src/common/metrics/business-metrics.service.ts` → 1 совпадение.
- `grep -n "aggregation: 'yes' | 'no' | 'unknown'" backend/src/common/metrics/business-metrics.service.ts` → есть (сигнатура обёртки).
- `grep -n "aggregation:" backend/src/modules/dialog-layer/services/dialog.service.ts` → присутствует в вызове `incRouterQueryClass`.
- **Concierge-покрытие (проверка без правок):** `grep -n "askEphemeral" backend/src/modules/concierge/services/concierge.service.ts` → есть; `askEphemeral` → `resolveAnswer` → `this.dialog.process` ([chat-v2.service.ts:317](../../backend/src/modules/chat-v2/chat-v2.service.ts#L317)) — путь цел (перечитать, что `resolveAnswer` вызывает `dialog.process`).
- Unit-тест `business-metrics` или `dialog.service`: при `queryPlan.aggregation === true` инкремент идёт с `aggregation:'yes'`; при `queryPlan == null` → `'unknown'`; иначе `'no'`. Файл-образец: [business-metrics.service.spec.ts](../../backend/src/common/metrics/business-metrics.service.spec.ts) или dialog-layer spec.
- `cd backend && bun run typecheck` (вкл. `.spec`) · `bun run lint` · `bun run build` — зелёные.
- `bunx vitest run` по затронутому spec — зелёный.

**Закрывает:** R1, R2, R4.

---

## Фаза 2 — Операционное правило-гейт + «куда смотреть»

**Ценность.** Как владелец, получаю записанное правило «на какой доле широких запросов пора думать про граф» и готовый PromQL, чтобы решение о фазе 2 было по факту, а не на глаз.

**Что входит:**
- Раздел в [second-brain/02_architecture/knowledge-core.md](../../second-brain/02_architecture/knowledge-core.md) (рядом с блоком про AGE/граф) **или** новый короткий док `docs/operations/graph-phase2-gate.md` — с:
  - метрика и разрез (`z_router_query_class_total{class, aggregation}`);
  - PromQL «доля широких/агрегатных за 30д» (из architecture-дока §«Как будет выглядеть»);
  - правило-порог (Решение Б3): ≥ 20% на 30д при ≥ 200 вопросов → сигнал поднять фазу-2 (запустить `feature-analyst` по multi-hop-ретриву);
  - явно: это **сигнал человеку, не автотриггер**; в проде ничего не включается.
- Обновить строку в [second-brain/04_не-сделано/README.md](../../second-brain/04_не-сделано/README.md) (гейт слеп → «замер добавлен, правило записано; открыт сам граф-слой по срабатыванию»).

**Что НЕ входит:** реализация алерта/дашборда; AdminSetting/ENV под порог.

**Acceptance:**
- Целевой док содержит: имя метрики с лейблом `aggregation`, PromQL-выражение, числовой порог (20% / 30д / 200), фразу «сигнал человеку, не автотриггер».
- Строка в реестре не-сделанного обновлена (гейт-замер закрыт, граф-слой остаётся открытым).
- `grep -rn "z_router_query_class_total.*aggregation\|aggregation.*z_router_query_class_total" docs/ second-brain/` → есть.

**Закрывает:** R3, R5.

---

## Требования (трассировка)

- **R1.** Когда пользователь задаёт вопрос к памяти, система shall инкрементировать `z_router_query_class_total` с лейблами `class` и `aggregation`.
- **R2.** Если `queryPlan` отсутствует (fail-open), then `aggregation='unknown'`; если `queryPlan.aggregation===true` → `'yes'`; иначе `'no'`.
- **R3.** Система (операционный док) shall содержать правило-порог, PromQL и пометку «не автотриггер».
- **R4.** Вопрос к памяти из concierge shall инкрементировать ту же метрику через существующий `askEphemeral→dialog.process` (без отдельного кода).
- **R5.** Реестр не-сделанного shall отражать закрытие гейт-замера и открытость самого граф-слоя.

## Сквозные аспекты

- **RBAC/tenant:** `[N/A]` — метрика агрегатная, без tenant-лейбла (кардинальность); tenant-разрез не требуется для гейта.
- **Observability:** это и есть суть фичи — новый разрез существующей prom-метрики.
- **Errors/идемпотентность:** `[N/A]` — счётчик, повторный инкремент семантически корректен.
- **Миграции данных:** `[N/A]` — схему не трогаем.
- **Rollout/флаг (Ship-On):** выкат включённым, флаг не нужен (изменение метрики, не поведения) — новой строки в `feature-flags.md` нет.
- **Тесты:** unit на маппинг `aggregation` (Фаза 1 Acceptance).

## Prod-deploy

- Миграций/схемы/ENV/скриптов/очередей — **нет**. Изменение — код метрики + доки.
- `docs/operations/prod-deploy-log.md` — **Шаг 12 (smoke)**: после выката проверить, что `/metrics` отдаёт `z_router_query_class_total` с лейблом `aggregation` (например, `curl -s localhost:PORT/metrics | grep z_router_query_class_total`). Существующие Grafana-панели (если появятся) — учесть новый лейбл. Prod-действий кроме обычного передеплоя backend нет.

## DoD

- typecheck (вкл. `.spec`) / lint / build зелёные; затронутый vitest зелёный.
- second-brain обновлён: `knowledge-core.md` (или новый `docs/operations/graph-phase2-gate.md`) + строка в `04_не-сделано/README.md`.
- `prod-deploy-log.md` Шаг 12 — строка smoke по метрике.
- Рефлексия по триггеру после push.

## Итог

_(заполняет tz-orchestrator по завершении: реализовано целиком / остаток.)_
