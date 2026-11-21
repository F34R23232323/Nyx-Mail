import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@nyxmail/crypto/server": root("./crypto/src/server.ts"),
      "@nyxmail/crypto": root("./crypto/src/index.ts"),
      "@nyxmail/shared/domains": root("./shared/src/domains.ts"),
      "@nyxmail/shared/parsers": root("./shared/src/parsers.ts"),
      "@nyxmail/shared/secrets": root("./shared/src/secrets.ts"),
      "@nyxmail/shared/storage": root("./shared/src/storage.ts"),
      "@nyxmail/shared": root("./shared/src/index.ts"),
      "@nyxmail/db": root("./db/src/index.ts"),
      "@nyxmail/server": root("./server/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: [
      "crypto/tests/**/*.test.ts",
      "shared/tests/**/*.test.ts",
      "server/tests/**/*.test.ts",
      "workers/tests/**/*.test.ts",
      "web/tests/unit/**/*.test.ts",
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
