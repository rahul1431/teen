-- Migration 108: Seed Active Lottery Draws and Instant Scratch Products
-- Provides working draws (daily, weekly, monthly) and scratch card catalog.

INSERT INTO lottery_draws (id, name, ticket_price, draw_time, status, category, prize_tiers, max_tickets)
VALUES 
  (gen_random_uuid(), 'Daily Gold Draw', 20.00, NOW() + INTERVAL '1 day', 'open', 'daily', '[{"tier": 1, "matches": 4, "prize": 10000}, {"tier": 2, "matches": 3, "prize": 1000}, {"tier": 3, "matches": 2, "prize": 100}]'::jsonb, 500),
  (gen_random_uuid(), 'Weekly Mega Jackpot', 50.00, NOW() + INTERVAL '7 days', 'open', 'weekly', '[{"tier": 1, "matches": 4, "prize": 50000}, {"tier": 2, "matches": 3, "prize": 5000}, {"tier": 3, "matches": 2, "prize": 250}]'::jsonb, 1000),
  (gen_random_uuid(), 'Monthly Bumper Crorepati', 100.00, NOW() + INTERVAL '30 days', 'open', 'monthly', '[{"tier": 1, "matches": 4, "prize": 200000}, {"tier": 2, "matches": 3, "prize": 20000}, {"tier": 3, "matches": 2, "prize": 500}]'::jsonb, 2000);

INSERT INTO lottery_scratch_products (id, name, price, payouts, is_active)
VALUES
  (gen_random_uuid(), 'Lucky 7 Scratch', 10.00, '[{"outcome": "cash", "amount": 100, "probability": 5}, {"outcome": "cash", "amount": 25, "probability": 15}, {"outcome": "cash", "amount": 10, "probability": 30}, {"outcome": "no_win", "amount": 0, "probability": 50}]'::jsonb, true),
  (gen_random_uuid(), 'Golden Ticket Scratch', 25.00, '[{"outcome": "cash", "amount": 500, "probability": 4}, {"outcome": "cash", "amount": 100, "probability": 16}, {"outcome": "cash", "amount": 25, "probability": 30}, {"outcome": "no_win", "amount": 0, "probability": 50}]'::jsonb, true),
  (gen_random_uuid(), 'Diamond Rush Scratch', 50.00, '[{"outcome": "cash", "amount": 2000, "probability": 2}, {"outcome": "cash", "amount": 250, "probability": 18}, {"outcome": "cash", "amount": 50, "probability": 30}, {"outcome": "no_win", "amount": 0, "probability": 50}]'::jsonb, true);
