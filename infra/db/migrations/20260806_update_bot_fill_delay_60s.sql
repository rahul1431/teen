-- Update matchmaking bot-fill delay to 60 seconds for Teen Patti, Ludo, and Rummy
UPDATE game_configs
SET bot_fill_delay_seconds = 60
WHERE game_type IN ('teen_patti', 'ludo', 'rummy');
