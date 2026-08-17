import "server-only";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

export interface PricingDefaults {
  taxRate: number; // imposto sobre venda (%)
  operationalRate: number; // custo operacional global para markup divisor (%)
  cardFeeRate: number; // taxa maquininha débito (%)
  cardFeeCreditRate: number; // taxa maquininha crédito (%)
  company_name: string;
  company_legal_name: string;
  company_trade_name: string;
  company_document: string;
  company_email: string;
  company_phone: string;
  company_phone2: string;
  company_whatsapp: string;
  company_address: string;
  company_street: string;
  company_number: string;
  company_district: string;
  company_city: string;
  company_state: string;
  company_cep: string;
  company_website: string;
  pix_key: string;
  fiscal_environment: string;
  fiscal_tax_regime: string;
}

const DEFAULTS: PricingDefaults = {
  taxRate: 0.06,
  operationalRate: 0.15,
  cardFeeRate: 0.0199,
  cardFeeCreditRate: 0.0499,
  company_name: "VTDIGITAL ART STUDIO",
  company_legal_name: "VTDIGITAL ART STUDIO",
  company_trade_name: "VTDIGITAL ART STUDIO",
  company_document: "30.189.224/0001-54",
  company_email: "contato.vt@vtdigital.com.br",
  company_phone: "(21) 2038-3504",
  company_phone2: "(21) 97886-9414",
  company_whatsapp: "(21) 97886-9414",
  company_address: "RUA ARAQUEM 910 — BANGU, RIO DE JANEIRO - RJ",
  company_street: "RUA ARAQUEM 910",
  company_number: "",
  company_district: "BANGU",
  company_city: "RIO DE JANEIRO",
  company_state: "RJ",
  company_cep: "21863-090",
  company_website: "http://www.vtdigital.com.br",
  pix_key: "contato.vt@vtdigital.com.br",
  fiscal_environment: "homologacao",
  fiscal_tax_regime: "simples",
};

let cache: PricingDefaults | null = null;

/**
 * Lê configurações do Painel de Controle com fallback para defaults.
 * Cache em memória por processo (revalidate clears em server actions).
 */
export async function getPricingDefaults(): Promise<PricingDefaults> {
  if (cache) return cache;
  try {
    const rows = await db.select().from(settings);
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const legalName = map.get("company_legal_name") || map.get("company_name") || DEFAULTS.company_legal_name;
    const tradeName = map.get("company_trade_name") || map.get("company_name") || legalName;
    const street = map.get("company_street") || DEFAULTS.company_street;
    const number = map.get("company_number") || "";
    const streetFull = [street, number].filter(Boolean).join(", ");
    const district = map.get("company_district") || DEFAULTS.company_district;
    const city = map.get("company_city") || DEFAULTS.company_city;
    const state = map.get("company_state") || DEFAULTS.company_state;
    const cep = map.get("company_cep") || DEFAULTS.company_cep;

    const structuredAddress = [
      streetFull,
      map.get("company_complement"),
      district,
      [city, state].filter(Boolean).join(" / "),
      cep && `CEP ${cep}`,
    ].filter(Boolean).join(" — ");

    cache = {
      taxRate: num(map.get("tax_rate"), DEFAULTS.taxRate),
      operationalRate: num(map.get("operational_rate"), DEFAULTS.operationalRate),
      cardFeeRate: num(map.get("card_fee_debit"), DEFAULTS.cardFeeRate),
      cardFeeCreditRate: num(map.get("card_fee_credit"), DEFAULTS.cardFeeCreditRate),
      company_name: tradeName,
      company_legal_name: legalName,
      company_trade_name: tradeName,
      company_document: map.get("company_cnpj") || map.get("company_document") || DEFAULTS.company_document,
      company_email: map.get("company_email") || DEFAULTS.company_email,
      company_phone: map.get("company_phone") || DEFAULTS.company_phone,
      company_phone2: map.get("company_phone2") || map.get("company_whatsapp") || DEFAULTS.company_phone2,
      company_whatsapp: map.get("company_whatsapp") || DEFAULTS.company_whatsapp,
      company_address: structuredAddress || map.get("company_address") || DEFAULTS.company_address,
      company_street: streetFull,
      company_number: number,
      company_district: district,
      company_city: city,
      company_state: state,
      company_cep: cep,
      company_website: map.get("company_website") || DEFAULTS.company_website,
      pix_key: map.get("pix_key") || DEFAULTS.pix_key,
      fiscal_environment: map.get("fiscal_environment") || DEFAULTS.fiscal_environment,
      fiscal_tax_regime: map.get("fiscal_tax_regime") || DEFAULTS.fiscal_tax_regime,
    };
    return cache;
  } catch {
    return DEFAULTS;
  }
}

export function clearSettingsCache() {
  cache = null;
}

/**
 * Utilitário helper para verificar se uma chave de configuração está ativa.
 */
export function isSettingEnabled(value: string | null | undefined): boolean {
  if (!value) return false;
  const lower = String(value).toLowerCase().trim();
  return lower === "true" || lower === "1" || lower === "sim" || lower === "yes" || lower === "ativo";
}

const num = (v: string | null | undefined, fallback: number): number => {
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n / 100 : fallback; // valores guardados em %
};
