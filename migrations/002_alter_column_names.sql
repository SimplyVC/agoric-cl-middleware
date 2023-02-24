--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

ALTER TABLE rounds
RENAME COLUMN feed TO feed;
ALTER TABLE rounds
RENAME COLUMN round_id TO roundId;
ALTER TABLE rounds
RENAME COLUMN started_at TO startedAt;
ALTER TABLE rounds
RENAME COLUMN started_by TO startedBy;
ALTER TABLE rounds
RENAME COLUMN submission_made TO submissionMade;

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------