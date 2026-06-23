# ТЗ: Клон должности знает регламенты своей должности (Способ C)

- **Дата:** 2026-06-22
- **Ветка-основа:** feature/2026-06-22-clone-signaltype-methodology-step
- **Статус:** готово к реализации, код не начат
- **Тип:** связка двух подсистем (карточки знаний → клон должности) + retrieval-навык клона

## Резюме

Сейчас клон должности (`ExecutablePersona` scope=role) при ответе «как бы ты сделал» опирается ТОЛЬКО на неявный опыт носителей роли (черты `SkillTrait`, принципы `RolePrinciple`, рецепты `PracticeSkill`). Записанные регламенты/инструкции/политики/процессы должности — карточки `Regulation`/`Instruction`/`Policy`/`Process` из раздела «База знаний» — в ответ клона **не попадают** (build-сервис их не читает). Это две разъединённые подсистемы.

Способ C сшивает их: при ответе клон **подтягивает по смыслу** (retrieval — поиск по векторному сходству) применимые к его должности правила и кладёт их в контекст как отдельный приоритетный блок; плюс держит лёгкий **указатель** этих правил в снапшоте, чтобы «знать, что у него есть что сверять» (фундамент под будущего проверяльщика). Приоритет: `Policy` со `severity=blocking/mandatory` перебивает личный опыт.

## Проблема (доказательно)

| Факт | Где в коде |
|---|---|
| Клон собирается из traits/principles/practice-skills, регламенты не читаются | [executable-persona-build.service.ts](../../backend/src/modules/knowledge-core/services/executable-persona-build.service.ts) `buildForRole` (~290–516) |
| Промпт ответа клона не содержит регламентов | [clone-respond.prompt.ts](../../backend/src/modules/knowledge-core/prompts/clone-respond.prompt.ts) `CLONE_RESPOND_USER_TEMPLATE` (~144–150) |
| Карточки знаний — отдельные модели со `scope`, `embedding`, но без связи с клоном | schema.prisma: `Regulation`:5985, `Instruction`:6048, `Policy`:6101, `Process`:5690 |
| `severity` (advisory/mandatory/blocking) есть только у `Policy` | schema.prisma:6101+ |
| `scope='role:<id>'` хранится строкой, матчится подстрокой (`contains`), точного фильтра нет | [regulations.service.ts](../../backend/src/modules/regulations/services/regulations.service.ts) `regulationsWhere` (~1035–1050) |
| Готовый семантический поиск есть, но не по этим моделям | [search.service.ts](../../backend/src/modules/knowledge-core/api/search.service.ts) (оператор `<=>`, `embedQuery`) |

## Цель / Нецели

**Цель:** клон роли при ответе опирается на записанные правила своей должности, с правильной субординацией «правило важнее привычки».

**Нецели (вне охвата этого ТЗ):**
- Проактивный проверяльщик / подсказка-ДО — отдельный этап, аналитика-задел: [2026-06-22-regulation-checker-proactive-and-postfact.md](../analysis/2026-06-22-regulation-checker-proactive-and-postfact.md).
- Клон человека (person-scope) — регламенты привязаны к должности, не к человеку.
- Нормализация `scope` в настоящий внешний ключ на `Role` (миграция модели) — отдельный задел, см. развилку Р2.

## Развилки владельца (решения приняты с обоснованием — поправь, если иначе)

**Р1. Объём Фазы 1: retrieval на лету vs сразу указатель в снапшоте.**
- Принято: **Фаза 1 — retrieval на лету** (клон-советчик работает сразу, без миграции БД), **Фаза 2 — указатель в снапшоте** (фундамент под проверяльщика).
- Почему: советчику «как бы ты сделал» достаточно подтягивать правила в момент ответа — это даёт ценность немедленно и без изменения схемы. Указатель в снапшоте критичен в основном для проверяльщика (чтобы клон заранее знал список своих правил), поэтому он логично идёт второй фазой, ближе к тому этапу.

**Р2. Точность привязки правила к должности.**
- Принято: **точный строковый фильтр** `scope = 'role:<roleId>'` (exact, не `contains`) + helper `parseRoleScope` + индекс на `Instruction(tenantId, scope)` (у остальных трёх индекс уже есть). Полную нормализацию `scope`→FK на `Role` НЕ делаем сейчас.
- Почему: миграция модели рискованнее и не нужна для ценности; точный фильтр по строке закрывает 100% задачи retrieval. Нормализацию вынести в реестр не-сделанного.

**Р3. Приоритизация при конфликте «правило vs опыт».**
- Принято ранжирование контекста: `Policy(blocking)` → `Policy(mandatory)` → `Regulation`/`Process`/`Instruction` (обязательный контекст) → `Policy(advisory)` → личный опыт (persona/traits). Для моделей без `severity` ранг — «обязательный контекст» (ниже blocking, выше личного опыта).
- Почему: `severity` есть только у `Policy`; для остального разумный дефолт — «записанное правило весомее привычки, но не перебивает явный блокирующий запрет».

## Архитектура (точки внедрения)

Новый сервис `RoleRegulationRetrievalService` (модуль `regulations` или `clones`):
- вход: `tenantId`, `roleId`, `query` (вопрос к клону), `topN`, `minSimilarity`;
- кодирует `query` через `embeddings.embedQuery` (как в search.service.ts);
- `$queryRaw` по каждой из 4 таблиц: `WHERE tenantId=? AND status='active' AND scope IN ('role:<id>','org'[,'department:<id>']) ORDER BY embedding <=> $vec LIMIT topN`, отбрасывая дистанцию выше порога;
- объединяет, ранжирует по (ранг severity, cosine), отдаёт топ-N с полями `{kind, id, name, statement|contentMd-выжимка, severity?, scope}`.

Вызов — в `callCloneRespond` ([clones.service.ts:2472](../../backend/src/modules/clones/services/clones.service.ts#L2472)) перед сборкой `userMessage`; результат прокидывается в новый аргумент шаблона `applicableRegulations` и рендерится отдельным блоком `<applicable_regulations>` после `practiceSkills` в `CLONE_RESPOND_USER_TEMPLATE`.

## Фазы

### Фаза 1 — retrieval применимых правил при ответе клона `[ ]`
1. `RoleRegulationRetrievalService` (embedQuery + `$queryRaw` <=> по 4 таблицам, фильтр `scope = 'role:<id>' OR scope='org'`, порог + topN из AdminSetting).
2. Helper `parseRoleScope(scope): string | null`.
3. Ранжирование по (ранг severity, cosine) согласно Р3.
4. Раздел `<applicable_regulations>` в `CLONE_RESPOND_USER_TEMPLATE` (после `practiceSkills`, в ПЕРЕМЕННОЙ части user-сообщения — не трогая стабильный system).
5. Вызов retrieval в `callCloneRespond`; прокидка в шаблон. Покрыть `askRole` и `askRoleV2`.
6. Если правил нет — блок не рендерится (клон отвечает как прежде).

### Фаза 2 — указатель правил в снапшоте клона `[ ]`
1. Новое поле `ExecutablePersona.applicableRegulationsSnapshot Json?` (`[{kind,id,name,severity?,scope}]`) — миграция Prisma.
2. Заполнение в `buildForRole` после компиляции persona: запрос правил по `scope='role:<id>'` (без embedding — просто список активных), топ по `lastConfirmedAt`/`updatedAt`.
3. Индекс `@@index([tenantId, scope])` на `Instruction`.
4. Указатель используется как дешёвый «клон знает, что у него N правил» — в промпт кладётся компактным списком заголовков (не полный текст).

### Фаза 3 — иерархия видимости + крутилки `[ ]`
1. Иерархия `scope`: `role:<id>` + `org` + (если у `Role` есть `departmentId`) `department:<id>`. Проверить наличие связи Role↔Department; при отсутствии — только role+org, департамент в задел.
2. Все пороги/количества — в `AdminSetting` (см. ниже), не в ENV и не в коде.

## Совместимость с prompt caching (обязательно)

- Системный промпт клона (`buildCloneRespondSystemPrompt`) **не меняем** — кэш стабильного префикса сохраняется.
- Блок `<applicable_regulations>` кладётся в КОНЕЦ переменной user-части (после `practiceSkills`), вместе с прочими переменными данными запроса — это не ломает кэш system-префикса.
- Тексты правил берём из `statement` (короткая суть) при наличии, иначе выжимку `contentMd` — чтобы не раздувать контекст.

## Крутилки → AdminSetting (не ENV, не код)

Через `getDynamic` (admin→ENV→code-fallback) + строка в [admin-setting-schema-registry.ts](../../backend/src/modules/admin/settings/admin-setting-schema-registry.ts) + сид + UI-поле:
- `clone.regulations.retrieval.top_n` (дефолт 6)
- `clone.regulations.retrieval.min_similarity` (дефолт 0.30 cosine-distance)
- `clone.regulations.snapshot.max_items` (дефолт 20)
- `clone.regulations.scope.include_org` (дефолт true)

## Верификация

- `bun run typecheck` · `bun run lint` · `bun run build` — обязательно зелёные.
- Unit: `parseRoleScope`, ранжирование по severity, пустой результат → блок не рендерится.
- Интеграционный: на тестовой роли с 1 `Policy(blocking)` + 1 `Regulation` — ответ клона содержит оба, blocking выше; вопрос вне темы правил — правила не подмешиваются (порог отсекает).
- Ручная приёмка в кабинете (qa-tester, прод korateam.ru): задать клону роли вопрос, по которому есть регламент — убедиться, что клон ссылается на него.

## Прод-операции (для реализации)

- Фаза 2 добавляет колонку → файл миграции Prisma + `prod-deploy-log.md` Шаг 4; индекс `Instruction(tenantId,scope)` — там же.
- Новые AdminSetting-ключи → сид + `prod-deploy-log.md` Шаг 1/7.
- Фаза 1/3 без изменения схемы — отдельных прод-действий нет, кроме `docker compose up -d --build backend`.

## Итог

Реализовано: ничего (ТЗ). Порядок фаз: 1 → 2 → 3, каждая самостоятельно ценна. Фаза 1 включает клона-советчика на регламентах без миграции БД; Фаза 2 кладёт фундамент-указатель под проверяльщика; Фаза 3 расширяет видимость и выносит крутилки.
