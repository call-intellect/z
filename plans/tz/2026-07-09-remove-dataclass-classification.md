# ТЗ — Убрать классификацию dataClass (`private`/`sensitive`/…) целиком

- **Дата:** 2026-07-09
- **Ветка:** `work/2026-07-09`
- **Тип:** прод-фикс (Этап 1) + рефактор-удаление (Этап 2). Источник — первый прогон стенда тестирования ([docs/testing/README.md](../../docs/testing/README.md)).
- **Парное ТЗ:** [2026-07-09-llm-deepseek-key-restore.md](2026-07-09-llm-deepseek-key-restore.md) (независимая находка того же прогона).
- **Решение владельца:** «у нас нет ничего приватного — удалить понятие `private`/`sensitive` и классификацию dataClass целиком».

---

## Симптом (прод-доказательство)
Логи за сутки: `theme-clusterer` падает на каждом кластере — `LlmRouter: no eligible provider for dataClass — block dispatch`; `entity-graph-builder` judge-подшаг → `fallback на none после 2 попыток`. Темы и рёбра графа молча не строятся на части данных (тихая деградация — не ошибка пользователю, а пустой выход).

## Корень (подтверждён кодом + прод-данными)
- Роутер фильтрует провайдеров: допускается только `rank(provider.cap) ≥ rank(effectiveDataClass)`; шкала `public(0)<internal(1)<sensitive(2)<private(3)` ([llm-router.service.ts:1002](../../backend/src/modules/ai/services/llm-router.service.ts#L1002)); при пустом фильтре — `throw NoEligibleProviderError` ([:1568-1586](../../backend/src/modules/ai/services/llm-router.service.ts#L1568)).
- `effectiveDataClass = max(caller.dataClass, route.requiredDataClass)`; воркеры над блоками шлют `maxDataClass(inputBlocks)` (напр. [entity-graph.service.ts:193](../../backend/src/modules/knowledge-core/services/entity-graph.service.ts#L193)).
- **Прод-факт (`GET /api/v1/admin/llm-providers`): cap всех рабочих провайдеров = `internal`** (deepseek/openai-via-proxy/kie/grsai/minimax). Только anthropic=`sensitive` (исключён по стандарту) и ollama=`private` (localOnly).
- Следствие: любые данные, которые `DataClassPolicyService` пометил `sensitive`/`private`, не покрывает никто → block dispatch. Гейт рубит не «приват» абстрактно, а всё выше `internal`.

## Масштаб
`grep -rn "dataClass\|DataClass" backend/src` → **≈184 файла** (без spec) + enum `DataClass` в `schema.prisma` + колонки `dataClass` на нескольких моделях (`IdeaBlock` и др.) + Json-поля `dataClassAudit` + `capability`/`maxDataClass` у `LlmProvider` + сервис `DataClassPolicyService` ([dataclass-policy.service.ts](../../backend/src/modules/knowledge-core/services/dataclass-policy.service.ts)). Полное удаление — большой охват, поэтому двумя этапами.

---

## Этап 1 (B1) — снять блокировку прода СРАЗУ (низкий риск, шиппим первым)
Гейт больше **не блокирует** dispatch; классификация ещё считается, но ничего не рубит.
- В [llm-router.service.ts:1568](../../backend/src/modules/ai/services/llm-router.service.ts#L1568): при пустом `filtered` — вместо `throw` **фолбэк на неотфильтрованный `providers`** + один WARN + метрика (наблюдаемость сохраняем). Дозвон идёт по обычной цепочке.
- Тест: `llm-router.service.spec.ts` — кейс «filtered пуст → не throw, а dispatch по всем провайдерам».
- Результат: `theme-clusterer` строит темы, `entity-graph` judge не уходит в `none` из-за класса.

_(Опциональный мгновенный хотфикс без деплоя: поднять `cap` рабочих провайдеров до `private` через `PATCH /api/v1/admin/llm-providers/:id`. Обратимо, но это data-drift — держим как аварийную кнопку, не как решение.)_

### Верификация Этапа 1
- Час спустя: `theme-clusterer` лог `createdThemes>0`, нет WARN «ошибка на кластере» по причине провайдера; `entity-graph` не пишет `fallback на none (exhausted)` из-за класса; в логах нет `no eligible provider for dataClass`.
- `diag.ts logs --at-least WARN --module LlmRouterService` — чисто по этой причине.

---

## Этап 2 (B2) — полное удаление концепта (отдельная аккуратная сессия)
Снести:
- enum `DataClass`, колонки `dataClass`/`dataClassAudit` (миграция на дроп), `capability`/`maxDataClass` у `LlmProvider`;
- `DataClassPolicyService`, функцию `maxDataClass`, `requiredDataClass`, фильтр в роутере ([:1560-1586](../../backend/src/modules/ai/services/llm-router.service.ts#L1560)), метрику `core_data_class_violations_total`;
- ≈184 call-site и все вызовы `maxDataClass(...)`.

Порядок безопасный: сначала перестать читать/писать (код), выкатить, убедиться в чистоте → потом дроп колонок/enum отдельной миграцией.

- **Риск высокий из-за охвата** — делать отдельной сессией с картографией и пофайловым ревью, НЕ в один присест с B1.
- Гейт процесса: перед B2 — картография (`vexp`/grep) + пофазный orchestrator-план.

### Верификация Этапа 2
- `grep -rn "DataClass\|dataClass" backend/src` = 0 (кроме миграции-дропа); `typecheck`/`lint`/`build` зелёные; полный прогон тестов; smoke основного отчёта встречи (самый рискованный путь).

---

## Прод-деплой (дифф)
- **Этап 1:** только код роутера (рестарт backend). Прод-операций с БД нет.
- **Этап 2:** добавит миграцию на дроп колонок/enum → [prod-deploy-log.md](../../docs/operations/prod-deploy-log.md) Шаг 4 (опасное изменение — дроп, делать после того как код перестал читать колонки).

## Фазы
- [ ] **Ф1 (Этап 1 / B1):** роутер не блокирует dispatch по dataClass + тест + верификация theme-clusterer/entity-graph на проде.
- [ ] **Ф2 (Этап 2 / B2, по подтверждению владельца):** полное удаление концепта + миграция дропа.

## Открытая развилка для владельца
**B2 сейчас или отдельным циклом?** Рекомендую: B1 сейчас (снимает прод-боль дешёвым безопасным изменением), B2 — отдельной сессией (184 файла, высокий риск в спешке; спешить с дропом колонок нельзя).
