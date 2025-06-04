export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'index.js',
    '!**/node_modules/**'
  ],
  clearMocks: true,
  resetMocks: true
};