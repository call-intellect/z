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

### [x] Ф4. Уровень материализации задачи
- Новый `intake-issue-similar.service.ts`: KNN по `IntakeIssue.embedding` (зеркало `SimilarIssuesService.findSimilarByVector`), фильтр `status='pending'`, порог-крутилка.
- `specialist-3-15-tasks.service.ts:163-179`: перед созданием `IntakeIssue` — KNN-проверка; при совпадении **линковать к существующей**, а не создавать. Инжектнуть сервис (`:55-74`).
- Убедиться, что `IntakeIssue.embedding` считается воркером эмбеддингов (иначе KNN пуст) — при отсутствии добавить в пайплайн эмбеддингов.

### [x] Ф5. Тесты
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
**Реализовано целиком (F-2, F-3, F-4).** Коммиты: `f56ff262` (F-2 якорь срока + F-3 SELF_ASSIGNMENT_RULE), `f625002b` (F-4 block-порог как крутилка 0.92→0.85), `9aece6d5` (F-4 mat-A: IntakeIssue.embedding + HNSW + IntakeIssueSimilarService + крутилка tracker.intakeDedupThreshold), + mat-B (интеграция KNN в specialist-3-15).

Верификация: typecheck 0 · lint 0 · build DI PASS · широкий прогон knowledge-core+tracker+probe 1791/1791. F-4 материализация решена по **варианту A** (полный семантический дедуп): у IntakeIssue не было embedding — добавлена колонка+HNSW, embedding считается инлайн при создании (один embed-вызов, переиспользуется для KNN и хранения), при KNN-совпадении (distance ≤ `tracker.intakeDedupThreshold` 0.15) дубль skip'ается (зеркалит exact-title-pending), иначе создаётся + сохраняет embedding.

Прод: миграция `intake_issue_embedding` (авто migrate deploy) + HNSW `IntakeIssue_embedding_hnsw_cosine_idx` (apply-postgres-init) + сиды крутилок — всё в `prod-deploy-log` Шаг 1/4/5/7/12.

Замечено (вне scope, на follow-up): системный рассинхрон написания FE↔backend ключей admin-крутилок knowledge (dotted-snake на FE vs camelCase в реестре) — много фантомных ключей на странице KnowledgeCoreSettings; починен только distill-порог.
