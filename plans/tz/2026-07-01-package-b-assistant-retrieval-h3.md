# ТЗ — Пакет B: ассистент отвечает на факт/экспертизу (H3)

- **Архитектура:** [plans/architecture/2026-07-01-package-b-assistant-retrieval-h3.md](../architecture/2026-07-01-package-b-assistant-retrieval-h3.md) (status: approved)
- **Покрывает:** H3 (Мастер → «ничего не нашлось» на факт/экспертизу)
- **Зависит от:** Пакет A (резолв людей/сущностей). Порядок: A → B.

## Контракт
Структурная агрегация запускается при любом `queryClass`, если разрешены `personIds`/`entityIds`; при пустом результате — честный фолбэк «по [кому] ничего не нашлось», не generic.

## Фазы

### [ ] Ф1. Data-driven структурный маршрут
- `chat-v2.service.ts:~1292 runStructuralRoute`: заменить `if (queryClass !== 'list') return []` на приём `['list','fact','topic']` при непустых `personIds`/`entityIds`; при наличии id — звать `runStructuralAggregate` независимо от `confidence`.
- Метрика `structural_fallback_used{queryClass}`.

### [ ] Ф2. Честный фолбэк
- `chat-v2.service.ts:909-942`: если пул пуст И структурный маршрут пробовался с разрешёнными людьми/сущностями — вернуть «По [Михаил / компании X] в памяти ничего не нашлось» (перечислить, по кому искали).
- Хелпер `describePersonAndEntityFilters(personIds, entityIds, entityNames?)` — гуманизирует id в имена.

### [ ] Ф3. Контракт агрегации (не ломать)
- `chat-v2-retrieval.service.ts:353-427 runStructuralAggregate`: опц. `entityNames?: Map<string,string>` только для логов; тело не менять.

### [ ] Ф4. Тесты
- Unit: `runStructuralRoute(queryClass='fact', personIds=[x])`, непустой пул → зовёт агрегацию; пустой + разрешён person → honest-сообщение с именем.
- Integration: «что решили по пилоту» (сущность «пилот» в БД) → цитаты, не «ничего»; «что знает Михаил» (participant Михаил) → блоки по участнику.
- Edge: `fact`+высокая уверенность+personIds → агрегация всё равно зовётся; при пустой агрегации, но непустом semantic — семантика выигрывает (корректная фузия в `runRetrieval`).
- Regression: honest-fallback вместо «Недостаточно данных».

## Критерии приёмки (DoD)
- Вопросы про факты/экспертизу с разрешёнными людьми/сущностями возвращают данные, если они есть.
- При реальной пустоте — сообщение называет, по кому искали, а не generic.
- `queryClass`-кэш не сломан (классификатор не трогали).

## Итог
_Заполнить после реализации._
