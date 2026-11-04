-- Reconcile historical Rummy wins in game_participants from wallet_transactions
UPDATE game_participants gp
SET prize_won = wt.amount, final_rank = 1
FROM wallet_transactions wt, game_rooms gr
WHERE gr.id = gp.room_id
  AND wt.user_id = gp.user_id
  AND wt.reference_id = gp.room_id::text
  AND wt.type = 'game_credit'
  AND gr.game_type = 'rummy'
  AND (gp.prize_won IS NULL OR gp.prize_won = 0);

-- Reconcile historical Rummy losses where prize_won is 0
UPDATE game_participants gp
SET final_rank = 2
FROM game_rooms gr
WHERE gr.id = gp.room_id
  AND gr.game_type = 'rummy'
  AND (gp.prize_won IS NULL OR gp.prize_won = 0)
  AND gp.final_rank IS NULL;

-- Mark any unclosed rummy rooms that had participants as completed
UPDATE game_rooms gr
SET status = 'completed', ended_at = COALESCE(gr.ended_at, NOW())
WHERE gr.game_type = 'rummy'
  AND gr.status = 'active'
  AND EXISTS (SELECT 1 FROM game_participants gp WHERE gp.room_id = gr.id);
