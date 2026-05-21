# SECOND BRAIN — Z (память компании)

> Главный навигационный файл. Все разделы ведут отсюда.
>
> **Категория продукта:** «память компании» / memory layer (см. [[06_marketing/positioning]]). **Первая рабочая вертикаль:** AI-встречи на LiveKit (MVP).

## Карты верхнего уровня

- [[02_architecture/project-overview]] — что такое проект, MVP-границы, основной флоу

## Система

- [[00_system/SECOND_BRAIN_PROTOCOL]] — главный протокол
- [[00_system/SOURCE_OF_TRUTH]] — каким источникам верить
- [[00_system/STRUCTURE_RULES]] — правила файлов и папок
- [[00_system/LINKING_RULES]] — правила перелинковки
- [[00_system/INDEX_RULES]] — правила обновления этого файла
- [[00_system/TASK_WORKFLOW]] — процесс работы над задачей
- [[00_system/UPDATE_AFTER_CODE_CHANGE]] — что обновлять после изменений кода
- [[00_system/BOOTSTRAP_FROM_CODE]] — как первично заполнить second-brain

## Проекты

- [[01_projects/crossmark-integration]] — связь с Crossmark: только через API, развёртывание отдельное
- [[01_projects/meeting-types]] — 9 типов встреч MVP
- [[01_projects/ai-analysis-by-type]] — шаблоны AI-анализа по типу
- [[01_projects/ai-value-director]] — **AI-директор по ценности** (Value Director) — первый агент в будущем AI-совете директоров CEO, работает на методологии из [[06_marketing/client-value-framework]]
- [[01_projects/roles-and-permissions]] — роли host/guest и их права
- [[01_projects/recording]] — запись встречи (общая + аудиодорожки) + retention (TTL по тарифу)
- [[01_projects/meeting-result-page]] — карточка результата: что показываем после встречи
- [[01_projects/capacity-and-infra]] — мощности, метрики, deployment-правила

## Архитектура

- [[02_architecture/project-overview]] — что такое проект и основной флоу
- [[02_architecture/tech-stack]] — стек технологий
- [[02_architecture/module-map]] — карта модулей и потоков данных
- [[02_architecture/data-model]] — сущности (Meeting, Participant, Recording, AI Result) и FSM статусов
- [[02_architecture/ai-integration]] — внутренние API компании: GigaAM Vox (ASR) + Claude Sonnet (LLM), `proxy.agent-lia.ru` для fallback

- [[02_architecture/code-pitfalls]] — копилка тех. фактов «не как кажется» (LiveKit, Egress, webhooks, ASR-биллинг)
- [[02_architecture/knowledge-core]] — единое информационное ядро Z (Фаза 4): IdeaBlock + Entity + IdeaBlockLink + EntityLink + Theme, pipeline ingest→distill→link→reframing→theme-clusterer→card-rollup-v2, гибридный поиск + граф + темы

## Решения / ADR
_пусто_

## Активные ТЗ
- `plans/tz/2026-05-10-knowledge-core-tz.md` — **переустройство фундамента Z в единое информационное ядро (knowledge core)**. 12 фаз: org/multi-tenancy → universal ingest → IdeaBlock + Entity → граф связей → Theme → переписанные UX-агенты → AI-чат через ядро → админка отладки → дашборд директора → цели и стратегический согласователь → доп. источники → retention/security → tariffs. Концепции из `delivery/` и Blockify, реализация на стеке Z (NestJS/pgvector/BullMQ).
  - **Дочерние ТЗ (для агентов-исполнителей):**
    - `plans/tz/2026-05-10-phase-7-admin.md` — Z-Admin (super_admin) + Org-Admin (owner/admin): отладка, аналитика стоимости, A/B моделей, прайс-карта, тумблеры воркеров, отладка ядра.
    - `plans/tz/2026-05-10-phase-8-director-dashboard.md` — Дашборд директора: 5 виджетов поверх ядра + AI-чат (org-scope chat-v2), role-based split на `/dashboard`.
    - `plans/tz/2026-05-10-phase-9-goals-strategic-alignment.md` — Цели компании + воркер strategic-alignment (alignment 0-100 + history snapshots) + индикатор «Согласованность стратегии» на дашборде.
- `plans/architecture/2026-05-08-z-architecture.md` — целевая архитектура MVP (полное полотно: модули, FSM, контракты API, ENV, безопасность, decisions log)
- `plans/tz/2026-05-08-mvp-fullstack-tz.md` — основное ТЗ MVP по фазам 0–9 (frontend + backend + AI + admin + observability) ✅ закрыт
- `plans/tz/2026-05-06-infrastructure-deployment-tz.md` — фаза 0 (инфра): развёртывание серверов, LiveKit, Egress, БД, мониторинг, Selectel S3
- `plans/tz/2026-05-09-standalone-product.md` — Z как самостоятельный продукт ✅ реализован (2026-05-09): accounts/mail backend + signup/login/forgot/reset/onboarding + AppShell + master-detail журнал
- `plans/tz/2026-05-09-ai-meeting-workspace.md` — расширенный AI Meeting Workspace ✅ реализован (2026-05-09): 9 backend cross-cutting модулей (security/audit/quotas/api-keys/webhooks-out/destinations/exports/chat/public-api), 6 domain (tasks/chapters/highlights/shares/tags/templates), AI-pipeline (LlmRouter + Embeddings + 4 новых worker'а), 3-колоночная страница встречи + AI-чат + Vidstack + clips + public share, /tasks /settings/{tags,api,webhooks,exports,integrations} /admin/ai-models /dashboard
- `plans/tz/2026-05-09-cards.md` — Карточки (CRM-структура) ✅ реализован (2026-05-09): сущность Card (client/deal/project/topic/custom) с одним primary-контактом, Meeting.cardId (one-to-many), AI-сводка по карточке + AI-чат с RAG, ⌘K command palette, Public REST API, webhook events (card.created/updated/deleted, meeting.linked_to_card/unlinked), привязка только явная без LLM-угадывания
- `plans/tz/2026-05-09-meeting-room-chat.md` — In-meeting чат с persist ✅ реализован (2026-05-09): MeetingRoomMessage модель, POST/GET с идемпотентностью, ChatPanel переписан с history+dedup, 6-й таб «Чат», MeetingShare.allowChat для публичного шеринга, AI-pipeline merger подмешивает roomChat во все 9 типов промптов

## Заметки по реализации (2026-05-09)
- [[01_projects/auth-and-accounts]] — standalone-аккаунты: argon2id, UserSession+jti, mail.hosting.reg.ru SMTP, forced-onboarding (+ Org-хук в register с 2026-05-10)
- [[01_projects/ai-workspace]] — карта новых модулей (tasks/chapters/highlights/shares/tags/templates/chat/api-keys/webhooks-out/destinations/exports), Public REST API
- [[01_projects/meeting-room-chat]] — in-meeting чат с persist: LiveKit DataChannel + POST в БД, history на join, 6-й таб результата, allowChat шеринг, AI-pipeline mixing
- [[01_projects/cards]] — CRM-структура встреч: Card (5 видов) + Meeting.cardId, card-rollup воркер с дебаунсом, AI-чат по карточке, ⌘K палитра, Public REST API
- [[02_architecture/security]] — SSRF-guard, AES-GCM-256 envelope-encryption webhook-секретов, ipHash, soft-delete с 30-дневным grace, retention extras
- [[02_architecture/design-system]] — dark-first + mint `#5EEAD4` + Geist + glass-cards, motion presets, AppShell

## Заметки по реализации (2026-05-10) — Фаза 0 knowledge-core
- [[01_projects/orgs-and-rbac]] — Org / Membership / OrgInvitation, RBAC через RbacService (Casbin-совместимый), super_admin, visibilityMode (open/strict)
- [[01_projects/llm-router]] — LlmRouter с обязательным tenantId, LlmModelPrice (версионируемая прайс-карта), AiUsageLog (cachedTokens/sourceRef/experimentGroup)
- [[13_glossary/index|Глоссарий]] — Org, Membership, super_admin, visibilityMode, tenantId, IdeaBlock/Entity/Theme/Source/RawEvent (placeholder'ы для Фаз 1-4)

## Заметки по реализации (2026-05-10) — Фаза 1 knowledge-core
- [[01_projects/ingest-and-sources]] — Source/RawEvent + IngestService + meeting-adapter + core.raw-events очередь, hook в analyze.worker, MeetingTranscriptChunk помечен @deprecated

## Заметки по реализации (2026-05-10) — Фаза 2 knowledge-core
- [[02_architecture/knowledge-core]] — `IdeaBlock` + `Entity` + `IdeaBlockEvidence` + `IdeaBlockEntity`, pipeline `block-ingest.worker` → `block-distill.worker` → `entity-resolver.worker/cron`, гибридный поиск `cosine + BM25` (`POST /api/v1/knowledge/search`), pgvector HNSW + ts_vector GIN
- [[02_architecture/data-model]] — обновлён разделом knowledge-core (IdeaBlock + Entity + связи)
- [[02_architecture/module-map]] — добавлен раздел knowledge-core (services/workers/api)
- [[01_projects/llm-router]] — DeepSeek/Ollama адаптеры, JSON Schema strict, taskType ядра (`block-ingest`, `block-distill`, `entity-merge-arbiter`)

## Заметки по реализации (2026-05-10) — Фаза 3 knowledge-core
- [[02_architecture/knowledge-core]] — раздел «Граф (Фаза 3)»: `IdeaBlockLink` (7 типов связей: develops/contradicts/causes/consequences_of/shares_topic/shares_entity/question_answered_by) + `EntityLink` (6 типов: works_at/belongs_to/part_of/opposes/depends_on/mentions_with). `block-linker.worker` (consumer `core.block-linker`, KNN top-10 + LLM-арбитр, гейт LINKER_MIN_BLOCKS=50). `entity-graph-builder.cron` (раз в час, co-mentioned пары). `reframing.cron` (3:00, архивация слабых связей confidence<0.5, dynamicScore decay 90 дней, LLM-анализ свежих блоков)
- [[02_architecture/data-model]] — добавлены модели `IdeaBlockLink`, `EntityLink` + ER-связи
- API: `GET /api/v1/knowledge/blocks/:id/links`, `GET /api/v1/knowledge/entities/:id/links`, `GET /api/v1/knowledge/graph/neighbors?nodeType=block|entity&id=…&depth=1..3` (BFS, лимит 100 nodes, `truncated=true` при превышении)
- LlmTaskType: добавлен `entity-graph-builder` (`reframing` уже был); seed обновлён

## Заметки по реализации (2026-05-10) — Фаза 4 knowledge-core (только backend, frontend отложен)
- [[01_projects/themes]] — новая сущность `Theme` (AI-кластер блоков, embedding 1536, ветка из 12 delivery, dynamic/status/weight). `ThemeIdeaBlock` (M:M с весом) + `ThemeEntity` (denorm с mentionsCount). Pipeline: `theme-clusterer.cron` (`15 * * * *`) — KNN-greedy union-find (threshold 0.78, minSize 3, гейт `THEME_CLUSTERING_MIN_BLOCKS=100`) + LLM `theme-classify` (JSON Schema strict). Reframing `reflectOnThemes` (themeMerges = перенос связей + status='merged_into', themesToArchive, themeSplits — только лог)
- [[01_projects/cards]] — расширение `Card`: `entityId` (primary) + `relatedEntityIds[]` + `bornFromThemeId` + `cachedTopThemeIds[]`. Новый `card-rollup-v2.worker` (consumer `core.card-rollup-v2`, дебаунс 60s, 5 промптов по `Card.kind`); старый `card-rollup.worker` живёт параллельно до Фаз 5/6
- [[02_architecture/knowledge-core]] — раздел «Темы (Фаза 4)»: theme-clusterer + card-rollup-v2 + reflectOnThemes
- [[02_architecture/data-model]] — добавлены модели `Theme`, `ThemeIdeaBlock`, `ThemeEntity`, расширения `Card` + ER-связи
- API: `GET /api/v1/knowledge/themes` (фильтры branch/status, пагинация), `GET /api/v1/knowledge/themes/:id`, `POST /api/v1/knowledge/themes/:id/save-as-card`, `GET /api/v1/cards/:id/themes`
- RBAC: ResourceType расширен `'theme'` (read для всех member'ов Org, write/delete — owner/admin)
- LlmTaskType: `theme-classify` уже был в seed'е; `card-rollup-v2` тоже; обновление через `--update-existing` не обязательно

## Маркетинг

- [[06_marketing/index]] — навигация по маркетинговому разделу
- [[06_marketing/competitors]] — анализ конкурентов (Fireflies, Otter, Granola, tl;dv и др.)
- [[06_marketing/positioning]] — ценностное предложение, отличия от конкурентов
- [[06_marketing/icp]] — портрет идеального покупателя (ICP)
- [[06_marketing/messaging]] — ключевые сообщения, заголовки, tone of voice
- [[06_marketing/client-value-framework]] — методология клиентской ценности (по Гордееву) + роль Value Officer
- [[06_marketing/company-ontology]] — онтология компании (13 классов сущностей + ~40 типов рёбер, клон сотрудника как subgraph, специфика РФ) — фундамент архитектуры «второго мозга»

## Баги и инциденты (`03_bugs/`)
_пусто_

## Архив (`04_archive/`)
_пусто_

## Инфраструктура агента Claude Code

- `.claude/settings.json` — hooks (PreToolUse: блок `git push main/master`, `rm -rf /`, `DROP TABLE`; Stop: ворнинг про забытый second-brain после коммита в `backend/src` / `frontend/src` / `*.prisma`) + permissions deny для `.env` / секретов / ключей
- `.claude/skills/` — 12 скиллов (Crossmark-портированные + `bulletproof`, `skill-creator`, `frontend-design`); подробности и адаптации — в `plans/tz/2026-05-06-claude-code-infrastructure.md`
- `.mcp.json` — playwright MCP (UI-тесты)

---
_Обновлён: 2026-05-10 (Фаза 4 knowledge-core: Theme + theme-clusterer + card-rollup-v2 + Card.entityId/relatedEntityIds/bornFromThemeId + themes API; backend-only, frontend отложен)_
