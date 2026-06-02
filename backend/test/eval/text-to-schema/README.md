# Eval Text-to-Schema (Smart-tables auto-creation, Фаза 1.5)

Этот набор — **блокер для включения feature-flag `feature.tables_text_to_schema`**.
Он оценивает качество генерации схемы Smart-таблицы по русскому NL-запросу
(`TableAgentService.inferSchemaFromText`, 3 LLM-pass'а: DRAFT → ARCHITECT →
ENTITY-CHECK) против golden-схем.

> ТЗ: `plans/tz/2026-06-02-smart-tables-auto-creation.md`, раздел «Фаза 1.5».

## Что внутри

```
text-to-schema/
├── fixtures/            6 файлов по категориям, суммарно ≥100 кейсов
│   ├── hr.json          сотрудники, кандидаты, отпуска, онбординг, ревью…
│   ├── sales.json       клиенты, сделки, воронка, договоры, тендеры…
│   ├── product.json     задачи, баги, бэклог, релизы, инциденты, фич-флаги…
│   ├── ops.json         поставщики, закупки, склад, оборудование, риски…
│   ├── finance.json     расходы, бюджеты, счета, подписки, инвесторы…
│   └── marketing.json   кампании, контент-план, рассылки, креативы, промокоды…
├── metrics.ts           чистые функции метрик (без Nest/Prisma/LLM)
├── metrics.spec.ts      OFFLINE unit-тесты метрик + валидатор фикстур
└── reports/             отчёты реального прогона (создаются runner'ом)
```

### Формат фикстуры

```jsonc
{
  "id": "sales-01",
  "category": "sales",
  "specificity": "low|mid|high",  // low: «таблица задач»; high: детальное перечисление колонок
  "nlPrompt": "нужна таблица клиентов с контактами и стадией сделки",
  "golden": {
    "name": "Клиенты",
    "entitySync": { "type": "org" },           // org | person | meeting | document | null
    "properties": [
      { "name": "Название", "type": "text",   "isPrimary": true  },
      { "name": "Контакт",  "type": "person", "isPrimary": false },
      { "name": "Стадия",   "type": "status", "isPrimary": false }
    ]
  }
}
```

Инварианты golden (проверяются в `metrics.spec.ts`): ровно одна `isPrimary`,
3–8 колонок, валидный `TablePropType`, `entitySync ∈ {org,person,meeting,document}`
или `null`, уникальные `id`.

## Метрики

| Метрика | Что считает |
|---|---|
| `schemaAccuracy` | precision = matched/predicted, recall = matched/golden, F1 |
| `typeCorrectness` | доля СОПОСТАВЛЕННЫХ колонок с совпавшим типом |
| `entityBindingCorrectness` | 1, если `entitySync.type` совпал (или оба null), иначе 0 |
| `hallucinationRate` | extra / max(1, predicted) — доля «придуманных» колонок |
| `aggregate` | средние по набору + разбивка `byCategory` и `bySpecificity` |

Колонки сопоставляются по **нормализованному имени** (trim + lowercase + ё→е +
схлопывание пробелов; без словаря синонимов — только точное совпадение).

## Пороги PASS (блокер для feature-flag)

```
schema-F1 ≥ 0.85   И   hallucination-rate ≤ 0.05
```

При FAIL runner завершает работу с exit code 1 — оператор/CI не включает флаг.

## Как запускать

### OFFLINE — метрики и валидность фикстур (без LLM, на CI)

```bash
cd backend
bunx vitest run test/eval/text-to-schema/metrics.spec.ts
```

Проверяет: арифметику всех метрик на синтетике (точное совпадение → F1=1;
лишняя колонка → hallucination>0; пропуск → recall<1; неверный тип →
typeCorrectness<1; mismatch entitySync → 0) и качество golden-набора
(≥100 кейсов, валидные типы, ровно одна isPrimary, уникальные id).

### Полный прогон против реального LLM (требует прокси `proxy.agent-lia.ru`)

Прогоняет каждый NL-запрос через продакшен-путь `TableAgentService` и сравнивает
с golden. В среде разработки прокси нет — запускается **на проде** (всё в
docker-compose):

```bash
docker compose exec backend bun run scripts/eval/run-text-to-schema-eval.ts
# с явным тест-tenant:
docker compose exec -e EVAL_TENANT_ID=<orgId> backend \
  bun run scripts/eval/run-text-to-schema-eval.ts
```

Tenant берётся из `--tenant <id>` / `EVAL_TENANT_ID`, иначе — первая не-удалённая
Org. Отчёты пишутся в `reports/result-<timestamp>.json` и `.csv`.

## Когда обновлять

- При правке промптов `table-infer-schema` / `table-architect-pass` /
  `table-entity-check` или логики `TableAgentService.inferSchemaFromText`.
- При смене primary-модели для этих task-type в `LlmTaskRoute`.
- При появлении новой бизнес-категории запросов, не покрытой набором.
- При обнаружении в проде нового класса hallucination — добавить фикстуру.
