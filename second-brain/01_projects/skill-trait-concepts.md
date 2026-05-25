---
type: project
status: implemented
phase: clone-reliability-hardening — Фаза 2
date: 2026-05-25
---

# Смысловые блоки навыка (SkillTraitConcept)

## Зачем

В γ-1 LLM придумывал имя категории `SkillTrait` эмерджентно: у Сергея черта называется «осторожен с оценками сроков», у Маши — «не любит давать сроки без данных», у Олега — «откладывает оценку до сбора фактов». По смыслу это одна и та же черта, но в базе три разных текста. Это:
- ломает агрегацию «у скольких людей в команде эта черта»;
- мешает поиску «найди всех осторожных с оценками»;
- размывает данные клона роли.

Решение — автоматический справочник «смысловых блоков навыка», без участия человека.

## Модель данных

[`SkillTraitConcept`](../../backend/prisma/schema.prisma) — модель Org-scope:
- `canonicalName` — короткое каноническое имя (3–6 слов).
- `variants[]` — все наблюдённые формулировки (для прозрачности и отладки).
- `embedding vector(1536)` — семантический отпечаток canonicalName + description, HNSW-индекс с cosine ops.
- `traitCount` — денормализованный счётчик активных `SkillTrait` с этим `conceptId`.
- `status` — `active` | `merged_into` | `archived`. `mergedIntoId` указывает куда слили.

`SkillTrait` расширен полем `conceptId` (опц.).

## Пороги

| Параметр | Значение | Где задаётся |
|---|---|---|
| `cfg.skill.conceptMatchThreshold` | 0.85 | Минимальная косинусная близость, чтобы взять существующий концепт вместо создания нового. |
| `cfg.skill.conceptMergeThreshold` | 0.92 | Минимальная близость, чтобы cron-нормализатор слил два концепта. Выше match-порога, потому что слияние деструктивно. |
| `cfg.skill.conceptArchiveAfterMonths` | 6 | Архивация концепта без активных traits после N месяцев. |

ENV: `CLONE_CONCEPT_MATCH_THRESHOLD`, `CLONE_CONCEPT_MERGE_THRESHOLD`, `CLONE_CONCEPT_ARCHIVE_AFTER_MONTHS`.

## Pipeline

```
Specialist37Service.createNewTraitRaw (после insert SkillTrait)
  ↓ синхронно
SkillTraitConceptService.findOrCreateConcept(tenantId, category, statement)
  ↓ embed(category + '. ' + statement) → pgvector top-1
  ↓ similarity >= 0.85 → существующий + variants/lastSeenAt/traitCount
  ↓ < 0.85 → создаём новый: canonicalName=category «как есть»
  ↓
SkillTrait.conceptId = concept.id

# Ночью
SkillTraitConceptNormalizerCron (0 3 * * *, per-tenant Redis-замок 1ч)
  ↓ загрузка всех active концептов Org
  ↓ union-find кластеризация по cosine >= 0.92
  ↓ для каждого кластера 2+ концептов:
  ↓   опорный = max(traitCount)
  ↓   LLM `skill-trait-concept-name` (DeepSeek V4 Flash) → канон-имя
  ↓   mergeConcepts → перепривязка traits, sources → status='merged_into'
  ↓ архивация концептов с traitCount=0 и lastSeenAt > 6 мес → 'archived'
  ↓ probe-event `skill.concepts_merged` если в слитом кластере были разные canonicalName и совокупно >=5 traits
```

## LLM

Один новый taskType — `skill-trait-concept-name`. Вызывается **только в cron-нормализаторе при слиянии 2+ концептов** (на создании одиночной черты берём category как есть, экономим вызовы модели).

| TaskType | Primary | Secondary | Tertiary |
|---|---|---|---|
| `skill-trait-concept-name` | `deepseek:deepseek-v4-flash` | `openai-via-proxy:gpt-5.4-mini` | `ollama:qwen3:30b` |

Seed: [`backend/scripts/seed-llm-task-routes-skill-concept.ts`](../../backend/scripts/seed-llm-task-routes-skill-concept.ts) (idempotent + `editedByAdmin` защита).

## Admin API + UI

REST `/api/v1/admin/skill-trait-concepts`:
- `GET /` — list с фильтрами `status` / `search` (по `canonicalName`/`variants`) + пагинация.
- `GET /:id` — детали + последние 20 связанных traits.
- `POST /:id/merge` body `{ targetId, reason }` — ручное слияние с обоснованием.
- `POST /:id/archive` body `{ reason }` — ручная архивация.

RBAC: owner/admin, audit-log `admin_audit_log`.

UI `/admin/skill-trait-concepts` — master-detail на русском, термин «Смысловой блок навыка». Действия merge/archive через модалки с обязательным обоснованием.

## Метрики

- `skill_trait_concepts_total{status}` (gauge) — пересчитывается cron-нормализатором.
- `skill_trait_concepts_merged_total` (counter) — инкремент при каждом `mergeConcepts`.

## Бэкфилл

[`backend/scripts/skill-trait-concepts-backfill.ts`](../../backend/scripts/skill-trait-concepts-backfill.ts) — для каждой Org проходит по активным `SkillTrait` без `conceptId` и проставляет. В конце запускает cron-нормализатор один раз. Idempotent.

## Что осталось

- **Frontend интеграция в `/persons/[id]/skill-profile`** — пока traits группируются по `category` (тексту), а не по `conceptId`. После бэкфилла можно перейти на группировку по концепту — это естественный шаг. Не критично для MVP.
- **Аналитика «топ-смысловых блоков компании»** — виджет на дашборде CEO. Отложен.
