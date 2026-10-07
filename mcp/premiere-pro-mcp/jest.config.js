export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // Keep tests off the real telemetry database.
  setupFiles: ['<rootDir>/src/__tests__/support/setup-env.ts'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
    }],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleNameMapper: {
    // The one import.meta user; see src/utils/package-root.ts.
    '^(\\.{1,2}/)+utils/package-root(\\.js)?$': '<rootDir>/src/__tests__/support/package-root.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  testTimeout: 10000,
  verbose: true,
  transformIgnorePatterns: [
    'node_modules/(?!(@modelcontextprotocol)/)',
  ],
};
