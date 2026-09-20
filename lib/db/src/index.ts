import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const supabasePassword = process.env.SUPABASE_DB_PASSWORD;
const supabaseHost = process.env.SUPABASE_DB_HOST;
const supabaseUser = process.env.SUPABASE_DB_USER;
const supabasePort = process.env.SUPABASE_DB_PORT ?? "5432";
const supabaseDatabase = process.env.SUPABASE_DB_NAME ?? "postgres";

const connectionString =
  supabasePassword && supabaseHost && supabaseUser
    ? `postgresql://${encodeURIComponent(supabaseUser)}:${encodeURIComponent(supabasePassword)}@${supabaseHost}:${supabasePort}/${supabaseDatabase}`
    : process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "A database connection must be configured.",
  );
}

export const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  options: "-c search_path=afucloud,public",
});
export const db = drizzle(pool, { schema });

export * from "./schema";
