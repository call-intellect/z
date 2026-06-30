# Анализ: двойной импорт задач из встречи (legacy-миграция × актуальный pipeline) — нет сквозного дедупа

> **Статус:** анализ-разбор (основа для будущего ТЗ). Реализация НЕ начата.
> **Дата:** 2026-06-25 · **Org-симптом:** «Ооо луа» (`cmpndk2tw000101mwmixvacuj`)
> **Связанный анализ:** [`2026-06-25-tasks-vs-decisions-noise-audit.md`](2026-06-25-tasks-vs-decisions-noise-audit.md) — там разбирается *семантический* шум (задача↔решение на уровне промптов). **Здесь — другая, структурная причина размножения задач: один и тот же артефакт записывается дважды двумя слепыми друг к другу путями.**

---

## 1. Симптом

При ручной чистке кабинета задач («Ооо луа») вскрылась партия дубль-задач: каждая «настоящая» задача со встречи присутствовала дважды —

| Дубль (удалён) | externalSource | Оригинал (оставлен) | externalSource |
|---|---|---|---|
| MTG-6 «Изучить Tenchat и создать пять профилей» | `meeting_legacy` | DEVE-5 «Изучить сервис Tenchat и создать пять профилей» | `meeting` |
| MTG-7 «Создать отдельную группу в чат-боксе…» | `meeting_legacy` | MANA-5 «Создать отдельную группу по продукту…» | `meeting` |
| MTG-8 «Уточнить у Никиты новый путь интеграции…» | `meeting_legacy` | DEVE-4 «Уточнить у Никиты про новую функцию интеграции…» | `meeting` |
| MTG-9 «Узнать про восстановление базы из Битрикс24» | `meeting_legacy` | MANA-4 «Узнать про оплату Битрикс и восстановление базы» | `meeting` |

Все дубли — из виртуального проекта **MTG «Из встроек»** (`identifier=MTG`, `externalSource=meeting_legacy`). Все оригиналы — из актуального пайплайна (`externalSource=meeting`). 4 пары удалены вручную (soft-delete); это лечение симптома, не причины.

---

## 2. Корневая причина: два независимых писателя одного артефакта

Один и тот же артефакт «action item со встречи» материализуется в `Issue` **двумя разными путями, которые не знают друг о друге**:

### Путь A — актуальный pipeline (источник `meeting`)
`meeting → ingest → IntakeIssue → intake-auto-triage.worker → issues.service.create`
- Issue создаётся через сервис, `externalSource = intake.externalSource ?? intake.source` (`meeting`) — [intake-auto-triage.worker.ts:514](../../backend/src/modules/tracker/workers/intake-auto-triage.worker.ts#L514).
- **Дедуп есть:** `TaskDedupService.evaluate` зовётся на уровне A (intake create) — [intake.service.ts:230](../../backend/src/modules/tracker/services/intake.service.ts#L230) — и на уровне B (прямой create, если не `skipDedup`) — [issues.service.ts:161](../../backend/src/modules/tracker/services/issues.service.ts#L161).

### Путь B — миграция legacy-модели (источник `meeting_legacy`)
`старая модель Task → migrate-task-to-issue.ts → prisma.issue.create (напрямую)`
- Issue создаётся **транзакцией напрямую через Prisma**, минуя `issues.service.create` — [migrate-task-to-issue.ts:268-289](../../backend/scripts/migrate-task-to-issue.ts#L268-L289), `externalSource='meeting_legacy'`, `externalId=task.id`, `meetingId`, `sourceBlockIds=task.evidenceBlockIds`.
- **Дедупа нет.** Единственная идемпотентность — проверка «не мигрировал ли я уже ЭТОТ Task» по `(externalSource='meeting_legacy', externalId=task.id)` — [migrate-task-to-issue.ts:238-248](../../backend/scripts/migrate-task-to-issue.ts#L238-L248). Это защищает от повторного прогона миграции, **но не от дубля с задачей, которую уже создал путь A**.

> **Суть:** старый `Task` и новый `Issue` — это две записи об одном и том же поручении с одной встречи. Актуальный пайплайн извлёк его как `Issue(meeting)`, миграция отдельно подняла старый `Task` как `Issue(meeting_legacy)`. Дедуп-гейт стоит на пути A, миграция (путь B) пишет в БД мимо него.

---

## 3. Почему существующий дедуп не спасает — три независимые причины

1. **Миграция не вызывает дедуп вообще.** Она пишет `prisma.issue.create` в транзакции напрямую, а гейт `TaskDedupService` подключён только к `issues.service.create` / `intake.service`. Путь B физически не проходит через гейт.

2. **Даже если бы вызывала — KNN-кандидаты только открытые.** `TaskDedupService` ищет похожие среди `completedAt IS NULL` (`openOnly`) — [similar-issues.service.ts:129-130](../../backend/src/modules/tracker/services/similar-issues.service.ts#L129-L130), [task-dedup.service.ts:114-122](../../backend/src/modules/tracker/services/task-dedup.service.ts#L114-L122). Часть оригиналов (`MANA-4/5`, `DEVE-5`) уже в статусе `completed` → они вне набора кандидатов, дубль не был бы пойман.

3. **Порядок во времени.** По cuid-меткам партия `meeting_legacy` (`cmq6ewe…`) создана **позже** партии `meeting` (`cmq6ab…/cmq6a8…`) — миграция отработала после актуального пайплайна. Дедуп-гейт сравнивает кандидата с тем, что уже есть, **в момент create пути A** — он не может «посмотреть вперёд» на запись, которую миграция сделает позже. А сама миграция «назад» не смотрит.

Порог гейта (0.88 cosine + LLM-арбитр, [task-dedup.service.ts:71](../../backend/src/modules/tracker/services/task-dedup.service.ts#L71)) к делу не относится — гейт в этом канале просто не участвует.

---

## 4. Где и как это запускается на проде

Миграция зарегистрирована в едином агрегаторе прод-операций — [apply-prod-deploy.ts:770-775](../../backend/scripts/apply-prod-deploy.ts#L770-L775): `phase='migrate'`, `args=['--apply']`, `skipBootstrap=true`. То есть она прогоняется на **каждом** `apply-prod-deploy.ts` в режиме `update`/`all` для **всех** org с `Task` count > 0 — [migrate-task-to-issue.ts:340-345](../../backend/scripts/migrate-task-to-issue.ts#L340). Повторный прогон не плодит новые дубли (идемпотентна сама к себе), но **уже созданные** дубли остаются и копятся по мере того, как пайплайн A продолжает извлекать те же встречи.

---

## 5. Масштаб

- **Подтверждено:** 4 пары на «Ооо луа» (удалены вручную). Остаток legacy в этой org без явного meeting-двойника: MTG-10/11/12 (фон видео / Битрикс-интеграция / тех. встреча) — не трогали.
- **Не измерено:** сколько `Issue(meeting_legacy)` имеют meeting-двойника по **всем** org (миграция глобальна). Нужен прод-аудит: для каждого `Issue(meeting_legacy)` искать `Issue(meeting)` с тем же `meetingId` и пересечением `sourceBlockIds` либо высокой похожестью `title`.

---

## 6. Развилки для будущего ТЗ (что решать владельцу)

| # | Направление | Суть | Плюсы | Минусы / риск |
|---|---|---|---|---|
| Р1 | **Профилактика в миграции** | Перед `issue.create` по Task искать существующий `Issue` того же `meetingId` с пересечением `sourceBlockIds` (или title-similarity) → **skip + слинковать провенанс**, а не создавать дубль | Закрывает канал для ещё-не-мигрированных org; дёшево (точечная сверка) | Title-порог требует калибровки; sourceBlockIds-пересечение надёжнее |
| Р2 | **Backfill-дедуп уже созданного** | One-off скрипт: найти пары `legacy ↔ meeting` на проде, схлопнуть (удалить/слить legacy-дубль, перенести провенанс/связи на канон) | Лечит накопленное (миграция уже отработала на «Ооо луа» и др.) | Прод-данные → только с подтверждения владельца; нужна безопасная стратегия слияния (assignee/связи/активность) |
| Р3 | **Судьба самой миграции** | Нужна ли `Task→Issue(meeting_legacy)` вообще, если актуальный пайплайн уже покрывает встречи? Ограничить org-ами без пайплайна A / отключить | Убирает источник дубля в корне | Связано с vNext «дроп legacy `Task`» (реестр не-сделано, строка 2026-06-23) — не делать врозь |
| Р4 | **Расширить набор кандидатов дедупа** | Снять `openOnly` при сверке миграции (закрытая задача — тоже дубль) | Ловит `completed`-оригиналы | Для горячего пути A `openOnly` оправдан (производительность) — расширять только в канале миграции |

**Связи с существующими vNext (не дублировать, переиспользовать):**
- «Двунаправленный дедуп одного артефакта при любом порядке» — реестр не-сделано, строка 2026-06-23 (ТЗ `unified-task-extraction` §12 vNext (д)). Этот legacy-канал — частный случай той же асимметрии.
- «Дроп legacy-модели `Task`» — реестр не-сделано, строка 2026-06-23 (ТЗ `unified-task-extraction` §12 vNext (а)). Р3 пересекается.

---

## 7. Рекомендация

1. **Сейчас (без ТЗ):** зафиксировать пробел в реестре не-сделано (сделано этой сессией) + точечная ручная чистка на «Ооо луа» (4 пары — сделано).
2. **ТЗ писать после решения владельца по Р1–Р4.** Минимальный безопасный набор для первого ТЗ: **Р1 (профилактика) + Р2 (backfill-дедуп)**; Р3/Р4 — в связке с уже заведёнными vNext про legacy `Task`, чтобы не делать миграционную работу дважды.
3. Прод-аудит масштаба (п.5) — вход в ТЗ: без числа «сколько пар по всем org» нельзя оценить объём Р2.

---

## 8. Карта кода (якоря)

| Что | Файл:строка |
|---|---|
| Миграция Task→Issue, `meeting_legacy`, create напрямую | [migrate-task-to-issue.ts:268-289](../../backend/scripts/migrate-task-to-issue.ts#L268-L289) |
| Идемпотентность миграции (только сама к себе) | [migrate-task-to-issue.ts:238-248](../../backend/scripts/migrate-task-to-issue.ts#L238-L248) |
| Актуальный pipeline: create Issue(`meeting`) | [intake-auto-triage.worker.ts:496-524](../../backend/src/modules/tracker/workers/intake-auto-triage.worker.ts#L496-L524) |
| Дедуп-гейт (уровень A — intake) | [intake.service.ts:230](../../backend/src/modules/tracker/services/intake.service.ts#L230) |
| Дедуп-гейт (уровень B — прямой create) | [issues.service.ts:161](../../backend/src/modules/tracker/services/issues.service.ts#L161) |
| `TaskDedupService` — KNN openOnly + порог 0.88 + LLM-арбитр | [task-dedup.service.ts](../../backend/src/modules/tracker/services/task-dedup.service.ts) |
| KNN только открытые (`completedAt IS NULL`) | [similar-issues.service.ts:129-130](../../backend/src/modules/tracker/services/similar-issues.service.ts#L129-L130) |
| Регистрация миграции в прод-агрегаторе | [apply-prod-deploy.ts:770-775](../../backend/scripts/apply-prod-deploy.ts#L770-L775) |
