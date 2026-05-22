# SBA γ-1 — SMOKE-тесты Clone API

> Документация dev-сценариев для проверки SkillProfile + ExecutablePersona +
> Clone API. Реальный запуск — после deploy. На γ-1.20 это только
> описание; manager validation note: 1–2 dev-куратора должны лично
> подтвердить «traits похожи на правду».

## Предусловия

- ENV из `.env.example` (`SKILL_*`, `PERSONA_*`, `CLONE_ASK_PER_USER_PER_DAY`).
- Бэкенд запущен (`bun run dev` + `bun run worker:dev` — оба процесса).
- `bun run apply-postgres-init` (HNSW индекс на `skill_traits.embedding`).
- `bun run seed:llm-task-routes-skill-and-clone` (4 taskType маршрута).
- В test-Org есть Person с `relationship='employee'` и `entityId IS NOT NULL`.
- Person.userId заполнен (для тестирования self-доступа).

## Сценарий 1 — Сотрудник с 100+ reasoning-блоков

**Setup:**
- Создать 30+ встреч, где этот сотрудник — subject, и обсуждаются «почему я так решил».
- Дождаться, пока block-ingest сгенерирует 100+ `IdeaBlock` с
  `signalType='reasoning'` + `IdeaBlockEntity.role='subject'`.

**Ожидаемое поведение:**
1. RouterService диспатчит каждый блок в `3-7-skill`.
2. Specialist37SkillWorker создаёт SkillProfile (если нет) + enqueue rebuild
   (debounce 60s). Несколько подряд идущих enqueue для одного профиля
   сложатся в один job.
3. SkillProfileRebuildWorker запускает `Specialist37Service.rebuildProfile`:
   - Группирует блоки по embedding similarity (порог 0.78).
   - Для групп >= 5 блоков — LLM `skill-trait-detect`.
   - KNN-merge новых traits с активными.
   - Decay traits с устаревшим lastConfirmedAt.

**Что должно появиться:**
- 5–10 SkillTrait записей со статусом `active`.
- Категории — эмерджентные строки (например, «осторожен с легаси-кодом»,
  «требует данных перед решением»). НЕ из фиксированного списка.
- Statements — гипотезные («Похоже, …» / «Склонен …» / «В большинстве случаев …»).
- Confidence — преимущественно `medium` / `high`.
- В метриках: `skill_profiles_active_total >= 1`,
  `skill_traits_per_profile` гистограмма заполнена,
  `core_specialist_pipeline_duration_seconds{type='skill_trait'}` есть данные.

**Проверка:**
```sql
SELECT category, confidence, "observationCount", "lastConfirmedAt"
FROM skill_traits
WHERE "profileId" = '<profileId>'
  AND status = 'active'
ORDER BY confidence DESC, "lastConfirmedAt" DESC;
```

## Сценарий 2 — Сотрудник с 10 reasoning-блоков

**Setup:**
- Создать 3–4 встречи с этим сотрудником, 10 блоков `reasoning` всего.

**Ожидаемое поведение:**
- SkillProfile создан (после первого dispatch).
- rebuildProfile запускается — но groups < 5 (порог SKILL_MIN_OBSERVATIONS).
- Появится 0–2 категории (если все 10 блоков семантически близки и
  образовали одну группу из >= 5).
- В большинстве случаев — 0 traits (порог не достигнут).

**Что должно появиться:**
- `SkillProfile` со status='active', buildVersion >= 1.
- 0–2 SkillTrait с confidence='low'.
- Probe `skill.profile_starved` (если employee tenure > 3 мес).

## Сценарий 3 — Новый сотрудник без reasoning

**Setup:**
- Person.relationship='employee', createdAt > 3 мес назад.
- НИ ОДНОГО `IdeaBlockEntity` с role='subject' + signalType='reasoning'.

**Ожидаемое поведение:**
- SkillProfile может быть создан (если когда-то был dispatch блока, который
  потом был удалён), но traits=[].
- rebuildProfile — skip (blocks.length < minObservations).
- Probe `skill.profile_starved` — должен прийти direct manager'у (или admin
  fallback) после очередного rebuild'а / cron'а.

**Что должно появиться:**
- В UI `/persons/:id/skill-profile` — empty state «Профиль ещё не сформирован».
- В `/me/clone` (для этого сотрудника) — input disabled с tooltip
  «накопится после нескольких встреч».
- POST /clones/persons/:id/ask → 404 `no_clone` / `starved_profile`.

## Сценарий 4 — Clone API self-доступ

**Setup:**
- Сотрудник из Сценария 1 заходит в `/me/clone`.

**Ожидаемое поведение:**
1. UI грузит /me/profile → personId.
2. Грузит /me/knowledge-profile (для проверки empty).
3. Если traits >= 3 → input enabled.
4. Submit → POST /clones/persons/:personId/ask с question.
5. ClonesService.canAccessPersonClone → relation='self' → allowed.
6. Rate limit OK (< 20 в сутки).
7. Active ExecutablePersona найдена (или собрана on-demand).
8. Retrieval subgraph: reasoning-блоки + knowledgeProfile + decisions.
9. LLM `clone-respond` с persona prompt в system.
10. Citations [BLOCK:id] парсятся.
11. Запись в ChatV2Conversation (mode='clone_style', scope='card', scopeRefId=profile.id).
12. UI показывает ответ с badge «в стиле сотрудника» + кнопка «помечу неверным».
13. `clone_ask_by_owner_total` инкрементируется.

## Сценарий 5 — Clone API direct manager доступ

**Setup:**
- Сотрудник A (подчинённый) — `primaryDepartmentId=dept-1`.
- Сотрудник B (manager) — `primaryDepartmentId=dept-1`, Membership.role='manager'.

**Ожидаемое поведение:**
- B заходит в `/persons/A/skill-profile` → UI показывает профиль.
- В UI traits — кнопка «Помечу неверным» (canMarkMisleading=true).
- Click → POST /clones/skill-traits/:id/mark-misleading + reason.
- SkillTrait.status = 'misleading'.
- `skill_traits_marked_misleading_total{category}` инкрементируется.

## Сценарий 6 — Rate limit clone-ask

**Setup:**
- Сделать 21 запрос /clones/persons/:id/ask за один день.

**Ожидаемое поведение:**
- 21-й запрос → HTTP 429 `clone_ask_rate_limit`.
- Redis ключ `clone:ask:<userId>:<date>` имеет TTL ~26 часов.

## Сценарий 7 — Role-clone

**Setup:**
- Role «Менеджер по продажам» с 3 сотрудниками, у каждого active SkillProfile.

**Ожидаемое поведение:**
1. ExecutablePersonaBuildCron в воскресенье 06:00 → builder.buildForRole.
2. Aggregate top traits всех 3 сотрудников.
3. LLM `executable-persona-compile` → role persona prompt.
4. Insert ExecutablePersona(scope='role', scopeRefId=roleId).
5. UI `/roles/:id/skill-profile` показывает top-5 traits + list людей +
   кнопку «Начать диалог».
6. POST /clones/roles/:id/ask → role-persona ответ.

## Manager validation note

После реального deploy на проде:
- Выбрать 2 dev-куратора (admin Org).
- Запустить rebuild профилей 3 сотрудников с разным объёмом данных
  (см. сценарии 1–3).
- Кураторы лично читают traits и оценивают «похоже на правду» по шкале 1–5.
- Если средняя оценка < 3 — НЕ выпускать в general availability.
- Записать оценки в `second-brain/05_история/<date>-skill-validation.md`.

## Что **НЕ** проверяется автоматически

- Качество persona prompt 300–800 слов (полу-ручная оценка).
- Защита от инъекций в clone-respond (отдельный security audit).
- Производительность KNN на 100k+ traits (load test).
- Цепочка fallback skill-trait-detect (gpt-5.4 → deepseek-v4-pro → ollama).
