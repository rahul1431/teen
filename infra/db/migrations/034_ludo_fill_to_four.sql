-- Online Ludo colour selection: guarantee a player their chosen colour by
-- always seating a full 4-colour table. Setting bot_fill_table_size = 4 makes
-- matchmaking top every Ludo room up to 4 seats with bots (same mechanism
-- Teen Patti already uses), so all four colours (red/green/yellow/blue) always
-- exist and the gateway can honour each real player's preferred seat/colour.
--
-- NOTE: this makes every Ludo Quick Match a 4-way pot (stake x 4, 5% rake) —
-- an intentional trade-off for guaranteed colour choice.
UPDATE game_configs
   SET bot_fill_table_size = 4,
       updated_at = NOW()
 WHERE game_type = 'ludo';
