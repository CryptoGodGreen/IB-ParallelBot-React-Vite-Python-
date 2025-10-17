-- Migration to add trade_amount column to user_charts table
-- Run this SQL command in your PostgreSQL database

ALTER TABLE user_charts 
ADD COLUMN trade_amount NUMERIC(10, 2) DEFAULT 1000;

-- Update existing records to have the default trade amount
UPDATE user_charts 
SET trade_amount = 1000 
WHERE trade_amount IS NULL;

-- Make the column NOT NULL after setting defaults
ALTER TABLE user_charts 
ALTER COLUMN trade_amount SET NOT NULL;
