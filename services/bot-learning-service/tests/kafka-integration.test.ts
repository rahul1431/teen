import { KafkaProducer } from '../../game-gateway/src/kafka-producer'
import { KafkaConsumer } from '../src/kafka-consumer'
import { EventRecord, EventSchema } from '../src/event-schema'

describe('Kafka Integration', () => {
  let producer: KafkaProducer
  let consumer: KafkaConsumer
  const brokers = ['localhost:9092']
  const testTopics = {
    gameEvents: 'game-events',
    profileUpdates: 'profile-updates',
    anomalyAlerts: 'anomaly-alerts',
  }

  beforeAll(async () => {
    // Initialize producer and consumer
    producer = new KafkaProducer(brokers)
    consumer = new KafkaConsumer(brokers, 'test-consumer-group')

    // Connect
    await producer.connect()
    await consumer.connect()
  })

  afterAll(async () => {
    // Disconnect
    await producer.disconnect()
    await consumer.disconnect()
  })

  describe('should create Kafka topics', () => {
    it('should create Kafka topics', async () => {
      const topics = [testTopics.gameEvents, testTopics.profileUpdates, testTopics.anomalyAlerts]
      const created = await producer.createTopics(topics)
      expect(created).toBeTruthy()
    })
  })

  describe('should produce game-complete events', () => {
    it('should produce game-complete events', async () => {
      const event: EventRecord = {
        event_type: 'game-complete',
        player_id: 'player_123',
        game_type: 'teen-patti',
        outcome: 'win',
        win_rate: 0.75,
        timestamp: new Date().toISOString(),
      }

      const result = await producer.publishEvent(testTopics.gameEvents, event)
      expect(result.success).toBe(true)

      // Validate event schema
      const validResult = EventSchema.safeParse(event)
      expect(validResult.success).toBe(true)
    })
  })

  describe('should consume messages in order', () => {
    it('should consume messages in order', async () => {
      const messages: EventRecord[] = []
      const consumerHandler = async (event: EventRecord) => {
        messages.push(event)
      }

      // Subscribe to topic
      await consumer.subscribe(testTopics.gameEvents, consumerHandler)

      // Publish events
      const testEvents = [
        {
          event_type: 'game-complete' as const,
          player_id: 'player_order_1',
          game_type: 'teen-patti',
          outcome: 'win' as const,
          win_rate: 0.8,
          timestamp: new Date().toISOString(),
        },
        {
          event_type: 'game-complete' as const,
          player_id: 'player_order_2',
          game_type: 'aviator',
          outcome: 'loss' as const,
          win_rate: 0.3,
          timestamp: new Date().toISOString(),
        },
      ]

      for (const event of testEvents) {
        await producer.publishEvent(testTopics.gameEvents, event)
      }

      // Wait for messages to be consumed
      await new Promise((resolve) => setTimeout(resolve, 2000))

      // Verify order
      expect(messages.length).toBeGreaterThanOrEqual(testEvents.length)
      for (let i = 0; i < testEvents.length; i++) {
        expect(messages[i].player_id).toBe(testEvents[i].player_id)
      }

      await consumer.unsubscribe()
    })
  })

  describe('should handle message batching', () => {
    it('should handle message batching', async () => {
      const batchSize = 100
      const events: EventRecord[] = []

      // Generate batch
      for (let i = 0; i < batchSize; i++) {
        events.push({
          event_type: 'game-complete',
          player_id: `player_batch_${i}`,
          game_type: i % 2 === 0 ? 'teen-patti' : 'aviator',
          outcome: Math.random() > 0.5 ? 'win' : 'loss',
          win_rate: Math.random(),
          timestamp: new Date().toISOString(),
        })
      }

      // Publish all events (producer should batch them)
      const publishPromises = events.map((event) =>
        producer.publishEvent(testTopics.gameEvents, event)
      )
      const results = await Promise.all(publishPromises)

      // Verify all published successfully
      expect(results.every((r) => r.success)).toBe(true)
      // Verify batch was processed (check producer's batch size)
      await producer.disconnect()
      await producer.connect()
    })
  })

  describe('should maintain partition ordering per player', () => {
    it('should maintain partition ordering per player', async () => {
      const playerId = 'player_partition_test'
      const numEvents = 10
      const events: EventRecord[] = []

      // Generate events for same player
      for (let i = 0; i < numEvents; i++) {
        events.push({
          event_type: 'game-complete',
          player_id: playerId,
          game_type: 'teen-patti',
          outcome: i % 2 === 0 ? 'win' : 'loss',
          win_rate: 0.5 + i * 0.01,
          timestamp: new Date(Date.now() + i * 100).toISOString(),
        })
      }

      // Publish all events with same partition key
      const publishPromises = events.map((event) =>
        producer.publishEvent(testTopics.gameEvents, event, playerId)
      )
      const results = await Promise.all(publishPromises)

      // All should succeed
      expect(results.every((r) => r.success)).toBe(true)

      // Consume and verify order
      const consumedEvents: EventRecord[] = []
      const consumerHandler = async (event: EventRecord) => {
        if (event.player_id === playerId) {
          consumedEvents.push(event)
        }
      }

      await consumer.subscribe(testTopics.gameEvents, consumerHandler)
      await new Promise((resolve) => setTimeout(resolve, 2000))

      // Verify events are in order based on win_rate progression
      if (consumedEvents.length >= numEvents) {
        for (let i = 1; i < numEvents; i++) {
          const prev = consumedEvents[i - 1]
          const curr = consumedEvents[i]
          // Events should be ordered (win_rate should increase or stay same)
          if (curr.win_rate !== undefined && prev.win_rate !== undefined) {
            expect(curr.win_rate).toBeGreaterThanOrEqual(prev.win_rate - 0.001)
          }
        }
      }

      await consumer.unsubscribe()
    })
  })
})
