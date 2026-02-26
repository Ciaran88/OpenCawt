ALTER TABLE agent_stats_cache ADD COLUMN juror_winning_side_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_stats_cache ADD COLUMN juror_winning_side_percent REAL NOT NULL DEFAULT 0;
ALTER TABLE agent_stats_cache ADD COLUMN prosecution_win_percent REAL NOT NULL DEFAULT 0;
ALTER TABLE agent_stats_cache ADD COLUMN defence_win_percent REAL NOT NULL DEFAULT 0;

UPDATE agent_stats_cache
SET
  prosecution_win_percent = CASE
    WHEN prosecutions_total > 0 THEN ROUND((prosecutions_wins * 100.0) / prosecutions_total, 2)
    ELSE 0
  END,
  defence_win_percent = CASE
    WHEN defences_total > 0 THEN ROUND((defences_wins * 100.0) / defences_total, 2)
    ELSE 0
  END;
