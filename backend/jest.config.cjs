module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.spec.ts'],
  testTimeout: 120000,
  maxWorkers: 1,
  globals: { 'ts-jest': { tsconfig: { rootDir: '.', experimentalDecorators: true, emitDecoratorMetadata: true } } }
};
