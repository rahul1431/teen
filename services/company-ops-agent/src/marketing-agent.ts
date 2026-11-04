import { Pool } from 'pg'
import { GeminiAdvisor } from './gemini-advisor'
import { ChurnedVIPLead } from './types'

export class MarketingRetentionAgent {
  constructor(
    private db: Pool,
    private advisor: GeminiAdvisor
  ) {}

  /**
   * Discovers high-value VIP players who have churned (inactive for > 48 hours)
   * and generates AI-tailored re-engagement offers.
   */
  public async getVIPRetentionCampaigns(limit = 5): Promise<ChurnedVIPLead[]> {
    try {
      const res = await this.db.query(`
        SELECT 
          u.id as user_id,
          u.phone,
          w.total_deposited,
          w.total_won,
          COALESCE(w.updated_at, u.created_at) as last_active,
          COALESCE(
            (SELECT game_type FROM game_participants gp 
             JOIN game_rooms gr ON gr.id = gp.room_id 
             WHERE gp.user_id = u.id 
             ORDER BY gp.created_at DESC LIMIT 1),
            'teen_patti'
          ) as favorite_game
        FROM users u
        JOIN wallets w ON w.user_id = u.id
        WHERE w.total_deposited >= 500
          AND u.status = 'active'
          AND w.updated_at < NOW() - INTERVAL '48 hours'
        ORDER BY w.total_deposited DESC
        LIMIT $1
      `, [limit])

      const leads: ChurnedVIPLead[] = []

      for (const row of res.rows) {
        const deposited = parseFloat(row.total_deposited)
        const game = row.favorite_game === 'teen_patti' ? 'Teen Patti' : row.favorite_game === 'rummy' ? 'Points Rummy' : 'Ludo'
        const bonusAmount = deposited > 5000 ? 500 : deposited > 2000 ? 250 : 100

        // Draft AI promotion using Gemini
        const query = `Generate a 1-sentence WhatsApp promotional hook for VIP player who deposited ₹${deposited} and loves ${game}. Offer ₹${bonusAmount} deposit bonus cash valid tonight only.`
        const customMsg = await this.advisor.answerOwnerQuery(query, `Gaming platform MyOnlineJoker, VIP re-engagement campaign.`)

        leads.push({
          userId: row.user_id,
          phone: row.phone ? row.phone.replace(/(\d{2})\d{4}(\d{4})/, '$1****$2') : 'Protected Phone',
          lastPlayedAt: row.last_active,
          totalLifetimeDeposits: deposited,
          favoriteGame: game,
          suggestedBonus: bonusAmount,
          suggestedMessage: customMsg.replace(/["\n]/g, '').trim()
        })
      }

      return leads
    } catch (err: any) {
      console.error('[MarketingRetentionAgent] Discovery failed:', err.message)
      return []
    }
  }
}
