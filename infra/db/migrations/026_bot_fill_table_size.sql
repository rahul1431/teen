-- Fixed table size to top up with bots when a real-player queue is short.
-- NULL keeps the old max_bot_ratio-based sizing (used by games that don't set this).
-- Teen Patti wants a strict 4-seat table whenever fewer than 4 real players are
-- waiting (1+3, 2+2, 3+1 bots), and no bots at all once 4-6 real players queue.
ALTER TABLE game_configs ADD COLUMN bot_fill_table_size INT;

UPDATE game_configs SET bot_fill_table_size = 4 WHERE game_type = 'teen_patti';
