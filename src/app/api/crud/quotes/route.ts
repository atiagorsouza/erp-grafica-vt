import { db } from "@/db";
import { quotes, quoteItems, kanbanCards, customers, products, services, orders } from "@/db/schema";
import { nextDocumentNumber } from "@/lib/documents";
import { eq, inArray } from "drizzle-orm";
import { applyDiscount, round2, toDecimalString, toNumber, toPositive } from "@/lib/money";
import { getPricingDefaults } from "@/lib/settings";

export const dynamic = "force-dynamic";

const QUOTE_STATUSES = new Set(["rascunho", "enviado", "aprovado", "recusado", "expirado"]);

type ItemInput = {
  description?: string;
  productId?: number | string | null;
  serviceId?: number | string | null;
  quantity?: number | string;
  unitPrice?: number | string;
};

type ResolvedItem = {
  description: string;
  productId: number | null;
  serviceId: number | null;
  quantity: number;
  unitPrice: number;
  total: number;
};

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const op = String(body.op || "");
  const d = (body.data as Record<string, unknown>) || {};

  try {
    if (op === "create") {
      const defaults = await getPricingDefaults();
      const items = await resolveItems(d.items);
      if (items.length === 0) {
        return Response.json({ error: "Adicione ao menos um item" }, { status: 422 });
      }
      const totals = calculateTotals(items, d);
      const status = sanitizeStatus(d.status, "rascunho");
      const number = await nextDocumentNumber("quote");

      const [row] = await db
        .insert(quotes)
        .values({
          number,
          customerId: parseOptionalId(d.customerId),
          status: status as never,
          validUntil: sanitizeDate(d.validUntil),
          subtotal: toDecimalString(totals.subtotal),
          discount: toDecimalString(totals.discount),
          taxes: toDecimalString(totals.taxes),
          shippingFee: toDecimalString(totals.shippingFee),
          total: toDecimalString(totals.total),
          paymentMethod: cleanText(d.paymentMethod, defaults.pdv_require_customer ? "A definir" : "PIX", 80),
          channel: cleanText(d.channel, "Atendimento", 80),
          sellerName: cleanText(d.sellerName, defaults.pdv_seller_default || "OPERADOR", 100),
          notes: cleanText(d.notes, null, 1000),
        })
        .returning();

      await saveItems(row.id, items);
      await syncProductionCard(row.id, String(row.status), row.customerId, row.number, items);

      return Response.json({ ok: true, row });
    }

    if (op === "update") {
      const id = Number(body.id);
      if (!Number.isFinite(id)) return Response.json({ error: "id obrigatório" }, { status: 400 });
      const [existing] = await db.select().from(quotes).where(eq(quotes.id, id));
      if (!existing) return Response.json({ error: "Orçamento não encontrado" }, { status: 404 });

      const hasItems = Array.isArray(d.items);
      const items = hasItems ? await resolveItems(d.items) : [];
      if (hasItems && items.length === 0) {
        return Response.json({ error: "Adicione ao menos um item" }, { status: 422 });
      }

      const totals = hasItems ? calculateTotals(items, d) : null;
      const patch: Record<string, unknown> = {};

      if (d.customerId !== undefined) patch.customerId = parseOptionalId(d.customerId);
      if (d.status !== undefined) patch.status = sanitizeStatus(d.status, String(existing.status)) as never;
      if (d.validUntil !== undefined) patch.validUntil = sanitizeDate(d.validUntil);
      if (d.paymentMethod !== undefined) patch.paymentMethod = cleanText(d.paymentMethod, null, 80);
      if (d.channel !== undefined) patch.channel = cleanText(d.channel, null, 80);
      if (d.sellerName !== undefined) patch.sellerName = cleanText(d.sellerName, null, 100);
      if (d.notes !== undefined) patch.notes = cleanText(d.notes, null, 1000);

      if (totals) {
        patch.subtotal = toDecimalString(totals.subtotal);
        patch.discount = toDecimalString(totals.discount);
        patch.taxes = toDecimalString(totals.taxes);
        patch.shippingFee = toDecimalString(totals.shippingFee);
        patch.total = toDecimalString(totals.total);
      }

      if (Object.keys(patch).length > 0) {
        await db.update(quotes).set(patch as never).where(eq(quotes.id, id));
      }

      if (hasItems) await saveItems(id, items);

      const [updated] = await db.select().from(quotes).where(eq(quotes.id, id));
      const cardItems = hasItems ? items : await getItemsForCard(id);
      if (updated) {
        await syncProductionCard(id, String(updated.status), updated.customerId, updated.number, cardItems);
      }

      return Response.json({ ok: true, row: updated });
    }

    if (op === "delete") {
      const id = Number(body.id);
      if (!Number.isFinite(id)) return Response.json({ error: "id obrigatório" }, { status: 400 });
      const [existingOrder] = await db.select().from(orders).where(eq(orders.quoteId, id)).limit(1);
      if (existingOrder) {
        return Response.json(
          { error: "Não é possível excluir orçamento já convertido em pedido" },
          { status: 409 }
        );
      }
      await db.delete(quotes).where(eq(quotes.id, id));
      return Response.json({ ok: true });
    }

    return Response.json({ error: "op inválido" }, { status: 400 });
  } catch (e) {
    console.error("[quotes]", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "erro interno" },
      { status: 500 }
    );
  }
}

async function resolveItems(raw: unknown): Promise<ResolvedItem[]> {
  const input = Array.isArray(raw) ? (raw as ItemInput[]) : [];
  const productIds = [
    ...new Set(input.map((i) => parseOptionalId(i.productId)).filter((id): id is number => !!id)),
  ];
  const serviceIds = [
    ...new Set(input.map((i) => parseOptionalId(i.serviceId)).filter((id): id is number => !!id)),
  ];

  const productMap = new Map<number, typeof products.$inferSelect>();
  const serviceMap = new Map<number, typeof services.$inferSelect>();

  if (productIds.length > 0) {
    const rows = await db.select().from(products).where(inArray(products.id, productIds));
    for (const row of rows) productMap.set(row.id, row);
  }
  if (serviceIds.length > 0) {
    const rows = await db.select().from(services).where(inArray(services.id, serviceIds));
    for (const row of rows) serviceMap.set(row.id, row);
  }

  const items: ResolvedItem[] = [];

  for (const item of input) {
    const productId = parseOptionalId(item.productId);
    const serviceId = parseOptionalId(item.serviceId);
    const product = productId ? productMap.get(productId) : undefined;
    const service = serviceId ? serviceMap.get(serviceId) : undefined;

    if (productId && !product) throw new Error(`Produto ${productId} não encontrado`);
    if (serviceId && !service) throw new Error(`Serviço ${serviceId} não encontrado`);
    if (product && product.active === false) throw new Error(`Produto "${product.name}" está inativo`);

    const quantity = toPositive(item.quantity, 1);
    if (quantity <= 0) throw new Error("Quantidade deve ser maior que zero");

    const dbPrice = product ? toNumber(product.finalPrice, 0) : service ? toNumber(service.baseCost, 0) : null;
    const unitPrice = dbPrice != null ? dbPrice : toPositive(item.unitPrice, 0);
    if (unitPrice < 0) throw new Error("Preço não pode ser negativo");

    const description = product
      ? String(product.name)
      : service
        ? String(service.name)
        : cleanText(item.description, "Item avulso", 200) || "Item avulso";

    if (unitPrice <= 0 && !product && !service) {
      throw new Error(`Item "${description}" sem preço`);
    }

    items.push({
      productId: productId || null,
      serviceId: serviceId || null,
      description,
      quantity: roundQuantity(quantity),
      unitPrice: round2(unitPrice),
      total: round2(unitPrice * quantity),
    });
  }

  return items;
}

function calculateTotals(items: ResolvedItem[], d: Record<string, unknown>) {
  const subtotal = round2(items.reduce((s, i) => s + i.total, 0));
  const discount = applyDiscount(subtotal, d.discount, "value");
  const shippingFee = toPositive(d.shippingFee, 0);
  const taxes = toPositive(d.taxes, 0);
  const total = round2(subtotal - discount + shippingFee + taxes);
  return { subtotal, discount, shippingFee, taxes, total };
}

async function saveItems(quoteId: number, items: ResolvedItem[]) {
  await db.delete(quoteItems).where(eq(quoteItems.quoteId, quoteId));
  if (items.length === 0) return;
  await db.insert(quoteItems).values(
    items.map((it) => ({
      quoteId,
      description: it.description,
      productId: it.productId,
      serviceId: it.serviceId,
      quantity: toDecimalString(it.quantity, 3),
      unitPrice: toDecimalString(it.unitPrice, 4),
      total: toDecimalString(it.total, 4),
    }))
  );
}

async function getItemsForCard(quoteId: number): Promise<ResolvedItem[]> {
  const rows = await db.select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId));
  return rows.map((it) => ({
    description: it.description,
    productId: it.productId,
    serviceId: it.serviceId,
    quantity: toNumber(it.quantity, 1),
    unitPrice: toNumber(it.unitPrice, 0),
    total: toNumber(it.total, 0),
  }));
}

async function syncProductionCard(
  quoteId: number,
  status: string,
  customerId: number | null,
  quoteNumber: string,
  items: ResolvedItem[]
) {
  const [existing] = await db.select().from(kanbanCards).where(eq(kanbanCards.quoteId, quoteId));

  if (status !== "aprovado") {
    if (existing && existing.column === "backlog") {
      await db.delete(kanbanCards).where(eq(kanbanCards.id, existing.id));
    }
    return;
  }

  const [customer] = customerId
    ? await db.select().from(customers).where(eq(customers.id, customerId))
    : [null];

  const firstProduct = items.find((i) => i.productId)?.productId || null;
  const summary = items
    .slice(0, 3)
    .map((i) => `${i.quantity}× ${i.description}`)
    .join(" · ");

  const cardData = {
    title: `Orçamento aprovado ${quoteNumber}`,
    description: summary || "Orçamento aprovado — pronto para virar pedido.",
    column: "backlog",
    customerId: customerId || null,
    customerName: customer ? customer.tradeName || customer.name : "Consumidor final",
    productId: firstProduct ? Number(firstProduct) : null,
    priority: "normal",
    quoteId,
    estimatedValue: toDecimalString(items.reduce((sum, item) => sum + item.total, 0), 2),
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(kanbanCards).set(cardData as never).where(eq(kanbanCards.id, existing.id));
  } else {
    await db.insert(kanbanCards).values(cardData as never);
  }
}

function parseOptionalId(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function sanitizeStatus(value: unknown, fallback: string) {
  const status = String(value || fallback);
  return QUOTE_STATUSES.has(status) ? status : fallback;
}

function sanitizeDate(value: unknown): string | null {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function cleanText(value: unknown, fallback: string | null, max: number): string | null {
  if (value == null) return fallback;
  const text = String(value).trim().slice(0, max);
  return text || fallback;
}

function roundQuantity(value: number) {
  return Math.round(value * 1000) / 1000;
}
