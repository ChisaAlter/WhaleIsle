import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Date-time strings format in the viewer's zone; tests pin it.
  test: { environment: "node", include: ["src/**/*.test.ts"], env: { TZ: "UTC" } },
});
