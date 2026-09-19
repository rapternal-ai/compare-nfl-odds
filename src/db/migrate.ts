import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createDatabase } from "./client";

async function main() {
  const sql = createDatabase();
  try {
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const applied = new Set((await sql`SELECT name FROM schema_migrations`).map((r) => r.name));
    const files = (await readdir(join(process.cwd(), "db/migrations"))).filter((name) => name.endsWith(".sql")).sort();
    let any = false;
    for (const name of files) {
      if (applied.has(name)) {
        process.stdout.write(`${name} already applied\n`);
        continue;
      }
      const migration = await readFile(join(process.cwd(), "db/migrations", name), "utf8");
      await sql.begin(async (transaction) => {
        await transaction.unsafe(migration);
        await transaction`INSERT INTO schema_migrations (name) VALUES (${name})`;
      });
      process.stdout.write(`Applied db/migrations/${name}\n`);
      any = true;
    }
    if (!any) process.stdout.write("All migrations already applied\n");
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Migration failed"}\n`);
  process.exitCode = 1;
});
