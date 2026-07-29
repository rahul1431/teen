// Get the kafkajs mock module and clear storage before/after each test
beforeEach(() => {
  // Use real timers but let pending timers from previous tests finish first
  jest.useRealTimers();

  // Import the mock to get access to storage
  const kafkaMock = require('kafkajs');
  if (global.__kafkaMockStorage) {
    global.__kafkaMockStorage.messages.clear();
    global.__kafkaMockStorage.handlers.clear();
    global.__kafkaMockStorage.subscribers.clear();
    global.__kafkaMockStorage.activeConsumers = [];
  }
});

afterEach(() => {
  if (global.__kafkaMockStorage) {
    global.__kafkaMockStorage.messages.clear();
    global.__kafkaMockStorage.handlers.clear();
    global.__kafkaMockStorage.subscribers.clear();
    global.__kafkaMockStorage.activeConsumers = [];
  }
});
