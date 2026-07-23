import { LudoState, LudoPlayer, chooseBotToken } from './rules'

export interface CoordinationMetadata {
  isHelper: boolean
  winnerBotIdx: number
  aggressiveness: number // 0.0 - 1.0
}

/**
 * Choose a token for a helper bot to move in coordinated mode.
 * Priority: block RP, clear path for winner, sacrifice, normal move
 */
export function chooseBotTokenCoordinated(
  state: LudoState,
  botIdx: number,
  dice: number,
  metadata: CoordinationMetadata
): number {
  if (!metadata.isHelper) {
    // Winner bot plays normally; use existing chooseBotToken logic
    return chooseBotToken(state, botIdx, dice)
  }

  const myTokens = state.players[botIdx].tokens
  const rpTokens = findRPTokens(state)
  const winnerTokens = state.players[metadata.winnerBotIdx].tokens

  // Priority 1: Block RP's strongest token (most advanced)
  if (rpTokens.length > 0 && metadata.aggressiveness > 0.3) {
    const strongestRpToken = rpTokens.reduce((best: number, token: number) => {
      return token > best ? token : best
    })

    const blockingToken = findTokenThatCanBlock(myTokens, strongestRpToken, dice)
    if (blockingToken !== -1) {
      return blockingToken
    }
  }

  // Priority 2: Clear a path for winner bot (move blockers out of their way)
  if (winnerTokens.length > 0 && metadata.aggressiveness > 0.2) {
    const blockersOfWinner = findTokensBlockingPath(state, metadata.winnerBotIdx)
    const myBlocker = blockersOfWinner.find((t: { playerIdx: number; tokenIdx: number }) => t.playerIdx === botIdx)
    if (myBlocker !== undefined) {
      return myBlocker.tokenIdx
    }
  }

  // Priority 3: Sacrifice a token if beneficial to winner
  if (metadata.aggressiveness > 0.5) {
    const sacrificeToken = findSacrificeToken(myTokens, rpTokens, dice)
    if (sacrificeToken !== -1) {
      return sacrificeToken
    }
  }

  // Priority 4: Normal best-move logic (fallback)
  return chooseBotToken(state, botIdx, dice)
}

function findRPTokens(state: LudoState): number[] {
  const rpIdx = state.players.findIndex((p: LudoPlayer) => !p.is_bot)
  if (rpIdx === -1) return []
  return state.players[rpIdx].tokens.filter((t: number) => t > 0)
}

function findTokenThatCanBlock(myTokens: number[], rpToken: number, dice: number): number {
  for (let i = 0; i < myTokens.length; i++) {
    const token = myTokens[i]
    if (token > 0) {
      const newPos = token + dice
      if (newPos === rpToken) {
        return i
      }
    }
  }
  return -1
}

function findTokensBlockingPath(state: LudoState, winnerBotIdx: number): Array<{ playerIdx: number; tokenIdx: number }> {
  const winnerTokens = state.players[winnerBotIdx].tokens
  const blockingTokens: Array<{ playerIdx: number; tokenIdx: number }> = []

  for (let idx = 0; idx < state.players.length; idx++) {
    if (idx === winnerBotIdx || !state.players[idx].is_bot) continue

    const botTokens = state.players[idx].tokens
    for (let botTokenIdx = 0; botTokenIdx < botTokens.length; botTokenIdx++) {
      const botToken = botTokens[botTokenIdx]
      for (const winnerToken of winnerTokens) {
        if (botToken > 0 && botToken === winnerToken) {
          blockingTokens.push({ playerIdx: idx, tokenIdx: botTokenIdx })
        }
      }
    }
  }

  return blockingTokens
}

function findSacrificeToken(myTokens: number[], rpTokens: number[], dice: number): number {
  for (let i = 0; i < myTokens.length; i++) {
    if (myTokens[i] > 0 && myTokens[i] < 20) {
      return i
    }
  }
  return -1
}
