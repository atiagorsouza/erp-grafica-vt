// PrintFlow ERP · garante configurações novas sem sobrescrever dados existentes
// Uso: node scripts/ensure-settings.mjs
import pg from "pg";
import "dotenv/config";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não definido");
  process.exit(1);
}

const SETTINGS = [
  // empresa
  ["company_name", "Gráfica VT Digital", "empresa"],
  ["company_legal_name", "", "empresa"],
  ["company_trade_name", "Gráfica VT Digital", "empresa"],
  ["company_cnpj", "", "empresa"],
  ["company_email", "", "empresa"],
  ["company_phone", "(21) 3000-0000", "empresa"],
  ["company_phone2", "", "empresa"],
  ["company_whatsapp", "", "empresa"],
  ["company_website", "", "empresa"],
  ["company_street", "", "empresa"],
  ["company_number", "", "empresa"],
  ["company_district", "", "empresa"],
  ["company_city", "", "empresa"],
  ["company_state", "", "empresa"],
  ["company_cep", "", "empresa"],
  ["pix_key", "contato@graficavtdigital.com.br", "empresa"],

  // tributação / precificação
  ["operational_rate", "15", "tributacao"],
  ["tax_rate", "6", "tributacao"],
  ["card_fee_debit", "1.99", "tributacao"],
  ["card_fee_credit", "4.99", "tributacao"],

  // documentos
  ["document_number_mode", "annual", "documentos"],
  ["document_number_width", "4", "documentos"],
  ["document_prefix_quote", "ORC", "documentos"],
  ["document_prefix_order", "PED", "documentos"],
  ["document_prefix_sale", "PDV", "documentos"],
  ["document_prefix_purchase", "CMP", "documentos"],

  // PDV
  ["pdv_seller_default", "OPERADOR", "pdv"],
  ["pdv_delivery_default", "Retirada no balcão", "pdv"],
  ["pdv_allow_negative_stock", "false", "pdv"],
  ["pdv_require_customer", "false", "pdv"],
  ["pdv_require_open_cash", "true", "pdv"],
  ["pdv_receipt_footer", "Agradecemos a preferência! Volte sempre.", "pdv"],

  // orçamentos
  ["quote_validity_days", "7", "orcamentos"],
  ["quote_default_payment", "PIX", "orcamentos"],
  ["quote_default_seller", "OPERADOR", "orcamentos"],
  ["quote_terms", "Orçamento válido conforme prazo informado. Produção inicia após aprovação e pagamento combinado.", "orcamentos"],

  // pedidos / OS
  ["order_default_priority", "normal", "pedidos"],
  ["order_default_channel", "Atendimento", "pedidos"],
  ["order_auto_kanban", "true", "pedidos"],
  ["order_require_art_approval", "true", "pedidos"],

  // kanban
  ["kanban_default_columns", "backlog,producao,revisao,pronto,entregue", "kanban"],
  ["kanban_show_values", "true", "kanban"],
  ["kanban_alert_due_days", "2", "kanban"],

  // CRM
  ["crm_followup_interval_days", "7", "crm"],
  ["crm_lead_expiry_days", "30", "crm"],

  // calendário
  ["calendar_campaign_lead_days", "15", "calendario"],
  ["calendar_show_low_relevance", "true", "calendario"],

  // fiscal
  ["fiscal_environment", "homologacao", "fiscal"],
  ["fiscal_tax_regime", "simples", "fiscal"],
  ["fiscal_nfe_enabled", "false", "fiscal"],
  ["fiscal_nfce_enabled", "false", "fiscal"],
  ["fiscal_nfse_enabled", "false", "fiscal"],
  ["fiscal_provider", "manual", "fiscal"],
  ["fiscal_certificate_type", "nenhum", "fiscal"],
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let inserted = 0;
    let categoryFixed = 0;

    for (const [key, value, category] of SETTINGS) {
      const res = await client.query(
        `INSERT INTO settings (key, value, category)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO NOTHING`,
        [key, value, category]
      );
      inserted += res.rowCount || 0;

      const upd = await client.query(
        `UPDATE settings
            SET category = $2, updated_at = updated_at
          WHERE key = $1
            AND (category IS NULL OR category = '' OR category = 'geral')`,
        [key, category]
      );
      categoryFixed += upd.rowCount || 0;
    }

    // remove sobras antigas de comunicação, se existirem em banco legado
    await client.query(`DELETE FROM settings WHERE key LIKE 'communication_%' OR category = 'comunicacao'`);

    await client.query("COMMIT");
    console.log(`✅ Settings garantidas: ${inserted} novas, ${categoryFixed} categorias ajustadas.`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("❌ ensure-settings falhou:", e.message);
  process.exit(1);
});
