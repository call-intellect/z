---
date: 2026-06-25
type: reflection
feature: task-decision-disambiguation
distilled: false
---

# Разведение «задача ↔ решение» в извлечении

## Что было поставлено
ТЗ `plans/tz/2026-06-25-task-decision-disambiguation.md` — реестр решений накапливал переодетые поручения (~треть записей = задачи, оформленные как Decision). Извлечение путало две сущности: **решение = ЧТО выбрали**, **задача = КТО что делает** (одно решение может породить задачи — это не дубль). Нужно было: симметричные few-shot в обоих агентах извлечения (`decision-extract` ↔ `task-extract`) + усиление классификатора `block-ingest`, вынос хардкод-порога извлечения в крутилки AdminSetting, cosine-гейт дедупа решений перед LLM-арбитром, и provenance «Откуда это» на фронте (задачи + идеи).

## Как решал
Оркестрация ТЗ суб-агентами по 7 фазам, 7 коммитов на ветке `feature/task-decision-disambiguation`:
- **`f5604742` Ф1** — единый реестр `backend/src/modules/knowledge-core/prompts/task-decision-examples.ts`: 18 контрастных пар (домен · решение ↔ задача) из разных индустрий + правило `TASK_VS_DECISION_RULE` + 3 рендера-проекции (decision-extract / task-extract / block-ingest). Чистый TS без NestJS — импортируется и в проде, и в diag-скриптах.
- **`62c37a0c` Ф2-4** — реестр подключён в 3 промпта `knowledge-core/prompts/`: `decision-extract` (правило + примеры РЕШЕНИЕ→true/ЗАДАЧА→false + пункт самопроверки), `task-extract` (зеркально ЗАДАЧА→true/РЕШЕНИЕ→false + самопроверка), `block-ingest` (усилены описания `decision` (≠задача) и `action_item` (слова-триггеры поручения) + секция «Граница задача↔решение»). Снапшоты обновлены.
- **`9a782cfb` Ф5a** — хардкод `MIN_EXTRACT_CONFIDENCE=0.4` вынесен в крутилки AdminSetting `knowledge.{decisions,ideas,insights}ExtractMinConfidence` (UNIT_INTERVAL, дефолт 0.4) в specialist-3-3/3-6/3-5; чтение через `@Optional() AdminSettingsService` с code-fallback. Новый seed `backend/scripts/seed-admin-setting-knowledge-extract.ts` + registry + apply-prod-deploy STEPS.
- **`8141f179` Ф5b** — cosine similarity-гейт дедупа решений ПЕРЕД LLM/debate-арбитром (`supersedeDetect`). Чистая `Specialist33Service.classifyDedupeGate(sim,threshold,grayBand)`: sim≥0.86 → авто-merge без LLM; sim<0.79 → новое без LLM; серая зона → прежний арбитр. KNN-запрос теперь возвращает similarity (1−cosine distance). Ключи `knowledge.decisionsDedupe{Threshold=0.86,GrayBand=0.07}`.
- **`512a9ad5` Ф6** — фронт provenance «Откуда это»: IssueSidebar (ветка «Создано вручную — источника нет»), IssueDetailClient (`ProvenancePreviewSnippet` по `issue.provenancePreview`), IdeasListClient (`ProvenanceChip` entityType=block).
- **`5556e3fb` Ф7** — `backend/scripts/diag-decision-classifier-test.ts` переписан под 3 агента + 30 фикстур (реальные + синтетика из реестра).

## Что вышло (верификация)
- typecheck / lint / build — зелёные на каждой фазе.
- prompts-тесты 182/182; dedup.spec 13/13.
- Реальный diag-прогон (deepseek, temp 0): псевдо-решения (мусор-поручения) отсечены **5/5 + синтетика-задачи 10/10**, task-extract задачи **15/15**, block-ingest задачи→action_item **15/15**. Регресс — только на двойственных пограничных кейсах (P2 «создать отдельную группу» = и решение, и действие; decision-extract настоящие 4/5, task-extract решения 13/15, block-ingest решения 14/15), в рамках границы ТЗ §14.
- Установлено: подъём порога 0.4→0.5 регресс НЕ лечит (он на уровне булева `isDecision`/`isTask`, не confidence) — поэтому seed-дефолт оставлен 0.4.

**Осознанные отсрочки:** (1) UI-поле для новых порогов в кураторскую страницу не добавлено — по прецеденту прямого аналога `tracker.taskExtractMinConfidence` (тоже не в whitelist, редактируется через generic admin-API); (2) полный набор 21 реального псевдо-решения с прода для фикстур не вытащен (нужен прод-доступ; синтетика + 5 реальных реплик доказали эффект); (3) чистка кабинета (удаление существующих 21 псевдо-решения) — отдельная операция после выката (вне кода, развилка ТЗ §12.4).

## Чему научился
- **Промпты decision/task/block-ingest НЕ в PromptResolver/registry** — прямой импорт констант, правка in-place достаточна; F10 (`_V2` shadow-run) к ним неприменимо.
- **`DECISION_DISCRIMINATOR` / `NOT_A_TASK_DISCRIMINATOR` из `ai/services/prompts/common.ts` покрывают ДРУГИЕ границы** (решение↔пожелание, задача↔вопрос) — перед добавлением различителя проверяй существующие хелперы, чтобы не дублировать; здесь закрыта непокрытая граница «задача↔решение».
- **`DecisionKnnCandidate` не возвращал similarity** — для cosine-гейта пришлось пробросить `1−distance` из KNN-SELECT.
- **Регресс разведения — на уровне булева `isDecision`/`isTask`, не confidence** — поэтому порог его не лечит (подъём 0.4→0.5 бесполезен).
- **`grep -oE '...='` обрезает значение ENV** (выводит только имя ключа) — не делай вывод «ключ пустой» по такому грепу.
