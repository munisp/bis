import { defineConfig } from "vitest/config";
import path from "path";
import dotenv from "dotenv";

// Load .env so DATABASE_URL and other secrets are available in tests
dotenv.config({ path: path.resolve(import.meta.dirname, ".env") });

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
      // DATABASE_URL is loaded from .env above; this fallback is only used in CI without .env
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://bis_user:bis_secure_2026@localhost:5432/bis_db",
    },
  },
});
