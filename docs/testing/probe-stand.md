# Стенд уточняющих вопросов (probe-stand)

Инструмент, чтобы **периодически проверять, какие уточняющие вопросы (probe) Кора задаёт, и судить — полезны они или шум.** Гоняется на **локальной «Стреле»** (наполненный тестовый тенант), прод не трогает.

Файлы: `backend/scripts/probe-stand/` — `stand.ts` (раннер), `registry.ts` (карта всех типов вопросов), `judge.ts` (LLM-судья по API).

## Зачем

- **Инвентаризация:** какие вопросы вообще возникают, каким агентом (`emittedByService`), кому уходят, как часто.
- **Судья польза/шум:** LLM (DeepSeek-v4-pro через наш API) по фиксированной рубрике ставит каждому типу вердикт `useful | borderline | noise` + конкретную рекомендацию. Судит **LLM, а не агент-человек** — чтобы вердикт был воспроизводим и сравним между прогонами.
- **Поведенческие сценарии:** задача → «Готово» = приходит «расскажи, как решал» (`task.method_capture`); задача без срока/исполнителя = уточняющий вопрос.

Стенд разводит два слоя: **«сработало ли правильно»** (детерминированные ассерты, без LLM) и **«полезен ли вопрос»** (LLM-судья).

## Предпосылки (перед запуском)

1. Поднята dev-инфра из корня: `docker compose -f docker-compose.dev.yml up -d` (Postgres :55435, Redis :56381).
2. `backend/.env` смотрит на локальную БД (НЕ на прод) и содержит `DEEPSEEK_API_KEY` (нужен для `judge`/`report`).
3. «Стрела» засеяна. Id по умолчанию `cmr1qbvpx0001pwbwxbgmh1jl`; переопределяется `STRELA_ORG`. Наполнение — см. `docs/testing/synthetic-qa-baseline-strela.md`.
4. Запускать из папки `backend/` (отчёт пишется в `../docs/testing/`).

## Запуск

```bash
cd backend

# карта всех типов вопросов (без БД/LLM)
bun run scripts/probe-stand/stand.ts catalog

# что уже накопилось в Стреле (без LLM), окно 14 дн
bun run scripts/probe-stand/stand.ts harvest

# полный отчёт с вердиктами LLM-судьи → ../docs/testing/probe-stand-report.md (+ .json)
bun run scripts/probe-stand/stand.ts report

# то же без LLM (только инвентаризация)
bun run scripts/probe-stand/stand.ts report:nollm

# ФОРСИРОВАТЬ инспекторы (чистит dedup Стрелы, гонит consistency-checker + task-clarify-sweep), затем harvest
bun run scripts/probe-stand/stand.ts trigger

# сценарий: перевести значимую задачу в «Готово» → ждать probe «расскажи как решал»
bun run scripts/probe-stand/stand.ts scenario:method-capture

# сценарий: прогнать sweep задач без срока/исполнителя → ждать уточняющий probe
bun run scripts/probe-stand/stand.ts scenario:task-clarify

# всё сразу: trigger → оба сценария → отчёт
bun run scripts/probe-stand/stand.ts all
```

Окно выборки: `PROBE_STAND_SINCE_DAYS` (по умолчанию 14).

## Что означают режимы

| Режим | БД | LLM | Nest | Что делает |
|---|---|---|---|---|
| `catalog` | — | — | — | печатает реестр `registry.ts` |
| `harvest` | чтение | — | — | группирует probe Стрелы по reason |
| `report` / `judge` | чтение | да | — | harvest + вердикт судьи + отчёт в файл |
| `report:nollm` | чтение | — | — | отчёт без вердиктов |
| `trigger` | чтение | — | да | форс инспекторов (пишет probe в БД!) + harvest |
| `scenario:*` | чтение+1 запись | — | да | поведенческая проверка |
| `all` | чтение+записи | да | да | trigger + сценарии + отчёт |

`trigger`, `scenario:*`, `all` поднимают **полный Nest-контекст** (`AppModule`) и **пишут** в локальную БД (создают probe / у одной задачи меняют статус на «Готово»). На локальной Стреле это ожидаемо. Легкие режимы (`catalog`/`harvest`/`report`) — только чтение probe_events + вызов LLM.

## Как читать отчёт

`../docs/testing/probe-stand-report.md` — таблица, отсортированная «шум → спорно → полезно», с колонкой рекомендации; ниже — детали по каждому reason (пример текста, оценки рубрики, обоснование, фикс).

## Известные нюансы (проверяются стендом)

- **`task.method_capture` уходит ИСПОЛНИТЕЛЮ (assignees), не владельцу**, и только если сложность задачи ≥ `tracker.methodCaptureMinComplexity` (0.5). Простую задачу закрыл — вопроса не будет (это by design). Сценарий берёт самую приоритетную открытую задачу с исполнителем.
- **`task-clarify-sweep`** спрашивает по `IntakeIssue` в статусе `pending` **старше 20ч** (`tracker.taskClarifySweep.minAgeHours`) без исполнителя/срока. Если таких нет — сценарий честно сообщит, что нужно засеять.
- **`consistency-checker`** дедупит в Redis с TTL = интервалу крона (4ч) и шлёт **отдельный probe на каждый шаг/сущность** — главный источник объёма. `trigger` чистит dedup-ключи Стрелы, чтобы получить свежие probe.
- **Дубль:** `consistency_violation.R6` и `companyprofile.missing_*` спрашивают одно и то же (миссия/видение/стратегия).

## Границы

- Только локальная Стрела. Прод — исключительно read-only диагностика (см. `docs/operations/prod-ssh-access.md`), стенд туда не ходит.
- Реестр `registry.ts` — производная от `probe-reason-labels.ts` + эмиттеров; при добавлении нового probe-reason дополнить реестр.
