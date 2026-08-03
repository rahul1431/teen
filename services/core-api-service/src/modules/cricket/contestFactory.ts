import { Pool } from 'pg'

interface ContestTier {
  name: string
  entry_fee: number
  max_entries: number
  prize_pool: number
  prize_distribution: { rank_start: number; rank_end: number; payout: number }[]
}

async function getContestTiers(db: Pool): Promise<ContestTier[]> {
  const res = await db.query("SELECT special_rules FROM game_configs WHERE game_type = 'cricket'")
  const tiers = res.rows[0]?.special_rules?.contest_tiers
  return Array.isArray(tiers) ? tiers : []
}

// Auto-creates the fixed-price fantasy leagues for a match, one per
// configured tier, skipping any tier that already has a league for this
// match (idempotent — safe to call every scheduler tick for the same
// match without creating duplicates, and doesn't collide with an admin
// hand-creating a league at some other price point).
export async function createDefaultContests(db: Pool, matchId: string): Promise<number> {
  const tiers = await getContestTiers(db)
  let created = 0
  for (const tier of tiers) {
    const existing = await db.query(
      'SELECT id FROM cricket_fantasy_leagues WHERE match_id = $1 AND entry_fee = $2',
      [matchId, tier.entry_fee],
    )
    if (existing.rows.length) continue
    await db.query(
      `INSERT INTO cricket_fantasy_leagues (match_id, name, entry_fee, prize_pool, max_entries, prize_distribution)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [matchId, `${tier.name} Contest`, tier.entry_fee, tier.prize_pool, tier.max_entries, JSON.stringify(tier.prize_distribution)],
    )
    created++
  }
  return created
}
