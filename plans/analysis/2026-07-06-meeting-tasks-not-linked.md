# Анализ: задачи из встречи не появляются во вкладке «Задачи» встречи

- **Дата:** 2026-07-06
- **Тип:** баг-разбор (root-cause), продовый инцидент
- **Автор запроса:** владелец (svmazur@mail.ru)
- **Статус:** анализ завершён → следующий шаг: ТЗ (`tz-author`)
- **Эталонная встреча:** «Роман. Встреча по консалтингу.» `01KWVRAXGM41375A3N54HGSGEQ`, тип `partner`, орг «Ооо луа» (`cmpndk2tw000101mwmixvacuj`), 06.07.2026 16:02 МСК
- **Метод:** Playwright-вход в кабинет владельца + `diag.ts` (read-only прод) + API-сессия трекера + **SSH read-only на прод** (сверка задеплоенного кода) + git-археология

---

## 1. Симптом

После встречи AI-анализ отрабатывает и «достаёт задачи», но во вкладке **«Задачи»** карточки встречи пусто («0 всего»). Плюс отдельный вопрос владельца: **вторая задача назначена на Айназ, которой на встрече не было** (был Роман).

---

## 2. Доказательная база (прод)

### 2.1. UI и API карточки встречи
- Вкладка «Задачи» встречи: `0 всего`.
- `GET /api/v1/issues?linkedMeetingId=01KWVRAXGM…` → **`total: 0`**. Ни одной `Issue` с `linkedMeetingIds` этой встречи → вкладка (фильтр по `linkedMeetingIds has meetingId`) пуста по данным.

### 2.2. Задачи извлеклись — но в интейке и без привязки
`GET /api/v1/intake` — по встрече **2 кандидата**, оба `source="meeting_report"`, externalId `mat_*`, **`meetingId = null`**:

| # | Задача | Назначенец (карточка) | Статус | Источник-текст |
|---|---|---|---|---|
| 1 | «Зафиксировать позиционирование…» | **Сергей** (`cmpndk2so…`) | pending, conf 0.55 | «Сергей — зафиксировать позиционирование…» |
| 2 | «Найти подходящие компании для пилота» | **Айназ** (`cmpz3fi21…`) | accepted, conf 0.85 | «**Роман** взял паузу на поиск подходящих компаний…» |

Задача 1 (Сергей) — назначенец совпал с текстом. Задача 2 — в тексте **Роман**, а назначенец **Айназ** (см. §2.7).

### 2.3. Diag-трейс основного конвейера (`mtg_`)
Статус `ai_ready`, транскрипт 6743 слова, `reportFast: ready`, отчёт есть. Специалисты 3-1/3-4/3-14-goals, meeting-report-fast, roi, notify. **Извлечения задач в основном (`mtg_`) трейсе нет.**

### 2.4. LLM-вызовы встречи
Нет ни `meeting-extract-actions`, ни `task-extract` — специализированный экстрактор задач встречи в основном пайплайне не звался.

### 2.5. Прод-логи — материалайзер (диагностический «ствол»)
`TaskDraftMaterializerService` @ `14:09:37`, полная запись:
```json
{ "channel": "meeting_report", "created": 2, "skipped": 0,
  "sourceId": "report_01KWVRAXGM41375A3N54HGSGEQ",
  "traceId": "mtg_report_01KWVRAXGM41375A3N54HGSGEQ" }
```
Комбо-специалист под тем же трейсом:
```
[PIPE] combo START | { externalId: "report_01KWVRAXGM…", sourceType: "meeting_report", channelKind: "chat" }
[PIPE] combo DONE  | { tasks: 2, ideas: 1, insights: 3, decisions: 0, ... }
```
**Ключ:** комбо отработал по отчёту встречи с **`channelKind: "chat"`** (не `meeting`). За сутки материалайзер шёл только с каналами `meeting_report` (эта встреча) и `chatbox` — **ни одного `channel=meeting`**.

### 2.6. SSH на прод (read-only) — сверка задеплоенного кода
**Гипотеза «прод старее 23 июня» ОПРОВЕРГНУТА.** В задеплоенном контейнере присутствуют:
- `knowledge-core/services/specialist-3-15-tasks.service.ts` (спайн-специалист задач),
- `ai/services/prompts/tasks-unified.ts` (23 июня 12:34),
- маркеры `meeting-extract-actions` / `taskExtractionMode` (llm-router, workers.module, intake.service),
- материалайзер стр. 194: `meetingId: channel === 'meeting' ? args.sourceId : null` — идентичен локальному.

Унифицированное извлечение задач **задеплоено**. Значит дефект — не в возрасте сборки, а в **маршрутизации задач встречи**.

### 2.7. Атрибуция назначенца Айназ (вопрос владельца)
- Текст-источник задачи 2 явно называет **Роман**; Роман — **гость партнёрской встречи** (partner = гость без регистрации), в орге его нет как `User`.
- Комбо отработал с `channelKind='chat'` (без контекста участников встречи), `suggestedAssigneeHint` в карточке **пуст**.
- Итоговый назначенец — **Айназ**, org-участник, отличный от Романа.
- Механизм (код материалайзера `task-draft-materializer.service.ts`): имя-хинт → `AssigneeResolverService.resolve`; **если имя не резолвится в участника орга** (Роман — гость) → fallback **`SkillRoutingService.suggestAssignee({tenantId, taskText})`**: авто-назначение org-участника по совпадению навыков с текстом задачи при `confidence ≥ taskRouting.autoAssignMinConfidence`. Текст «найти компании для пилотного внедрения» лёг на профиль Айназ.
- **ВАЖНО:** само решение назначенца (имя-хинт vs skill-routing, кандидаты, confidence) **нигде не логируется** → доказать точную ветку по прод-логам сейчас НЕЛЬЗЯ, вывод построен на коде + состоянии карточки. Это отдельное требование к ТЗ (см. §5.4).

---

## 3. Корневая причина

### 3.1. Механизм потери привязки
Комбо-специалист (`specialists-combined.service.ts`) — фактический экстрактор задач встречи. По ingest **отчёта** встречи он вызывается с `channelKind='chat'` / `sourceType='meeting_report'`, и:
- `persistTasks` (стр. ~256) зовёт материалайзер с `channel = args.sourceType` (=`meeting_report`), `sourceId = args.meetingId` (=`report_<id>`, префиксованный);
- meetingId материалайзеру передаётся только при `channelKind === 'meeting'` (стр. 166, 413) → для `chat`/`meeting_report` **не передаётся**;
- материалайзер стр. 194: `meetingId: channel === 'meeting' ? args.sourceId : null` → для `meeting_report` **`meetingId = null`**, хотя реальный id встречи доступен (block-ingest умеет `tryGetPayloadMeetingId`, стр. 1091).

Итог: intake без `meetingId` → при промоуте `Issue.linkedMeetingIds` пуст → вкладка встречи пуста.

### 3.2. Фантомный `meeting-extract-actions` + спайн-skip
- Спайн-специалист 3-15 (стр. 104–116) **пропускает** блоки `meeting`/`meeting_report` с reason `meeting_handled_elsewhere` — «задачи извлекает meeting-extract-actions».
- Но `meeting-extract-actions` — **осиротевший taskType**: зарегистрирован в роутере, упоминается только в комментариях, **рантайм-вызова НЕТ ни в рабочей ветке, ни в `origin/dev`**.
- Даже для не-meeting блоков спайн хардкодит `meetingId: null` (стр. 298).

Т.е. «правильный» путь для встреч (`meeting-extract-actions`, source=`meeting`, привязка) — не существует в рантайме; задачи встреч фактически рождает только комбо по ingest отчёта, теряя привязку.

### 3.3. dev тоже не чинит
Текущая ветка `work/2026-07-02` и `origin/dev` содержат тот же дефект (комбо `channelKind`-гард + материалайзер стр. 194 + фантомный meeting-extract-actions). **«Просто выкатить dev» проблему НЕ решает — нужен код-фикс.**

---

## 4. Blast radius
- **Все встречи на текущем проде** отдают задачи без привязки к карточке → вкладка «Задачи» встречи всегда пуста, задачи «растекаются» по общему интейку/списку.
- Часть застревает `pending` (`source=meeting_report` не получает always-promote, который есть только у `source=meeting`).
- Назначенцы на партнёрских/клиентских встречах (где реальный владелец действия — гость) авто-назначаются на случайно-подходящего сотрудника (skill-routing), без следа в логах → «почему на меня?» без ответа.
- Подрывает ключевой сценарий «Кора ставит задачи по встречам».

---

## 5. Направления фикса (для ТЗ, не решение)

### 5.1. Проставлять `meetingId` для задач, производных от встречи
Резолвить реальный id встречи из `report_<meetingId>` (или из payload блока, `tryGetPayloadMeetingId`) и класть в `IntakeIssue.meetingId` + в `Issue.linkedMeetingIds` при промоуте. Точки: `task-draft-materializer.service.ts:194`, `specialists-combined.service.ts:166/413/256`.

### 5.2. Единый владелец извлечения задач встречи
Либо реально включить `meeting-extract-actions` (source=`meeting`+привязка), либо признать комбо владельцем и корректно прокинуть `channelKind='meeting'`/`meetingId` для meeting_report-ingest. Убрать фантомный taskType, чтобы спайн-skip не делегировал «в никуда».

### 5.3. Авто-триаж/промоут задач встречи
После §5.1 проверить, что meeting-производные задачи проходят always-promote (как `source=meeting`) и не застревают `pending`.

### 5.4. Логирование (требование владельца — «добавить логи на будущее»)
Добавить структурные логи в путь назначения и привязки задачи:
- **assignee-resolution**: какой хинт пришёл от LLM, результат `AssigneeResolver` (resolved/not_found), сработал ли skill-routing, top-кандидаты + confidence, финальный назначенец и **причина** (name-hint | skill-routing | none).
- **meeting-linkage**: `channelKind`/`channel`/`sourceId`/резолвнутый `meetingId` в материалайзере и комбо (почему привязка есть/нет).
Цель — чтобы «почему задача ушла X и не привязалась к встрече» читалось из `diag logs`, а не реконструировалось из кода.

---

## 6. Открытые вопросы (перед/в ходе ТЗ)
1. **`tracker.taskExtractionMode` на проде** (spine|legacy) — уточнить фактическое значение (в логах не встретилось); влияет на то, какой путь активен.
2. **Точный git-sha прода** — желателен для полноты (version-эндпоинта нет; сверка кода по SSH уже подтвердила наличие унифицированного извлечения).
3. **Развилка реализации (§5.2):** оживлять `meeting-extract-actions` как отдельный экстрактор ИЛИ доверить комбо + починить `channelKind`/`meetingId`. Рекомендация для ТЗ — второй путь (комбо уже работает, меньше новой поверхности), + fail-safe резолв `meetingId` в материалайзере.

---

## 7. Артефакты
- Трейсы: `mtg_01KWVRAXGM…` (основной), `mtg_report_01KWVRAXGM…` (отчёт/задачи).
- Логи: `TaskDraftMaterializerService` @14:09:37 `channel=meeting_report, created=2`; combo START `channelKind=chat`.
- Код-точки: `task-draft-materializer.service.ts:194`; `specialists-combined.service.ts:166/413/256`; `specialist-3-15-tasks.service.ts:104-116,298`; фантом `meeting-extract-actions` (`llm-router.service.ts:440/870`, только регистрация).
- Замысел: коммит `72249ebe` (ТЗ `2026-06-23-unified-task-extraction`), удаление легаси spine-chain — коммит-след `4046685b`.
