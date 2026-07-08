export const meta = {
  name: 'kora-product-audit-three-lenses',
  description: 'Аудит продукта Кора с трёх линз (продукт/UX, инженерия, AI-ядро) с состязательной верификацией находок',
  phases: [
    { title: 'Аудит', detail: '13 параллельных аудиторов по трём линзам' },
    { title: 'Верификация', detail: 'состязательная проверка P0/P1 находок' },
  ],
}

const ROOT = '/Users/sergrvmz/Documents/kora'

const COMMON = `Ты — аудитор продукта «Кора» (репозиторий ${ROOT}). Работай ТОЛЬКО в режиме чтения — ничего не изменяй.

КОНТЕКСТ ПРОДУКТА (важно для приоритизации):
- Кора = «AI операционный директор» для малого/среднего бизнеса 40–80 человек (стратегический разворот 2026-06-29). Память компании / граф знаний / клоны — движок под капотом, витрина — контроль компании собственником.
- Killer-экран — «День компании» (утренний брифинг собственника). Метрика месяца: сколько собственников открывают его 5 рабочих дней подряд.
- Прод — ранний пилот, волна 40–100 реальных пользователей. Цена — ~60 000 ₽/мес за компанию.
- Стек: NestJS 11 + Prisma 7 + PostgreSQL (pgvector + Apache AGE) + Redis/BullMQ + Next.js 14 App Router + React 19. Рантайм Bun. Python в backend/ запрещён.
- Правила дома: крутилки в AdminSetting (не ENV, не магические константы); Ship-On (нельзя «выкатить выключенным»); LLM-роутинг DeepSeek → gpt-5.x → kie/gemini (Anthropic не закупается; smart-модели отфильтровываются на private-данных).

ИНСТРУМЕНТЫ: инструменты Grep/Glob могут быть ЗАБЛОКИРОВАНЫ хуком (vexp). Используй Bash (find, ls, wc) и Read. Вывод Bash-grep может быть искажён хуком — используй его только как подсказку и ВСЕГДА подтверждай цитату через Read перед тем как сослаться на file:line.

ТРЕБОВАНИЯ К НАХОДКАМ:
- 5–10 находок максимум. Качество важнее количества. Каждая находка = конкретная проблема + конкретное предложение.
- Каждое утверждение о коде — с доказательством: путь файла + строки + короткая цитата (≤3 строк), проверенная через Read.
- severity: P0 = прямо сейчас ломает ценность/деньги/данные/ритуал собственника; P1 = существенно ухудшает продукт; P2 = улучшение.
- Для каждого предложения: почему оно ЛУЧШЕЕ (сравни минимум с 2 альтернативами в поле alternatives), и объяснение простым человеческим языком (поле plain) — как для владельца бизнеса без кода.
- code_example — только если реально помогает (≤30 строк, TypeScript в стиле проекта, без комментариев в коде).
- ПРОВЕРЬ ИЗВЕСТНОЕ: перед включением находки посмотри реестр second-brain/04_не-сделано/README.md и plans/tz/ — если проблема уже описана/запланирована, укажи ссылку в поле known и включай её ТОЛЬКО если добавляешь новое (лучшее решение, новый приоритет, доказательство что план не закрывает корень).
- Пиши всё по-русски. Твой финальный ответ — только структурированные данные (StructuredOutput), не сообщение человеку.`

const FINDINGS = {
  type: 'object',
  required: ['summary', 'findings'],
  properties: {
    summary: { type: 'string', description: 'Резюме состояния области 5-10 предложений: что хорошо, что плохо, главный вывод' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'severity', 'problem', 'plain', 'proposal', 'why_best'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          severity: { enum: ['P0', 'P1', 'P2'] },
          evidence: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, lines: { type: 'string' }, quote: { type: 'string' } } } },
          problem: { type: 'string', description: 'Техническое описание проблемы' },
          plain: { type: 'string', description: 'Простым человеческим языком для владельца: что это значит для бизнеса' },
          proposal: { type: 'string', description: 'Конкретное предложение что сделать' },
          why_best: { type: 'string', description: 'Почему это лучшее решение' },
          alternatives: { type: 'string', description: 'Какие альтернативы рассмотрены и почему хуже' },
          effort: { type: 'string', description: 'Оценка объёма: часы/дни/недели' },
          code_example: { type: 'string' },
          known: { type: 'string', description: 'Ссылка на существующий план/реестр если проблема уже известна' },
        },
      },
    },
  },
}

const VERDICT = {
  type: 'object',
  required: ['evidence_ok', 'proposal_verdict', 'notes'],
  properties: {
    evidence_ok: { type: 'boolean', description: 'Доказательства подтвердились при независимой проверке кода/источников' },
    proposal_verdict: { enum: ['confirm', 'improve', 'reject'] },
    notes: { type: 'string', description: 'Что подтвердилось, что нет, по-русски' },
    improved_proposal: { type: 'string', description: 'Если improve — улучшенное предложение' },
  },
}

const AUDITS = [
  {
    key: 'market',
    lens: 'Продукт/рынок/UX',
    prompt: `РОЛЬ: продуктовый аналитик рынка. Задача: где Кора отстаёт от рынка и какие боли ЦА (собственник бизнеса 40–80 человек, РФ) не закрыты.
Используй WebSearch/WebFetch АКТИВНО (10+ поисков). Исследуй две группы конкурентов:
(1) РФ: mymeet.ai, НаВстрече, Контур.Толк, SberJazz, MTS Link, TEAMLY, Kaiten, WEEEK, Битрикс24 CoPilot, Aspro.Agile и другие найденные;
(2) Мир: Fireflies, Otter, Fathom, tl;dv, Granola, Limitless, Glean, Dust, Notion AI, ClickUp Brain, Lindy, стартапы категории "AI chief of staff / AI COO".
Для контекста Коры прочитай: second-brain/06_marketing/2026-06-29-strategy-session-aicoo-smb-pricing.md, second-brain/02_architecture/chief-of-staff-capability-map.md, plans/analysis/2026-06-11-kora-moat-and-competitive-defensibility.md, plans/analysis/2026-06-11-istok-ai-competitor-teardown.md (учти — им месяц, рынок мог сдвинуться).
Находки = продуктовые пробелы/возможности: чего у конкурентов/на рынке есть или что болит у ЦА, а Кора не даёт; где Кора рискует быть скопированной; что усилит ров. evidence = ссылки на источники (в поле file пиши URL). Особый фокус: (а) фичи, повышающие ежедневный ритуал собственника; (б) фичи, снижающие холодный старт (пустой граф в первые недели); (в) ценовая упаковка.`,
  },
  {
    key: 'ux',
    lens: 'Продукт/рынок/UX',
    prompt: `РОЛЬ: UX-аудитор. Задача: аудит интерфейса кабинета по коду фронтенда — где пользователь теряется, где интерфейс врёт или молчит.
Сначала прочитай прошлые аудиты (что уже известно/исправлено): plans/analysis/2026-06-12-product-audit-cabinet-ui-dashboards.md, plans/analysis/2026-06-15-qa-cabinet-full-test-bugs.md, plans/analysis/2026-06-16-knowledge-base-ux-and-formatter.md.
Затем систематически пройди код: frontend/app/(authenticated)/ — перечисли все страницы (find), выбери 12–15 ключевых для ЦА-собственника (dashboard, day/week/month, chat, tasks, meetings, decisions, insights, clones, onboarding, settings) и прочитай их + связанные компоненты из frontend/src/ui.
Ищи по чек-листу: (1) пустые состояния — что видит новичок с пустым графом в первые 2 недели, есть ли объяснение «почему пусто и что сделать»; (2) состояния загрузки/ошибок — молчаливые падения, вечные спиннеры; (3) глубина навигации до ключевой ценности; (4) мобильная пригодность (собственник живёт в телефоне); (5) честность UI — кнопки/цифры, за которыми нет данных; (6) перегруз навигации (сколько пунктов меню видит собственник, что из них реально живое); (7) онбординг → время до первой ценности.`,
  },
  {
    key: 'strategy-fit',
    lens: 'Продукт/рынок/UX',
    prompt: `РОЛЬ: продуктовый стратег. Задача: разрыв между стратегией (AI операционный директор, ритуал «День компании») и фактическим продуктом — что блокирует метрику месяца.
Прочитай полностью: second-brain/06_marketing/2026-06-29-strategy-session-aicoo-smb-pricing.md, second-brain/02_architecture/chief-of-staff-capability-map.md, plans/analysis/2026-07-05-chief-of-staff-gap-map.md, second-brain/04_не-сделано/README.md (большой — читай кусками), docs/operations/feature-flags.md.
Проверь по коду ключевые утверждения (не верь докам на слово): (1) список «мёртвого груза» из capability-map — действительно ли Orchestrator/GEPA/WeeklyGoalsPulseDigest и др. выключены (найди флаги в коде/сиде); (2) «День компании» — доставляется ли в Telegram собственнику или только веб; (3) порог reasoning-блоков для клонов — починен ли (стратегия требовала); (4) потоки наполнения (ChatBox, Mango, email/IMAP, Telegram) — что реально включено.
Находки = топ-разрывы «стратегия сказала — продукт не делает», ранжированные по влиянию на ритуал собственника и на наполнение графа. Предложи последовательность закрытия (что раньше чего и почему).`,
  },
  {
    key: 'kc-reliability',
    lens: 'Инженерия',
    prompt: `РОЛЬ: senior backend-ревьюер. Задача: надёжность конвейера knowledge-core — главного актива продукта (потеря данных здесь = потеря памяти компании клиента).
Область: backend/src/modules/knowledge-core/ (воркеры, сервисы), backend/src/modules/core-queue/, backend/src/modules/ingest/. Начни с find по этим папкам, выбери 15–20 ключевых файлов (ingest, block-ingest, distill, link, specialist-routing, DLQ, cron'ы).
Контекст известного: plans/tz/2026-06-20-knowledge-core-silent-loss-reliability.md, plans/analysis/2026-06-22-ingestion-spine-unification-audit.md, plans/tz/2026-07-01-package-d-reliability-observability.md.
Ищи: (1) тихую потерю данных — catch без re-throw/DLQ/метрики, обрыв цепочки без следа; (2) неидемпотентность — повторный запуск джобы дублирует блоки/сущности/связи; (3) отсутствие транзакций на multi-write; (4) race conditions (debounce, параллельные воркеры одного tenant); (5) устойчивость к невалидному LLM-JSON; (6) застревающие статусы (нет reconcile/timeout sweep); (7) необработанные ошибки эмбеддингов. Для каждой P0/P1 — короткий сценарий отказа: какие входные данные → что теряется.`,
  },
  {
    key: 'chat-eng',
    lens: 'Инженерия',
    prompt: `РОЛЬ: senior backend-ревьюер. Задача: качество кода и архитектуры чат-контура — вторая по важности поверхность после «Дня компании».
Область: backend/src/modules/chat-v2/, concierge/, dialog-layer/, messaging/, conversational/, chat/ (legacy — оцени, мёртв ли и сколько кода держит). Начни с find, выбери ключевые сервисы.
Контекст: plans/analysis/2026-06-27-edinyy-master-chat-surface-state.md, plans/analysis/2026-06-25-telegram-concierge-classifier-arch.md; известная боль — «помощник временно недоступен» = llm_error в concierge.process, KIE timeout 60с при синтезе ~50с.
Ищи: (1) дублирование логики между chat-v2/concierge/dialog-layer/messaging — сколько параллельных путей ответа на вопрос пользователя, риск расхождения; (2) таймауты/ретраи/фолбэки LLM-вызовов — где пользователь получает «недоступен» вместо деградации; (3) обработку длинных диалогов (контекст, TTL, память); (4) streaming — есть ли, если нет, сколько секунд пользователь ждёт молча; (5) состояние гонки при параллельных сообщениях; (6) мёртвый код legacy chat/. Предложения — с учётом что чат должен работать в web + Telegram единообразно.`,
  },
  {
    key: 'clones-eng',
    lens: 'Инженерия',
    prompt: `РОЛЬ: senior backend-ревьюер. Задача: качество кода контура клонов и материализации опыта.
Область: backend/src/modules/clones/, knowledge-clone/, practice-skills/, task-solutions/, skills/. Плюс свежие правки: backend/src/modules/knowledge-core/services/task-solution-build.service.ts (и .spec).
Контекст известного (НЕ переоткрывай, добавляй новое): plans/analysis/2026-07-03-clone-construction-fragility.md, plans/analysis/2026-06-30-employee-clone-build-audit-and-risk-solutions.md, plans/analysis/2026-07-08-task-solution-materializer-weakness-audit.md, plans/tz/2026-07-08-task-solution-real-defects.md.
Ищи: (1) хрупкость сборки клона — пороги, зависимости от редких данных, места где клон молча не строится; (2) авто-мерж клонов/персон — риск слияния разных людей (известный прод-риск, проверь текущее состояние кода); (3) идемпотентность rebuild; (4) качество кода task-solution-build (свежий, в работе); (5) наблюдаемость — поймёт ли админ, почему у сотрудника нет клона. Для каждой находки — сценарий на проде с 40–100 юзерами.`,
  },
  {
    key: 'meetings-eng',
    lens: 'Инженерия',
    prompt: `РОЛЬ: senior backend-ревьюер. Задача: надёжность контура встреч — от комнаты до отчёта и графа (первая рабочая вертикаль, источник топлива для графа).
Область: backend/src/modules/meetings/, livekit/, recordings/, meeting-reports/, meeting-uploads/, participants/. Начни с find, выбери FSM встречи, webhooks, egress, пайплайн отчёта.
Контекст: plans/tz/2026-06-03-meeting-recording-reliability.md, plans/tz/2026-06-06-recording-pipeline-reliability-reconcile.md, second-brain/02_architecture/code-pitfalls.md (ловушки LiveKit/Egress).
Ищи: (1) сценарии потери записи/транскрипта — webhook не пришёл, egress упал, S3 недоступен: есть ли reconcile и заметит ли кто-то; (2) застревание встречи в промежуточном статусе; (3) идемпотентность обработки webhook (повторы LiveKit); (4) двойной импорт задач из встречи; (5) гостевой доступ — токены, утечки; (6) очередь ASR — что при недоступности провайдера. Для P0 — сценарий отказа: встреча прошла → что потерял клиент.`,
  },
  {
    key: 'cross-cutting',
    lens: 'Инженерия',
    prompt: `РОЛЬ: архитектор-ревьюер. Задача: сквозные инженерные риски всего backend.
Область: backend/src/common/ (config, prisma, redis, filters, interceptors), backend/src/modules/rbac/, orgs/, backend/prisma/schema.prisma (~1.7к строк — читай кусками, ищи паттерны).
Проверь: (1) изоляция тенантов — выборочно возьми 10 разных сервисов из разных модулей (Bash find + Read) и проверь, что каждый query фильтрует по tenantId; особо — raw SQL ($queryRaw) и поиск по embedding; (2) транзакционность multi-write операций (выборочно); (3) единообразие обработки ошибок (AllExceptionsFilter vs локальные catch); (4) схема Prisma: отсутствующие индексы под частые выборки, Json-поля где нужны таблицы, отсутствие onDelete-политик; (5) покрытие тестами: посчитай spec-файлы против сервисов (Bash find | wc -l), где ноль тестов в критичных местах; (6) метрики/алерты — по каким сбоям прод молчит. Плюс: оцени количество модулей (~100) — где границы модулей неправильные (циклические импорты, god-modules).`,
  },
  {
    key: 'frontend-eng',
    lens: 'Инженерия',
    prompt: `РОЛЬ: senior frontend-ревьюер. Задача: качество архитектуры фронтенда.
Область: frontend/src/ (api, domain, ui, hooks, contexts, lib), frontend/app/. Правило проекта: слои ApiDto → DomainModel → UiModel, единый api-client, SWR.
Проверь: (1) соблюдение слоёв — выборочно 10 страниц: где компоненты дёргают api напрямую мимо domain-мапперов, где ApiDto протекает в UI; (2) дублирование — одинаковые компоненты/хуки написанные заново (find по похожим именам); (3) размер и связность: самые большие файлы (find + wc -l, топ-20) — god-компоненты; (4) обработка ошибок API — что видит пользователь при 500/timeout, есть ли глобальный паттерн; (5) состояние: где SWR-ключи несогласованы (одни данные под разными ключами → рассинхрон после мутаций); (6) производительность: клиентские компоненты там где можно server, тяжёлые ре-рендеры на дашбордах. Топ-находки с примерами рефакторинга.`,
  },
  {
    key: 'extraction-ai',
    lens: 'AI-ядро',
    prompt: `РОЛЬ: AI/LLM-инженер. Задача: качество конвейера извлечения знаний (сырьё → IdeaBlock/Entity/связи/темы) против лучших практик индустрии (GraphRAG, extraction pipelines).
Сначала прочитай итоги своих же прошлых работ: plans/analysis/2026-06-30-extraction-best-architecture-FINAL-technical.md, plans/analysis/2026-07-03-extraction-consolidation-f0-diagnosis.md, plans/analysis/2026-07-03-strela-extraction-fidelity-results.md, second-brain/02_architecture/knowledge-core.md.
Потом код: backend/src/modules/knowledge-core/ — извлечение (block-ingest/extractors), дедуп/консолидация Entity, построение рёбер графа, темы; промпты (prompt registry — найди где живут тексты промптов extraction-агентов).
Оцени: (1) что из «best architecture FINAL» реально внедрено, что зависло; (2) качество промптов извлечения против методологии docs/methodology/prompts/README.md; (3) дедуп Entity — остаточные риски дублей/ложных слияний (люди!); (4) полнота извлечения — где сигнал теряется (chunking, пороги confidence, фильтры); (5) стоимость — где лишние LLM-вызовы. Сравни с лучшими практиками (можешь WebSearch по GraphRAG/entity resolution 2025-2026). Предложения — конкретные, с оценкой влияния на recall/precision.`,
  },
  {
    key: 'retrieval-ai',
    lens: 'AI-ядро',
    prompt: `РОЛЬ: AI/RAG-инженер. Задача: качество поиска/ретрива для чата и агентов — «мозг отвечает правильно» это ретрив.
Сначала прочитай: plans/analysis/2026-07-03-recall-to-99-MASTER-roadmap.md, plans/analysis/2026-07-02-recall-master-poisk-kak-rabotaet.md, plans/analysis/2026-07-03-recall-ceiling-hypotheses.md, plans/tz/2026-07-04-retrieval-base-recall-floor.md, plans/tz/2026-07-02-recall-master-retrieval-redesign.md.
Потом код: backend/src/modules/search/, dialog-layer/, knowledge-core (retrieval-сервисы) — найди фактическую реализацию: гибрид (вектор+FTS+граф), RRF, staged retrieval, роутер запросов, судья достаточности.
Оцени: (1) что из roadmap «recall to 99» внедрено, где сейчас потолок и почему; (2) соответствие лучшим практикам 2026 (hybrid + rerank: где reranker? query decomposition? HyDE? температурная/временная фильтрация); (3) какие классы вопросов собственника гарантированно проваливаются (агрегации «сколько», временные «что изменилось за неделю», отрицания); (4) latency-бюджет цепочки — сколько LLM-хопов до ответа; (5) есть ли автоматический eval ретрива (ruler) и гоняется ли регулярно. Предложения с оценкой влияния на recall/latency/стоимость.`,
  },
  {
    key: 'clones-ai',
    lens: 'AI-ядро',
    prompt: `РОЛЬ: AI-инженер. Задача: методологическая оценка построения клонов сотрудников — правильно ли устроен сам метод (не код, а подход).
Прочитай: second-brain/01_projects/clone-how-it-works.md, second-brain/01_projects/skill-and-clone.md, plans/analysis/2026-06-11-clone-depth-and-persona-method.md, plans/analysis/2026-07-05-clone-baseline-findings.md, plans/analysis/2026-07-03-employee-clone-expert-answer-audit.md, plans/analysis/2026-07-06-employee-stand-persona-research.md. Стенды: docs/testing/clone-stand-runs/ (посмотри последние judged-результаты).
Оцени метод против сути обещания «знания не уходят с людьми»: (1) достаточность источника — клон кормится только reasoning-блоками со встреч: какая доля реальных знаний сотрудника туда попадает, что метод принципиально НЕ захватывает (переписки, документы, код, артефакты работы); (2) пороги (5 блоков → кластер 3 → черта) — обоснованы ли, что говорят стенды; (3) может ли клон отвечать «как человек» без стиля/ценностей/контекста роли; (4) как индустрия строит digital twin/persona (WebSearch: employee digital twin, persona modeling 2025-2026); (5) честность продукта — что показывать, пока клон пустой. Предложи лучший метод сборки клона при реальных данных SMB (мало встреч, много переписок).`,
  },
  {
    key: 'eval-ai',
    lens: 'AI-ядро',
    prompt: `РОЛЬ: AI quality-инженер. Задача: оценить инфраструктуру измерения качества AI (стенды/evals) — без неё улучшения слепые.
Область: backend/scripts/regulation-stand/ (свежие правки в работе), docs/testing/ (regulation-stand-*, task-stand-runs, clone-stand-runs, regulation-stand-ruler.json, regulation-stand-manifest.json), plans/tz/2026-07-03-recall-eval-ruler.md, plans/tz/2026-06-06-agent-quality-golden-harness.md, plans/analysis/2026-07-06-probe-prod-reality-vs-stand.md.
Оцени: (1) покрытие — какие AI-контуры имеют стенд (клоны, регламенты, задачи, recall), какие НЕТ (День компании! чат! извлечение сущностей? probe?); (2) методология судейства — LLM-judge: какая модель судит, есть ли смещение «сам себя хвалит», есть ли калибровка на человеческих оценках; (3) регулярность — стенды гоняются руками или в CI/cron; регрессии ловятся ДО прода?; (4) репрезентативность данных стендов против реального прода (известная боль: стенд ≠ прод); (5) метрики в проде — есть ли онлайн-сигналы качества (thumbs up/down, доля «не знаю», доля llm_error). Предложи минимальный eval-контур для ритуала «День компании» — главного экрана без измерения качества.`,
  },
]

function verifyPrompt(a, f) {
  return `Ты — независимый скептик-верификатор в репозитории ${ROOT} (только чтение). Твоя задача ОПРОВЕРГНУТЬ находку аудита, если она слабая, и УЛУЧШИТЬ предложение, если оно не лучшее.

Находка из аудита «${a.key}» (линза «${a.lens}»):
${JSON.stringify(f, null, 2)}

Шаг 1 — проверь доказательства: если evidence ссылается на файлы репозитория — открой их через Read и проверь, что цитаты реальны и интерпретация верна (учитывай контекст вокруг цитаты — возможно проблема уже решена рядом). Если evidence = URL/рыночные утверждения — проверь логику и при необходимости WebSearch. Инструменты Grep/Glob могут быть заблокированы хуком — используй Bash find/ls + Read.
Шаг 2 — атакуй предложение: есть ли решение проще/дешевле/надёжнее? Не нарушает ли оно правила дома (стек Bun/TS/NestJS/Prisma, крутилки в AdminSetting, Ship-On, LLM без Anthropic, прод 40-100 юзеров, ЦА собственник 40-80 чел)? Не решается ли проблема уже существующим планом (проверь second-brain/04_не-сделано/README.md и plans/tz/ по теме)?
Шаг 3 — вердикт: confirm (доказано и предложение лучшее) / improve (проблема реальна, предложение улучшил — заполни improved_proposal) / reject (доказательства не подтвердились или проблема не существенна — объясни в notes).
Отвечай по-русски через StructuredOutput.`
}

phase('Аудит')
const results = await pipeline(
  AUDITS,
  a => agent(COMMON + '\n\nТВОЯ ОБЛАСТЬ:\n' + a.prompt, { label: 'audit:' + a.key, phase: 'Аудит', schema: FINDINGS }),
  (res, a) => {
    if (!res) return null
    const findings = (res.findings || []).map((f, i) => ({ ...f, id: f.id || a.key + '-' + (i + 1) }))
    const toVerify = findings.filter(f => f.severity !== 'P2').slice(0, 6)
    if (!toVerify.length) return { key: a.key, lens: a.lens, summary: res.summary, findings }
    return parallel(toVerify.map(f => () =>
      agent(verifyPrompt(a, f), { label: 'verify:' + f.id, phase: 'Верификация', schema: VERDICT })
        .then(v => ({ id: f.id, verdict: v }))
    )).then(vs => {
      const byId = {}
      vs.filter(Boolean).forEach(x => { byId[x.id] = x.verdict })
      return { key: a.key, lens: a.lens, summary: res.summary, findings: findings.map(f => byId[f.id] ? { ...f, verdict: byId[f.id] } : f) }
    })
  }
)

const done = results.filter(Boolean)
log('Аудит завершён: ' + done.length + '/12 областей, находок всего: ' + done.reduce((n, r) => n + r.findings.length, 0))
return done