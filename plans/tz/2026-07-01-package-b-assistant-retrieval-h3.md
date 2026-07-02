# ТЗ — Пакет B: ассистент отвечает на факт/экспертизу (H3)

- **Архитектура:** [plans/architecture/2026-07-01-package-b-assistant-retrieval-h3.md](../architecture/2026-07-01-package-b-assistant-retrieval-h3.md) (status: approved)
- **Покрывает:** H3 (Мастер → «ничего не нашлось» на факт/экспертизу)
- **Зависит от:** Пакет A (резолв людей/сущностей). Порядок: A → B.

## Контракт
Структурная агрегация запускается при любом `queryClass`, если разрешены `personIds`/`entityIds`; при пустом результате — честный фолбэк «по [кому] ничего не нашлось», не generic.

## Фазы

### [x] Ф1. Data-driven структурный маршрут
- `chat-v2.service.ts:~1292 runStructuralRoute`: заменить `if (queryClass !== 'list') return []` на приём `['list','fact','topic']` при непустых `personIds`/`entityIds`; при наличии id — звать `runStructuralAggregate` независимо от `confidence`.
- Метрика `structural_fallback_used{queryClass}`.

### [x] Ф2. Честный фолбэк
- `chat-v2.service.ts:909-942`: если пул пуст И структурный маршрут пробовался с разрешёнными людьми/сущностями — вернуть «По [Михаил / компании X] в памяти ничего не нашлось» (перечислить, по кому искали).
- Хелпер `describePersonAndEntityFilters(personIds, entityIds, entityNames?)` — гуманизирует id в имена.

### [x] Ф3. Контракт агрегации (не ломать)
_Контракт сохранён — `runStructuralAggregate` не тронут (переиспользован как есть для fact/topic). Опц. `entityNames`-параметр для логов НЕ добавлен: лишний риск в прод-путь ради debug-лога._
- `chat-v2-retrieval.service.ts:353-427 runStructuralAggregate`: опц. `entityNames?: Map<string,string>` только для логов; тело не менять.

### [x] Ф4. Тесты
- Unit: `runStructuralRoute(queryClass='fact', personIds=[x])`, непустой пул → зовёт агрегацию; пустой + разрешён person → honest-сообщение с именем.
- Integration: «что решили по пилоту» (сущность «пилот» в БД) → цитаты, не «ничего»; «что знает Михаил» (participant Михаил) → блоки по участнику.
- Edge: `fact`+высокая уверенность+personIds → агрегация всё равно зовётся; при пустой агрегации, но непустом semantic — семантика выигрывает (корректная фузия в `runRetrieval`).
- Regression: honest-fallback вместо «Недостаточно данных».

## Критерии приёмки (DoD)
- Вопросы про факты/экспертизу с разрешёнными людьми/сущностями возвращают данные, если они есть.
- При реальной пустоте — сообщение называет, по кому искали, а не generic.
- `queryClass`-кэш не сломан (классификатор не трогали).

## Итог
**Реализовано (H3 закрыт).** Один коммит. Изменения:
- `query-plan-extractor.resolveStructuralFiltersWithClarify`: personIds теперь резолвятся и для `fact`/`topic` (через `resolvePersonHints`, fuzzy best-match без clarify; list-clarify не тронут) — снята скрытая зависимость (раньше personIds были только для `list`).
- `chat-v2.service`: `forceStructuralFallback` (fact/topic + есть personIds/entityIds) добавлен в `bothWays` (НЕ в `isStructuralClass` — multi-query semantic не схлопывается, recall сохранён); `runStructuralRoute` пропускает `list|fact|topic` в `runStructuralAggregate`; метрика `z_structural_fallback_used_total{queryClass}`.
- Честный фолбэк: при пустом пуле с разрешёнными людьми/сущностями — «По {Михаил / компании «X»} в памяти ничего не нашлось» (`describePersonAndEntityFilters`, best-effort имена, fallback на generic).

Верификация: typecheck 0 · lint 0 · build DI PASS · dialog+metrics 136/136 · knowledge-core services 882/882. Fusion (structural-first RRF) и все кэш-ключи не тронуты. Прод-операций нет (новый Prometheus-счётчик само-регистрируется; ни миграций/ENV/сидов) — только Шаг 12 smoke-grep `z_structural_fallback_used_total` опц.

Зависимость от Пакета A выполнена (резолв людей рабочий).
