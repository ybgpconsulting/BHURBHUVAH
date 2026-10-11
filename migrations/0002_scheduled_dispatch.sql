ALTER TABLE deliveries ADD COLUMN source_change_id TEXT;
ALTER TABLE deliveries ADD COLUMN changed_after_publish INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dispatch_runs ADD COLUMN revision_of TEXT REFERENCES dispatch_runs(id);
ALTER TABLE dispatch_runs ADD COLUMN reviewed_by TEXT REFERENCES users(id);
ALTER TABLE dispatch_runs ADD COLUMN reviewed_at TEXT;

CREATE UNIQUE INDEX idx_delivery_source_change
  ON deliveries(dispatch_run_id, source_change_id)
  WHERE source_change_id IS NOT NULL;

CREATE TABLE dispatch_generation_runs (
  id TEXT PRIMARY KEY,
  delivery_date TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('cron', 'manual_retry')),
  status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'needs_review', 'failed')),
  result_json TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(delivery_date, attempt_number)
);
CREATE INDEX idx_dispatch_generation_runs_date
  ON dispatch_generation_runs(delivery_date, attempt_number DESC);
CREATE UNIQUE INDEX idx_dispatch_generation_one_running
  ON dispatch_generation_runs(delivery_date)
  WHERE status = 'running';

CREATE TABLE login_attempts (
  id TEXT PRIMARY KEY,
  attempt_key TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);
CREATE INDEX idx_login_attempts_key_time ON login_attempts(attempt_key, attempted_at);
