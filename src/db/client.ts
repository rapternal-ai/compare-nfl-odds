import postgres from "postgres";

export function createDatabase(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is required");
  return postgres(url, { max: 5, idle_timeout: 20 });
}

export type Database = ReturnType<typeof createDatabase>;
