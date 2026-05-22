// =================================================================
// Второй мозг для компаний — схема графа знаний (FalkorDB / Cypher)
// Версия: 1.0
// Дата: 2026-05-10
// =================================================================
// Полное описание — в delivery/05-data-schema.md
// Применяется при инициализации тенанта.
// =================================================================

// FalkorDB не поддерживает CREATE CONSTRAINT в полном объёме как Neo4j,
// поэтому валидация типов делается на уровне приложения через Graphiti.

// =================================================================
// Индексы
// =================================================================
CREATE INDEX FOR (n:Theme) ON (n.id);
CREATE INDEX FOR (n:Theme) ON (n.tenant_id);
CREATE INDEX FOR (n:Theme) ON (n.data_class);

CREATE INDEX FOR (n:Signal) ON (n.id);
CREATE INDEX FOR (n:Signal) ON (n.tenant_id);
CREATE INDEX FOR (n:Signal) ON (n.signal_type);

CREATE INDEX FOR (n:Goal) ON (n.id);
CREATE INDEX FOR (n:Goal) ON (n.tenant_id);

CREATE INDEX FOR (n:Idea) ON (n.id);
CREATE INDEX FOR (n:Risk) ON (n.id);
CREATE INDEX FOR (n:Decision) ON (n.id);
CREATE INDEX FOR (n:Person) ON (n.id);
CREATE INDEX FOR (n:Client) ON (n.id);
CREATE INDEX FOR (n:Department) ON (n.id);
CREATE INDEX FOR (n:Project) ON (n.id);
CREATE INDEX FOR (n:Document) ON (n.id);
CREATE INDEX FOR (n:Metric) ON (n.id);
CREATE INDEX FOR (n:Branch) ON (n.id);

// Edge-индексы (FalkorDB начиная с 4.x)
CREATE INDEX FOR ()-[r:RELATES]-() ON (r.relation_type);
CREATE INDEX FOR ()-[r:RELATES]-() ON (r.valid_from);
CREATE INDEX FOR ()-[r:RELATES]-() ON (r.status);

// =================================================================
// Шаблон узла (применяется через Graphiti API)
// =================================================================

// Theme:
// (theme:Theme {
//   id: 'uuid',
//   tenant_id: 'uuid',
//   title: 'string',
//   data_class: 'public|internal|sensitive|private',
//   weight: 0.85,
//   status: 'emerging|active|declining|archived',
//   confirmation: 'proposed|analyzed|confirmed|locked',
//   created_at: timestamp,
//   updated_at: timestamp,
//   valid_from: timestamp,
//   valid_to: timestamp_or_null
// })

// Signal:
// (signal:Signal {
//   id: 'uuid',
//   tenant_id: 'uuid',
//   signal_type: 'client_pain|...',
//   text_short: 'first 200 chars',
//   confidence: 0.85,
//   data_class: '...',
//   created_at: timestamp,
//   valid_from: timestamp,
//   valid_to: timestamp_or_null
// })

// Аналогично для Goal, Idea, Risk, Decision, Person, Client, Department,
// Project, Document, Metric, Branch.

// =================================================================
// Шаблон ребра
// =================================================================

// (a)-[r:RELATES {
//   relation_type: 'подтверждает|противоречит|мешает|помогает|вызывает|...',
//   confidence: 0.85,
//   explanation: 'string',
//   status: 'предложена_AI|подтверждена_человеком|отклонена_человеком|архивирована',
//   evidence_signals: ['signal_id', ...],
//   valid_from: timestamp,
//   valid_to: timestamp_or_null,
//   created_by: 'agent_id_or_user_id',
//   created_at: timestamp,
//   confirmed_by_user_id: 'uuid_or_null'
// }]->(b)

// =================================================================
// Примеры запросов
// =================================================================

// 1. Найти соседей темы 2-го хопа, активные на сейчас
// MATCH (t:Theme {id: $theme_id})-[r:RELATES]-(neighbor)
// WHERE r.valid_to IS NULL
//   AND r.status IN ['предложена_AI', 'подтверждена_человеком']
// OPTIONAL MATCH (neighbor)-[r2:RELATES]-(second_hop)
// WHERE r2.valid_to IS NULL
// RETURN t, r, neighbor, r2, second_hop
// LIMIT 50;

// 2. Time-travel: как граф темы выглядел 30 дней назад
// MATCH (t:Theme {id: $theme_id})-[r:RELATES]-(neighbor)
// WHERE r.valid_from <= $timestamp_30d_ago
//   AND (r.valid_to IS NULL OR r.valid_to > $timestamp_30d_ago)
// RETURN t, r, neighbor;

// 3. Найти пути между двумя сущностями (max 4 хопа)
// MATCH path = (start {id: $start_id})-[*1..4]-(end {id: $end_id})
// WHERE all(rel in relationships(path) WHERE rel.valid_to IS NULL)
// RETURN path
// LIMIT 10;

// 4. Subgraph для рендера (с учётом доступа)
// MATCH (seed {id: $seed_id})-[r:RELATES*1..2]-(neighbor)
// WHERE neighbor.data_class IN $allowed_data_classes
//   AND ALL(rel in r WHERE rel.valid_to IS NULL)
// RETURN seed, r, neighbor
// LIMIT 200;

// 5. Найти связи, ждущие подтверждения
// MATCH (a)-[r:RELATES {status: 'предложена_AI'}]->(b)
// WHERE r.confidence > 0.7
// RETURN a, r, b
// ORDER BY r.created_at DESC
// LIMIT 50;

// =================================================================
// Versioning через Graphiti
// =================================================================
// Graphiti управляет valid_from/valid_to автоматически:
// - При создании ребра — valid_from = now(), valid_to = NULL
// - При обновлении — старое получает valid_to = now(), создаётся новое с valid_from = now()
// - При удалении (соft) — valid_to = now(), узел/ребро не удаляется физически

// =================================================================
// Cleanup (раз в неделю, через M-14 Reframer)
// =================================================================
// Удалить устаревшие архивные рёбра (через 1 год после valid_to)
// MATCH ()-[r:RELATES]-()
// WHERE r.status = 'архивирована' AND r.valid_to < $timestamp_1y_ago
// DELETE r;
