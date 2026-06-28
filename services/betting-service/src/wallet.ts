// Thin client over the wallet-service internal endpoints. Stakes are debited
// when a bet is placed and prizes credited on settlement — both idempotent so
// retries (or a re-run settlement) never double-charge or double-pay.

const WALLET_URL = process.env.WALLET_SERVICE_URL || 'http://127.0.0.1:3003'
const KEY = process.env.INTERNAL_SERVICE_KEY || ''

export async function debitStake(opts: {
  userId: string
  amount: number
  referenceId: string
  idempotencyKey: string
  description?: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${WALLET_URL}/internal/wallet/debit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': KEY },
      body: JSON.stringify({
        user_id: opts.userId,
        amount: opts.amount,
        reference_id: opts.referenceId,
        idempotency_key: opts.idempotencyKey,
        description: opts.description,
      }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as any
      return { ok: false, error: body.error || 'Debit failed' }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: 'Wallet service unavailable' }
  }
}

export async function creditPrize(opts: {
  userId: string
  amount: number
  referenceId: string
  idempotencyKey: string
}): Promise<boolean> {
  if (opts.amount <= 0) return true
  try {
    const res = await fetch(`${WALLET_URL}/internal/wallet/credit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': KEY },
      body: JSON.stringify({
        user_id: opts.userId,
        amount: opts.amount,
        type: 'game_credit',
        reference_id: opts.referenceId,
        idempotency_key: opts.idempotencyKey,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}
