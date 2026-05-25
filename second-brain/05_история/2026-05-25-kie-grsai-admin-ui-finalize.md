---
date: 2026-05-25
title: Завершение интеграции KIE / GRSAI в админ-UI — поиск всех захардкоженных enum-ов
session: одиночная
related:
  - plans/tz/2026-05-24-kie-grsai-llm-router-integration.md
  - plans/tz/2026-05-25-admin-llm-routes-frontend.md
  - second-brain/01_projects/llm-providers-verified.md
commit: b8547c1
distilled: false
---

# Контекст

Пользователь спросил: «один из агентов говорит, что KIE/GRSAI не подключены к роутеру (доступны только из smoke), но ведь у нас же было ТЗ что подключаем и в админку?». Нужно было разобраться по факту.

# Что выяснил при разборе

1. **Бэкенд-роутер** — KIE/GRSAI подключены полностью ещё с 2026-05-24: `LlmProviderName` enum, `ALL_PROVIDERS`, `PROVIDER_CAPABILITY` (`maxDataClass='internal'`), инжекция `KieService`/`GrsaiService`, dispatch cases в `llm-router.service.ts`.
2. **Seed `LlmProvider`/`LlmModel`** — заведён в `seed-default-llm-providers-and-models.ts` (7 моделей).
3. **A/B seed для `dialog-multi-query`** — `seed-llm-task-routes-kie-grsai-ab.ts` создаёт `LlmModelExperiment` в draft.
4. **Admin-страница `/admin/llm-routes`** — **уже была написана**: page.tsx + LlmRoutesClient.tsx + EditRouteDialog.tsx с фильтрами, badges, `pinnedVersionNote` (фаза 6.5), warning для DeepSeek-Pro. Domain-слой и API-клиент тоже готовы.

Почему агент сказал «не подключены»: он опирался на устаревший `verified.md` (раздел B + правило №8) от 2026-05-24, который не был обновлён после фактического подключения. И на ТЗ-ревизию того же дня, где было написано «осталось дополнить seed-скрипты», но за следующий день seed уже допилили.

**Ошибочный первый вывод с моей стороны:** я тоже сначала поверил `verified.md` и сказал пользователю «бэкенд готов, фронт ещё не сделан, нужно ≈5.5 часов работы агента». Это было неверно — я искал страницу только в `(admin)` route-группе, а реально она в `(authenticated)`. Перепроверка показала, что страница есть и почти полностью готова. Реальная дельта — крохотные правки в захардкоженных списках провайдеров.

# Что было реально сделано

6 точечных правок (~10 минут вместо «5.5 часов»):

| Файл | Правка |
|---|---|
| `backend/src/modules/admin/llm-routes/dto/llm-routes.dto.ts` | `PROVIDER_NAMES` + `'kie'`, `'grsai'` |
| `backend/src/modules/admin/ai-models/dto/ai-models.dto.ts` | `PROVIDER_NAMES` + `'kie'`, `'grsai'` (для switch-primary / add-provider / create-experiment) |
| `backend/src/modules/admin/services/admin-functions.service.ts` | Фильтр `validProviders` расширен — без него **молча отбрасывал бы** kie/grsai даже после прохождения Zod-DTO |
| `frontend/src/api/admin-llm-routes.api.ts` | `LLM_PROVIDERS` + `'kie'`, `'grsai'` |
| `frontend/src/api/admin-ai-models.api.ts` | `AI_MODELS_PROVIDERS` + `'kie'`, `'grsai'` |
| `frontend/src/domain/admin-llm-route.ts` | `KNOWN_MODELS`: добавлены kie (5) и grsai (2); anthropic → `[]` + лейбл «не подключён — ключ невалиден». `providerLabel` — русские названия для kie/grsai. |

Документация:
- `verified.md`: kie/grsai перенесены из раздела B в A с пометкой «✓ (admin-UI с 2026-05-25; нужен seed-default-llm-providers-and-models.ts)»; правило №8 переписано;
- ТЗ `2026-05-24-kie-grsai-llm-router-integration.md` → `status: done` с итогом;
- ТЗ `2026-05-25-admin-llm-routes-frontend.md` → `status: done`, все фазы `[x]`.

Коммит `b8547c1` (9 файлов, +259/-15), запушен в `dev`.

# Что осталось на стороне пользователя

1. Прогнать `bun scripts/seed-default-llm-providers-and-models.ts` на dev/prod — без этого `LlmProvider{name:'kie'/'grsai'}` и `LlmModel` отсутствуют в БД, и админка их не покажет в дропдаунах справочников.
2. Визуально проверить `/admin/llm-routes` — выбрать taskType, поставить kie/gemini-3-flash secondary, сохранить, убедиться что `editedByAdmin=true` и запись в `LlmTaskRoute` появилась.
3. Цены `gpt-5-4` и `gemini-3-flash` в `MODEL_PRICES` — TBD; сверить с kie.ai иначе `AiUsageLog` пишет $0 для этих SKU.

# Уроки

1. **Перед утверждением «X не подключено» — грепай ВСЕ места захардкоженных списков, не только enum в одном DTO.** Я сначала нашёл 3 файла (`llm-routes.dto.ts`, `admin-llm-routes.api.ts`, `admin-llm-route.ts`), но реально таких списков оказалось 6 — ещё `ai-models.dto.ts`, `admin-functions.service.ts` и `admin-ai-models.api.ts`. Самый коварный — фильтр в `admin-functions.service.ts`, потому что он **молча отбрасывает** провайдеров (без exception), что значит DTO прошёл бы, но запись бы не создалась. Поиск через `Grep` по pattern `'anthropic'.*'minimax'.*'openai-via-proxy'.*'deepseek'.*'ollama'` (multiline) дал все 6 мест сразу — это надо делать СНАЧАЛА.

2. **Документация в `second-brain/` фрозен на дату обновления — нельзя доверять как актуальной без проверки.** `verified.md` от 2026-05-24 говорил «kie/grsai НЕ в LlmRouter», а в коде они уже были. CLAUDE.md прямым текстом упоминает: «Перед recommend-ом из памяти — verify по коду». Это же относится к second-brain.

3. **Когда ищешь admin-страницу — проверяй ОБЕ route-группы (`(admin)` и `(authenticated)`).** В Z страницы могут быть в любой. Я сначала проверил только `(admin)` и сделал вывод «страницы нет», но реально она лежала в `(authenticated)/admin/llm-routes/`. ТЗ тоже было написано до того, как структуру админки переехали в `(authenticated)`.

4. **Расширение enum'а имеет cascade effect.** В DTO добавил `'kie'`/`'grsai'` — но без обновления `LLM_PROVIDERS`/`KNOWN_MODELS`/`providerLabel` UI всё равно их не покажет. И без расширения фильтра в сервисе — бэк всё равно отбросит. Без обновления `AI_MODELS_PROVIDERS` — другая admin-страница (`/admin/ai-models/[taskType]`) их не примет. Все 6 мест должны идти одним коммитом, иначе риск частичного состояния.

5. **«Утверждение в коде vs утверждение в docs» — приоритет за кодом.** Когда агент или ты сам опираешься на устаревший doc и говоришь пользователю «X не работает», но в коде X давно работает — это потеря доверия и времени на пересборку картины. Лучше сразу: `Grep`/`Read` по имени → подтвердить или опровергнуть.

# Метрики сессии

- Time-to-correct-diagnosis: ~5 минут после первой ошибки (когда обнаружил страницу в `(authenticated)`).
- Размер реальной дельты: 6 файлов, в среднем по 2-7 строк изменений.
- Размер ошибочной начальной оценки: «5.5 часов». Размер реальной работы: ~15 минут на правки + ~10 на документацию.
- Захардкоженные enum-списки провайдеров в репо: 6 (3 backend + 3 frontend). Это указывает на пропущенную абстракцию — стоило бы иметь один общий источник (например `ALL_PROVIDERS` из `llm-router.service.ts` экспортировать на фронт). Но это уже refactor, не в скоупе.
