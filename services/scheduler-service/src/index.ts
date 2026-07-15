import 'dotenv/config'
import { startLotteryDailyScheduler } from './jobs/lottery-daily-draws'

async function start() {
  console.log('Scheduler service starting...')

  // Initialize and start lottery daily scheduler
  startLotteryDailyScheduler()

  // Keep the process alive
  process.on('SIGINT', () => {
    console.log('Scheduler service shutting down...')
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    console.log('Scheduler service shutting down...')
    process.exit(0)
  })
}

start().catch((err) => {
  console.error('Failed to start scheduler service:', err)
  process.exit(1)
})
