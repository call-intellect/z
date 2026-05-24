---
type: tz
status: draft
feature: SBA γ-1 — Specialist 3.7 SkillProfile + ExecutablePersona + Clone API + try-my-clone UI
date: 2026-05-21
parent_tz: tz/2026-05-21-second-brain-agents-umbrella.md
phase: gamma
depends_on:
  - tz/2026-05-21-sba-alpha-2-layer1-marking-extension.md (signalType='reasoning'/'rationale'/'decision_basis' — главный источник)
  - tz/2026-05-21-sba-alpha-3-layer2-ontology-extension.md (Person.relationship='employee')
  - tz/2026-05-21-sba-alpha-4-layer4-curation-foundation.md (mark_as_misleading вместо approve)
  - tz/2026-05-21-sba-alpha-5-layer5-chat-v2.md (clone-style mode регистрируется в chat-v2)
  - tz/2026-05-21-sba-alpha-6-specialist-3-4-project-customer.md (референс контракта)
  - tz/2026-05-21-sba-beta-2-specialist-3-2-knowledge-clone.md (фундамент — knowledgeProfile)
  - tz/2026-05-21-sba-beta-3-specialist-3-3-decisions.md (Decision rationale — источник)
  - tz/2026-05-21-sba-beta-5-specialist-3-6-ideas-and-layer6-probe.md (ProbeService для уточнений)
covers_matrix_rows: [C3, C5, D1..D10, F9, H2 (clone-style), J1..J11, L8, L9, M3..M10]
---

# ТЗ γ-1: Specialist 3.7 — SkillProfile + Executable Persona + Clone API + try-my-clone UI

> **Это sub-TZ.** Зонтичный — [`plans/tz/2026-05-21-second-brain-agents-umbrella.md`](2026-05-21-second-brain-agents-umbrella.md). При расхождениях — приоритет у зонтичного.
>
> **Самый чувствительный sub-TZ.** Перед стартом — прочитать §3.4 зонтичного **целиком**. Важные правила:
> - Skill — рабочий артефакт компании, не персональные данные.
> - Категории эмерджентные, не enum.
> - Источники только `IdeaBlockEntity.role='subject'`.
> - Гипотезные формулировки.
> - Только для `Person.relationship='employee'`.
> - Без onboarding/opt-in/прав скрытия от руководителя.
> - Видимость: owner/admin/direct manager. Носитель видит только **факт существования** + **«попробовать своего клона»** через `/me/clone`.
> - **Запрет выпуска без UI `/me/clone`** (§3.3 правило C5).

---

## 1. Цель

После γ-1:
- `SkillProfile` модель (1:1 с Person, только employee).
- `SkillTrait` карточки специалиста — эмерджентные категории, минимум N=5 наблюдений.
- `ExecutablePersona` — версионированные snapshots для использования в LLM.
- API клона: `POST /api/v1/clones/persons/:id/ask`, `POST /api/v1/clones/roles/:id/ask`.
- chat-v2 mode `clone-style` подключает Persona.
- UI `/me/clone` — диалоговое окно «попробовать своего клона» (обязательно).
- UI `/persons/:id/skill-profile` — для manager'а.
- UI `/roles/:id/skill-profile` — агрегат по роли.
- Manager weekly digest — «новые черты в skill-профилях твоих подчинённых», action `mark_as_misleading`.

---

## 2. Зависимости

**Зависит от:** все α + β-2, β-3, β-5.

**Особо опирается на:** signalType='reasoning' блоки (β-2 + α-2), Decision rationale (β-3), ProbeService (β-5 для уточнений).

---

## 3. Scope

### Входит

- 3 Prisma-модели: `SkillProfile`, `SkillTrait`, `ExecutablePersona`.
- Воркер `skill-trait-detector.worker` — consumer `core.specialist-routing` для блоков `signalType='reasoning'/'rationale'/'decision_basis'` + `IdeaBlockEntity.role='subject'` для employee-Person.
- Cron `skill-profile-recalibrate.cron` — переоценка traits с decay.
- Cron `executable-persona-build.cron` — раз в неделю snapshot.
- 4 новых `LlmTaskType` с 3 provider'ами: `skill-trait-detect`, `skill-trait-merge`, `executable-persona-compile`, `clone-respond`.
- API клона + retrieval с persona injection.
- Расширение chat-v2 mode `clone-style` (регистрация в SynthesisService через intent).
- UI `/me/clone` — диалоговая страница (обязательная).
- UI `/persons/:id/skill-profile` — manager-доступ.
- UI `/roles/:id/skill-profile` — агрегат по роли.
- Manager weekly digest через ConversationalService.
- Skill — post-hoc контроль через `mark_as_misleading` (расширение `/curation` нового типа решения).
- Жизненный цикл: при `Person.relationship` смене с `employee` → SkillProfile.status = `archived`, snapshots остаются.
- HNSW индекс на trait embedding.
- RBAC: `skill_profile`, `clone_persona`.

### Не входит

- Multi-org агрегаты skill (отраслевые бенчмарки) — отдельный sub-TZ позже.
- Voice-input для `/me/clone` (через ASR) — γ+.
- Skill для внешних участников (запрещено по §3.4).
- Multi-language Persona (русский по умолчанию; English — γ+ если потребуется).

---

## 4. Модели данных

```prisma
model SkillProfile {
  id              String   @id @default(uuid())
  tenantId        String
  personId        String   @unique  // 1:1 с Person
  status          SkillProfileStatus  // 'active' | 'archived' | 'paused_relationship'
  lastBuildAt     DateTime?
  buildVersion    Int       @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([tenantId, status])
}

model SkillTrait {
  id              String   @id @default(uuid())
  profileId       String
  category        String   // ЭМЕРДЖЕНТНАЯ (не enum) — LLM сам формирует
  statement       String   @db.Text  // гипотезная формулировка («Похоже, склонен к ...»)
  confidence      SkillConfidence  // 'low' | 'medium' | 'high'
  observationCount Int
  sourceBlockIds  String[]
  firstObservedAt DateTime
  lastConfirmedAt DateTime
  status          SkillTraitStatus  // 'active' | 'superseded_by' | 'archived' | 'misleading'
  supersededById  String?
  misleadingReason String?  @db.Text  // если manager mark_as_misleading
  misleadingFlaggedByUserId String?
  embedding       Unsupported("vector(1536)")?
  @@index([profileId, status])
  @@index([profileId, category])
}

model ExecutablePersona {
  id              String   @id @default(uuid())
  tenantId        String
  profileId       String
  scope           PersonaScope  // 'person' | 'role'  (role — агрегат)
  scopeRefId      String?  // null для person; roleId для role
  version         Int
  snapshotAt      DateTime
  personaPrompt   String   @db.Text  // структурированный текст «думай как X»
  includedTraitIds String[]
  status          PersonaStatus  // 'active' | 'superseded'
  builtFromTraitsCount Int
  @@unique([profileId, scope, scopeRefId, version])
  @@index([scope, scopeRefId, status])
}
```

Все enum'ы добавляются.

---

## 5. Воркер `skill-trait-detector`

```ts
@Processor(CORE_QUEUE_NAMES.SPECIALIST_ROUTING)
export class SkillTraitDetectorWorker {
  @Process('3-7-skill')
  async handle(job: Job<RoutedBlock>) {
    const block = await this.prisma.ideaBlock.findUnique(...);
    if (!['reasoning', 'rationale', 'decision_basis'].includes(block.signalType)) return;
    // 1. Найти Person с IdeaBlockEntity.role='subject', relationship='employee'
    //    Если внешний participant — skip
    // 2. Получить/создать SkillProfile для Person
    // 3. enqueueRebuildProfile с дебаунсом (60s)
  }

  @Process('rebuild-skill-profile')
  async rebuildProfile(job: Job<{ profileId: string }>) {
    // 1. Загрузить subject-блоки этого Person за rolling N мес
    // 2. Сгруппировать reasoning-блоки по similarity (embedding KNN)
    // 3. Для каждой группы из >= MIN_OBSERVATIONS (5) → LLM skill-trait-detect:
    //    - input: 5+ цитат reasoning от Person
    //    - output: { category: <эмерджентная>, statement, confidence, sourceBlockIds }
    //    - формулировки — гипотезные («похоже, склонен к…»)
    // 4. Для каждого новой trait — KNN cosine с существующими активными traits того же profileId:
    //    - Если совпадение > 0.85 → LLM skill-trait-merge: новый trait дополняет старый, заменяет, или новый
    //    - Если ничего близкого → новый trait
    // 5. CurationService.triage — Skill: НЕТ pre-approval (§3.6 F9), просто canonical при confidence>=medium
    //    Manager получит дайджест → может mark_as_misleading постфактум
    // 6. Decay для traits без подтверждений > N мес → confidence снижается; >2N мес → status='archived'
    // 7. Метрики
  }
}
```

`skill-profile-recalibrate.cron` — раз в сутки, decay для всех traits.

`executable-persona-build.cron` — раз в неделю:
- Для каждого `SkillProfile` со статусом active И числом активных traits >= 3:
  - LLM `executable-persona-compile`: traits → текстовый persona prompt
  - Insert `ExecutablePersona(version=N+1, scope='person')`
  - Старая → status='superseded'
- Для каждой Role с >= 2 employee'ями с активными SkillProfile:
  - Aggregate top traits → role-level persona
  - Insert `ExecutablePersona(scope='role', scopeRefId=roleId)`

---

## 6. Clone API

```ts
@Controller('clones')
export class ClonesController {
  @Post('persons/:personId/ask')
  async askPerson(@Param('personId') personId, @Body() { question, conversationId }) {
    // 1. RBAC: текущий user должен иметь read на skill_profile этого Person
    //    (owner/admin/direct manager/сам носитель)
    // 2. Получить active ExecutablePersona(scope='person', scopeRefId=personId)
    //    Если нет — 404 «у этого человека пока нет клона (мало данных)»
    // 3. Retrieval subgraph носителя:
    //    - блоки с IdeaBlockEntity.role='subject' для personId
    //    - karta knowledgeProfile из β-2
    //    - top decisions с decidedByPersonIds.includes(personId) (из β-3)
    //    - relevant cards (Card.personSubjectIds.includes(personId))
    // 4. LLM clone-respond:
    //    - input: persona prompt + subgraph context + question
    //    - output: ответ в стиле носителя + цитаты
    // 5. Сохранить в ChatV2Conversation (mode='clone-style', scope='card', scopeRefId=personId)
    // 6. Вернуть ответ
  }

  @Post('roles/:roleId/ask')
  async askRole(...) {
    // Аналогично, но persona — role-level
  }
}
```

---

## 7. Расширение chat-v2 (α-5)

В α-5 mode `clone-style` был заглушкой. Здесь полная реализация:
- В `ChatV2Service.ask({ mode: 'clone-style', scopeRefId: <personId> })` → вызывает `clonesService.askPerson(...)`.

---

## 8. Probe-events

| Reason | Trigger | Recipient |
|---|---|---|
| `skill.profile_starved` | Person employee >3 мес, нет reasoning-блоков | direct manager (можно ли поставить на роль с активным reasoning?) |
| `skill.contradicting_traits` | новый trait противоречит существующему high-confidence | direct manager |

---

## 9. ENV

```
SKILL_MIN_OBSERVATIONS=5
SKILL_TRAIT_SIMILARITY_THRESHOLD=0.85
SKILL_LOOKBACK_MONTHS=12
SKILL_DECAY_MONTHS=6
SKILL_ARCHIVE_MONTHS=12
SKILL_RECALIBRATE_CRON="0 5 * * *"
PERSONA_BUILD_CRON="0 6 * * SUN"
PERSONA_MIN_TRAITS=3
PERSONA_ROLE_AGG_MIN_PERSONS=2
MANAGER_DIGEST_CRON="0 9 * * MON"
```

---

## 10. RBAC

- `skill_profile` ResourceType:
  - read: owner / admin / direct manager / **самого носителя** (через `/me/clone` он не видит профиль, видит только факт + диалог)
  - write/delete: только worker (нет ручного API)
  - `mark_as_misleading`: owner / admin / direct manager
- `clone_persona` ResourceType:
  - read: owner / admin / direct manager / сам носитель (для `/me/clone`)
  - call `ask`: owner / admin / direct manager / сам носитель (для своего клона)

---

## 11. Метрики

```
core_specialist_cards_total{type='skill_trait', status, confidence}
core_specialist_pipeline_duration_seconds{type='skill_trait'}
core_specialist_llm_tokens_total{type='skill_trait', model, tier}
core_specialist_probe_events_total{type='skill_trait', reason}
skill_profiles_active_total
skill_traits_per_profile (histogram)
skill_traits_marked_misleading_total{category}  # для тюна промпта
persona_active_total
persona_build_duration_seconds
clone_ask_total{scope}  # 'person' | 'role'
clone_ask_by_owner_total  # сколько раз носитель сам спрашивает своего клона (engagement)
```

---

## 12. LLM (3 уровня — критично)

**4 новых `LlmTaskType`:**

1. `skill-trait-detect` — самая сложная задача. Из 5+ reasoning-цитат → структурированный trait с эмерджентной категорией.
2. `skill-trait-merge` — арбитр merge/extend/new.
3. `executable-persona-compile` — из traits → текстовый persona prompt.
4. `clone-respond` — ответ в стиле носителя на вопрос.

**Особенно важная задача** — `skill-trait-detect`. Качество LLM здесь определяет полезность всей γ-фазы. Тестировать особо тщательно через [llm-models-playbook.md](../../llm-models-playbook.md). Возможно primary должен быть более capable model (Claude Opus) чем у других задач.

Цепочки — primary/secondary/tertiary, **все три фильтр** `maxDataClass >= 'top_secret'`.

Seed `seed-llm-task-routes-skill-and-clone.ts` со ссылкой на playbook + явный комментарий «качество skill-trait-detect — критично, см. тест X в playbook».

---

## 13. UI

### `/me/clone` — обязательная страница

Диалоговое окно (как chat-v2 ChatPanel):
- Заголовок «Попробовать своего клона»
- Объяснение в одном предложении: «Это AI на основе твоего наблюдаемого поведения на встречах»
- Чат-input для вопросов («Как бы я подошёл к X?»)
- Ответы помечены «mode: clone-style»
- Кнопка «помечу как неверно» рядом с ответом → создаёт фидбек для тюна промпта
- **Кнопка «отключить наблюдение» — НЕ показывается** (§3.4: «никаких прав скрытия от руководителя»)
- Прозрачность через инструмент: «вот что я знаю — спроси сам»

### `/persons/:id/skill-profile` — для manager

- Список trait категорий (эмерджентные)
- На каждой — statement + confidence + observationCount + lastConfirmedAt
- Клик → раскрытие цитат-источников (blockIds → встречи)
- Кнопка «mark_as_misleading» → ввод reason → trait.status='misleading'
- Persona snapshots history (timeline по version)

### `/roles/:id/skill-profile` — агрегат

- Список людей на роли с их skill summary
- Топ-5 общих trait для роли
- Кнопка «спросить клона роли» → переход на `/clones/roles/:id/chat`

### Manager weekly digest

Через ConversationalService в понедельник утром:
- «На этой неделе появилось N новых черт в skill-профилях твоей команды»
- Inline-кнопки: «посмотреть», «всё ок», «есть подозрительные»
- Клик «есть подозрительные» → переход на `/curation?filter=skill_misleading_candidates`

---

## 14. Фазы реализации

- [ ] **γ-1.0** Прочитать §3.4 зонтичного целиком всей командой. Согласовать концепцию.
- [ ] **γ-1.1** Prisma-модели `SkillProfile`, `SkillTrait`, `ExecutablePersona` + enum'ы + HNSW + `bun run prisma:push`.
- [ ] **γ-1.2** Воркер `skill-trait-detector.worker` + два process handler'а (route + rebuild).
- [ ] **γ-1.3** Cron `skill-profile-recalibrate.cron` (daily decay).
- [ ] **γ-1.4** Cron `executable-persona-build.cron` (weekly snapshots, person + role).
- [ ] **γ-1.5** 4 промпта placeholder + TODO. `skill-trait-detect` — особо тщательно прописать инструкцию про гипотезные формулировки и эмерджентные категории.
- [ ] **γ-1.6** Seed `seed-llm-task-routes-skill-and-clone.ts` с 3 provider'ами для каждого + комментарии playbook.
- [ ] **γ-1.7** CurationService интеграция — не pre-approval, но `mark_as_misleading` через CurationDecision.
- [ ] **γ-1.8** Probe-events (2 trigger'а).
- [ ] **γ-1.9** Clone API `POST /clones/persons/:id/ask` + `POST /clones/roles/:id/ask`.
- [ ] **γ-1.10** Расширение chat-v2 mode `clone-style` (вызов clonesService).
- [ ] **γ-1.11** UI `/me/clone` (обязательно для DoD).
- [ ] **γ-1.12** UI `/persons/:id/skill-profile` (manager).
- [ ] **γ-1.13** UI `/roles/:id/skill-profile` (агрегат).
- [ ] **γ-1.14** Manager weekly digest через ConversationalService.
- [ ] **γ-1.15** Жизненный цикл: hook на `Person.relationship` смене → SkillProfile.status='archived'.
- [ ] **γ-1.16** RBAC: `skill_profile`, `clone_persona`.
- [ ] **γ-1.17** Метрики `skill_*`, `persona_*`, `clone_*`.
- [ ] **γ-1.18** Глоссарий UI: «клон», «попробовать клона», «навыковый профиль» (для manager).
- [ ] **γ-1.19** second-brain: новый файл `01_projects/skill-and-clone.md` + обновление `06_marketing/positioning.md` (Employee Clones теперь есть).
- [ ] **γ-1.20** Финальный smoke на 3 dev-сотрудниках с разным объёмом данных:
  - Сотрудник с 100+ reasoning-блоков → ожидаем 5-10 trait категорий
  - Сотрудник с 10 reasoning-блоков → 0-2 категории (или вообще без профиля если <5)
  - Новый сотрудник без reasoning → нет профиля

---

## 15. Открытые вопросы

1. **`SkillTrait.category` — Text-поле или отдельная модель `SkillTraitCategory` для merge/rename через UI?** (зонтичный §11.4) Рекомендация — Text-поле в γ-1; модель — если возникнет потребность.
2. **`ExecutablePersona` — версионируется при каждом изменении или раз в неделю?** (зонтичный §11.6) Рекомендация — раз в неделю + on-demand rebuild через admin API.
3. **Manager-визибилити — direct manager только или manager chain?** Рекомендация — direct (max 1 уровень).
4. **«Попробовать своего клона» для пустых профилей (<3 traits)** — отключено или показывать дисклеймер «недостаточно данных»? Рекомендация — disabled с тултипом «накопится после нескольких встреч».
5. **Лимиты на clone_ask** per-user для контроля стоимости — нужны? Если да, какие? Решение в начале sub-TZ через [llm-models-playbook.md](../../llm-models-playbook.md) (стоимость clone-respond).

---

## 16. DoD

- 3 модели + enum'ы + HNSW, `bun run prisma:push` зелёный.
- Воркер + 2 cron'а работают.
- 4 промпта placeholder + seed с 3 provider'ами + playbook-ссылки.
- Только employee-Person'ы получают SkillProfile (smoke на external — skip).
- Только subject-role блоки попадают в источник (smoke на mentioned — skip).
- Категории эмерджентные, не enum (LLM сам придумывает).
- Минимум 5 observations для появления trait (smoke).
- CurationService интеграция: нет pre-approval, mark_as_misleading работает.
- Clone API возвращает ответ с цитатами на dev-данных.
- chat-v2 mode='clone-style' → вызывает clonesService.
- **`/me/clone` — обязательная страница работает** (без неё DoD не закрыт).
- `/persons/:id/skill-profile` и `/roles/:id/skill-profile` — для manager.
- Manager weekly digest приходит (smoke).
- Жизненный цикл при `Person.relationship` смене — архивация.
- Метрики, RBAC, glossary, second-brain.
- Финальный smoke на 3 dev-сотрудниках с разным объёмом данных (см. §14.20).
- Manager validation: 1-2 dev-куратора лично подтверждают, что traits — «похоже на правду» (не блокирует DoD, но note).

---

## 17. Итог

**Реализовано целиком:** нет (draft).

**Что осталось:** вся реализация.

**Что меняет в продукте:** появляются полноценные клоны сотрудников — главная маркетинговая ценность «memory layer для команды». Знания компании остаются после ухода ключевых людей.
