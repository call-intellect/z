# ТЗ — Пакет C: чистота трекера (сроки · исполнитель · дедуп)

- **Архитектура:** [plans/architecture/2026-07-01-package-c-tracker-cleanliness.md](../architecture/2026-07-01-package-c-tracker-cleanliness.md) (status: approved)
- **Покрывает:** F-2 (сроки в прошлом), F-3 (исполнитель), F-4 (дубли)

## Фаза F-2 — якорь срока к дате источника

### [x] Ф1
- `specialist-3-15-tasks.service.ts:353-365`: при `probe.suggest()` для `task.due_date_missing` взять самую раннюю `block.evidence[].sourceTimestamp` (`:88`, по возрастанию) и положить `sourceOccurredAtIso` в payload пробы.
- `probe-response.handler.ts:765`: достать `sourceOccurredAtIso` из payload, распарсить в `Date`, передать вторым аргументом в `parseRussianDueDate(answer, anchor)`; fallback на `new Date()` если якоря нет.
- Тест: `parse-russian-due-date.spec.ts` — `'во вторник'` с якорем = прошлый понедельник → следующий вторник ОТ якоря (не от сегодня).

## Фаза F-3 — исполнитель из «X берёт на себя»

### [x] Ф2
- `task-extract.prompt.ts`: добавить `SELF_ASSIGNMENT_RULE` в `TASK_EXTRACT_SYSTEM_PROMPT` (после `TASK_VS_DECISION_RULE`, ~`:36`): «если говорящий берёт задачу на себя (‘беру’, ‘сделаю’, ‘на мне’) — `assigneeHint` = имя автора реплики». Промпт уже получает `«quote» — автор: NAME` (`:397-409`).
- Тест извлечения: «Я беру аудит на себя» (автор Михаил) → `assigneeHint='Михаил'`; далее существующий `AssigneeResolverService` резолвит в person.

## Фаза F-4 — дедуп (два уровня)

### [x] Ф3. Уровень блоков
- Порог склейки 0.92→0.85 через **крутилку** `getDynamic('distill.merge_threshold', 'DISTILL_MERGE_THRESHOLD', 0.85)` + строка в `admin-setting-schema-registry.ts` + сид + UI-поле (правило №9; не хардкод env-only). Спорные 0.85–0.91 решает арбитр-LLM.

### [ ] Ф4. Уровень материализации задачи
- Новый `intake-issue-similar.service.ts`: KNN по `IntakeIssue.embedding` (зеркало `SimilarIssuesService.findSimilarByVector`), фильтр `status='pending'`, порог-крутилка.
- `specialist-3-15-tasks.service.ts:163-179`: перед созданием `IntakeIssue` — KNN-проверка; при совпадении **линковать к существующей**, а не создавать. Инжектнуть сервис (`:55-74`).
- Убедиться, что `IntakeIssue.embedding` считается воркером эмбеддингов (иначе KNN пуст) — при отсутствии добавить в пайплайн эмбеддингов.

### [ ] Ф5. Тесты
- F-2: якорь в прошлом → срок не в прошлом.
- F-3: само-обязательство → `assigneeHint` заполнен.
- F-4: два near-dup блока (sim 0.88) → один; повторная материализация похожей задачи → линк, не дубль.

## Критерии приёмки (DoD)
- Сроки задач не уезжают в прошлые годы (якорь = дата источника).
- Задачи из «беру на себя» имеют исполнителя (или уходят в existing-проба-резолв, не в пустоту).
- Видимых дублей задач нет на sim≥0.85; порог — крутилка.

## Prod-deploy
- Новая крутилка `distill.merge_threshold` → `docs/operations/prod-deploy-log.md` Шаг 1 (реестр admin-settings/env) + сид.

## Итог
_Заполнить после реализации._
