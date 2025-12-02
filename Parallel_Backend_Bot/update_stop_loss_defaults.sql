-- SQL script to update stop loss default values in bot_configurations table
-- Updates the most recent configuration record with new default values

UPDATE bot_configurations
SET 
    default_trade_size = 250.00,
    stop_loss_5m = 1.0,
    stop_loss_minutes_5m = 60,
    hard_stop_5m = 2.5,
    stop_loss_15m = 1.5,
    stop_loss_minutes_15m = 90,
    hard_stop_15m = 4.0,
    stop_loss_1h = 2.5,
    stop_loss_minutes_1h = 300,
    hard_stop_1h = 6.0,
    updated_at = NOW()
WHERE id = (SELECT MAX(id) FROM bot_configurations);

-- If no record exists, insert a new one with default values
INSERT INTO bot_configurations (
    email_updates,
    default_trade_size,
    stop_loss_5m,
    stop_loss_minutes_5m,
    hard_stop_5m,
    stop_loss_15m,
    stop_loss_minutes_15m,
    hard_stop_15m,
    stop_loss_1h,
    stop_loss_minutes_1h,
    hard_stop_1h,
    symbols,
    created_at,
    updated_at
)
SELECT 
    true,
    250.00,
    1.0,
    60,
    2.5,
    1.5,
    90,
    4.0,
    2.5,
    300,
    6.0,
    'NU,OSCR,JOBY,ACHR,SOFI,GME,SMCI',
    NOW(),
    NOW()
WHERE NOT EXISTS (SELECT 1 FROM bot_configurations);

-- Verify the update
SELECT 
    id,
    default_trade_size,
    stop_loss_5m,
    stop_loss_minutes_5m,
    hard_stop_5m,
    stop_loss_15m,
    stop_loss_minutes_15m,
    hard_stop_15m,
    stop_loss_1h,
    stop_loss_minutes_1h,
    hard_stop_1h
FROM bot_configurations
ORDER BY id DESC
LIMIT 1;

