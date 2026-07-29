// Mock implementation of kafkajs
const EventEmitter = require('events');

const mockStorage = {
  messages: new Map(),
  handlers: new Map(),
  subscribers: new Map(),
  activeConsumers: [],
};

// Helper to deliver messages to active consumers
function deliverMessageToConsumers(topic, message) {
  for (const consumer of mockStorage.activeConsumers) {
    if (consumer.subscriptions.includes(topic) && consumer.eachMessage) {
      consumer.eachMessage({
        topic,
        partition: 0,
        message,
        heartbeat: async () => {},
      }).catch((err) => {
        console.error('Error in eachMessage handler:', err);
      });
    }
  }
}

class MockProducer extends EventEmitter {
  async connect() {
    return Promise.resolve();
  }

  async disconnect() {
    return Promise.resolve();
  }

  async sendBatch({ topicMessages }) {
    for (const { topic, messages } of topicMessages) {
      if (!mockStorage.messages.has(topic)) {
        mockStorage.messages.set(topic, []);
      }
      const topicMessagesList = mockStorage.messages.get(topic);
      topicMessagesList.push(...messages);

      // Deliver to active consumers immediately
      for (const message of messages) {
        deliverMessageToConsumers(topic, message);
      }
    }
    return Promise.resolve([{ topicMessages }]);
  }

  async send({ topic, messages }) {
    if (!mockStorage.messages.has(topic)) {
      mockStorage.messages.set(topic, []);
    }
    mockStorage.messages.get(topic).push(...messages);

    // Deliver to active consumers immediately
    for (const message of messages) {
      deliverMessageToConsumers(topic, message);
    }

    return Promise.resolve([{ topic, messages }]);
  }
}

class MockConsumer extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.eachMessage = null;
    this.subscriptions = [];
    this.processedUpTo = new Map(); // Track which messages we've already processed
  }

  async connect() {
    return Promise.resolve();
  }

  async disconnect() {
    // Reset processed messages on disconnect
    this.processedUpTo.clear();
    this.subscriptions = [];
    return Promise.resolve();
  }

  async subscribe({ topic, fromBeginning }) {
    if (!mockStorage.subscribers.has(topic)) {
      mockStorage.subscribers.set(topic, []);
    }
    // Add topic if not already in subscriptions
    if (!this.subscriptions.includes(topic)) {
      this.subscriptions.push(topic);
      // Reset processed count for new subscriptions
      this.processedUpTo.set(topic, fromBeginning ? -1 : (mockStorage.messages.get(topic)?.length || 0));
    }
    return Promise.resolve();
  }

  async run({ eachMessage }) {
    // Store the handler for this consumer
    this.eachMessage = eachMessage;

    // Register this consumer as active
    mockStorage.activeConsumers.push(this);

    // Process messages that were published before run() was called
    setImmediate(async () => {
      for (const topic of this.subscriptions) {
        if (mockStorage.messages.has(topic)) {
          const messages = mockStorage.messages.get(topic);
          const processedCount = this.processedUpTo.get(topic) || -1;

          // Only process messages after the last processed index
          for (let i = processedCount + 1; i < messages.length; i++) {
            const message = messages[i];
            await eachMessage({
              topic,
              partition: 0,
              message,
              heartbeat: async () => {},
            }).catch((err) => {
              console.error('Error in eachMessage handler:', err);
            });
            this.processedUpTo.set(topic, i);
          }
        }
      }
    });

    // Return immediately (don't block)
    return Promise.resolve();
  }

  async stop() {
    // Unregister this consumer
    const index = mockStorage.activeConsumers.indexOf(this);
    if (index > -1) {
      mockStorage.activeConsumers.splice(index, 1);
    }

    this.eachMessage = null;
    return Promise.resolve();
  }

  async pause() {
    return Promise.resolve();
  }

  async resume() {
    return Promise.resolve();
  }
}

class MockAdmin {
  async connect() {
    return Promise.resolve();
  }

  async disconnect() {
    return Promise.resolve();
  }

  async listTopics() {
    return Promise.resolve(Array.from(mockStorage.messages.keys()));
  }

  async createTopics({ topics }) {
    for (const topicConfig of topics) {
      if (!mockStorage.messages.has(topicConfig.topic)) {
        mockStorage.messages.set(topicConfig.topic, []);
      }
    }
    return Promise.resolve([]);
  }

  async deleteTopics({ topics }) {
    for (const topic of topics) {
      mockStorage.messages.delete(topic);
    }
    return Promise.resolve([]);
  }

  async fetchTopicMetadata({ topics }) {
    return Promise.resolve({ topics: [] });
  }
}

class MockKafka {
  constructor(config) {
    this.config = config;
  }

  producer(config) {
    return new MockProducer();
  }

  consumer(config) {
    return new MockConsumer(config);
  }

  admin(config) {
    return new MockAdmin();
  }
}

module.exports = {
  Kafka: MockKafka,
  logLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NOTHING: 4,
  },
  kafkaMockStorage: mockStorage,
};

// Make mockStorage available globally for tests
global.__kafkaMockStorage = mockStorage;
