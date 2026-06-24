---
type: reflection
date: 2026-06-24
feature: remove-manual-confirmations-autonomy
branch: feature/2026-06-23-remove-manual-confirmations
distilled: false
---

# Реализация мастер-ТЗ «убрать лишние подтверждения» (оркестрация по блокам)

## Что было поставлено

Зонтичное ТЗ `plans/tz/2026-06-23-remove-manual-confirmations-master-tz.md` + 4 дочерних: довести автономию Коры до «человек = аварийный стоп». Четыре блока:
- **A** — ИИ-судья курации: дать первоисточник + промпт по методологии (вариант C) + расширить на «серую зону» некритичных карточек (~78% потока к людям).
- **D** — наблюдаемость самообучения SubjectMemory + дочистка висящих дублей.
- **B** — probe-черновики из памяти вместо пустых вопросов.
- **C** — умный подбор «кому поручить» по навыкам в авто-задачах.
Плюс явный запрос владельца: проанализировать отложенное (конфликты/доставка/задачи/intake) — что уже решено в PR #56, что осталось, как доделать. И создать отдельную ветку.

## Как решал (оркестрация суб-агентами)

Роль — оркестратор tz-orchestrator: код руками не писал, вёл фазами через суб-агентов с приёмкой каждого шага.

1. **Картография** — Workflow с 5 параллельными read-only агентами (4 блока + анализ отложенного), structured output по schema. Дала актуальные `path:line` после мержа PR #56 (номера в ТЗ устарели). Ключевые находки картографов, спасшие от ошибок:
   - Блок A: `ProvenanceService` в `@Global` `knowledge-core.module` → inject в `CurationService` без риска цикла; схема `debate_vote` — это JSON Schema (не Zod), общая для 3 семейств → отдельная `debate_vote_with_quote_v1` только для curation-verify (не ломая supersede/conflict).
   - Блок D: `ProbeStatus` НЕ имеет `suppressed_by_memory` (ТЗ ошибалось) → миграция enum; `diag.ts` ходит по HTTP, не Prisma → диаг-команда через новый REST.
   - Блок B: reason'ы `companyprofile.missing_*` отсутствуют в коде → пришлось создать эмиттер (`company-profile-completeness.cron`).
   - Блок C: PR #56 уже сделал name-matching + author-fallback; `SkillRoutingService` НЕ подключён к авто-путям — это и есть остаток.
2. **Блоки A→D→B→C** (порядок мастер-ТЗ), каждая фаза: промпт кодеру с дословными сниппетами и решёнными развилками → спавн кодера → приёмка САМ (греп маркеров + re-Read критичной логики + typecheck/lint/build/тесты модуля) → коммит явными путями.
3. **Развилки решал сам** (не сваливал владельцу): Р-СУДЬЯ=flash, Р-СЕРАЯ=0.7 (крутилка), отдельная схема quote, новый статус probe через миграцию, отдельный порог `taskRouting.autoAssignMinConfidence`=0.75.

## Что вышло (верификация)

8 коммитов, все зелёные (typecheck + lint + build + юнит-тесты модуля, приёмка оркестратором):
- `1f6b22d5` A Ф1+Ф2 (первоисточник судье + quote + промпт C + docs)
- `5e67507b` A Ф3+Ф5 (серая зона + 3 крутилки + харнесс 38 карточек)
- `debef312` D Ф1 (read-эндпоинт + диаг)
- `0513e1cc` D Ф2+Ф3+Ф4 (дочистка дублей + миграция + страница + логи)
- `73e6d0df` B-1 (draft-pipeline + урок эксперимента)
- `5fd2d028` B-2+B-3 (фронт HYBRID + миссия/видение/стратегия)
- `8c329916` C (умный подбор в встречи+intake)

**Сознательно вынесено** (рискованные/непроверенные зоны, оформлено ready-ТЗ, не наспех):
- B-4 (process-шаги через CurationItem + AUTO skill/knowledge) → `plans/tz/2026-06-24-probe-drafts-phase-b-process-and-auto.md` (write в `definitionJson` нарушил бы W2-принцип «JSON авто не пишем»; тихая запись в профили — внешне-наблюдаемо).
- C OwnerResolver-ступень → остаток в дочернем ТЗ (риск DI-цикла knowledge-core↔tracker — фреймворк-поведение, требует bootstrap-верификации, не угадывания).
- Анализ отложенного → `plans/analysis/2026-06-24-deferred-areas-status-and-how-to-finish.md`.

## Чему научился

1. **Картография первым шагом окупается кратно.** Параллельный read-only fan-out по schema нашёл 4 расхождения ТЗ с фактом (нет `suppressed_by_memory`, нет companyprofile-эмиттера, схема — JSON не Zod, diag по HTTP), каждое из которых сломало бы кодера, работай он по устаревшему ТЗ. Line-номера в ТЗ всегда устаревают после параллельных мержей.
2. **Минимальный blast-radius на общих структурах.** Схема `debate_vote` общая для 3 семейств — добавлять `quote` глобально заставило бы supersede/conflict тоже его выдавать (strict json_schema). Отдельная `*_with_quote_v1` только для curation-verify — изолировала изменение.
3. **DI-цикл — это «не угадывай, проверяй».** `@Optional @Inject` из `@Global`-модуля резолвится без цикла (ProvenanceService→CurationService, ProbeService→company-foundation cron — оба сработали). Но knowledge-core→tracker (OwnerResolver→SkillRouting) — реальный риск, который нельзя закрыть build'ом (только bootstrap). Вынес честно, а не «авось».
4. **Агенты честно адаптируют ТЗ под факт.** Кодеры сами поправили: `hypothesis`→`hypothesisText`, `Org.ownerUserId` нет → Membership role='owner', strict-DTO профиля принимает только `contentMd`, `IntakeIssue` без `title`. Фактчек грепом подтвердил — никто не соврал про `[x]`.
5. **Пред-существующий red-тест в зоне работы.** `probe-provenance-synthetic.spec.ts` ждал старый deep-link (`/meetings/m-1?t=`), а прод давно отдаёт `/result` (коммит `1f9ddb9f`). Выровнял assertion с задеплоенным поведением — иначе мой gate «тесты модуля целиком» был бы вечно красным не по моей вине.

## Выкат (Ship-On, наблюдение прода)

Все фичи — включены (kill-switch ON). Наблюдать: `curation_gray_zone_judged_total{outcome}`, `subject_memory_pending_swept_total`, `task_skill_routing_assigned_total{path}`, эндпоинт `/api/v1/subject-memory` + диаг `subject-memory`, override-rate provisional-карточек (не должен расти). Прод-операция: `docker compose up -d --build` (миграция enum + сид крутилок прорастают авто).
