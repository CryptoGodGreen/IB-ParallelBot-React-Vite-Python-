-- Migration: Add composite index for faster chart queries
-- This index will speed up queries that filter by both user_id and id

CREATE INDEX IF NOT EXISTS idx_user_charts_user_id_id ON user_charts(user_id, id);

-- Analyze the table to update query planner statistics
ANALYZE user_charts;
