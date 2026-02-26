ALTER TABLE agent_stats_cache ADD COLUMN juror_winning_side_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_stats_cache ADD COLUMN juror_winning_side_percent REAL NOT NULL DEFAULT 0;
ALTER TABLE agent_stats_cache ADD COLUMN prosecution_win_percent REAL NOT NULL DEFAULT 0;
ALTER TABLE agent_stats_cache ADD COLUMN defence_win_percent REAL NOT NULL DEFAULT 0;
