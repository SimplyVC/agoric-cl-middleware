--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT,
  name TEXT PRIMARY KEY,
  request_id INTEGER DEFAULT 0,
  last_reported_round INTEGER DEFAULT 0,
  last_request_sent REAL DEFAULT 0,
  last_submission_time REAL DEFAULT 0,
  last_result REAL DEFAULT -1,
  last_received_request_id INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rounds (
  feed TEXT,
  round_id INTEGER DEFAULT 0,
  started_at REAL DEFAULT 0,
  started_by TEXT,
  submission_made INTEGER DEFAULT 0,
  FOREIGN KEY (feed) REFERENCES jobs(name) ON DELETE CASCADE
);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------

DROP INDEX jobs;
DROP TABLE rounds;