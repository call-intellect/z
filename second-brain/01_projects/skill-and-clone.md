---
type: project
status: implemented
phase: SBA γ-1
date: 2026-05-22
---

# SBA γ-1 — SkillProfile + ExecutablePersona + Clone API

## Что это

Финальная фаза SBA — **Employee Clones**. Самая чувствительная зона: клоны сотрудников. Skill — рабочий артефакт компании, не персональные данные сотрудника.

Главные сущности:
- **SkillProfile** (1:1 с Person для `relationship='employee'`) — навыковый профиль сотрудника.
- **SkillTrait** — отдельная черта подхода к решениям. Эмерджентная категория (LLM придумывает), гипотезная формулировка («похоже»/«склонен»/«в большинстве случаев»).
- **ExecutablePersona** — версионированный snapshot «думай как X» / «думай как Role». Используется как system prompt при ответе клона.

## Источник данных

Только `IdeaBlockEntity.role='subject'` от Person с `signalType ∈ {reasoning, rationale, decision_basis}` (где сам сотрудник объясняет «почему я так решил»). Минимум `SKILL_MIN_OBSERVATIONS=5` цитат для появления trait'а.

**НЕ источник:** mentioned-блоки, не-reasoning signalType, внешние Person'ы (relationship≠'employee').

## Жизненный цикл

| Event | Action |
|---|---|
| `signalType='reasoning'` блок canonical → RouterService dispatch | enqueue `core.specialist-routing` jobName='3-7-skill' |
| Worker диспетчер находит subject-Person employee → создаёт/получает SkillProfile | enqueue `core.skill-profile-rebuild` (debounce 60s) |
| RebuildWorker → `Specialist37Service.rebuildProfile` | KNN-группировка блоков → LLM skill-trait-detect → KNN-merge с активными → decay |
| Person.relationship → `former` | `SkillProfile.status='archived'`, snapshots остаются |
| Person.relationship → `candidate` | `paused_relationship` |
| Person.relationship → `employee` (возврат) | `active` |

## Auto-canonical (без pre-approval)

Skill traits **НЕ проходят** через `CurationService.triage` pre-approval. Auto-canonical при confidence>=medium. Manager mark_as_misleading **постфактум** (через `POST /api/v1/clones/skill-traits/:id/mark-misleading` + новый enum `CurationDecisionType.mark_as_misleading`).

## Видимость (RBAC)

| Кто | Что видит |
|---|---|
| owner / admin | Все профили Org |
| direct manager | Профили подчинённых (Membership.role='manager' + та же primaryDepartment) |
| Сам носитель | Только факт существования + `/me/clone` (диалог) |
| Прочие member'ы | НЕТ доступа |

В UI `/persons/:id/skill-profile` подмечает кнопкой «Помечу неверным» только тем, у кого есть `canMarkMisleading` (owner/admin/direct manager). Носитель не может помечать собственные traits — это post-hoc контроль.

## Crons (3 шт.)

| Cron | Расписание | Назначение |
|---|---|---|
| `SkillProfileRecalibrateCron` | `0 5 * * *` | Daily decay (high→medium→low) + archive старых traits |
| `ExecutablePersonaBuildCron` | `0 6 * * SUN` | Weekly snapshots scope='person' + scope='role' (агрегат) |
| `SkillManagerDigestCron` | `0 9 * * MON` | Weekly digest direct manager'ам «новые черты у подчинённых» |

## API

| Endpoint | Что делает |
|---|---|
| `POST /api/v1/clones/persons/:personId/ask` | Ответ от клона сотрудника. Rate limit 20/сутки. Mode='clone_style'. |
| `POST /api/v1/clones/roles/:roleId/ask` | Ответ от агрегатного клона роли (top traits всех employee'ев). |
| `GET /api/v1/clones/persons/:personId/skill-profile` | Read профиля для manager/admin/self. |
| `GET /api/v1/clones/roles/:roleId/skill-profile` | Агрегатный профиль роли + список людей. |
| `POST /api/v1/clones/skill-traits/:traitId/mark-misleading` | Manager/admin помечает trait как неверный. |

## UI (ОБЯЗАТЕЛЬНОЕ)

- `/me/clone` — обязательная страница «Попробовать своего клона» (зонтичный §3.3 правило C5).
- `/persons/:id/skill-profile` — для manager / admin / self.
- `/roles/:id/skill-profile` — агрегат + кнопка «попробовать клона роли».

**НЕ показывается:** кнопка «отключить наблюдение» (§3.4 — никаких прав скрытия от руководителя).

## LLM (4 taskType)

| TaskType | Primary | Secondary | Tertiary |
|---|---|---|---|
| `skill-trait-detect` (⚠ критично) | `openai-via-proxy:gpt-5.4` | `deepseek:deepseek-v4-pro` | `ollama:qwen3:30b` |
| `skill-trait-merge` | `deepseek:deepseek-v4-flash` | `openai-via-proxy:gpt-5.4-mini` | `ollama:qwen3:30b` |
| `executable-persona-compile` | `deepseek:deepseek-v4-flash` | `openai-via-proxy:gpt-5.4-mini` | `ollama:qwen3:30b` |
| `clone-respond` | `deepseek:deepseek-v4-flash` | `openai-via-proxy:gpt-5.4-mini` | `ollama:qwen3:30b` |

⚠ `skill-trait-detect` — primary должна быть capable. **Без согласования с product owner — не менять.**

## Метрики

- `skill_profiles_active_total` (gauge)
- `skill_traits_per_profile` (histogram)
- `skill_traits_marked_misleading_total{category}` (counter)
- `persona_active_total{scope}` (gauge)
- `persona_build_duration_seconds` (histogram)
- `clone_ask_total{scope}` (counter)
- `clone_ask_by_owner_total` (counter — engagement)
- `core_specialist_*{type='skill_trait'}` стандартные.

## Probe-events

| Reason | Trigger | Recipient |
|---|---|---|
| `skill.profile_starved` | Employee >3 мес, reasoning-блоков <5 за 3 мес | Direct manager (fallback admins) |
| `skill.contradicting_traits` | Новый trait противоречит существующему high-confidence | Direct manager |

## Открытые вопросы (решения γ-1)

1. **SkillTrait.category — Text-поле** в γ-1 (отдельная модель — γ+).
2. **ExecutablePersona — раз в неделю (cron) + on-demand rebuild** через ClonesService при отсутствии active snapshot.
3. **Manager visibility — direct manager** (1 уровень).
4. **«Попробовать своего клона» для пустых профилей <3 traits** — disabled с tooltip.
5. **Rate limit Clone API** — `CLONE_ASK_PER_USER_PER_DAY=20`.

## Чувствительность

Этот sub-TZ — самый чувствительный во всём SBA. Любая ошибка в формулировках, утечка manager-видимости носителю, потеря качества `skill-trait-detect` — подорвёт восприятие продукта. После deploy 1–2 dev-куратора должны лично подтвердить «traits похожи на правду» (manager validation note).
