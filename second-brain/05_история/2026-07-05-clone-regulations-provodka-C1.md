---
type: reflection
date: 2026-07-05
feature: clone-regulations-router-provodka
branch: work/2026-07-02
distilled: false
---

# Рефлексия — C1: проводка регламент-роутера (B) в реальный путь клона (EXPERT 55→67%, FAB 0)

## Что было поставлено

Владелец одобрил вариант B (бейк-офф доказал: flash-роутер на саммари, не полный текст, не имена). Задача цикла C1 —
провести победителя в реальный путь клона (не мини-стенд), замерить на основном стенде, проанализировать, дать
следующую гипотезу. Дисциплина: один рычаг за цикл, замер на реальном пути.

## Как решал (файлы)

- Схема: таблица `rule_summaries` (кэш саммари: kind+ruleId, sourceHash для staleness) + миграция
  `20260705174811_clone_rule_summaries` + обратная связь в `Org`.
- `role-regulation-retrieval.service.ts`: `retrieveForRole` стал router-first — `resolveOwnedRules` (владение по
  scope-id/имя/носитель/`forRole`/`ownerPersonId`, а не только `scope=role:<cuid>`) → `retrieveViaRouter`
  (flash `deepseek-v4-flash`, контекст = имя+саммари, парс id, отсев выдуманных id) → fallback на старый вектор
  под kill-switch `clone.regulations.router.enabled`. Инъекция `LlmRouterService` (AiModule @Global).
- `regulation-summary.service.ts` + `regulation-summarize.cron.ts` (@Cron 6h + `enabled`-крутилка, staleness по
  хешу контента) + `backfill-rule-summaries.ts` (в `apply-prod-deploy` STEPS). Крутилки в реестр.
- Стенд: `judgeG` теперь получает `regulationTexts`; `modeJudge` грузит карту имя→текст из БД и пробрасывает.

Проверка: typecheck зелёный (heap 8GB), lint 0 ошибок, retrieval-spec 13/13 (+3 на роутер), backfill 204 саммари
на «Стреле», перепрогон основного стенда (110) → judge с учётом регламентов.

## Что вышло (числом)

| | L2 (чистая) | L4 | C1b |
|---|---|---|---|
| EXPERT_PASS | 55% | 55% | **67%** (64/96) |
| FABRICATED | 0 | 2 | **0** |
| G заземлённость | — | 0.94 | **1.00** |
| BOUNDARY_OK | 13 | 12 | 10 |

`usedRegulationNames` был пустым (L3/L4) → стал корректно наполнен (роутер тянет нужные регламенты). Регламент-
категория 0→3 EXPERT. Открыто: boundary 13→10 (грубость, не breach), 20 отказов (`gate-refusal ×18` — резерв C3).

## Чему научился

1. **Судья-измеритель может быть СЛЕП к части опоры → систематически ложные фабрикации.** Первый замер C1 показал
   FABRICATED 6 — «клон выдумал регламент v2 / 4 часа». Ручная сверка с БД: регламент «v2» РЕАЛЬНО существует и
   дословно содержит «первый ответ 4 часа». Клон цитировал ПОДЛОЖЕННЫЙ роутером регламент, но `judgeG` видел только
   knowledge-блоки (`retrievedTexts`), а не `applicableRegulations`. Починка судьи (дать ему regulationTexts) → 6→0,
   EXPERT 60→67%. **Урок: когда метрика инварианта резко ухудшилась после расширения источников опоры — сначала
   проверь, ВИДИТ ли измеритель новый источник, а не правь продукт.** Верификация фабрикаций против первоисточника
   (БД) обязательна перед выводом — та же дисциплина, что «сверяйся с persisted-первоисточником» из L1-L2.
2. **Дрейф локальной БД: миграция помечена applied, но таблицы в `public` нет.** `createPrismaClient` ставит
   `search_path=ag_catalog,"$user",public` → безымянный `CREATE TABLE` ушёл в `ag_catalog`. Prisma же всегда бьёт в
   `public.<table>`. Лечение — явная `CREATE TABLE public."rule_summaries"`. Миграционный файл оставлен в стандартном
   Prisma-виде (без схемы) — на проде `search_path=public`, как у 109 миграций. Урок: при P2021 «table does not
   exist» при applied-миграции — проверь СХЕМУ таблицы (`pg_tables.schemaname`), это search_path, не отсутствие DDL.
3. **Проводка доказанного дизайна дала +12 п.п. одним рычагом** — чистая атрибуция (не трогал гейт/промпт клона,
   только retrieval регламентов). Подтверждает: структурный слой (реальная опора) > тюнинг гейта, который осциллировал ~55%.
