import { SystemMetrics, FinancialMetrics, PendingWithdrawal } from './types'

export class GeminiAdvisor {
  private apiKey: string
  private modelName = 'gemini-3.5-flash'

  constructor(apiKey?: string) {
    this.apiKey = (apiKey || process.env.GEMINI_API_KEY || '').trim()
  }

  public async generateExecutiveBriefing(
    sys: SystemMetrics,
    fin: FinancialMetrics,
    pending: PendingWithdrawal[]
  ): Promise<string> {
    const dataContext = `
Platform: MyOnlineJoker (Teen Patti, Rummy, Ludo, Aviator)
Date: ${fin.period}

--- FINANCIAL HEALTH ---
- Total Deposits: ₹${fin.totalDeposits.toLocaleString('en-IN')} (${fin.depositsCount} transactions)
- Total Withdrawals: ₹${fin.totalWithdrawals.toLocaleString('en-IN')} (${fin.withdrawalsCount} completed)
- Net Company Margin: ₹${fin.netMargin.toLocaleString('en-IN')}
- Active Players Today: ${fin.activePlayersToday}
- Pending Withdrawals: ${fin.pendingWithdrawalsCount} requests totaling ₹${fin.pendingWithdrawalsSum.toLocaleString('en-IN')}

--- INFRASTRUCTURE SRE HEALTH ---
- Total RAM: ${sys.totalMemMb} MB, Used: ${sys.memUsedPct}% (Free: ${sys.freeMemMb} MB)
- Root Disk Free: ${sys.diskFreeGb} GB (Used: ${sys.diskUsedPct}%)
- PostgreSQL: ${sys.dbConnected ? 'CONNECTED' : 'DOWN'} (${sys.dbLatencyMs}ms latency)
- Redis: ${sys.redisConnected ? 'CONNECTED' : 'DOWN'} (${sys.redisLatencyMs}ms latency)
- PM2 Processes Running: ${sys.processes.length} total, Errored: ${sys.erroredCount}
${sys.processes.map((p) => `  * ${p.name}: ${p.status} (RAM: ${p.memoryMb}MB, CPU: ${p.cpu}%, Restarts: ${p.restarts})`).join('\n')}

--- PENDING CASHOUTS FOR REVIEW ---
${pending.map((p) => `  * User ${p.userName} - ₹${p.amount} (Risk Score: ${p.riskScore}/100, Flags: ${p.riskReasons.join(', ')})`).join('\n')}
`

    if (!this.apiKey) {
      // Deterministic formatting fallback when no Gemini key is provided
      return `📊 <b>MyOnlineJoker Daily Operations Briefing</b> (${fin.period})\n\n` +
        `💵 <b>Deposits:</b> ₹${fin.totalDeposits.toLocaleString('en-IN')} (${fin.depositsCount})\n` +
        `💸 <b>Withdrawals:</b> ₹${fin.totalWithdrawals.toLocaleString('en-IN')}\n` +
        `📈 <b>Net Margin:</b> ₹${fin.netMargin.toLocaleString('en-IN')}\n` +
        `👥 <b>Active Players:</b> ${fin.activePlayersToday}\n\n` +
        `🛡️ <b>Server Health:</b>\n` +
        `• RAM Used: ${sys.memUsedPct}% | Disk Used: ${sys.diskUsedPct}%\n` +
        `• Database: ${sys.dbConnected ? '🟢 OK' : '🔴 DOWN'} (${sys.dbLatencyMs}ms)\n` +
        `• Microservices: ${sys.processes.length} online, ${sys.erroredCount} errored\n\n` +
        `⏳ <b>Pending Cashouts:</b> ${fin.pendingWithdrawalsCount} (₹${fin.pendingWithdrawalsSum.toLocaleString('en-IN')})\n\n` +
        `💡 <i>Tip: Set GEMINI_API_KEY in .env to get AI-generated executive insights and growth tips.</i>`
    }

    try {
      const prompt = `You are the Autonomous AI Chief Operating Officer (COO) of MyOnlineJoker, an online real-money gaming platform (Teen Patti, Rummy, Ludo).
Analyze the platform data below and generate a crisp, executive summary formatted for Telegram HTML message:
- Use emojis effectively.
- Highlight positive margins or warning signs.
- If any service is errored or memory > 85%, flag it as urgent.
- Give 2 actionable growth or risk recommendations for the owner.
- Keep it concise (under 250 words) so it's easily read on a mobile phone.

Data:
${dataContext}`

      return await this.callGemini(prompt)
    } catch (err: any) {
      console.error('[GeminiAdvisor] Generation failed:', err.message)
      return `⚠️ Gemini Advisor error: ${err.message}`
    }
  }

  public async answerOwnerQuery(question: string, contextSummary: string): Promise<string> {
    if (!this.apiKey) {
      return '⚠️ GEMINI_API_KEY is not configured yet. Please add it to .env to enable conversational AI answers.'
    }

    try {
      const prompt = `You are the Autonomous AI Assistant for the owner of MyOnlineJoker gaming platform.
Answer the owner's question accurately and concisely using this live context:

Context:
${contextSummary}

Question from Owner:
${question}`

      return await this.callGemini(prompt)
    } catch (err: any) {
      return `Error generating response: ${err.message}`
    }
  }

  private async callGemini(prompt: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ]
      })
    })

    if (!res.ok) {
      const errBody = await res.text()
      throw new Error(`Gemini API returned status ${res.status}: ${errBody}`)
    }

    const data: any = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    return text || 'No response generated from Gemini.'
  }
}
