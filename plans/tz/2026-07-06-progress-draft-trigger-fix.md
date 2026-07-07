---
type: tz
status: ready-to-implement
feature: progress-draft-trigger-fix
date: 2026-07-06
owner: Сергей (владелец)
relates_to:
  - plans/architecture/2026-07-06-progress-draft-trigger-fix.md
---
> Архитектура (одобрена владельцем): `plans/architecture/2026-07-06-progress-draft-trigger-fix.md` (status: approved, 2026-07-06) · Выбор: вариант A (строго) + планка уверенности 0.35 · Статус согласования: 2026-07-06

# ТЗ — починка триггера авто-черновика прогресса задач

## Принцип

Точечный баг-фикс логики **одного крона**. Кора перестаёт заводить черновик прогресса задачи, когда за задачей нет реального движения (дёрганье статуса туда-обратно) или когда сам ИИ не уверен. Текст черновика и работа LLM **не трогаются** — они корректны. Меняем только решение «а стоит ли вообще заводить черновик», до и сразу после вызова LLM.

## Цель + Зачем

**Болезненное состояние (диагностировано на проде korateam.ru, Org «Ооо луа», 2026-07-06):** из двух висящих черновиков прогресса оба — ложные срабатывания. У обоих единственные сигналы — две взаимно обратные смены статуса одной задачи (`A→B`, `B→A`, нетто-ноль). LLM честно вернула `health=at_risk`, `confidence` 0.2 и 0.3, текст «содержательного движения не видно». Черновик всё равно родился и попал в очередь «Подтверждения» как «Срочно». Это подрывает доверие ко всей очереди подтверждений.

**Решение делает лучше:** черновик рождается только когда за ним есть настоящее содержание. Три правила (все — крутилки в админке):
1. Взаимно-компенсирующиеся смены статуса не считаются сигналом (нетто-результат).
2. Нужен ≥1 **содержательный** сигнал (выполненный пункт чек-листа ИЛИ упоминание задачи в графе знаний); только смены статуса черновик не создают.
3. Черновик с `confidence` ниже порога (дефолт 0.35) тихо гасится, в очередь не попадает.

## REALITY-CHECK (фактическое состояние кода на 2026-07-06)

- **Крон существует и работает:** `backend/src/modules/tracker/workers/progress-auto-draft.cron.ts`. `@Cron('0 7 * * *')` (`runScheduled`) + событийный `@OnEvent('task.progress_signalled')` (`onProgressSignal`). Оба зовут `draftForIssue()`.
- **`collectSignals()` (строки ~321–389)** собирает 3 вида сигналов: выполненные пункты чек-листа (`issueChecklistItem`, label `'выполнен пункт чек-листа'`), смены статуса (`issueActivity` `verb='status_changed'`, `orderBy epoch asc`, label `'сменился статус задачи'`) — **по одному сигналу на каждую смену**, упоминания в графе (`taskClosureCandidate`, label `'упоминание задачи в графе знаний'`, дают `sourceBlockIds`).
- **`draftForIssue()` (строки ~234–302)** порядок: `collectSignals` → `if signals.length < minSignals return 'below_threshold'` → `hasPendingDraft` → `dedupAcquire` → `formulate` (LLM) → `computeSnapshot` → `prisma.issueProgressUpdate.create`. **Confidence LLM записывается в БД, но НИГДЕ не проверяется гейтом.**
- **`RunSummary`** уже содержит счётчики `drafted / belowThreshold / dedupSkipped / existingPendingSkipped`.
- **`minSignals()` (строки ~537–548)** читает `tracker.progressAutoDraftMinSignals` через `this.cfg.getDynamic<number>(...)` с code-fallback `DEFAULT_MIN_SIGNALS=2`. **Это образец чтения крутилки — повторить для новых порогов.**
- **Реестр настроек** `backend/src/modules/admin/settings/admin-setting-schema-registry.ts`: строки 449–451 уже содержат `tracker.progressAutoDraftEnabled` / `progressAutoDraftMinSignals` / `progressAutoDraftCron`. `UNIT_INTERVAL = z.number().min(0).max(1)` определён на строке 7.
- **Сид** `backend/scripts/seed-admin-setting-tracker.ts`: массив `SEEDS`, три существующих ключа сидятся на строках 37–63. Сид **уже зарегистрирован** в `apply-prod-deploy.ts:186` (`STEPS`) → новый ключ в `SEEDS` попадёт в прод автоматически, новый STEP не нужен.
- **UI админки** подтягивает поля из записей `AdminSetting` (category/section/severity/description) автоматически — **отдельного UI-кода на ключ писать не нужно**, достаточно строки в `SEEDS`.
- **Тесты существуют:** `progress-auto-draft.cron.spec.ts` (13 кейсов, стиль — ручные `vi.fn()`-моки Prisma, `makeCfg(overrides)` для крутилок). Happy-path кейс использует checklist=2 + candidate=1 + `confidence:0.8` → под новые гейты **не ломается**.

**Вывод:** остаток = правка одного метода `collectSignals` (нетто-схлопывание статуса) + два гейта в `draftForIssue` + чтение двух новых крутилок + 2 строки в реестре + 2 записи в `SEEDS` + расширение spec. Ни новой таблицы, ни миграции, ни ENV, ни backfill.

## Принятые решения владельца

| # | Решение | Обоснование |
|---|---|---|
| В1 | Вариант A (строго): нужен ≥1 содержательный сигнал + нетто-сдвиг статуса + confidence ≥ порога | Одобрено 2026-07-06. Убивает ровно класс пустышек с прода, риск срезать полезное минимален |
| В2 | Планка уверенности = 0.35 (дефолт крутилки) | Одобрено 2026-07-06. Оба прод-пустышки (0.2/0.3) отсекаются, нормальные (0.5+) проходят |
| В3 | Пороги — крутилки в `AdminSetting`, не ENV/хардкод | Принцип №9 CLAUDE.md; рядом уже 3 родственные крутилки того же механизма |
| В4 | Два прод-пустышки уже отклонены вручную при диагностике | Обратимо, ничего не опубликовано; фикс — про предотвращение новых |

## Доказательство выбора (кратко)

Разобрано в архитектуре. Ключевой довод: **поднять `minSignals` с 2 до 3 проблему не решает** — на активной задаче человек накликает 3–4 смены статуса и снова получит пустышку. Чинить надо *смысл* сигналов (что считается сигналом), а не их *число*. Проход-альтернатива «просто поднять порог» отвергнута: ломается на первом же кейсе с ≥3 статус-флипами.

## Scope

**Входит:**
- Нетто-схлопывание смен статуса в `collectSignals`.
- Гейт «требуется содержательный сигнал» в `draftForIssue` (за крутилкой `tracker.progressAutoDraftRequireSubstantiveSignal`, дефолт `true`).
- Гейт «confidence ≥ порога» после `formulate` (крутилка `tracker.progressAutoDraftMinConfidence`, дефолт `0.35`).
- Регистрация двух новых крутилок (реестр + сид).
- Счётчики в `RunSummary` для наблюдаемости.
- Юнит-тесты.

**Не входит (с судьбой):**
- Текст черновика / промпт / работа LLM — корректны, не трогаем.
- Другие типы «Подтверждений» (curation/probe/conflict/intake) — отдельная история, вне scope.
- Чистка уже висящих черновиков — сделана вручную при диагностике.
- «Умное» распознавание важности статуса (Done важнее In Progress) — не требуется на этом этапе; при появлении потребности — отдельное ТЗ.

## Границы фичи

- ✅ **Always:** читать пороги через `this.cfg.getDynamic(...)` с code-fallback; сохранять существующее поведение happy-path (реальный прогресс → черновик как раньше).
- ⚠️ **Ask first:** менять что-либо в промпте/тексте черновика; трогать другие провайдеры pending-actions.
- 🚫 **Never:** `process.env.*` в кроне; хардкод порога; `new PrismaClient()` в скриптах; миграция/ENV ради этих порогов; авто-публикация черновика без человека (Р2 инварианта прогресса — только draft `pending`).

---

## Фаза 1 — Две новые крутилки в реестре и сиде

**Ценность:** как админ компании, получаю в админке два новых порога управления авто-черновиком прогресса, чтобы настраивать строгость без правки кода (принцип №9).

**Цель:** зарегистрировать `tracker.progressAutoDraftMinConfidence` и `tracker.progressAutoDraftRequireSubstantiveSignal`.

**Файлы:**
- `backend/src/modules/admin/settings/admin-setting-schema-registry.ts` — после строки 451 (`tracker.progressAutoDraftCron`), в том же блоке `tracker.*`. Якорь: строка `['tracker.progressAutoDraftCron', z.string().min(1)],`. **Перед правкой перечитать — номера строк могли сдвинуться.**

  Добавить:
  ```ts
  ['tracker.progressAutoDraftMinConfidence', UNIT_INTERVAL],
  ['tracker.progressAutoDraftRequireSubstantiveSignal', z.boolean()],
  ```

- `backend/scripts/seed-admin-setting-tracker.ts` — в массив `SEEDS`, рядом с существующими `progressAutoDraft*` (после блока строк 46–63). Якорь: объект с `key: 'tracker.progressAutoDraftCron'`.

  Добавить два объекта в стиле соседей:
  ```ts
  {
    key: 'tracker.progressAutoDraftMinConfidence',
    value: 0.35,
    category: 'tracker',
    section: 'workers',
    severity: 'low',
    description:
      'Порог уверenности авто-черновика прогресса: черновик с confidence ниже порога тихо гасится и не попадает в «Подтверждения» (анти-fatigue). По умолчанию 0.35, диапазон 0–1.',
  },
  {
    key: 'tracker.progressAutoDraftRequireSubstantiveSignal',
    value: true,
    category: 'tracker',
    section: 'workers',
    severity: 'medium',
    description:
      'Требовать хотя бы один содержательный сигнал (выполненный пункт чек-листа или упоминание задачи в графе) для создания авто-черновика прогресса. По умолчанию вкл: одни смены статуса черновик не создают. Выкл → старое поведение (черновик может родиться и только из смен статуса).',
  },
  ```
  > Опечатку в слове не копировать — писать «уверенности».

**Что НЕ входит:** логика крона (Фаза 2), UI-код (подтягивается из AdminSetting автоматически).

**Acceptance:**
- `grep -n "progressAutoDraftMinConfidence\|progressAutoDraftRequireSubstantiveSignal" backend/src/modules/admin/settings/admin-setting-schema-registry.ts` → 2 совпадения.
- `grep -n "progressAutoDraftMinConfidence\|progressAutoDraftRequireSubstantiveSignal" backend/scripts/seed-admin-setting-tracker.ts` → ≥2 совпадения.
- `bun run typecheck` зелёный.
- Идемпотентность сида: повторный `upsertSetting` не перезаписывает admin-edited (логика уже в файле, новые записи ей подчиняются) — проверяется тем, что value ставится только при create/non-admin-edited.

**Закрывает:** R4, R5.

---

## Фаза 2 — Логика крона: нетто-статус + два гейта

**Ценность:** как руководитель, перестаю получать в «Подтверждениях» пустые черновики от дёрганья статуса и неуверенные черновики, чтобы очередь подтверждений снова была сигналом, а не шумом.

**Цель:** починить `collectSignals` (нетто-схлопывание статуса) и `draftForIssue` (гейт содержательности + гейт уверенности), читать новые крутилки.

**Файл:** `backend/src/modules/tracker/workers/progress-auto-draft.cron.ts`. **Перед правкой перечитать — номера строк ниже на момент написания.**

### 2.1 — Нетто-схлопывание статуса в `collectSignals`

Якорь: блок `const statusChanges = await this.prisma.issueActivity.findMany({ ... verb: 'status_changed' ... orderBy: { epoch: 'asc' } ... })` и следующий за ним цикл `for (const change of statusChanges) { signals.push({ label: 'сменился статус задачи', detail: this.describeStatusChange(...) }); }`.

Заменить цикл добавления статус-сигналов на нетто-логику:
- Если `statusChanges.length === 0` — статус-сигналов нет (как сейчас).
- Иначе вычислить `firstOld = this.stringifyValue(statusChanges[0].oldValue)`, `lastNew = this.stringifyValue(statusChanges[statusChanges.length - 1].newValue)`.
- Если `firstOld === lastNew` (и оба непусты) — задача вернулась в исходный статус → **не добавлять ни одного статус-сигнала** (нетто-ноль).
- Иначе добавить **ровно ОДИН** сводный сигнал: `{ label: 'сменился статус задачи', detail: this.describeStatusChange(statusChanges[0].oldValue, statusChanges[statusChanges.length - 1].newValue) }` (нетто-переход A→C, а не по одному на каждую смену).

> Реализовать отдельным приватным хелпером (напр. `netStatusSignal(statusChanges): IssueProgressDraftSignal | null`) для тестируемости — вернуть null или один сигнал.

### 2.2 — Помечать содержательность в `collectSignals`

`collectSignals` должен вернуть, помимо `signals` и `sourceBlockIds`, признак `substantiveCount` — число содержательных сигналов = (кол-во выполненных пунктов чек-листа) + (кол-во упоминаний в графе / `candidates.length`). Смены статуса в `substantiveCount` **не входят**.

Расширить интерфейс `IssueSignals`:
```ts
interface IssueSignals {
  signals: IssueProgressDraftSignal[];
  sourceBlockIds: string[];
  substantiveCount: number;
}
```

### 2.3 — Гейт содержательности в `draftForIssue`

Якорь: строка `if (signals.length < args.minSignals) return 'below_threshold';`.

Сразу после неё (до `hasPendingDraft`) добавить:
```ts
const requireSubstantive = await this.requireSubstantiveSignal();
if (requireSubstantive && substantiveCount === 0) return 'no_substantive';
```
где `substantiveCount` берётся из результата `collectSignals`.

### 2.4 — Гейт уверенности в `draftForIssue`

Якорь: строка `const draft = await this.formulate({ ... });` и следующая `if (!draft) return 'below_threshold';`.

После получения `draft` (и проверки `if (!draft)`), **до** `computeSnapshot` / `prisma.issueProgressUpdate.create`, добавить:
```ts
const minConfidence = await this.minConfidence();
if (draft.confidence < minConfidence) {
  this.logger.debug(
    { tenantId: issue.tenantId, issueId: issue.id, confidence: draft.confidence, minConfidence },
    'progress-auto-draft: черновик заглушён по низкой уверенности',
  );
  return 'low_confidence';
}
```

### 2.5 — Чтение новых крутилок

По образцу `minSignals()` (строки ~537–548) добавить два приватных метода:
```ts
private async minConfidence(): Promise<number> {
  const v = await this.cfg
    .getDynamic<number>('tracker.progressAutoDraftMinConfidence', undefined, ProgressAutoDraftCron.DEFAULT_MIN_CONFIDENCE)
    .catch(() => undefined);
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
    ? v
    : ProgressAutoDraftCron.DEFAULT_MIN_CONFIDENCE;
}

private async requireSubstantiveSignal(): Promise<boolean> {
  const v = await this.cfg
    .getDynamic<boolean>('tracker.progressAutoDraftRequireSubstantiveSignal', undefined, true)
    .catch(() => undefined);
  return typeof v === 'boolean' ? v : true;
}
```
Добавить константу рядом с существующими: `private static readonly DEFAULT_MIN_CONFIDENCE = 0.35;`.

### 2.6 — Счётчики наблюдаемости

Расширить `RunSummary` и агрегацию в `run()`:
```ts
interface RunSummary {
  scannedOrgs: number;
  scannedIssues: number;
  drafted: number;
  belowThreshold: number;
  noSubstantive: number;     // новое
  lowConfidence: number;     // новое
  dedupSkipped: number;
  existingPendingSkipped: number;
}
```
В `run()` в блоке подсчёта `handled` добавить ветки `else if (handled === 'no_substantive') summary.noSubstantive += 1;` и `else if (handled === 'low_confidence') summary.lowConfidence += 1;`. Обновить сигнатуры возврата `draftForIssue`/`processIssue` union-типом, включив `'no_substantive' | 'low_confidence'`.

**Что НЕ входит:** менять промпт, `formulate`, запись в БД (кроме того, что до неё теперь два гейта), провайдер pending-actions.

**Порядок гейтов (важно, не переставлять):** `signals.length < minSignals` → **гейт содержательности** → `hasPendingDraft` → `dedupAcquire` → `formulate` → **гейт уверенности** → `create`. Обоснование: содержательность дёшева (без LLM) — проверяем до дорогого вызова; уверенность известна только после LLM — проверяем после. Дедуп остаётся до LLM (не долбим модель повторно).

**Acceptance:**
- `grep -n "no_substantive\|low_confidence\|substantiveCount\|DEFAULT_MIN_CONFIDENCE\|requireSubstantiveSignal\|minConfidence" backend/src/modules/tracker/workers/progress-auto-draft.cron.ts` → все символы присутствуют.
- Нет `process.env` в файле: `grep -c "process.env" .../progress-auto-draft.cron.ts` → 0.
- `bun run typecheck` · `bun run lint` · `bun run build` — зелёные.

**Закрывает:** R1, R2, R3, R6.

---

## Фаза 3 — Тесты + prod-deploy-log

**Ценность:** как воркер авто-черновика, получаю регрессионную защиту, чтобы починка не развалилась при будущих правках; как программист на проде — знаю, что новые крутилки просто сидятся существующим шагом.

**Цель:** расширить `progress-auto-draft.cron.spec.ts`; обновить prod-deploy-log.

**Файл:** `backend/src/modules/tracker/workers/progress-auto-draft.cron.spec.ts`. Стиль — существующий (`vi.fn()`-моки, `makeCfg(overrides)`). `activityFindMany` в дефолте — `[]`; для статус-кейсов мокать её.

Новые кейсы (минимум):
1. **Статус туда-обратно (нетто-ноль) → нет черновика.** `activityFindMany` = `[{oldValue:'S1', newValue:'S2'}, {oldValue:'S2', newValue:'S1'}]`, `checklistFindMany`=`[]`, `candidateFindMany`=`[]`. Ожидание: `progressCreate` не вызван; `res.drafted === 0`. (Соответствует прод-кейсу.)
2. **Статус A→B→C (нетто-сдвиг) даёт ровно 1 статус-сигнал, но без содержательного → нет черновика (гейт содержательности).** `activityFindMany` = 2 перехода с итогом S1→S3, checklist=[], candidate=[]. Ожидание: `res.noSubstantive === 1`, `progressCreate` не вызван.
3. **Гейт уверенности: LLM вернула confidence 0.2 → нет черновика.** checklist=2 (содержательный есть), `llmCall` возвращает JSON с `confidence:0.2`. Ожидание: `res.lowConfidence === 1`, `progressCreate` не вызван.
4. **Happy-path сохранён: checklist=2 + candidate=1 + confidence 0.8 → черновик создаётся.** (Существующий кейс на строке 112 — проверить, что не сломался.)
5. **`requireSubstantiveSignal=false` (крутилка выкл) + только нетто-сдвиг статуса + confidence 0.8 → черновик создаётся** (вариант B поведения через крутилку). `makeCfg({'tracker.progressAutoDraftRequireSubstantiveSignal': false})`.

> Проверить, что существующий кейс «сигналов меньше порога» (строка 135) остаётся зелёным: checklist=1, candidate=[] → `signals.length=1 < minSignals=2` → `belowThreshold` (срабатывает раньше гейта содержательности, порядок сохранён).

**Файл:** `docs/operations/prod-deploy-log.md` — **Шаг 7 (seed)**: обновить существующую запись про `seed-admin-setting-tracker.ts` (или добавить строку-примечание), что скрипт теперь сидит ещё 2 ключа (`progressAutoDraftMinConfidence`, `progressAutoDraftRequireSubstantiveSignal`). Новый STEP не заводить — сид уже в `apply-prod-deploy.ts` STEPS. ENV/схема/backfill — не затронуты (Шаги 1/4/5/8 не трогать).

**Acceptance:**
- `bunx vitest run backend/src/modules/tracker/workers/progress-auto-draft.cron.spec.ts` — все кейсы (старые + 5 новых) зелёные.
- Кейс №1 воспроизводит прод-ситуацию (статус туда-обратно) и подтверждает: черновик не создаётся.
- `grep -n "progressAutoDraftMinConfidence" docs/operations/prod-deploy-log.md` → ≥1 совпадение.

**Закрывает:** R1, R2, R3, R7.

---

## Требования (трассировка)

- **R1.** Если по задаче все смены статуса в сумме дают возврат в исходный статус (нетто-ноль), система shall не засчитывать статус как сигнал.
- **R2.** Если `progressAutoDraftRequireSubstantiveSignal=true` и по задаче нет ни одного содержательного сигнала (чек-лист/граф), система shall не создавать черновик, даже если общее число сигналов ≥ `minSignals`.
- **R3.** Когда LLM вернула `confidence < progressAutoDraftMinConfidence`, система shall не создавать `IssueProgressUpdate` и залогировать заглушение на уровне debug.
- **R4.** Система shall хранить `progressAutoDraftMinConfidence` (0–1, дефолт 0.35) и `progressAutoDraftRequireSubstantiveSignal` (bool, дефолт true) как `AdminSetting`, читаемые через `getDynamic` с code-fallback; никаких ENV/хардкода.
- **R5.** Новые крутилки shall быть видны/редактируемы в админке компании (через запись `AdminSetting`, без отдельного UI-кода).
- **R6.** При нетто-сдвиге статуса (A→C, A≠C) система shall добавлять ровно один сводный статус-сигнал, а не по одному на каждую смену.
- **R7.** Существующее happy-path поведение (реальный прогресс → черновик `pending`) shall сохраняться без изменений.

## Сквозные аспекты

- **RBAC/tenant:** `[N/A]` — крон уже tenant-scoped (обходит Org), новые гейты не меняют границы; видимость черновиков в провайдере не трогается.
- **Observability:** покрыто счётчиками `noSubstantive`/`lowConfidence` в `RunSummary` (логируется в `runScheduled`) + debug-лог заглушения.
- **Errors/идемпотентность:** сид идемпотентен (upsert, admin-edited не перезаписывается); гейты — чистые early-return, без побочных эффектов.
- **Миграции/backfill:** `[N/A]` — только дефолты новых настроек, схема БД не меняется.
- **Rollout/флаг (Ship-On):** обе крутилки выкатываются включёнными в строгий режим (В1/В2) — это «решение владельца» с заданными параметрами, сразу активно. `progressAutoDraftRequireSubstantiveSignal` — аварийный откат на старое поведение при необходимости. Строка в `docs/operations/feature-flags.md` (реестр флагов) — добавить.
- **Тесты:** Фаза 3.

## DoD

- `bun run typecheck` (вкл. `.spec`) · `bun run lint` · `bun run build` — зелёные.
- `bunx vitest run backend/src/modules/tracker/workers/progress-auto-draft.cron.spec.ts` — зелёный.
- second-brain: обновить профильную заметку по трекеру/прогрессу, если есть (`01_projects/*` про auto-draft); `docs/operations/feature-flags.md` — 2 новых флага; `docs/operations/prod-deploy-log.md` Шаг 7 — примечание.
- Рефлексия в `second-brain/05_история/`.
- Прод-инструкция: `docker compose exec backend bun run scripts/seed-admin-setting-tracker.ts` (или общий `apply-prod-deploy.ts --mode update`) — сидит 2 новых ключа. ENV/миграций нет.

## Итог

Реализовано целиком (2026-07-06). Фаза 1 — 2 крутилки в реестре+сиде; Фаза 2 — нетто-схлопывание статуса (`netStatusSignal`) + гейт содержательности + гейт уверенности + счётчики; Фаза 3 — 5 юнит-кейсов (18 passed в spec, 88 passed по модулю tracker/workers) + prod-deploy-log + feature-flags. typecheck/lint/build зелёные. Осталось для прода: прогон сид-скрипта (`seed-admin-setting-tracker.ts`, уже в `apply-prod-deploy.ts` STEPS) — миграций/ENV нет.
