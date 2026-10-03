import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/familymart_map/",
  test: {
    environment: "jsdom",
    restoreMocks: true,
    clearMocks: true,
    maxWorkers: 1,
    fileParallelism: false,
  },
});
