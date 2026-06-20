# Реестр тестов Коры — что мы реально тестируем (живой документ)

> **Назначение.** Единая точка правды о том, **что в системе протестировано, чем именно, и как этот тест перезапустить**.
> Документ **накопительный**: появился новый тест/прогон — добавь строку. Это не отчёт одной сессии, а карта покрытия,
> по которой видно «где система доказанно работает, а где мы пока верим на слово».
>
> Связанные: разовый разбор большого теста агентов — [`plans/analysis/2026-06-20-agents-big-test-RESULTS.md`](../../plans/analysis/2026-06-20-agents-big-test-RESULTS.md);
> ТЗ на фикс найденного 🔴 — [`plans/tz/2026-06-20-decision-materialization-idempotency-fix.md`](../../plans/tz/2026-06-20-decision-materialization-idempotency-fix.md).

## Как пользоваться
- **Колонки покрытия:** ✅ доказано (есть проходящий тест) · 🟡 частично · ❌ не покрыто.
- **Каждая ✅** обязана иметь ссылку на сам тест (файл `.spec` / фикстуры харнесса) — иначе это не ✅, а «верим на слово».
- Запустил новый тест → добавь строку в матрицу + в «Журнал прогонов» внизу.

## Что вообще можно тестировать (типы тестов)

Система — это цепочка: **встреча/чат → робот-читатель (LLM) достаёт смысл → код решает что с этим делать → запись в базу знаний → показ в кабинете.** На каждом звене — свой тип теста. Звено не покрыто — значит в этом месте система может молча врать.

| Тип теста | Что доказывает (простыми словами) | Чем гоняем | Где живёт |
|---|---|---|---|
| **1. Промпт-тест** | «Робот-читатель понимает текст»: на заданный вход LLM достаёт правильное (задачу/решение/сущность), держит кривую расшифровку речи (ASR), не выдумывает лишнего | харнесс `agent-run-table` — **реальный LLM**, фикстуры | `backend/scripts/agent-registry.ts` + `backend/test/eval/<агент>/fixtures/*.json` |
| **2. Логика-тест (unit)** | «Код принимает правильные решения»: дедуп, идемпотентность, гейты качества, ветвления — без LLM, на моках | `vitest` (`bun run test:unit`) | `backend/src/**/<файл>.spec.ts` |
| **3. Выход-в-базу (персистентность)** | «Знание реально сохранилось и его видно»: извлечённое доходит до таблицы Prisma + узла графа AGE, не теряется на гонке/ошибке | e2e на изолированном тенанте (`combat-harness`) + прод-трассировка `diag.ts` (read-only) | `backend/test/**/*.e2e` · `backend/scripts/diag.ts` |
| **4. Контракт/схема** | «Ответ LLM валиден»: проходит Zod-схему, битый JSON не роняет весь массив | `vitest` + `validate` в call-site | `*.spec.ts`, Zod-схемы агентов |
| **5. Идемпотентность/гонки** | «Повтор/параллель не плодит дубли и не теряет данные» (именно тут жил 🔴 #2b) | `vitest` (мок гонки) + e2e параллельный диспатч | `*.dedup.spec.ts`, `*.p2002*.spec.ts` |
| **6. Сегментация/нарезка** | «Разговор правильно нарезан на куски»: договорённость не размазывается так, что её никто не ловит (upstream от промптов) | e2e + инспекция блоков встречи | — (пока ручная, см. #2a в RESULTS) |
| **7. Безопасность (инъекции)** | «Вредная инструкция внутри текста встречи не управляет агентом» | харнесс с обёртками call-site | фикстура `injection-*` |
| **8. Сквозной (end-to-end)** | «Вся цепочка от встречи до экрана даёт ожидаемое» | e2e на изолированном тенанте | `combat-harness` |

**Важно про честность покрытия:** промпт-тест (тип 1) НЕ доказывает, что знание дошло до базы — он доказывает только что LLM понял текст. «Дошло до базы» доказывает только тип 3. Главный 🔴 этой сессии (решения молча не сохранялись) промпт-тестами не ловился — он жил между «LLM понял» и «записалось»: тип 3/5.

## Матрица покрытия по агентам

Заполнено из аудита конвейера ([2026-06-20-knowledge-pipeline-agents-audit.md](../../plans/analysis/2026-06-20-knowledge-pipeline-agents-audit.md)).
Колонки = три уровня, о которых ты спрашивал: **1·Промпт** (LLM понимает текст), **2·Логика** (код решает верно), **3·Выход-в-базу** (знание реально сохранилось/не теряется на гонке).

| Агент | Что делает | 1·Промпт | 2·Логика | 3·Выход-в-базу | Здоровье | Где тест |
|---|---|:--:|:--:|:--:|:--:|---|
| `block-ingest` | режет на блоки + сущности | ✅ 2/2 | 🟡 happy-path | 🟡 partial-loss закрыт (`core_partial_loss_total`, не «ingested» при потере; +unit), real-DB e2e нет (CI) | ✅ | `test/eval/block-ingest/` |
| `block-distill` | повышает блок → запускает спецов | — | 🟡 happy-path | 🟡 reconcile-cron «обработано без проекций» (Б4/Б36, +spec), real-DB e2e нет (CI) | ✅ | `block-distill.worker.spec` · `block-distill-reconcile.cron.spec` |
| `specialist-3-1` (регламенты) | регламенты/процессы/политики/инструкции | ✅ V1/V2 | 🟡 happy-path | ❌ (инструкции мимо куратора) | 🔴 | `diag-regulations` · [аудит](../../plans/analysis/2026-06-20-regulations-process-module-audit.md) |
| `specialist-3-3` (решения) | решения | ✅ 3/3 | ✅ 8/8 (вкл. гонку P2002) | 🟡 unit-гонка ✅ (create+catch P2002→merge), real-DB e2e нет (CI) | ✅ | `test/eval/decision-extract/` · `specialist-3-3-decisions.dedup.spec.ts` |
| `specialist-3-5` (инсайты) | боли/риски/возражения | ✅ 2/2 (+ASR) | 🟡 dedup | 🟡 unit-гард ✅ (rethrow→retry, guard sourceBlockIds), real-DB e2e нет (CI) | ✅ | `test/eval/insight-extract/` · `specialist-3-5-insights.dedup.spec.ts` |
| `specialist-3-6` (идеи) | идеи/запросы фич | ✅ PRO/flash | 🟡 dedup | 🟡 unit-гард ✅ (rethrow→retry, guard sourceBlockIds), real-DB e2e нет (CI) | ✅ | [idea-vs-decision](../../plans/tz/2026-06-20-idea-vs-decision-disambiguation.md) · `idv-ab.ts` · `specialist-3-6-ideas.service.spec.ts` |
| `specialist-3-14` (цели) | цели/обязательства | 🟡 (research) | 🟡 | 🟡 unit-гард ✅ (rethrow→retry, guard sourceBlockIds), real-DB e2e нет (CI) | 🟡 | [goals-map-and-ideas](../../plans/tz/2026-06-20-goals-map-and-ideas-tz.md) · `specialist-3-14-goals.service.spec.ts` |
| `specialists-combined` | 9 типов за 1 вызов | ❌ | 🟡 | 🟡 unit-гард ✅ (P2002=дедуп, не errors.push), real-DB e2e нет (CI) | 🟡 | `specialists-combined.service.spec.ts` |
| `entity-resolution` | склейка сущностей (НЕ LLM) | — | 🟡 слияние ок | ❌ (дубли по имени, нет `@@unique`) | 🟡 | `*.spec` (частично) |
| `entity-graph` (связи) | строит связи раз в час | — | 🟡 | ❌ | ✅ | `*.spec` (частично) |
| `theme-clusterer` | блоки → темы | — | 🟡 | ❌ | ✅ | `*.spec` (частично) |
| `idea-clusterer` | идеи → кластеры | — | 🟡 | ❌ | ✅ | `*.spec` (частично) |
| `meeting-report-fast` | AI-отчёт + задачи | — | 🟡 деградация LLM | ❌ | ✅ | `*.spec` (частично) |
| `meeting-extract-actions` | достаёт задачи | ✅ 3/3 | 🟡 гейт | ❌ (пишет в IntakeIssue) | 🟡 | `test/eval/meeting-extract-actions/` |
| `task-closure-verify` | «задача сделана?» | ✅ 3/3 | ✅ **полностью** | 🟡 | ✅ | `test/eval/task-closure-verify/` · `*.spec` |
| `graph.service` (писатель) | низкоуровневая запись в граф | — | 🟡 | 🟡 unit-гард ✅ (`upsertDecision` P2002-safe re-find + cross-tenant→ConflictException), real-DB AGE e2e нет (CI) | 🟡 | `graph.service.spec.ts` (AGE-тесты `describe.skip`) |

**Как читать матрицу (главный вывод, обновлено 2026-06-20):** колонка **3·Выход-в-базу** была почти сплошь ❌ — самое опасное место и самый большой пробел тестов. После сессии «надёжность записи» (3 ТЗ) гонка/сбой у всех писателей сущностей закрыты **детерминированными unit-гардами** (P2002→merge / rethrow→retry / partial-loss-метрика / reconcile-cron) — колонка 3 поднялась с ❌ на 🟡 у `specialist-3-3/3-5/3-6/3-14`, `specialists-combined`, `graph.service`, `block-ingest`, `block-distill`. **Остающийся пробел: real-DB e2e гонки** (2 параллельных dispatch одного блока на ЖИВОЙ БД) — НЕ покрыт локально, потому что dev-postgres без Apache AGE (полный конвейер требует AGE + LLM); это CI-гейт. То есть «логику гонки/идемпотентности» мы доказали unit-гардами, но «гонку на настоящей БД сквозняком» — пока нет.

## Покрытие по «логикам» (потокам), а не только по агентам
Разные потоки — разная логика; покрытие у них разное:

| Поток (логика) | Что это | Покрытие сейчас |
|---|---|---|
| **Извлечение знаний → база** | встреча → блоки → типизированные сущности → граф | промпты крепкие (✅), но выход-в-базу для Decision был 🔴 (чинится); по остальным типам — в аудите |
| **Логика решений** | извлечь Решение → найти конфликт/supersede → записать → действовать на задачи | извлечение ✅; запись 🔴→чинится; «решение закрывает задачи» зависит от записи (без решений в реестре ветка мертва) |
| **Логика задач** | достать Задачу → гейт качества → создать → показать | извлечение ✅; **видимость — разобрана: задача оседает в `IntakeIssue` (`/intake`), а вкладка встречи читает пустую `Task`** (не баг, рассинхрон путей; флаг `meetingTasksToTrackerOnly` OFF). Есть готовый тест-доказательство `meeting-action-items.service.spec.ts:45` |
| **Логика закрытия** | сигнал «сделано» → судья → закрыть/пометить | судья ✅ (3/3); сквозной путь не e2e |

## Что реально протестировано в этой сессии (с пруфами)
- **4 промпт-агента — реальным LLM:** decision-extract 3/3, task-closure-verify 3/3, block-ingest 2/2, meeting-extract-actions 3/3. Вывод: **LLM-слой здоров**.
- **Идемпотентность Decision — unit на гонку:** воспроизвёл P2002-гонку, доказал что решение больше не теряется (8/8, `*.dedup.spec.ts`).
- **Защита от инъекций — подтверждена** (N=3) на реальном вызове.
- **Прод-диагностика (diag, read-only):** подтвердил 🔴 — у тенанта 23 встречи → 0 решений, 4× P2002 в логах.

## Что НЕ протестировано (честно) — и чем доказывать
- **Выход-в-базу для большинства типов** (тип 3) — нет e2e на изолированном тенанте. Доказывать: `combat-harness` сквозняком.
- **«Решения закрывают задачи» сквозняком** — только судья покрыт, не вся ветка.
- **Сегментация/нарезка** (тип 6) — #2a в RESULTS, нужен block-level доступ.
- **Гонки/сбои (выход-в-базу, колонка 3) — логика покрыта unit-гардами у ВСЕХ писателей** (3-3/3-5/3-6/3-14, combined, graph.service), плюс reconcile-cron (block-distill) и partial-loss-метрика (block-ingest). Класс «тихих потерь» больше не «верим на слово» — он доказан детерминированными unit-моками (P2002/гонка/сбой записи), а не только чтением кода. **Остаётся непокрытым: real-DB e2e/combat-harness гонки** — 2+ воркера на один блок параллельно на ЖИВОЙ БД (→ ровно 1 сущность, `db_conflict≥1`) + мок-сбой enqueue после commit → reconcile восстановил. Локально не прогоняется (dev-postgres без Apache AGE; полный конвейер требует AGE + LLM) → CI-гейт. Строки-указатели: ТЗ [`knowledge-core-silent-loss`](../../plans/tz/2026-06-20-knowledge-core-silent-loss-reliability.md) Ф6 / [`decision-idempotency`](../../plans/tz/2026-06-20-decision-materialization-idempotency-fix.md) Ф5; `second-brain/04_не-сделано/README.md`.
- **Симптом «не создаются задачи» — РАЗОБРАН, фикс уже спроектирован.** В проде флаг `meetingTasksToTrackerOnly`=**ON** (AdminSetting), реальный обрыв — `linkedMeetingIds` не прокидывается в `Issue`, вкладка ищет по нему → 0. Готовое ТЗ: [`intake-issue-linked-meeting-ids-fix`](../../plans/tz/2026-06-17-intake-issue-linked-meeting-ids-fix.md) (add `meetingId`→`Issue.linkedMeetingIds`). Доказательство тестом готово (`meeting-action-items.service.spec.ts:45`).

## Как запустить сохранённые тесты
```bash
# Промпт-тесты (реальный LLM) — один агент:
cd backend && bun run --env-file=../.env scripts/agent-run-table.ts --agent <имя>   # --list список
# Логика/идемпотентность (unit):
cd backend && bunx vitest run src/modules/knowledge-core/services/specialist-3-3-decisions.dedup.spec.ts
cd backend && bun run test:unit
# Прод-трассировка (read-only, только с разрешения владельца в сессии):
bun run --env-file=../.env scripts/diag.ts <cmd>
```

## Как добавлять новый тест в реестр
1. Промпт-тест: добавь агента в `agent-registry.ts` + фикстуры в `test/eval/<агент>/fixtures/` → прогон `agent-run-table` → строка в матрицу.
2. Логика/идемпотентность: `.spec.ts` рядом с кодом → строка в матрицу.
3. Выход-в-базу: сценарий в `combat-harness` → строка в матрицу.
4. Обнови колонки покрытия и «Журнал прогонов».

## Журнал прогонов
| Дата | Что прогнали | Результат | Где |
|---|---|---|---|
| 2026-06-20 | decision-extract, task-closure-verify, block-ingest, meeting-extract-actions (промпт) | 1.000 по всем | harness `test/eval/*` |
| 2026-06-20 | specialist-3-3 идемпотентность (unit, гонка P2002) | 8/8 | `*.dedup.spec.ts` |
| 2026-06-20 | аудит всего конвейера (16 агентов, логика + выход-в-базу), адверсариально | 6× 🔴, 5× 🟡, 5× ✅; класс «тихих потерь» в ~6 местах; задачи — рассинхрон путей | [pipeline-agents-audit](../../plans/analysis/2026-06-20-knowledge-pipeline-agents-audit.md) |
| 2026-06-20 | расследование «не создаются задачи» | не баг логики: прод-флаг ON, обрыв `linkedMeetingIds`; ready-ТЗ есть | [intake-fix](../../plans/tz/2026-06-17-intake-issue-linked-meeting-ids-fix.md) |
| 2026-06-20 | insight-extract (3-5) промпт | 2/2 (чистый+ASR) | `test/eval/insight-extract/` |
| 2026-06-20 | идемпотентные писатели + graph/combined P2002 — unit-гарды (3 ТЗ надёжности записи) | зелёные: `specialist-3-3` create+catch P2002→merge, `3-5/3-6/3-14` rethrow→retry+guard, `graph.service.upsertDecision` P2002-safe+cross-tenant, `specialists-combined` P2002=дедуп, block-ingest partial-loss | `specialist-3-3-decisions.dedup.spec.ts` · `specialist-3-5-insights.dedup.spec.ts` · `specialist-3-6-ideas.service.spec.ts` · `specialist-3-14-goals.service.spec.ts` · `graph.service.spec.ts` · `specialists-combined.service.spec.ts` |
| 2026-06-20 | real-DB e2e гонки (2 параллельных dispatch одного блока → 1 сущность, `db_conflict≥1`) | **НЕ покрыт локально** — dev-postgres без Apache AGE; CI-гейт (когда поднят полный стек) | ТЗ silent-loss Ф6 / decision-idempotency Ф5; `combat-harness` |
