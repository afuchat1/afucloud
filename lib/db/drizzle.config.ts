import { defineConfig } from "drizzle-kit";
import path from "path";

const dbUrl = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error("POSTGRES_URL must be set, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
    ssl: true,
  },
});
