import { SystemSre } from './system-sre'
import { FinanceAnalytics } from './finance-analytics'
import { GeminiAdvisor } from './gemini-advisor'

export class TelegramOpsBot {
  private token: string
  private adminChatIds: Set<string>
  private isPolling = false
  private offset = 0

  constructor(
    token: string,
    adminChatId: string,
    private sre: SystemSre,
    private finance: FinanceAnalytics,
    private advisor: GeminiAdvisor
  ) {
    this.token = token.trim()
    this.adminChatIds = new Set(
      adminChatId
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  }

  public start(): void {
    if (!this.token) {
      console.log('[TelegramOpsBot] No TELEGRAM_BOT_TOKEN provided. Telegram bot skipped.')
      return
    }

    this.isPolling = true
    console.log('[TelegramOpsBot] Starting Telegram command center polling...')
    this.pollLoop()
  }

  public stop(): void {
    this.isPolling = false
  }

  public async broadcast(message: string): Promise<void> {
    if (!this.token) return
    for (const chatId of this.adminChatIds) {
      await this.sendMessage(chatId, message)
    }
  }

  private async sendMessage(
    chatId: string,
    text: string,
    replyMarkup?: any
  ): Promise<void> {
    try {
      const url = `https://api.telegram.org/bot${this.token}/sendMessage`
      const body: any = {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }
      if (replyMarkup) {
        body.reply_markup = replyMarkup
      }

      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    } catch (err: any) {
      console.error('[TelegramOpsBot] sendMessage failed:', err.message)
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.isPolling) {
      try {
        const url = `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.offset}&timeout=20`
        const res = await fetch(url)
        const data: any = await res.json()

        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            this.offset = update.update_id + 1
            await this.handleUpdate(update)
          }
        }
      } catch (err: any) {
        // Sleep 5s on network error before retrying
        await new Promise((r) => setTimeout(r, 5000))
      }
    }
  }

  private async handleUpdate(update: any): Promise<void> {
    // 1. Handle Button Callbacks
    if (update.callback_query) {
      const cb = update.callback_query
      const chatId = String(cb.message?.chat?.id)
      const data = cb.data

      if (!this.adminChatIds.has(chatId) && this.adminChatIds.size > 0) {
        await this.sendMessage(chatId, `⛔ Unauthorized ID: ${chatId}`)
        return
      }

      if (data === 'btn_status') {
        await this.handleStatusCommand(chatId)
      } else if (data === 'btn_earnings') {
        await this.handleEarningsCommand(chatId)
      } else if (data === 'btn_report') {
        await this.handleReportCommand(chatId)
      } else if (data === 'btn_flush_logs') {
        const res = this.sre.flushLogs()
        await this.sendMessage(chatId, res.success ? '🧹 PM2 logs flushed successfully!' : `❌ ${res.message}`)
      }
      return
    }

    // 2. Handle Text Messages
    const message = update.message
    if (!message || !message.text) return

    const chatId = String(message.chat.id)
    const text = message.text.trim()

    // Authorization Check
    if (!this.adminChatIds.has(chatId)) {
      if (this.adminChatIds.size === 0) {
        // First user auto-registers if no admin ID configured
        this.adminChatIds.add(chatId)
        await this.sendMessage(
          chatId,
          `👑 <b>Welcome Owner!</b> Your Telegram Chat ID (<code>${chatId}</code>) is now set as the primary Admin.`
        )
      } else {
        await this.sendMessage(
          chatId,
          `⛔ <b>Access Denied</b>\nYour Telegram Chat ID is: <code>${chatId}</code>\nPlease add this ID to <code>TELEGRAM_ADMIN_CHAT_ID</code> in <code>.env</code>.`
        )
        return
      }
    }

    // Command Router
    if (text === '/start' || text === '/help') {
      await this.handleHelpCommand(chatId)
    } else if (text === '/status') {
      await this.handleStatusCommand(chatId)
    } else if (text === '/earnings' || text === '/revenue') {
      await this.handleEarningsCommand(chatId)
    } else if (text === '/report' || text === '/briefing') {
      await this.handleReportCommand(chatId)
    } else if (text === '/flush') {
      const res = this.sre.flushLogs()
      await this.sendMessage(chatId, res.success ? '🧹 PM2 logs flushed successfully!' : `❌ ${res.message}`)
    } else if (text.startsWith('/restart ')) {
      const svcName = text.replace('/restart ', '').trim()
      await this.sendMessage(chatId, `🔄 Restarting service: <code>${svcName}</code>...`)
      const res = await this.sre.restartService(svcName)
      await this.sendMessage(chatId, res.success ? `✅ <b>Success:</b> ${res.message}` : `❌ <b>Failed:</b> ${res.message}`)
    } else {
      // Natural Language AI Question
      const sys = await this.sre.getSystemMetrics()
      const fin = await this.finance.getDailyMetrics()
      const context = `System: RAM ${sys.memUsedPct}% used, Disk ${sys.diskUsedPct}% used, ${sys.processes.length} PM2 services. Financials today: ₹${fin.totalDeposits} deposits, ₹${fin.totalWithdrawals} withdrawals, net ₹${fin.netMargin}. Active players: ${fin.activePlayersToday}.`
      
      await this.sendMessage(chatId, '🤔 <i>Consulting Gemini AI...</i>')
      const answer = await this.advisor.answerOwnerQuery(text, context)
      await this.sendMessage(chatId, answer)
    }
  }

  private async handleHelpCommand(chatId: string): Promise<void> {
    const text = `🤖 <b>MyOnlineJoker Autonomous AI Operations Center</b>

Available Commands:
• /status - Live GCP server metrics, PM2 services & memory
• /earnings - Today's P&L (Deposits, Withdrawals, Margin)
• /report - Full AI Executive Briefing (powered by Gemini)
• /restart &lt;service&gt; - Restart any PM2 service safely
• /flush - Flush PM2 logs to free disk space

<i>You can also ask me any question in plain English (e.g. "how are the games running?") and I will answer with live platform data.</i>`

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🖥️ Status', callback_data: 'btn_status' },
          { text: '💵 Earnings', callback_data: 'btn_earnings' }
        ],
        [
          { text: '📊 AI Report', callback_data: 'btn_report' },
          { text: '🧹 Flush Logs', callback_data: 'btn_flush_logs' }
        ]
      ]
    }

    await this.sendMessage(chatId, text, keyboard)
  }

  private async handleStatusCommand(chatId: string): Promise<void> {
    const m = await this.sre.getSystemMetrics()
    const erroredList = m.processes.filter((p) => p.status === 'errored').map((p) => p.name)

    const text = `🖥️ <b>GCP Server & SRE Health Report</b>
-----------------------------------
🧠 <b>Memory:</b> ${m.memUsedPct}% used (${m.freeMemMb} MB free of ${m.totalMemMb} MB)
💾 <b>Disk Space:</b> ${m.diskFreeGb} GB free (${m.diskUsedPct}% used)
🗄️ <b>PostgreSQL:</b> ${m.dbConnected ? '🟢 Online' : '🔴 OFFLINE'} (${m.dbLatencyMs}ms)
⚡ <b>Redis:</b> ${m.redisConnected ? '🟢 Online' : '🔴 OFFLINE'} (${m.redisLatencyMs}ms)

⚙️ <b>PM2 Microservices:</b> ${m.processes.length} total
${m.erroredCount > 0 ? `⚠️ <b>CRASHED SERVICES:</b> ${erroredList.join(', ')}\n` : '✅ All services operating normally.'}
`
    const keyboard = {
      inline_keyboard: [
        [
          { text: '🔄 Refresh', callback_data: 'btn_status' },
          { text: '📊 Full AI Report', callback_data: 'btn_report' }
        ]
      ]
    }

    await this.sendMessage(chatId, text, keyboard)
  }

  private async handleEarningsCommand(chatId: string): Promise<void> {
    const f = await this.finance.getDailyMetrics()

    const text = `💵 <b>MyOnlineJoker Financial Performance</b>
Date: ${f.period}
-----------------------------------
📥 <b>Deposits:</b> ₹${f.totalDeposits.toLocaleString('en-IN')} (${f.depositsCount} orders)
📤 <b>Withdrawals:</b> ₹${f.totalWithdrawals.toLocaleString('en-IN')} (${f.withdrawalsCount} orders)
📈 <b>Net Company Margin:</b> ₹${f.netMargin.toLocaleString('en-IN')}
👥 <b>Active Players Today:</b> ${f.activePlayersToday}

⏳ <b>Pending Cashouts:</b> ${f.pendingWithdrawalsCount} (₹${f.pendingWithdrawalsSum.toLocaleString('en-IN')})
`
    await this.sendMessage(chatId, text)
  }

  private async handleReportCommand(chatId: string): Promise<void> {
    await this.sendMessage(chatId, '⏳ <i>Generating AI Executive Briefing with Gemini 2.0...</i>')
    const sys = await this.sre.getSystemMetrics()
    const fin = await this.finance.getDailyMetrics()
    const pending = await this.finance.getPendingWithdrawals(3)

    const briefing = await this.advisor.generateExecutiveBriefing(sys, fin, pending)
    await this.sendMessage(chatId, briefing)
  }
}
