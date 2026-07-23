export function buildWithdrawalsFilter(status: string | undefined): { clause: string; params: any[] } {
  if (status === 'all') return { clause: '', params: [] }
  return { clause: 'AND po.status = $1', params: [status || 'created'] }
}

export function resolveWithdrawalsLimit(raw: unknown): number {
  const n = parseInt(String(raw), 10)
  if (!Number.isFinite(n)) return 100
  return Math.min(500, Math.max(1, n))
}
