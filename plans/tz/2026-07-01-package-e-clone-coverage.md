# ТЗ — Пакет E: покрытие клонов сотрудников (F-7)

- **Архитектура:** [plans/architecture/2026-07-01-package-e-clone-coverage.md](../architecture/2026-07-01-package-e-clone-coverage.md) (status: approved)
- **Покрывает:** F-7 (3/7 клонов)
- **Зависит от:** Пакет A (целостность entityId влияет на сбор блоков). Порядок: A → E.

## Контракт
Профиль знаний — не критический ресурс: авто-материализуется при мягком пороге уверенности, не висит в очереди курации как критический тип.

## Фазы

### [x] Ф1. Ослабить триаж для профилей
- `specialist-3-2-knowledge-clone.service.ts:206`: при `triageDecision ∈ {provisional, pending}` всё равно писать `Person.knowledgeProfile`, если `effectiveConfidence` > мягкого порога-**крутилки** (`getDynamic('knowledge_clone.profile_min_confidence', …)`).
- `curation.service.ts:147` + `typed-config.service.ts:1048`: исключить `knowledge_profile` из `criticalTypes` (или override для `resourceType='knowledge_profile'`).

### [x] Ф2. (опц.) Качество отбора
- `specialist-3-2:418-430 loadBlocksForPerson`: предпочитать блоки `confidence≥0.6 && evidenceCount>0` (высокосигнальные).
- `specialist-3-2:697-713 computeProfileConfidence`: буст уверенности при `observationCount≥3` в категории.

### [x] Ф3. Пересборка
_Прод/ручной пост-деплой-шаг (локально нельзя — реальный LLM knowledge-clone-extract недоступен, dev-ключи фейковые): после выката прогнать сид + триггернуть `knowledge-clone-rebuild.cron` на «Стреле», затем счётчик `Person.knowledgeProfile IS NOT NULL` (цель ≥ прежних 3/7 → 7/7 для Анны/Дарьи)._
- После фикса A+E — прогон `knowledge-clone-rebuild.cron.ts` (или ручной триггер) → пересобрать Анну/Дарью и остальных.

### [x] Ф4. Тесты
- Unit: профиль с `provisional`-триажем и `effectiveConfidence`>порога → пишется в `Person.knowledgeProfile`.
- Integration: 20-блочный сотрудник → профиль материализуется, не висит в курации.
- E2E (после A): прогон крона → покрытие клонов растёт относительно прежних 3/7.

## Критерии приёмки (DoD)
- Сотрудники с достаточными данными (≥ порог блоков) получают профиль без ручной курации.
- Профиль знаний не классифицируется как критический ресурс в курации.
- Покрытие клонов на синтетике «Стрела» → ≥ прежних 3/7 (цель 7/7 при достаточных данных).

## Prod-deploy
- Новая крутилка `knowledge_clone.profile_min_confidence` → `prod-deploy-log.md` Шаг 1 + сид.

## Итог
**Реализовано (F-7).** Один коммит. Зависит от Пакета A (сбор блоков по entityId) — выполнено.
- **Ф1:** гейт сохранения профиля ослаблен — материализуется при `triageDecision==='auto'` ИЛИ (non-deep && `profileConfidence >= knowledgeClone.profileMinConfidence`=0.55). provisional/light со средней уверенностью теперь пишут `Person.knowledgeProfile` (метрика `canonical_provisional`); `deep` остаётся под ручной курацией. `knowledge_profile` уже не в criticalTypes — правка не требовалась. Крутилка + сид + getDynamic.
- **Ф2:** `loadBlocksForPerson` — orderBy предпочитает высокосигнальные (`confidence desc, evidenceCount desc, createdAt desc`) БЕЗ hard-filter (чтобы не срезать покрытие целевых Анны/Дарьи); `computeProfileConfidence` — буст `+0.03×доля категорий с observationCount≥3`.
- **Ф3:** пересборка — пост-деплой-шаг (локально нет реального LLM), см. выше.

Верификация: typecheck 0 · lint 0 · build DI PASS · knowledge-core services + registry 902/902. Прод: крутилка `knowledgeClone.profileMinConfidence` (новый сид `seed-admin-setting-clone-coverage`, в STEPS) + пост-деплой rebuild.
