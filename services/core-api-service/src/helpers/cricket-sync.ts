import { Pool } from 'pg'
import { cricApiFetch } from './cricapi-client'

export interface SyncResult {
  insertedIds: string[]
  updatedCount: number
}

// Discovers new matches and refreshes live scores for existing ones from
// CricAPI's currentMatches endpoint — shared by the admin's manual "Sync"
// button and the automatic scheduler so there is exactly one
// implementation. A match reported matchEnded is set to 'closed', not
// 'settled' — nothing has actually settled the fantasy leagues on it yet,
// that only happens via finalizeMatch() (cricket-finalize.ts). Setting
// 'settled' directly here (the old behavior) left leagues open forever
// with a match that already looked finished.
export async function syncCurrentMatches(db: Pool): Promise<SyncResult> {
  const currentData = await cricApiFetch(db, apiKey => `https://api.cricapi.com/v1/currentMatches?apikey=${apiKey}&offset=0`)
  if (currentData.status !== 'success') throw new Error(currentData.reason || 'CricAPI sync failed')

  const flagsRes = await db.query('SELECT name, flag_url FROM cricket_countries')
  const flagMap = new Map(flagsRes.rows.map((r: any) => [r.name.toLowerCase(), r.flag_url]))
  const findFlag = (n: string) => { for (const [k, v] of flagMap) if (n?.toLowerCase().includes(k as string) || (k as string).includes(n?.toLowerCase())) return v; return null }

  const insertedIds: string[] = []
  let updatedCount = 0

  for (const m of (currentData.data || [])) {
    if (!m.id) continue
    const [team_a, team_b] = [m.teams?.[0] || 'Team A', m.teams?.[1] || 'Team B']
    const status = m.matchEnded ? 'closed' : m.matchStarted ? 'live' : 'upcoming'
    const live_score = m.score?.length ? { runs: m.score.at(-1).r, wickets: m.score.at(-1).w, overs: m.score.at(-1).o, description: m.status } : {}
    const existing = await db.query('SELECT id FROM cricket_matches WHERE match_api_id = $1', [m.id])
    if (existing.rows.length) {
      await db.query(`UPDATE cricket_matches SET status = $1, live_score = $2, team_a_flag = $3, team_b_flag = $4 WHERE id = $5`, [status, JSON.stringify(live_score), findFlag(team_a), findFlag(team_b), existing.rows[0].id])
      updatedCount++
    } else {
      const ins = await db.query(`INSERT INTO cricket_matches (series, format, team_a, team_b, team_a_short, team_b_short, start_time, match_api_id, status, live_score, team_a_flag, team_b_flag) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [m.name || 'Current Match', m.matchType || 't20', team_a, team_b, m.teamInfo?.[0]?.shortname || team_a.substring(0,3).toUpperCase(), m.teamInfo?.[1]?.shortname || team_b.substring(0,3).toUpperCase(), m.dateTimeGMT ? `${m.dateTimeGMT}Z` : new Date().toISOString(), m.id, status, JSON.stringify(live_score), findFlag(team_a), findFlag(team_b)])
      insertedIds.push(ins.rows[0].id)
    }
  }

  return { insertedIds, updatedCount }
}
