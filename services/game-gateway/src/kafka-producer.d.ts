import { EventRecord } from '../../../services/bot-learning-service/src/event-schema';
/**
 * KafkaProducer - Publishes game events to Kafka topics
 *
 * Features:
 * - Batch publishing (100 events or 5s timeout)
 * - Partition key support for per-player ordering
 * - JSON validation before publishing
 * - Automatic topic creation
 */
export declare class KafkaProducer {
    private kafka;
    private producer;
    private brokers;
    private batch;
    private batchTimer;
    private readonly BATCH_SIZE;
    private readonly BATCH_TIMEOUT;
    private connected;
    constructor(brokers?: string[]);
    /**
     * Connect to Kafka broker
     */
    connect(): Promise<void>;
    /**
     * Disconnect from Kafka broker
     */
    disconnect(): Promise<void>;
    /**
     * Create Kafka topics
     */
    createTopics(topicNames: string[]): Promise<boolean>;
    /**
     * Publish a single game event
     * Batches events for efficient transport
     *
     * @param topic - Kafka topic to publish to
     * @param event - EventRecord to publish
     * @param partitionKey - Optional partition key (defaults to player_id)
     */
    publishEvent(topic: string, event: EventRecord, partitionKey?: string): Promise<{
        success: boolean;
        error?: string;
    }>;
    /**
     * Start the batch timeout timer
     */
    private startBatchTimer;
    /**
     * Flush the batch and send to Kafka
     */
    private flushBatch;
    /**
     * Get current batch size
     */
    getBatchSize(): number;
    /**
     * Check if producer is connected
     */
    isConnected(): boolean;
}
export declare function getKafkaProducer(): Promise<KafkaProducer>;
export declare function shutdownKafkaProducer(): Promise<void>;
//# sourceMappingURL=kafka-producer.d.ts.map