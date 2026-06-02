import { defineConfig } from "vitest/config";

// The api-server tests are integration tests that run against the real
// Postgres pointed to by DATABASE_URL (the same connection the server uses).
// They seed throw-away rows under random ids and clean up after themselves.
// File parallelism is disabled so concurrent suites can't interfere through
// the shared connection pool.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
