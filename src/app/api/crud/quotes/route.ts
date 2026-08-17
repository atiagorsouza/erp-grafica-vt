import { db } from "@/db";
import { quotes, quoteItems, kanbanCards, customers } from "@/db/schema";
import { nextDocumentNumber } from "@/lib/documents";
import { eq } from "drizzle-orm";
import { applyDiscount, round2, toDecimalString, toNumber, toPositive } from "@/lib/money";

export const dynamic = "force-dynamic";

type Item = {
  description: string;
  productId?: number | null;
  serviceId?: number | null;
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
      const number = await nextDocumentNumber("quote");
      const itemsInput = Array.isArray(d.items) ? (d.items as Item[]) : [];
      const items = itemsInput.map((i) => {
        const qty = toPositive(i.quantity, 1);
        const price = toPositive(i.unitPrice, 0);
        return {
          productId: i.productId ? Number(i.productId) : null,
          serviceId: i.serviceId ? Number(i.serviceId) : null,
          description: String(i.description || "Item avulso"),
          quantity: qty,
          unitPrice: price,
          total: round2(qty * price),
        };
      });

      const subtotal = round2(items.reduce((s, i) => s + i.total, 0));
      const discount = applyDiscount(subtotal, d.discount, "value");
      const shippingFee = toPositive(d.shippingFee, 0);
      const taxes = toPositive(d.taxes, 0);
      const total = round2(subtotal - discount + shippingFee + taxes);

      const [row] = await db
        .insert(quotes)
        .values({
          number,
          customerId: d.customerId ? Number(d.customerId) : null,
          status: (d.status as never) || "rascunho",
          validUntil: d.validUntil ? String(d.validUntil) : null,
          subtotal: toDecimalString(subtotal),
          discount: toDecimalString(discount),
          taxes: toDecimalString(taxes),
          shippingFee: toDecimalString(shippingFee),
          total: toDecimalString(total),
          paymentMethod: d.paymentMethod ? String(d.paymentMethod) : "PIX",
          channel: d.channel ? String(d.channel) : "Atendimento",
          sellerName: d.sellerName ? String(d.sellerName) : "TIAGO SOUZA",
          notes: d.notes ? String(d.notes) : null,
        })
        .returning();

      await saveItems(row.id, items);
      await syncProductionCard(row.id, String(row.status), row.customerId, row.number, items);

      return Response.json({ ok: true, row });
    }

    if (op === "update") {
      const id = Number(body.id);
      if (!Number.isFinite(id)) return Response.json({ error: "id obrigatório" }, { status: 400 });

      const itemsInput = Array.isArray(d.items) ? (d.items as Item[]) : [];
      const items = itemsInput.map((i) => {
        const qty = toPositive(i.quantity, 1);
        const price = toPositive(i.unitPrice, 0);
        return {
          productId: i.productId ? Number(i.productId) : null,
          serviceId: i.serviceId ? Number(i.serviceId) : null,
          description: String(i.description || "Item avulso"),
          quantity: qty,
          unitPrice: price,
          total: round2(qty * price),
        };
      });

      const subtotal = round2(items.reduce((s, i) => s + i.total, 0));
      const discount = applyDiscount(subtotal, d.discount, "value");
      const shippingFee = toPositive(d.shippingFee, 0);
      const taxes = toPositive(d.taxes, 0);
      const total = round2(subtotal - discount + shippingFee + taxes);

      await db
        .update(quotes)
        .set({
          customerId: d.customerId ? Number(d.customerId) : null,
          status: (d.status as never) || "rascunho",
          validUntil: d.validUntil ? String(d.validUntil) : null,
          subtotal: toDecimalString(subtotal),
          discount: toDecimalString(discount),
          taxes: toDecimalString(taxes),
          shippingFee: toDecimalString(shippingFee),
          total: toDecimalString(total),
          paymentMethod: d.paymentMethod ? String(d.paymentMethod) : undefined,
          channel: d.channel ? String(d.channel) : undefined,
          sellerName: d.sellerName ? String(d.sellerName) : undefined,
          notes: d.notes !== undefined ? (d.notes ? String(d.notes) : null) : undefined,
        })
        .where(eq(quotes.id, id));

      await saveItems(id, items);

      const [updated] = await db.select().from(quotes).where(eq(quotes.id, id));
      if (updated) {
        await syncProductionCard(id, String(updated.status), updated.customerId, updated.number, items);
      }

      return Response.json({ ok: true, row: updated });
    }

    if (op === "delete") {
      const id = Number(body.id);
      if (!Number.isFinite(id)) return Response.json({ error: "id obrigatório" }, { status: 400 });
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

async function saveItems(quoteId: number, items: Item[]) {
  await db.delete(quoteItems).where(eq(quoteItems.quoteId, quoteId));
  for (const it of items) {
    await db.insert(quoteItems).values({
      quoteId,
      description: it.description,
      productId: it.productId ? Number(it.productId) : null,
      serviceId: it.serviceId ? Number(it.serviceId) : null,
      quantity: toDecimalString(it.quantity, 3),
      unitPrice: toDecimalString(it.unitPrice, 4),
      total: toDecimalString(it.total, 4),
    });
  }
}

async function syncProductionCard(
  quoteId: number,
  status: string,
  customerId: number | null,
  quoteNumber: string,
  items: Item[]
) {
  if (status !== "aprovado") return;
  const [existing] = await db
    .select()
    .from(kanbanCards)
    .where(eq(kanbanCards.quoteId, quoteId));

  const [customer] = customerId
    ? await db.select().from(customers).where(eq(customers.id, customerId))
    : [null];

  const firstProduct = items.find((i) => i.productId)?.productId || null;
  const summary = items
    .slice(0, 3)
    .map((i) => `${i.quantity}× ${i.description}`)
    .join(" · ");

  const cardData = {
    title: `Pedido ${quoteNumber}`,
    description: summary || "Orçamento aprovado — aguardando produção.",
    column: "backlog",
    customerId: customerId || null,
    customerName: customer ? (customer.tradeName || customer.name) : "Consumidor final",
    productId: firstProduct ? Number(firstProduct) : null,
    priority: "normal",
    quoteId,
  };

  if (existing) {
    await db.update(kanbanCards).set(cardData).where(eq(kanbanCards.id, existing.id));
  } else {
    await db.insert(kanbanCards).values(cardData);
  }
}
