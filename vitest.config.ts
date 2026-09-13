import { defineConfig } from "vitest/config";
import path from "path";
import dotenv from "dotenv";

// Optional local values never override explicit CI or integration-test credentials.
dotenv.config({ path: path.resolve(import.meta.dirname, ".env"), override: false });

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      BIS_DATABASE_URL: process.env.BIS_DATABASE_URL ?? "",
    },
  },
});
