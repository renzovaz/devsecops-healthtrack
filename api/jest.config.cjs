/** Os testes da API usam o código-fonte do núcleo (core/src), transformado pelo ts-jest. */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', moduleResolution: 'node', esModuleInterop: true, lib: ['ES2022', 'DOM'], types: ['jest', 'node'], strict: true, baseUrl: '.', paths: { '@healthtrack/core': ['../core/src/index.ts'] } } }],
  },
  moduleNameMapper: {
    '^@healthtrack/core$': '<rootDir>/../core/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/server.ts', '!src/token.ts'],
};
