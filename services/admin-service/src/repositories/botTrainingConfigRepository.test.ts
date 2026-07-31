import { describe, it, expect } from 'vitest'
import { BotTrainingConfigRepository } from './botTrainingConfigRepository'

class MockRedis {
  private store = new Map<string, string>()
  async get(key: string) { return this.store.get(key) ?? null }
  async setex(key: string, _ttl: number, value: string) { this.store.set(key, value) }
  async del(key: string) { this.store.delete(key) }
}

class MockDb {
  async query(_sql: string, _params: any[] = []) { return { rows: [] } }
}

describe('BotTrainingConfigRepository - tiered_hard_wins (admin-service)', () => {
  it('default config includes fallbackStrategy = lifetime_winrate', async () => {
    const repo = new BotTrainingConfigRepository(new MockRedis() as any, new MockDb() as any)
    const config = await repo.getConfig('teen_patti')
    expect(config.fallbackStrategy).toBe('lifetime_winrate')
  })

  it('accepts tiered_hard_wins as a valid strategy', async () => {
    const repo = new BotTrainingConfigRepository(new MockRedis() as any, new MockDb() as any)
    const config = await repo.getConfig('teen_patti')
    await expect(
      repo.updateConfig('teen_patti', { ...config, strategy: 'tiered_hard_wins', fallbackStrategy: 'weakest_first' })
    ).resolves.not.toThrow()
  })

  it('rejects an invalid fallbackStrategy value', async () => {
    const repo = new BotTrainingConfigRepository(new MockRedis() as any, new MockDb() as any)
    const config = await repo.getConfig('teen_patti')
    await expect(
      repo.updateConfig('teen_patti', { ...config, fallbackStrategy: 'bogus' as any })
    ).rejects.toThrow('fallbackStrategy must be one of')
  })

  it('rejects an invalid strategy value', async () => {
    const repo = new BotTrainingConfigRepository(new MockRedis() as any, new MockDb() as any)
    const config = await repo.getConfig('teen_patti')
    await expect(
      repo.updateConfig('teen_patti', { ...config, strategy: 'bogus' as any })
    ).rejects.toThrow('strategy must be one of')
  })
})
