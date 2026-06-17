# DataClass Policy v1 — единые правила классификации данных

Дата: 2026-05-25 · Источник: `plans/archive/2026-05-25-knowledge-core-temporal-and-graph-quality.md` §4 + §W4.1.

Версия `v1` — соответствует ENV `DATACLASS_POLICY_VERSION=v1` и записывается в `DataClassAudit.policyVersion`.

## 1. 4 уровня DataClass

| Уровень       | Кто видит                                              | Примеры                                                                 |
|---------------|--------------------------------------------------------|-------------------------------------------------------------------------|
| `public`      | любой пользователь (вне организации тоже)              | публичный лендинг, согласованные кейсы клиентов                         |
| `internal`    | любой member организации (Org)                         | большая часть встреч, регламенты, общие метрики, **Клоны Ролей**        |
| `sensitive`   | определённые роли (owner / admin / role-based по теме) | стратегия, финансы, увольнения, переговорные позиции                    |
| `private`     | только subject-Person + owner / super_admin            | персональные данные о конкретном человеке (медицинское, переписки 1:1)  |

Уровень `private` дополнительно несёт атрибут `subjectPersonId` — id Person'а, к которому относится содержимое.

## 2. Lattice (отношение порядка)

```
public  <  internal  <  sensitive  <  private
```

Реализация — константа `DATACLASS_RANK` в `backend/src/modules/knowledge-core/services/dataclass-policy.service.ts`:

```ts
export const DATACLASS_RANK: Record<DataClass, number> = {
  public: 0, internal: 1, sensitive: 2, private: 3,
};
```

Операция `max(a, b)` — тот, у кого `DATACLASS_RANK` выше. На пустом массиве — `public` (нейтраль).

### Private aggregation

При derive результата над набором источников, среди которых есть `private`:

- если в источниках встречается **≥2 разных** `subjectPersonId` и `kind` входит в набор «агрегируемых» (`insight`, `decision`, `card_rollup`, `skill_profile`, `executable_persona`, `skill_trait`, `chat_context`) — результат **понижается** до `sensitive` и `subjectPersonId = null` (анонимизация);
- если в источниках **ровно один** `subjectPersonId` — результат остаётся `private` и наследует этот `subjectPersonId`;
- если `subjectPersonId` нигде не заполнен (`null`) — результат `private`, `subjectPersonId = null`.

Это компромисс: ≥2 разных людей в одном агрегате — `private` теряет смысл (анонимизация), но мы помечаем `sensitive`, чтобы такой агрегат не утёк в `public`-сводки.

## 3. Floor per `kind` (правила v1)

Floor — минимально-допустимый уровень DataClass для проекции данного `kind`. Применяется как `result = max(max(sources), floor)`.

| `kind` результата       | Floor v1   | Особое правило                                                                                         |
|-------------------------|------------|--------------------------------------------------------------------------------------------------------|
| `idea_block`            | `public`   | специальный путь — это сам источник, ничего не lift'им сверху                                          |
| `insight`               | `internal` | ≥1 источник `private` → `sensitive` (агрегация анонимизирует)                                          |
| `decision`              | `internal` | то же                                                                                                  |
| `card_rollup`           | `internal` | `kind='deal'`/`'vendor'` с финансовыми источниками → `sensitive` (override через `explicitFloor`)      |
| `executable_persona`    | `internal` | Клон Роли = рабочий артефакт, как должностная инструкция (см. решение №6 от 2026-05-25 — clones-role-based-rebrand) |
| `skill_profile`         | `internal` | служебный per-Person профиль; на UI не показывается, но floor нужен                                    |
| `skill_trait`           | `internal` | при `mark_as_misleading` → Curation event получает `sensitive`                                         |
| `idea`                  | `internal` | приравнено к idea_block по доступу                                                                     |
| `regulation`            | `internal` | то же                                                                                                  |
| `process`               | `internal` | то же                                                                                                  |
| `policy`                | `internal` | то же                                                                                                  |
| `chat_context`          | `public`   | реальный floor задаётся caller'ом через `explicitFloor` (например `clone_style` → `internal`)          |
| `ai_usage_log`          | `public`   | log пишется **после** derive — max от input+output                                                     |
| `conflict_item`         | `public`   | max от участников                                                                                      |
| `probe_event`           | `internal` | служебное событие knowledge-core                                                                       |

Override floors per Org доступен через `AdminSetting` ключ `dataclass_policy:floors` (JSON `Record<DerivedKind, DataClass>`) — читается через `getFloor(kind)`. Если AdminSetting не задан / недоступен — fallback на default из таблицы выше.

> **Изменение vs предыдущая версия:** `knowledge_profile` (раньше floor=`sensitive`/`private` для не-сотрудников) переименован в `executable_persona` + `skill_profile`. Floor у обоих = `internal`, потому что Клон делается на роль, а не на человека. Подробности — `plans/archive/2026-05-25-clones-role-based-rebrand.md`.

## 4. LLM-провайдеры

В версии политики `v1` — **без ограничений по DataClass** (решение №8 от 2026-05-25: «пока всё можно отправлять, отдельно решу»). Поле `LlmProvider.maxDataClass` не используется как гарант — `LlmRouterService` его читает в legacy-пути (см. `backend/src/modules/ai/services/llm-router.service.ts`), но **DataClassPolicyService.canEmit** на LLM-провайдеры пока не накладывается. Будет включено отдельной фазой.

## 5. API сервиса

```ts
@Injectable()
export class DataClassPolicyService {
  derive(args: {
    sources: DataClassSource[];
    context: { kind: DerivedKind; explicitFloor?: DataClass };
  }): { dataClass: DataClass; subjectPersonId: string | null; audit: DataClassAudit };

  canEmit(args: {
    payloadDataClass: DataClass;
    payloadSubjectPersonId?: string | null;
    sink: SinkConfig;
  }): { allowed: boolean; reason?: string };

  getFloor(kind: DerivedKind): Promise<DataClass>;

  compareWithLegacy(args: {
    legacyResult: DataClass;
    proposedResult: DataClass;
    kind: DerivedKind;
    sourceIds: string[];
  }): void;
}
```

Типы — `backend/src/modules/knowledge-core/services/dataclass-policy.types.ts`.

## 6. Примеры

### Пример 1 — Decision из одного internal-блока

```ts
policy.derive({
  sources: [{ dataClass: 'internal', sourceId: 'b1', sourceKind: 'idea_block' }],
  context: { kind: 'decision' },
});
// → { dataClass: 'internal', subjectPersonId: null, audit: { rule: 'single-source-passthrough' | 'max-and-floor', ... } }
```

### Пример 2 — Insight из public-блока (floor поднимает)

```ts
policy.derive({
  sources: [{ dataClass: 'public', sourceId: 'b1', sourceKind: 'idea_block' }],
  context: { kind: 'insight' },
});
// → { dataClass: 'internal', subjectPersonId: null, audit: { floorApplied: 'internal', rule: 'max-and-floor' } }
```

### Пример 3 — Insight с двумя разными private-источниками (анонимизация)

```ts
policy.derive({
  sources: [
    { dataClass: 'private', subjectPersonId: 'alice', sourceId: 's1', sourceKind: 'insight' },
    { dataClass: 'private', subjectPersonId: 'bob',   sourceId: 's2', sourceKind: 'insight' },
  ],
  context: { kind: 'insight' },
});
// → { dataClass: 'sensitive', subjectPersonId: null, audit: { rule: 'private-aggregation-to-sensitive' } }
```

### Пример 4 — Insight с одним private-источником (subject сохраняется)

```ts
policy.derive({
  sources: [
    { dataClass: 'private', subjectPersonId: 'alice', sourceId: 's1', sourceKind: 'insight' },
    { dataClass: 'internal', sourceId: 'b2', sourceKind: 'idea_block' },
  ],
  context: { kind: 'insight' },
});
// → { dataClass: 'private', subjectPersonId: 'alice', audit: { ... } }
```

### Пример 5 — canEmit reject

```ts
policy.canEmit({
  payloadDataClass: 'sensitive',
  sink: { maxDataClass: 'internal', channel: 'telegram-broadcast' },
});
// → { allowed: false, reason: 'payload=sensitive > sink.maxDataClass=internal (channel=telegram-broadcast)' }
```

### Пример 6 — explicit floor (override)

```ts
policy.derive({
  sources: [{ dataClass: 'public', sourceId: 'b1', sourceKind: 'idea_block' }],
  context: { kind: 'insight', explicitFloor: 'sensitive' },
});
// → { dataClass: 'sensitive', subjectPersonId: null, audit: { rule: 'explicit-floor' } }
```

## 7. Режимы работы (`DATACLASS_POLICY_ENFORCEMENT`)

| Режим       | Поведение                                                                                                          | Когда                                              |
|-------------|--------------------------------------------------------------------------------------------------------------------|----------------------------------------------------|
| `off`       | `DataClassPolicyService.derive` не вызывается; legacy `elevateDataClass` / `maxDataClass` работают как есть         | emergency-режим                                    |
| `shadow`    | `derive()` вызывается параллельно legacy; `compareWithLegacy` эмитит метрики/warn при расхождении; **write — legacy** | W4.1 (default) — ≥1 неделя на dev/staging          |
| `enforce`   | `derive()` — источник истины; legacy удаляется                                                                     | W4.2 после ≥1 недели без расхождений + правок v1.1 |

## 8. Метрики Prometheus

- `kc_dataclass_shadow_diff_total{kind, legacy, proposed}` — расхождения legacy vs proposed. Цель — `< 1%` от общего volume derive'ов перед W4.2.
- `kc_dataclass_derived_total{kind, level}` — распределение уровней по `kind`. Помогает понять «как часто insight реально становится private» и т.п.
- `kc_dataclass_floor_lifted_total{kind, source_level, result_level}` — частота применения floor (`result > max(source)`).

## 9. Что НЕ покрыто в v1

- Канал-специфичные ACL для outbound (Telegram/Email/Webhook) — только потолок `sink.maxDataClass`. Subject-based ACL (`private` payload разрешён только в личку subject'а) — W4.3.
- Per-Org override floors — есть в `getFloor` через AdminSetting `dataclass_policy:floors`, но не кэшируется в hot-path `derive` (caller передаёт `explicitFloor`). Кэш — W4.2.
- LLM-провайдеры — без ограничений (решение №8 от 2026-05-25). Будет отдельной фазой.

## 10. Регрессия / тесты

`backend/src/modules/knowledge-core/services/dataclass-policy.service.spec.ts` покрывает:

1. Идемпотентность: `derive([s], k) >= s.dataClass`.
2. Монотонность: добавление источников не понижает результат.
3. Sensitive не утекает: ≥1 sensitive → result ∈ {sensitive, private}.
4. Private aggregation: ≥2 разных subject'а → `sensitive`, `subjectPersonId=null`.
5. Floor `executable_persona`/`skill_profile`/`insight` — всегда ≥ internal.
6. `canEmit` reject: `sink.maxDataClass=internal` + `payload=sensitive` → `allowed=false`.

Запуск: `cd backend && bunx vitest run src/modules/knowledge-core/services/dataclass-policy.service.spec.ts`.
