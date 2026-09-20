import { defineConfig } from "drizzle-kit";
import path from "path";

const supabasePassword = process.env.SUPABASE_DB_PASSWORD;
const supabaseHost = process.env.SUPABASE_DB_HOST;
const supabaseUser = process.env.SUPABASE_DB_USER;
const supabasePort = process.env.SUPABASE_DB_PORT ?? "5432";
const supabaseDatabase = process.env.SUPABASE_DB_NAME ?? "postgres";

const dbUrl =
  supabasePassword && supabaseHost && supabaseUser
    ? `postgresql://${encodeURIComponent(supabaseUser)}:${encodeURIComponent(supabasePassword)}@${supabaseHost}:${supabasePort}/${supabaseDatabase}`
    : process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error("A database connection must be configured");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
    ssl: true,
    options: "-c search_path=public,afucloud",
  },
});
