module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
    collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/**/__tests__/**'],
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
    transform: {
        '^.+\\.(t|j)sx?$': '@swc/jest',
    },
    transformIgnorePatterns: ['node_modules/(?!(uuid)/)'],
    testTimeout: 10000,
    globalSetup: '<rootDir>/jest/globalSetup.ts',
};
