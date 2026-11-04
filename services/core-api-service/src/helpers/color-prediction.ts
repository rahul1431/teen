import { Pool } from 'pg'
import { creditPrize } from './wallet-client'

export interface ColorPredictionRuleConfig {
  interval_seconds: number
  rake_percent: number
  min_bet: number
  max_bet: number
}

export function getColorFromNumber(num: number): 'green' | 'red' | 'violet_green' | 'violet_red' {
  if (num === 0) return 'violet_red'
  if (num === 5) return 'violet_green'
  if ([1, 3, 7, 9].includes(num)) return 'green'
  return 'red'
}

export function getSizeFromNumber(num: number): 'big' | 'small' {
  return num >= 5 ? 'big' : 'small'
}

export function calculateBetPayout(
  betType: string,
  betValue: string,
  winningNumber: number,
  amount: number,
  rakePercent: number = 5
): { isWin: boolean; payout: number; multiplier: number } {
  const winColor = getColorFromNumber(winningNumber)
  const winSize = getSizeFromNumber(winningNumber)
  const rakeMultiplier = (100 - rakePercent) / 100

  let isWin = false
  let rawMultiplier = 0

  if (betType === 'number') {
    if (parseInt(betValue, 10) === winningNumber) {
      isWin = true
      rawMultiplier = 9.0
    }
  } else if (betType === 'color') {
    const val = betValue.toLowerCase()
    if (val === 'green') {
      if ([1, 3, 7, 9].includes(winningNumber)) {
        isWin = true
        rawMultiplier = 2.0
      } else if (winningNumber === 5) {
        isWin = true
        rawMultiplier = 1.5
      }
    } else if (val === 'red') {
      if ([2, 4, 6, 8].includes(winningNumber)) {
        isWin = true
        rawMultiplier = 2.0
      } else if (winningNumber === 0) {
        isWin = true
        rawMultiplier = 1.5
      }
    } else if (val === 'violet') {
      if ([0, 5].includes(winningNumber)) {
        isWin = true
        rawMultiplier = 4.5
      }
    }
  } else if (betType === 'size') {
    const val = betValue.toLowerCase()
    if (val === winSize) {
      isWin = true
      rawMultiplier = 2.0
    }
  }

  if (!isWin) {
    return { isWin: false, payout: 0, multiplier: 0 }
  }

  // Payout = Bet Amount * Multiplier * (1 - Rake)
  const netPayout = Math.round(amount * rawMultiplier * rakeMultiplier * 100) / 100
  return { isWin: true, payout: netPayout, multiplier: rawMultiplier }
}

export async function settleColorPredictionRound(
  db: Pool,
  roundId: string,
  forcedNumber?: number
) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')

    const roundRes = await client.query(
      'SELECT * FROM color_prediction_rounds WHERE id = $1 FOR UPDATE',
      [roundId]
    )

    if (roundRes.rows.length === 0) {
      await client.query('ROLLBACK')
      return null
    }

    const round = roundRes.rows[0]
    if (round.status === 'settled' || round.status === 'cancelled') {
      await client.query('ROLLBACK')
      return round
    }

    // Determine Rake %
    const cfgRes = await client.query(
      "SELECT rake_percent, special_rules FROM game_configs WHERE game_type = 'color_prediction'"
    )
    const rakePercent = Number(cfgRes.rows[0]?.rake_percent ?? 5)
    const specialRules = typeof cfgRes.rows[0]?.special_rules === 'string'
      ? JSON.parse(cfgRes.rows[0]?.special_rules)
      : (cfgRes.rows[0]?.special_rules || {})

    // Determine Winning Number
    let winningNumber: number
    if (forcedNumber !== undefined && forcedNumber >= 0 && forcedNumber <= 9) {
      winningNumber = forcedNumber
    } else if (round.manual_override_number != null && round.manual_override_number >= 0 && round.manual_override_number <= 9) {
      winningNumber = round.manual_override_number
    } else if (specialRules.house_mode === 'low_payout') {
      // Find the number(s) that minimize total payout to protect house margin
      const betsRes = await client.query(
        "SELECT * FROM color_prediction_bets WHERE round_id = $1 AND status = 'pending'",
        [roundId]
      )
      const allBets = betsRes.rows
      if (allBets.length === 0) {
        // No bets placed in this round: pick a completely fair random number 0-9
        winningNumber = Math.floor(Math.random() * 10)
      } else {
        let minPayout = Infinity
        let tiedBestNumbers: number[] = []

        for (let testNum = 0; testNum <= 9; testNum++) {
          let testPayout = 0
          for (const b of allBets) {
            const calc = calculateBetPayout(b.bet_type, b.bet_value, testNum, Number(b.amount), rakePercent)
            if (calc.isWin) testPayout += calc.payout
          }
          if (testPayout < minPayout) {
            minPayout = testPayout
            tiedBestNumbers = [testNum]
          } else if (testPayout === minPayout) {
            tiedBestNumbers.push(testNum)
          }
        }
        // Randomly pick among all tied minimum-payout numbers
        winningNumber = tiedBestNumbers[Math.floor(Math.random() * tiedBestNumbers.length)]
      }
    } else {
      // Fair RNG 0 - 9
      winningNumber = Math.floor(Math.random() * 10)
    }

    const winningColor = getColorFromNumber(winningNumber)
    const winningSize = getSizeFromNumber(winningNumber)

    // Settle Bets
    const betsRes = await client.query(
      "SELECT * FROM color_prediction_bets WHERE round_id = $1 AND status = 'pending' FOR UPDATE",
      [roundId]
    )
    const bets = betsRes.rows

    let totalPayout = 0
    let totalBetAmount = 0

    for (const bet of bets) {
      const betAmt = Number(bet.amount)
      totalBetAmount += betAmt

      const calc = calculateBetPayout(bet.bet_type, bet.bet_value, winningNumber, betAmt, rakePercent)
      if (calc.isWin && calc.payout > 0) {
        totalPayout += calc.payout
        await client.query(
          "UPDATE color_prediction_bets SET status = 'won', payout = $1 WHERE id = $2",
          [calc.payout, bet.id]
        )

        // Credit Wallet
        creditPrize({
          userId: bet.user_id,
          amount: calc.payout,
          referenceId: `color_win_${bet.id}`,
          idempotencyKey: `color_win_${bet.id}`,
          notification: {
            title: '🎉 Color Prediction Win!',
            body: `You won ₹${calc.payout.toFixed(2)} on Period ${round.period_id} (${winningColor.toUpperCase()} #${winningNumber})!`
          }
        }).catch(err => console.error('[ColorPrediction] Wallet credit failed for bet:', bet.id, err))
      } else {
        await client.query(
          "UPDATE color_prediction_bets SET status = 'lost', payout = 0 WHERE id = $1",
          [bet.id]
        )
      }
    }

    const houseProfit = totalBetAmount - totalPayout

    // Update Round as Settled
    const updatedRoundRes = await client.query(
      `UPDATE color_prediction_rounds
       SET status = 'settled',
           winning_number = $1,
           winning_color = $2,
           winning_size = $3,
           total_bets_count = $4,
           total_bet_amount = $5,
           total_payout_amount = $6,
           house_profit = $7,
           settled_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [
        winningNumber,
        winningColor,
        winningSize,
        bets.length,
        totalBetAmount,
        totalPayout,
        houseProfit,
        roundId
      ]
    )

    await client.query('COMMIT')
    return updatedRoundRes.rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
