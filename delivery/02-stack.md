# 02 — Технологический стек

## Принципы выбора

1. **Open-source с possibility self-host** — обязательное требование для всех компонентов в обязательном пути.
2. **Лицензия позволяет коммерческое использование при self-host** — Apache 2.0, MIT, AGPL допустимы. ELv2, BSL, Commons Clause — запрещены.
3. **Активный maintenance** — последний релиз < 6 мес назад, ответ на issues.
4. **Зрелость на production** — у проекта должен быть хотя бы один публичный production-кейс или ≥1k звёзд GitHub в категории.
5. **Интерпретируемость** — компонент не должен быть «чёрным ящиком», документация раскрывает поведение.

См. [DR-002](14-decisions-log.md#dr-002).

---

## Версии (на старт разработки 2026)

Все версии — **актуальные стабильные** на момент сборки первого релиза. Обновление до мажорных версий — через миграционный план.

---

## Бэкенд

### Языки и runtime

| Компонент | Технология | Версия | Зачем |
|---|---|---|---|
| Основной язык бэкенда | **Python** | 3.12+ | Лучшая экосистема для AI-стека (LangGraph, vLLM, sentence-transformers, llama-index, Graphiti). Производительность достаточна за счёт async + nats для I/O-bound нагрузок. |
| Высоконагруженные сервисы | **Go** | 1.22+ | API Gateway, ingest-приёмники, сервис эмбеддингов (через cgo/onnxruntime) — там, где нужна предсказуемая латентность. |
| Системы с особо горячими путями | **Rust** | 1.75+ | Только для индекса полнотекстового поиска (Tantivy уже на Rust). Своего Rust-кода — минимум. |

Не используем: Node.js на бэкенде (исключение — рендеринг SSR во фронте), Java, Kotlin, .NET, PHP.

### Frameworks

| Компонент | Технология | Зачем |
|---|---|---|
| API Gateway | **FastAPI** + Uvicorn / Caddy reverse proxy | Стандарт de-facto для Python API. Auto-OpenAPI, async, pydantic. |
| Бизнес-сервисы (workers) | **FastAPI** + asyncio + httpx | Тот же стек по горизонтали. |
| Telegram-бот | **aiogram 3.x** | Self-host bot, асинхронный, активная поддержка. |
| Real-time (WebSocket) | **FastAPI WebSocket** + Redis Pub/Sub | Streaming чата с агентом. |

### LLM-оркестрация

| Компонент | Технология | Зачем |
|---|---|---|
| Граф агентов | **LangGraph** (langchain-ai/langgraph) | State machine для агентских workflow. Поддерживает checkpointing, временное путешествие, human-in-the-loop. См. [07-ai-team.md](07-ai-team.md). |
| Маршрутизатор моделей | **LiteLLM** (BerriAI/litellm) | Единый API ко всем провайдерам (Anthropic, OpenAI, Gemini, Ollama, vLLM). Retry, fallback chain, бюджет, кэш. |
| Локальный inference | **vLLM** (для GPU) или **Ollama** (для лёгких setup) | OpenAI-compatible API для локальных моделей. |
| Структурированный вывод | **Instructor** (jxnl/instructor) или Pydantic + tool_use | Принудительная типизация LLM-выхода. |
| Embeddings | **sentence-transformers** + **bge-m3** (мультиязычный, 1024-dim) | Первоклассный мультиязычный эмбеддер с открытой лицензией. Дополнительно — **e5-large** для запросов специализированного типа. |
| Cross-encoder | **bge-reranker-v2-m3** | Финальный rerank после KNN-выборки. |
| Speech-to-text | **WhisperX** (на базе faster-whisper) + **pyannote.audio** | Транскрипция + разделение спикеров. Полностью self-host. |
| Document parsing | **RAGFlow deepdoc** или **Unstructured.io** (в self-host режиме) | Парсинг PDF, Excel, Word с layout-aware подходом. |
| OCR | **PaddleOCR** | Кириллица из коробки. |

### Оркестрация фоновых задач

| Компонент | Технология | Зачем |
|---|---|---|
| Workflow engine | **Temporal.io** (self-host) | Долгоживущие workflow (синтез за месяц, переосмысление, согласование), retry, durable state, time-travel. |
| Лёгкие очереди | **Redis Streams** через **redis-py** или **Saq** | Простые быстрые задачи без durability. |
| Cron-задачи | **Temporal Schedule** | Часовые / суточные / недельные синтезы. |

Не используем: Celery (тяжело отлаживать, нет хорошего durability), Airflow (избыточно для нашей задачи).

### Event bus

| Компонент | Технология | Зачем |
|---|---|---|
| Шина событий | **Redpanda** (Kafka-совместимая, single-binary, BSL-исключение) | **Альтернатива:** Apache Kafka — если BSL у Redpanda окажется проблемой. У Kafka — Apache 2.0. |

**Важно:** Redpanda Community Edition — BSL, и это запрещено по [DR-002](14-decisions-log.md#dr-002). Для первого релиза берём **Apache Kafka 3.7+** (Apache 2.0). Если ресурсы команды позволят, оценить **NATS JetStream** (Apache 2.0) как лёгкую альтернативу. См. [DR-010](14-decisions-log.md#dr-010).

Топики: `ingest.raw.events`, `signals.extracted`, `themes.changed`, `links.proposed`, `insights.published`, `agent.actions`, `metrics.updated`. Ретеншн топиков — 30 дней + архив в MinIO.

---

## Хранилища

| Компонент | Технология | Зачем |
|---|---|---|
| Реляционная БД | **PostgreSQL 16+** | Метаданные, OLTP, JSONB для гибких полей, audit trail, sessions. |
| Векторное хранилище | **pgvector 0.7+** (расширение PostgreSQL) | Эмбеддинги в той же базе, что и метаданные — atomic-обновления. HNSW индекс. Dim 1024 (bge-m3). |
| Граф знаний | **FalkorDB** (RedisGraph fork, активный maintenance, GPL-3) | OpenCypher, sparse matrices, in-memory с durability. **Альтернатива:** Memgraph (BSL — отвергнут), Kuzu (slim community). См. [DR-008](14-decisions-log.md#dr-008). |
| Обёртка временного KG | **Graphiti** (getzep/graphiti) | Temporal context graph поверх FalkorDB. Поддерживает edge-versioning, learned ontology, time-travel запросы. |
| Полнотекстовый поиск | **Tantivy** (через **PyO3** или **Meilisearch**) | Русская морфология, BM25-аналог для гибридного поиска. **Выбираем Meilisearch** (MIT, простой self-host, русский tokenizer). |
| Объектное хранилище | **MinIO** (Apache 2.0) | Бинарные первоисточники (аудио/видео/файлы), снапшоты, экспорт. S3-совместимый API. |
| Кэш и легкие очереди | **Redis 7+** (BSD/SSPL — берём fork **Valkey** для безопасности лицензии) | Кэш LLM-ответов, rate-limit, pub/sub для реального времени. |
| Поиск по аудио (опц.) | **Vespa** (Apache 2.0) | Если потребуется hybrid retrieval с временными фильтрами на больших объёмах — резерв. Не в обязательном пути. |

**Принцип:** все обязательные базы развёртываются через `docker-compose.yml` без managed-сервисов. См. [11-deployment.md](11-deployment.md).

### Зачем такой набор хранилищ

- **PostgreSQL + pgvector** — OLTP + векторы в одной транзакции. Любое изменение сигнала атомарно обновляет и метаданные, и эмбеддинг. Без двухфазного коммита.
- **FalkorDB + Graphiti** — граф связей с временем. Свойства узлов и рёбер хранятся в Redis-структурах FalkorDB, OpenCypher запросы. Graphiti добавляет temporal slice (время жизни рёбра, переосмысление).
- **Meilisearch** — русский морфологический поиск. PostgreSQL FTS уступает Meilisearch на смешанной morpho-кириллице.
- **MinIO** — S3-совместимый интерфейс для будущей миграции в облако (если у клиента появится приватный S3).
- **Valkey** (Redis-fork) — кэш LLM-ответов и pub/sub для streaming chat.

### Маркер `data_class`

Каждая запись в любой базе несёт `data_class ∈ {public, internal, sensitive, private}`. Этот маркер влияет на:
- какие LLM-провайдеры можно использовать при анализе записи (см. [07-ai-team.md](07-ai-team.md));
- кто может читать (см. [08-security-privacy.md](08-security-privacy.md));
- сроки хранения (см. retention policy).

---

## Frontend

| Компонент | Технология | Зачем |
|---|---|---|
| Фреймворк | **Next.js 15+** (App Router) | SSR + клиентская интерактивность, отличная экосистема. |
| Язык | **TypeScript 5+** | Типобезопасность по всему проекту. |
| Стилизация | **Tailwind CSS 4+** | Утилитарный CSS, быстрая разработка. |
| Компоненты | **shadcn/ui** (Radix-based) | Accessible-компоненты, копируем в репо (не зависим от npm-пакета). |
| Чат-интерфейс | **assistant-ui** (Yonom/assistant-ui) или собственный на shadcn | Поддержка streaming, attachments, tool calls, history. |
| Графы и карты | **D3.js v7** + **Cytoscape.js** | Визуализация графа знаний, карты компании. |
| Голосовой ввод | **MediaRecorder API** + WSS-стрим в WhisperX | Браузерный голос → сервер → транскрипция → ответ. |
| Глобальное состояние | **Zustand** | Лёгкий, предсказуемый. |
| Формы (только админка) | **React Hook Form** + **Zod** | Только для админ-панели — **в основном UI форм нет.** |
| Графики | **Recharts** или **VisX** | Дашборд с метриками. |
| Локализация | **next-intl** | Базовый русский, опционально английский для внутренней техкоманды. |
| Богатый текст | **TipTap** | Если нужен редактор для wiki — но в основном UI пишет AI. |

### Принципы фронта

- **Никаких форм с кнопками выбора категории.** Любой ввод — свободный текст или голос. См. [06-ux-ui.md](06-ux-ui.md).
- **Streaming везде, где можно.** Любой LLM-ответ показывается частями.
- **Server components по умолчанию.** Клиентская часть — только там, где нужна интерактивность.
- **Доступность (a11y) обязательна.** WCAG AA, скринридеры, навигация с клавиатуры.
- **Mobile-first.** Большинство сотрудников работают с телефона.

---

## RBAC и аутентификация

| Компонент | Технология | Зачем |
|---|---|---|
| Identity provider | **Keycloak** (self-host) | OIDC, SSO с Active Directory / LDAP / OAuth, MFA. |
| Policy engine | **OpenFGA** (Apache 2.0) | Zanzibar-модель, идеально ложится на 3 измерения нашей ролевой модели. |
| Fallback policy engine | **Casbin** | Если OpenFGA не пройдёт PoC по latency — переключаемся. |
| Secrets management | **HashiCorp Vault** (BSL — отвергнут!) → **OpenBao** (Apache 2.0 fork от Vault) | Хранение API-ключей, db-паролей, encryption keys. |

См. [DR-006](14-decisions-log.md#dr-006), [DR-007](14-decisions-log.md#dr-007), [08-security-privacy.md](08-security-privacy.md).

---

## Observability

| Компонент | Технология | Зачем |
|---|---|---|
| Logs | **Loki** (Grafana Labs, AGPL-3) | Структурированные логи всех сервисов. |
| Metrics | **Prometheus** (Apache 2.0) | Метрики бизнеса и инфраструктуры. |
| Traces | **Jaeger** (Apache 2.0) или **Tempo** (AGPL-3) | Распределённый трейсинг. |
| LLM observability | **Langfuse** (self-host, MIT) | Промпты, ответы, токены, цена, латентность, оценки качества. |
| Дашборды | **Grafana** (AGPL-3) | UI для всех метрик. |
| Алертинг | **Alertmanager** + Telegram bot | Уведомления админу. |
| Sentry-альтернатива | **GlitchTip** (MIT, self-host) или **Sentry self-hosted** (BSL — отвергнут) | Сбор фронтенд/бэкенд ошибок. |

Стандарт инструментации — **OpenTelemetry**. Все сервисы экспортируют traces/logs/metrics через OTel collector → Tempo/Loki/Prometheus.

См. [09-observability.md](09-observability.md).

---

## DevOps и деплоймент

| Компонент | Технология | Зачем |
|---|---|---|
| Контейнеры | **Docker** + **Docker Compose** (для small/medium клиентов) | Single-server deployment до 100 сотрудников клиента. |
| Оркестратор (большие клиенты) | **Kubernetes** (любой self-host: kubeadm, k3s, Rancher) | Для клиентов 200+ сотрудников. |
| Чарты | **Helm 3+** | Helm charts на каждый компонент. |
| CI/CD | **Gitea Actions** (self-host, MIT) или **Forgejo Actions** | GitHub Actions-совместимое, self-host. |
| Реестр контейнеров | **Harbor** (Apache 2.0) | Privacy-first registry, уязвимости, signing. |
| Reverse proxy / TLS | **Caddy** (Apache 2.0) | Auto HTTPS, простой конфиг. |
| Резервные копии | **Restic** (BSD-2) | Шифрованные incremental-бэкапы PostgreSQL/MinIO/FalkorDB. |
| Мониторинг хостов | **Netdata** (GPL-3) | Метрики серверов, дисков, сети. |

См. [11-deployment.md](11-deployment.md).

---

## Тестирование

| Уровень | Технология |
|---|---|
| Unit | **pytest** (Python), **Go test** (Go), **Vitest** (frontend) |
| Integration | **pytest** + Testcontainers (PostgreSQL/Kafka/FalkorDB в Docker) |
| E2E | **Playwright** для UI, **pytest** + **httpx** для API |
| Load | **k6** (Apache 2.0) или **Locust** |
| AI-quality | **Promptfoo** (MIT, self-host) + собственный golden-set |
| Mutation testing | **mutmut** (для критических модулей) |
| Контрактные тесты API | **Schemathesis** (на основе OpenAPI) |
| Проверка миграций | **pytest-alembic** |

См. [10-testing.md](10-testing.md).

---

## Безопасность

| Компонент | Технология | Зачем |
|---|---|---|
| SAST | **Bandit** (Python), **gosec** (Go), **eslint-plugin-security** (JS) | Статический анализ. |
| SCA | **OSV-Scanner** (Apache 2.0) | Уязвимости в зависимостях. |
| DAST | **OWASP ZAP** | Динамическое тестирование API. |
| Secrets scanner | **Gitleaks** | Поиск утёкших ключей в коммитах. |
| Container scanner | **Trivy** | Уязвимости образов Docker. |
| WAF | **Caddy** + **Coraza** (OWASP CRS) | Web application firewall на уровне reverse proxy. |
| Шифрование at-rest | **PostgreSQL TDE** (через Cybertec patch) или LUKS на уровне диска | Шифрование томов. |
| Шифрование in-transit | **Caddy** + **mTLS** между сервисами (Service Mesh опционально через Linkerd) | TLS везде. |

См. [08-security-privacy.md](08-security-privacy.md).

---

## Маршрутизация LLM (LiteLLM конфиг)

Маршрутизация моделей реализуется через LiteLLM с тремя политиками:

### Политика 1 — публичные данные, разрешён внешний LLM

```yaml
model_list:
  - model_name: smart-default
    litellm_params:
      model: anthropic/claude-sonnet-4-6
      api_key: ${ANTHROPIC_API_KEY}
  - model_name: smart-default
    litellm_params:
      model: openai/gpt-4o
      api_key: ${OPENAI_API_KEY}
  - model_name: smart-default
    litellm_params:
      model: gemini/gemini-2.0-pro
      api_key: ${GEMINI_API_KEY}
router_settings:
  routing_strategy: latency-based
  fallbacks:
    - smart-default: [smart-local]
```

### Политика 2 — внутренние данные, разрешён внешний LLM с консентом компании

То же, что Политика 1, но через прокси с логированием и opt-out на уровне записи.

### Политика 3 — sensitive / private, только локальный LLM

```yaml
  - model_name: smart-local
    litellm_params:
      model: ollama/qwen2.5:72b-instruct
      api_base: http://vllm:8000
  - model_name: smart-local
    litellm_params:
      model: ollama/llama-3.3-70b-instruct
      api_base: http://vllm:8001
```

Маршрутизация выбирается по `data_class` записи. См. [07-ai-team.md](07-ai-team.md), раздел «Политика маршрутизации».

### Бюджеты и кэш

- Лимит на тенант в сутки: настраиваемый, дефолт 100 000 ₽ / мес.
- Кэширование ответов: ключ = `sha256(prompt + model + params)`, TTL 24 часа для повторов.
- Semantic cache (vector-similarity > 0.95) для FAQ-style запросов.

---

## Внешние сервисы (опциональные)

Эти сервисы — **не обязательны**, но могут быть включены клиентом:

| Сервис | Когда использовать | Запасной путь self-host |
|---|---|---|
| Anthropic Claude API | Лучшее качество анализа | Llama 3.3 70B + Qwen 2.5 72B |
| OpenAI API | Альтернатива при недоступности Claude | То же |
| Google Gemini | Альтернатива | То же |
| AssemblyAI / Deepgram | Если WhisperX не справляется по качеству на специфических доменах | WhisperX — обязательный fallback |
| Sentry SaaS | Если клиент уже использует | GlitchTip self-host |

---

## Запрещённые компоненты

Список того, что **не используем** в дефолтной конфигурации:

- **Pinecone, Weaviate Cloud, Chroma Cloud** — managed-only, нарушают self-host.
- **Auth0, Supabase, Firebase, Clerk** — managed identity, нарушают self-host.
- **OpenAI Embeddings как единственный путь** — должен быть локальный fallback (bge-m3).
- **Snowflake, BigQuery, Redshift** — managed warehouse, не нужны (PostgreSQL хватает на нашем размере).
- **Datadog, New Relic** — observability SaaS, нарушают self-host.
- **AWS-only services** (DynamoDB, ElasticBeanstalk и т.п.) — vendor lock-in.
- **Sentry self-hosted** — лицензия BSL, запрещена.
- **Hashicorp Vault** — лицензия BSL с 2023, заменяется OpenBao.
- **MongoDB Atlas, Redis Cloud, Elastic Cloud** — managed.
- **Российские LLM (YandexGPT, GigaChat, Sber-сервисы)** — исключены по качеству. Может быть включён по запросу клиента, но не в default.
- **MS SQL Server / Oracle** — vendor lock, дорогие лицензии. PostgreSQL покрывает наши задачи.
- **Любые компоненты с лицензиями ELv2, BSL, Commons Clause, SSPL** — кроме случаев, когда есть Apache/MIT-fork.

---

## Совокупная картина (one-page summary)

```
┌──────────────────────────────────────────────────────────────────┐
│                    ВНЕШНИЙ ПЕРИМЕТР                              │
│   Caddy (TLS, WAF) ──→ Keycloak (Auth) ──→ FastAPI (API GW)     │
└──────────────────────────────────────────────────────────────────┘
                              │
   ┌──────────────────────────┼──────────────────────────────┐
   │                          │                              │
   ↓                          ↓                              ↓
┌──────────┐            ┌──────────────┐              ┌──────────────┐
│ Frontend │            │ Бизнес-сервисы│              │  AI-команда  │
│ Next.js  │            │  Python /     │              │  LangGraph + │
│ Tailwind │            │  FastAPI      │              │  LiteLLM     │
└──────────┘            └─────┬────────┘              └──────┬───────┘
                              │                              │
                  ┌───────────┼──────────────────────────────┤
                  ↓           ↓           ↓          ↓       ↓
            ┌─────────┐ ┌──────────┐ ┌────────┐ ┌──────┐ ┌──────────┐
            │PostgreSQL│ │ FalkorDB │ │MinIO   │ │Valkey│ │vLLM/Ollama│
            │+pgvector │ │+Graphiti │ │ S3-API │ │Redis │ │ Локальные │
            │          │ │          │ │        │ │      │ │ LLM       │
            └──────────┘ └──────────┘ └────────┘ └──────┘ └───────────┘

            ┌──────────────────────────────────────────────────────┐
            │  Apache Kafka — event bus                            │
            │  Temporal — durable workflows                        │
            │  Meilisearch — полнотекстовый поиск (русский)        │
            │  Langfuse + Loki + Prometheus + Jaeger — observ.     │
            │  OpenFGA — RBAC                                      │
            │  OpenBao — секреты                                   │
            └──────────────────────────────────────────────────────┘
```

---

## Что **не** включено в стек, но обсуждалось

- **Neo4j** — отвергнут: BSL/коммерческая лицензия для Enterprise edition. Community edition — слабая для нашей задачи.
- **Memgraph** — отвергнут: BSL.
- **Kuzu** — отвергнут: малое community, риск заглохнуть.
- **Pinecone, Weaviate** — нарушают self-host.
- **Vector + Loki** для логов — Vector хорош, но Loki сам справляется. Vector добавим, если потребуется агрегация из >50 источников.
- **Linkerd / Istio** — service mesh не обязателен для single-instance deployment. Может быть добавлен в k8s-сценарии.

---

## Ссылки в пакете

- Архитектура: [01-architecture.md](01-architecture.md)
- Схемы данных: [05-data-schema.md](05-data-schema.md)
- AI-команда и маршрутизация: [07-ai-team.md](07-ai-team.md)
- Безопасность: [08-security-privacy.md](08-security-privacy.md)
- Deployment: [11-deployment.md](11-deployment.md)
- Журнал решений: [14-decisions-log.md](14-decisions-log.md)
