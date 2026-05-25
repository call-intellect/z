# ADR — Architecture Decision Records (решения по архитектуре)

В этом разделе живут ADR — короткие документы, в которых фиксируется
**одно архитектурное решение** в момент его принятия: что решили, почему,
какие альтернативы рассмотрели и отклонили.

В проекте Z процесс ADR обязателен для **расширения enum'ов knowledge-core**
(ядра графа знаний): добавление нового значения в enum без явного обсуждения
быстро превращается в семантический мусор (классификатор не различает
похожие типы, snapshot-тесты деградируют, метрики по signalType теряют смысл).

## Когда ADR обязателен

Любое расширение одного из enum'ов:

- `SIGNAL_TYPE_VALUES` в [`backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts`](../../backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts) (зеркало Prisma enum `SignalType`).
- `EntityType` в `backend/prisma/schema.prisma` (типы сущностей графа: Person, Project, ...).
- `IdeaBlockLinkRelationType` в `backend/prisma/schema.prisma` (типы связей между IdeaBlock).
- `EntityLinkType` в `backend/prisma/schema.prisma` (типы связей между Entity).

Удаление значения (deprecate / superseded) — тоже ADR со статусом `superseded`
и ссылкой на ADR, который пришёл на замену.

**Не требуется** ADR для: внутренних enum'ов модулей (FSM встречи, статусы
задач трекера и т.п.), полей DTO, и любых других перечислений вне knowledge-core.

## Нумерация

Sequential, начиная с `0001`. Имя файла: `NNNN-<enum-kind>-<value-name>.md`.

- `enum-kind` — `signal-type` | `entity-type` | `idea-block-link-relation-type` | `entity-link-type`.
- `value-name` — фактическое значение enum'а (snake_case, как в коде).

Примеры:

- `0001-signal-type-reasoning.md`
- `0002-signal-type-task-blocked.md`
- `0003-entity-type-customer-segment.md`

Перед созданием — посмотри последний номер в `ls docs/adr/` и возьми следующий.

## Шаблон

Используй [`template-signal-type.md`](./template-signal-type.md) — он рассчитан на
signalType, но структура подходит для всех четырёх enum'ов (просто замени
заголовок и таблицу примеров под нужный enum).

## Статусы

- **proposed** — черновик, идёт обсуждение.
- **accepted** — решение принято, значение можно добавлять в код.
- **rejected** — решение отклонено, ADR остаётся как след «почему НЕ добавили».
- **superseded** — заменено другим ADR (ссылка обязательна).

## Процесс review

Минимум **1 reviewer** (помимо автора). Reviewer проверяет:

1. Семантика чёткая, отличие от соседних значений описано в разделе «Решение».
2. Минимум 5 примеров «это [name]» vs «это не [name]» в таблице.
3. Snapshot-тест либо обновлён в этом же PR, либо явно сказано «не требуется,
   потому что …».
4. Раздел «Альтернативы» не пустой (если вообще нет альтернатив — это
   подозрительно, проси автора подумать ещё раз).

## Как заявить новое значение

1. Скопируй `template-signal-type.md` → `NNNN-<enum-kind>-<value-name>.md`.
2. Заполни (минимум 5 примеров обязательно).
3. Status: `proposed`.
4. Открой PR, в описании дай ссылку на ADR.
5. После approve reviewer'ом → status: `accepted` → добавь значение в код
   и обнови snapshot-тесты в том же PR.

## CI-проверка

Скрипт `scripts/check-signal-type-adr.sh` сравнивает изменения в
`block-ingest.prompt.ts` с наличием новых/изменённых файлов в `docs/adr/`.
Запускается локально перед commit (опционально) либо в CI (см. ниже).

### Как включить CI-проверку

В проекте сейчас **нет** `.github/workflows/` и нет `.husky/` — поэтому скрипт
лежит отдельно и запускается вручную:

```bash
bash scripts/check-signal-type-adr.sh
```

Когда появится одно из двух — подключить так:

- **GitHub Actions** (`.github/workflows/`) — создать
  `.github/workflows/signal-type-adr-check.yml` с шагом
  `bash scripts/check-signal-type-adr.sh` (триггер `pull_request` на ветку `main`).
- **Husky** (`.husky/`) — добавить вызов скрипта в `.husky/pre-commit`.
  Требует `bunx husky install` при первой настройке (это уже за рамками ADR-процесса).

До тех пор — reviewer проверяет наличие ADR вручную при code review.
