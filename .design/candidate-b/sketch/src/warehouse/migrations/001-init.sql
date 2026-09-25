CREATE TABLE source_file (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  adapter TEXT NOT NULL CHECK (adapter IN ('claude_code', 'codex', 'cursor_db', 'cursor_csv')),
  parser_version INTEGER NOT NULL,
  cursor_json TEXT NOT NULL,
  presence TEXT NOT NULL CHECK (presence IN ('present', 'missing')),
  last_error TEXT,
  ingested_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE project (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL
) STRICT;

CREATE TABLE price (
  key TEXT PRIMARY KEY,
  vendor TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('flagship', 'standard', 'small')),
  downshift_key TEXT REFERENCES price(key),
  input_per_mtok REAL NOT NULL,
  output_per_mtok REAL NOT NULL,
  cache_write_5m_per_mtok REAL NOT NULL,
  cache_write_1h_per_mtok REAL NOT NULL,
  cache_read_per_mtok REAL NOT NULL
) STRICT;

CREATE TABLE model (
  id INTEGER PRIMARY KEY,
  raw_name TEXT NOT NULL UNIQUE,
  price_key TEXT REFERENCES price(key)
) STRICT;

CREATE TABLE session (
  key TEXT PRIMARY KEY,
  native_id TEXT NOT NULL,
  project_id INTEGER REFERENCES project(id),
  parent_key TEXT REFERENCES session(key),
  title TEXT,
  title_rank INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE request (
  source_id TEXT PRIMARY KEY,
  source_file_id INTEGER NOT NULL REFERENCES source_file(id),
  tool TEXT NOT NULL CHECK (tool IN ('claude_code', 'codex', 'cursor')),
  session_key TEXT REFERENCES session(key),
  model_id INTEGER NOT NULL REFERENCES model(id),
  ts_ms INTEGER NOT NULL,
  day TEXT NOT NULL,
  week TEXT NOT NULL,
  fidelity TEXT NOT NULL CHECK (fidelity IN ('measured', 'total_only', 'estimated')),
  input_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_write_5m_tokens INTEGER NOT NULL,
  cache_write_1h_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  reported_cost_usd REAL,
  is_sidechain INTEGER NOT NULL CHECK (is_sidechain IN (0, 1)),
  tool_calls INTEGER NOT NULL,
  CHECK (fidelity = 'total_only' OR total_tokens = input_tokens + cache_read_tokens + cache_write_5m_tokens + cache_write_1h_tokens + output_tokens),
  CHECK (fidelity <> 'total_only' OR (input_tokens + cache_read_tokens + cache_write_5m_tokens + cache_write_1h_tokens + output_tokens) = 0),
  CHECK (reasoning_tokens <= output_tokens OR fidelity = 'total_only')
) STRICT;

CREATE INDEX request_by_day ON request(day, tool);
CREATE INDEX request_by_session ON request(session_key, ts_ms);
CREATE INDEX request_by_source_file ON request(source_file_id);

CREATE VIEW measured_coverage AS
SELECT DISTINCT r.tool, r.day
FROM request r JOIN source_file sf ON sf.id = r.source_file_id
WHERE r.fidelity = 'measured' AND sf.adapter = 'cursor_csv';

CREATE VIEW fact AS
SELECT
  r.source_id, r.tool, r.session_key, r.ts_ms, r.day, r.week, r.fidelity,
  r.input_tokens, r.cache_read_tokens, r.cache_write_5m_tokens, r.cache_write_1h_tokens,
  r.output_tokens, r.reasoning_tokens, r.total_tokens, r.is_sidechain, r.tool_calls,
  r.input_tokens + r.cache_read_tokens + r.cache_write_5m_tokens + r.cache_write_1h_tokens AS context_tokens,
  r.cache_write_5m_tokens + r.cache_write_1h_tokens AS cache_write_tokens,
  m.id AS model_id, m.raw_name AS model_name,
  p.key AS price_key, p.vendor, p.tier, p.downshift_key,
  p.input_per_mtok AS rate_input, p.cache_read_per_mtok AS rate_cache_read,
  p.cache_write_5m_per_mtok AS rate_cache_write_5m, p.cache_write_1h_per_mtok AS rate_cache_write_1h,
  s.project_id, pr.label AS project_label, s.parent_key, s.title AS session_title,
  CASE
    WHEN r.reported_cost_usd IS NOT NULL THEN r.reported_cost_usd
    WHEN p.key IS NULL THEN NULL
    WHEN r.fidelity = 'total_only' THEN r.total_tokens * p.input_per_mtok / 1e6
    ELSE (r.input_tokens * p.input_per_mtok
        + r.cache_read_tokens * p.cache_read_per_mtok
        + r.cache_write_5m_tokens * p.cache_write_5m_per_mtok
        + r.cache_write_1h_tokens * p.cache_write_1h_per_mtok
        + r.output_tokens * p.output_per_mtok) / 1e6
  END AS cost_usd,
  CASE WHEN p.key IS NULL THEN NULL
    ELSE r.output_tokens * p.output_per_mtok / 1e6 END AS output_cost_usd,
  CASE WHEN d.key IS NULL OR r.fidelity = 'total_only' THEN NULL
    ELSE (r.input_tokens * d.input_per_mtok
        + r.cache_read_tokens * d.cache_read_per_mtok
        + r.cache_write_5m_tokens * d.cache_write_5m_per_mtok
        + r.cache_write_1h_tokens * d.cache_write_1h_per_mtok
        + r.output_tokens * d.output_per_mtok) / 1e6
  END AS downshift_cost_usd
FROM request r
JOIN model m ON m.id = r.model_id
LEFT JOIN price p ON p.key = m.price_key
LEFT JOIN price d ON d.key = p.downshift_key
LEFT JOIN session s ON s.key = r.session_key
LEFT JOIN project pr ON pr.id = s.project_id
WHERE NOT (
  r.fidelity = 'estimated'
  AND EXISTS (SELECT 1 FROM measured_coverage c WHERE c.tool = r.tool AND c.day = r.day)
);
