module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testTimeout: 10000,
  moduleNameMapper: {
    '^kafkajs$': '<rootDir>/__mocks__/kafkajs.js',
  },
};
