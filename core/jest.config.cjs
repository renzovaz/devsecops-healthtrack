/** Jest roda o núcleo a partir do código-fonte TypeScript (transformado para CommonJS só nos testes). */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', moduleResolution: 'node', lib: ['ES2022', 'DOM'], types: ['jest'], strict: true, noUncheckedIndexedAccess: true } }],
  },
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  collectCoverageFrom: ['src/**/*.ts'],
  coverageThreshold: { global: { lines: 90, branches: 80 } },
};
