import type { Metadata } from "next";
import { db } from "@/db";
import { customers, cashSessions } from "@/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getCategoriesByModule, listProducts } from "@/lib/queries";
import { getPricingDefaults } from "@/lib/settings";
import { PosClient } from "@/components/modules/PosClient";

export const metadata: Metadata = { title: "PDV · Frente de Caixa" };
export const dynamic = "force-dynamic";

export default async function PdvPage() {
  const [productCats, defaults, productRows, customerRows, openSessions] = await Promise.all([
    getCategoriesByModule("product"),
    getPricingDefaults(),
    listProducts(),
    db.select().from(customers).orderBy(asc(customers.name)),
    db
      .select()
      .from(cashSessions)
      .where(and(eq(cashSessions.status, "aberto"), isNull(cashSessions.closedAt)))
      .limit(1),
  ]);

  const session = openSessions[0];

  return (
    <PosClient
      products={productRows.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode ?? null,
        finalPrice: p.finalPrice,
        productCategoryId: p.productCategoryId,
        active: p.active,
        trackStock: p.trackStock,
        stock: p.stock,
        minStock: p.minStock,
      }))}
      productCats={productCats.map((c) => ({
        id: c.id,
        name: c.name,
        icon: c.icon,
        color: c.color,
      }))}
      customers={customerRows.map((c) => ({
        id: c.id,
        name: c.name,
        tradeName: c.tradeName,
        document: c.document,
        phone: c.phone,
        whatsapp: c.whatsapp,
        email: c.email,
        street: c.street,
        number: c.number,
        complement: c.complement,
        district: c.district,
        city: c.city,
        state: c.state,
        cep: c.cep,
      }))}
      company={{
        name: defaults.company_trade_name || defaults.company_name,
        legalName: defaults.company_legal_name,
        document: defaults.company_document,
        email: defaults.company_email,
        phone: defaults.company_phone,
        phone2: defaults.company_phone2 || defaults.company_whatsapp,
        whatsapp: defaults.company_whatsapp,
        address: defaults.company_address,
        street: defaults.company_street,
        number: defaults.company_number,
        district: defaults.company_district,
        city: defaults.company_city,
        state: defaults.company_state,
        cep: defaults.company_cep,
        website: defaults.company_website,
        pixKey: defaults.pix_key,
      }}
      cardFeeDebit={defaults.cardFeeRate}
      cardFeeCredit={defaults.cardFeeCreditRate}
      cashSession={
        session
          ? {
              id: session.id,
              operator: session.operator,
              openingAmount: session.openingAmount,
              openedAt: session.openedAt.toISOString(),
            }
          : null
      }
    />
  );
}
