import { defineConfig } from "drizzle-kit";

/**
 * `db:generate` never connects to a database, so the fallback below is a
 * syntactically valid placeholder, not a credential. `db:migrate` requires a
 * real DIRECT_URL and will fail loudly without one.
 */
export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DIRECT_URL ??
      "postgres://placeholder:placeholder@localhost:5432/placeholder",
  },
  strict: true,
  verbose: true,
});
