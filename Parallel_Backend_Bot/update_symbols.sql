-- SQL script to update symbols in symbol_info table
-- Run this script directly in the postgres database

-- Delete old symbols
DELETE FROM symbol_info WHERE symbol IN ('AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA');

-- Insert new symbols
INSERT INTO symbol_info (symbol, ticker, name, description, exchange, currency, min_tick, min_size, pricescale, session, timezone, has_intraday, has_daily, has_weekly_and_monthly, data_status, created_at, updated_at)
VALUES
    ('NU', 'NU', 'Nu Holdings Ltd.', 'Nu Holdings Ltd. Common Stock', 'SMART', 'USD', 0.01, 1, 100, '0930-1600', 'America/New_York', 'true', 'true', 'true', 'streaming', NOW(), NOW()),
    ('OSCR', 'OSCR', 'Oscar Health, Inc.', 'Oscar Health, Inc. Common Stock', 'SMART', 'USD', 0.01, 1, 100, '0930-1600', 'America/New_York', 'true', 'true', 'true', 'streaming', NOW(), NOW()),
    ('JOBY', 'JOBY', 'Joby Aviation, Inc.', 'Joby Aviation, Inc. Common Stock', 'SMART', 'USD', 0.01, 1, 100, '0930-1600', 'America/New_York', 'true', 'true', 'true', 'streaming', NOW(), NOW()),
    ('ACHR', 'ACHR', 'Archer Aviation Inc.', 'Archer Aviation Inc. Common Stock', 'SMART', 'USD', 0.01, 1, 100, '0930-1600', 'America/New_York', 'true', 'true', 'true', 'streaming', NOW(), NOW()),
    ('SOFI', 'SOFI', 'SoFi Technologies, Inc.', 'SoFi Technologies, Inc. Common Stock', 'SMART', 'USD', 0.01, 1, 100, '0930-1600', 'America/New_York', 'true', 'true', 'true', 'streaming', NOW(), NOW()),
    ('GME', 'GME', 'GameStop Corp.', 'GameStop Corp. Common Stock', 'SMART', 'USD', 0.01, 1, 100, '0930-1600', 'America/New_York', 'true', 'true', 'true', 'streaming', NOW(), NOW()),
    ('SMCI', 'SMCI', 'Super Micro Computer, Inc.', 'Super Micro Computer, Inc. Common Stock', 'SMART', 'USD', 0.01, 1, 100, '0930-1600', 'America/New_York', 'true', 'true', 'true', 'streaming', NOW(), NOW())
ON CONFLICT (symbol) DO NOTHING;

-- SOFI + SMCI 
-- tight prices
-- Verify the changes
SELECT symbol, name FROM symbol_info ORDER BY symbol;

