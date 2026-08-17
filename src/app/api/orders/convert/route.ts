import { db } from "@/db";
import { orders, quotes, quoteItems, deliveries, transactions, kanbanCards, customers } from "@/db/schema";
import { nextDocumentNumber } from "@/lib/documents";
import { eq } from "drizzle-orm";
import { toDecimalString, toNumber } from "@/lib/money";

export const dynamic = "force-dynamic";

type QuoteLine = {
  productId: number | null;
  serviceId: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

/** Converte orçamento aprovado em Pedido/OS. Idempotente por quoteId. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const quoteId = Number(body.quoteId);
  if (!Number.isFinite(quoteId) || quoteId <= 0) {
    return Response.json({ error: "quoteId obrigatório" }, { status: 400 });
  }

  try {
    const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
    if (!quote) return Response.json({ error: "Orçamento não encontrado" }, { status: 404 });

    const [existing] = await db.select().from(orders).where(eq(orders.quoteId, quoteId)).limit(1);
    if (existing) return Response.json({ ok: true, order: existing, existing: true });

    if (quote.status !== "aprovado") {
      return Response.json({ error: "Apenas orçamentos aprovados podem virar pedido" }, { status: 409 });
    }

    const rawItems = await db.select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId));
    if (rawItems.length === 0) {
      return Response.json({ error: "Orçamento sem itens não pode virar pedido" }, { status: 422 });
    }

    const formattedItems: QuoteLine[] = rawItems.map((it) => ({
      productId: it.productId,
      serviceId: it.serviceId,
      description: it.description,
      quantity: toNumber(it.quantity, 1),
      unitPrice: toNumber(it.unitPrice, 0),
      total: toNumber(it.total, 0),
    }));

    const [customer] = quote.customerId
      ? await db.select().from(customers).where(eq(customers.id, quote.customerId))
      : [null];

    const payMethod = String(quote.paymentMethod || "");
    const financialStatus = deriveFinancialStatus(payMethod);
    const number = await nextDocumentNumber("order");

    const order = await db.transaction(async (tx) => {
      const [newOrder] = await tx
        .insert(orders)
        .values({
          number,
          quoteId,
          customerId: quote.customerId,
          status: "confirmado",
          productionStatus: "aguardando",
          artStatus: "nao_enviada",
          deliveryStatus: "a_definir",
          financialStatus,
          priority: "normal",
          dueDate: quote.validUntil || null,
          items: formattedItems,
          subtotal: quote.subtotal,
          discount: quote.discount,
          taxes: quote.taxes,
          shippingFee: quote.shippingFee || "0",
          total: quote.total,
          paymentMethod: quote.paymentMethod || "A definir",
          channel: quote.channel || "Atendimento",
          sellerName: quote.sellerName || "OPERADOR",
          notes: quote.notes,
          updatedAt: new Date(),
        })
        .returning();

      await tx.insert(deliveries).values({
        orderId: newOrder.id,
        customerId: newOrder.customerId,
        method: "retirada",
        status: "aguardando",
        addressSnapshot: customer
          ? [customer.street, customer.number, customer.district, customer.city, customer.state, customer.cep]
              .filter(Boolean)
              .join(", ")
          : null,
        notes: "Gerada automaticamente ao converter orçamento em pedido.",
      });

      const [existingCard] = await tx
        .select()
        .from(kanbanCards)
        .where(eq(kanbanCards.quoteId, quoteId));

      const cardData = {
        title: `Pedido ${newOrder.number}`,
        description:
          formattedItems.slice(0, 3).map((i) => `${i.quantity}× ${i.description}`).join(" · ") ||
          "Produção gerada do orçamento",
        column: "backlog",
        customerId: newOrder.customerId,
        customerName: customer ? customer.tradeName || customer.name : "Consumidor final",
        productId: formattedItems.find((i) => i.productId)?.productId || null,
        priority: "normal",
        dueDate: newOrder.dueDate || null,
        estimatedValue: String(toNumber(newOrder.total, 0)),
        quoteId,
        updatedAt: new Date(),
      };

      if (existingCard) {
        await tx.update(kanbanCards).set(cardData as never).where(eq(kanbanCards.id, existingCard.id));
      } else {
        await tx.insert(kanbanCards).values(cardData as never);
      }

      const today = new Date().toISOString().slice(0, 10);
      const settle30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
      const pending = financialStatus !== "pago";

      await tx.insert(transactions).values({
        type: "receita",
        category: "pedido",
        description: `Pedido ${newOrder.number} — ${customer ? customer.name : "Consumidor final"}`,
        amount: toDecimalString(newOrder.total, 2),
        dueDate: payMethod === "Crédito" ? settle30 : today,
        paidDate: pending ? null : today,
        status: pending ? "pendente" : "pago",
        method: newOrder.paymentMethod,
        customerId: newOrder.customerId,
      });

      return newOrder;
    });

    return Response.json({ ok: true, order, existing: false });
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    if (text.includes("orders_quote_id_unique_idx") || text.includes("duplicate key")) {
      const [existing] = await db.select().from(orders).where(eq(orders.quoteId, quoteId)).limit(1);
      if (existing) return Response.json({ ok: true, order: existing, existing: true });
    }
    console.error("[orders/convert]", e);
    return Response.json({ error: e instanceof Error ? e.message : "erro" }, { status: 500 });
  }
}

function deriveFinancialStatus(method: string) {
  const text = method.toLowerCase();
  if (text.includes("50%") || text.includes("sinal") || text.includes("parcial")) return "parcial";
  if (text.includes("boleto") || text.includes("crédito") || text.includes("credito")) return "pendente";
  return "pago";
}
