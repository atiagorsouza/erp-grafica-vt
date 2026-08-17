// PrintFlow ERP · sincroniza document_counters com documentos já existentes
// Evita colisão após seed/importação manual de ORC/PED/PDV/CMP.
import pg from "pg";
import "dotenv/config";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não definido");
  process.exit(1);
}

const DOCS = [
  { type: "quote", table: "quotes", fallbackPrefix: "ORC", setting: "document_prefix_quote" },
  { type: "order", table: "orders", fallbackPrefix: "PED", setting: "document_prefix_order" },
  { type: "sale", table: "sales", fallbackPrefix: "PDV", setting: "document_prefix_sale" },
  { type: "purchase", table: "purchases", fallbackPrefix: "CMP", setting: "document_prefix_purchase" },
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: settings } = await client.query(`SELECT key, value FROM settings`);
    const map = new Map(settings.map((r) => [r.key, r.value || ""]));
    const mode = map.get("document_number_mode") || "annual";
    const currentYear = new Date().getFullYear();

    let touched = 0;
    for (const doc of DOCS) {
      const prefix = String(map.get(doc.setting) || doc.fallbackPrefix)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "") || doc.fallbackPrefix;

      const { rows } = await client.query(
        `SELECT number FROM ${doc.table} WHERE number IS NOT NULL AND number <> ''`
      );

      const byYear = new Map();
      for (const row of rows) {
        const number = String(row.number || "");
        const matchAnnual = number.match(new RegExp(`^${prefix}-(\\d{4})-(\\d+)$`, "i"));
        const matchContinuous = number.match(new RegExp(`^${prefix}-(\\d+)$`, "i"));

        if (matchAnnual) {
          const year = Number(matchAnnual[1]);
          const seq = Number(matchAnnual[2]);
          if (Number.isFinite(year) && Number.isFinite(seq)) {
            byYear.set(year, Math.max(byYear.get(year) || 0, seq));
          }
        } else if (matchContinuous) {
          const seq = Number(matchContinuous[1]);
          if (Number.isFinite(seq)) byYear.set(0, Math.max(byYear.get(0) || 0, seq));
        }
      }

      if (mode === "annual" && !byYear.has(currentYear)) byYear.set(currentYear, 0);
      if (mode !== "annual" && !byYear.has(0)) byYear.set(0, 0);

      for (const [year, current] of byYear.entries()) {
        await client.query(
          `INSERT INTO document_counters (document_type, year, current, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (document_type, year)
           DO UPDATE SET current = GREATEST(document_counters.current, EXCLUDED.current), updated_at = NOW()`,
          [doc.type, year, current]
        );
        touched++;
      }
    }

    await client.query("COMMIT");
    console.log(`✅ Contadores sincronizados (${touched} registros verificados).`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("❌ sync-document-counters falhou:", e.message);
  process.exit(1);
});
