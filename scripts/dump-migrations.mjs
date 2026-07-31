// Baixa todas as migrações aplicadas do banco (supabase_migrations.schema_migrations)
// e grava um arquivo por migração em supabase/migrations/.
//
// Uso (PowerShell), com a senha do banco na variável de ambiente:
//   npm i pg
//   $env:PGPASSWORD="SUA_SENHA_DO_BANCO"; node scripts/dump-migrations.mjs
//
// A senha NÃO fica salva em nenhum arquivo; é lida de PGPASSWORD em tempo de execução.

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import pg from "pg";

const url = readFileSync("supabase/.temp/pooler-url", "utf8").trim();
if (!process.env.PGPASSWORD) {
  console.error('Defina a senha do banco antes de rodar:\n  $env:PGPASSWORD="SUA_SENHA"; node scripts/dump-migrations.mjs');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
const { rows } = await client.query(
  "select version, name, array_to_string(statements, E'\\n') as sql " +
  "from supabase_migrations.schema_migrations order by version",
);

mkdirSync("supabase/migrations", { recursive: true });
let n = 0;
for (const r of rows) {
  const safe = String(r.name || "migration").replace(/[^\w.-]+/g, "_");
  writeFileSync(`supabase/migrations/${r.version}_${safe}.sql`, (r.sql ?? "") + "\n");
  n++;
}
console.log(`Gerados ${n} arquivo(s) em supabase/migrations/`);
await client.end();
