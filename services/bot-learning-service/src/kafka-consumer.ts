import { Kafka, Consumer, logLevel, ConsumerConfig } from 'kafkajs'
import { EventRecord, validateEvent } from './event-schema'
import pino from 'pino'

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

/**
 * EventHandler interface for processing events
 */
export interface EventHandler {
  (event: EventRecord): Promise<void>
}

/**
 * ErrorHandler interface for handling errors
 */
export interface ErrorHandler {
  (error: Error): Promise<void>
}

/**
 * KafkaConsumer - Consumes game events from Kafka topics
 *
 * Features:
 * - Message deserialization and validation
 * - Topic subscription with handler
 * - Error handling with configurable callbacks
 * - Graceful shutdown
 */
export class KafkaConsumer {
  private kafka: Kafka
  private consumer: Consumer | null = null
  private brokers: string[]
  private groupId: string
  private handlers: Map<string, EventHandler> = new Map()
  private errorHandlers: ErrorHandler[] = []
  private connected = false
  private subscriptions: Set<string> = new Set()

  constructor(brokers: string[] = ['localhost:9092'], groupId: string = 'bot-learning-consumer') {
    this.brokers = brokers
    this.groupId = groupId
    this.kafka = new Kafka({
      clientId: `${groupId}-client`,
      brokers: this.brokers,
      logLevel: logLevel.ERROR,
    })
  }

  /**
   * Connect to Kafka broker
   */
  async connect(): Promise<void> {
    if (this.connected) return

    const consumerConfig: ConsumerConfig = {
      groupId: this.groupId,
      sessionTimeout: 30000,
      rebalanceTimeout: 60000,
      heartbeatInterval: 3000,
      retry: {
        maxRetryTime: 30000,
        initialRetryTime: 300,
        retries: 8,
      },
    }

    this.consumer = this.kafka.consumer(consumerConfig)

    // Attach event listeners
    this.consumer.on('consumer.crash', (payload: any) => {
      logger.error('Consumer crashed:', payload)
      if (payload.error) {
        this.handleError(payload.error)
      }
    })

    this.consumer.on('consumer.network.request', (payload) => {
      if (payload.payload.apiName === 'Fetch') {
        logger.debug(`Fetch request to broker`)
      }
    })

    await this.consumer.connect()
    this.connected = true
    logger.info(`Kafka consumer connected to group: ${this.groupId}`)
  }

  /**
   * Disconnect from Kafka broker
   */
  async disconnect(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect()
      this.consumer = null
      this.connected = false
      this.subscriptions.clear()
      logger.info('Kafka consumer disconnected')
    }
  }

  /**
   * Subscribe to a topic and handle messages
   *
   * @param topic - Kafka topic to subscribe to
   * @param handler - Async function to handle each message
   */
  async subscribe(topic: string, handler: EventHandler): Promise<void> {
    if (!this.connected || !this.consumer) {
      throw new Error('Consumer not connected')
    }

    if (this.subscriptions.has(topic)) {
      logger.warn(`Already subscribed to topic: ${topic}`)
      return
    }

    this.handlers.set(topic, handler)
    this.subscriptions.add(topic)

    try {
      await this.consumer.subscribe({ topic, fromBeginning: true })

      // Start consuming
      await this.consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          try {
            if (!message.value) {
              logger.warn('Received message with no value')
              return
            }

            // Deserialize message
            const eventData = JSON.parse(message.value.toString())

            // Validate against schema
            const validation = validateEvent(eventData)
            if (!validation.valid) {
              logger.warn(`Invalid event received: ${validation.error}`)
              return
            }

            const event = eventData as EventRecord

            // Call handler
            const handler = this.handlers.get(topic)
            if (handler) {
              await handler(event)
            }

            logger.debug(
              `Processed event: ${event.event_type} from player ${event.player_id} on partition ${partition}`
            )
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error))
            logger.error('Error processing message:', err)
            await this.handleError(err)
          }
        },
      })

      logger.info(`Subscribed to topic: ${topic}`)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      logger.error(`Error subscribing to topic ${topic}:`, err)
      throw err
    }
  }

  /**
   * Unsubscribe from a topic
   */
  async unsubscribe(): Promise<void> {
    if (!this.connected || !this.consumer) {
      return
    }

    try {
      // Stop consuming (but don't disconnect to allow future subscriptions)
      await this.consumer.stop()

      this.subscriptions.clear()
      this.handlers.clear()

      logger.info('Unsubscribed from all topics')
    } catch (error) {
      logger.error('Error unsubscribing:', error)
    }
  }

  /**
   * Register error handler
   */
  async onError(handler: ErrorHandler): Promise<void> {
    this.errorHandlers.push(handler)
  }

  /**
   * Handle errors by calling all registered error handlers
   */
  private async handleError(error: Error): Promise<void> {
    for (const handler of this.errorHandlers) {
      try {
        await handler(error)
      } catch (err) {
        logger.error('Error in error handler:', err)
      }
    }
  }

  /**
   * Check if consumer is connected
   */
  isConnected(): boolean {
    return this.connected
  }

  /**
   * Get active subscriptions
   */
  getSubscriptions(): string[] {
    return Array.from(this.subscriptions)
  }
}

/**
 * Singleton instance for use across bot-learning-service
 */
let consumerInstance: KafkaConsumer | null = null

export async function getKafkaConsumer(groupId?: string): Promise<KafkaConsumer> {
  if (!consumerInstance) {
    const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
    consumerInstance = new KafkaConsumer(brokers, groupId)
    await consumerInstance.connect()
  }
  return consumerInstance
}

export async function shutdownKafkaConsumer(): Promise<void> {
  if (consumerInstance) {
    await consumerInstance.disconnect()
    consumerInstance = null
  }
}
