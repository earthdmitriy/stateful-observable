import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.spec.ts"],
    typecheck: {
      enabled: true,
      include: ["tests/**/*.spec.ts"], // Targets your exact test files
      tsconfig: "./tsconfig.spec.json",
    },
  },
});
