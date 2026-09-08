import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { defineConfig, env } from "prisma/config";

let configDir = ".";
try {
  if (import.meta.url) {
    configDir = path.dirname(fileURLToPath(import.meta.url));
  }
} catch {
  if (typeof __dirname !== "undefined") {
    configDir = __dirname;
  }
}

dotenv.config({ path: path.resolve(configDir, ".env") });

export default defineConfig({
  schema: "packages/db/prisma/schema.prisma",
  migrations: {
    path: "packages/db/prisma/migrations",
    seed: "npx tsx packages/db/src/seed-cli.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});