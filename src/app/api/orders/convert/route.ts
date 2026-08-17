import { db } from "@/db";
import { orders, quotes, quoteItems, deliveries, transactions, kanbanCards, customers } from "@/db/schema";
import { nextDocumentNumber } from "@/lib/documents";
import { eq } from "drizzle-orm";
import { toDecimalString, toNumber } from "@/lib/money";

export const dynamic = "force-dynamic";

/** Converte orçamento aprovado em Pedido/OS. Idempotente por quoteId.
 *  Todas as escritas em uma única transação para evitar estados órfãos.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const quoteId = Number(body.quoteId);
  if (!quoteId) return Response.json({ error: "quoteId obrigatório" }, { status: 400 });

  try {
    const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
    if (!quote) return Response.json({ error: "Orçamento não encontrado" }, { status: 404 });
    if (quote.status !== "aprovado") {
      return Response.json({ error: "Apenas orçamentos aprovados podem virar pedido" }, { status: 409 });
    }

    // Idempotência — se já existe um pedido para este orçamento, devolve sem criar novamente
    const [existing] = await db.select().from(orders).where(eq(orders.quoteId, quoteId));
    if (existing) return Response.json({ ok: true, order: existing, existing: true });

    const rawItems = await db.select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId));
    const formattedItems = rawItems.map((it) => ({
      productId: it.productId,
      serviceId: it.serviceId,
      description: it.description,
      quantity: toNumber(it.quantity, 1),
      unitPrice: toNumber(it.unitPrice, 0),
      total: toNumber(it.total, 0),
    }));

    const number = await nextDocumentNumber("order");
    const [customer] = quote.customerId
      ? await db.select().from(customers).where(eq(customers.id, quote.customerId))
      : [null];

    // Determina status financeiro pelo método de pagamento do orçamento
    const payMethod = String(quote.paymentMethod || "");
    const financialStatus =
      payMethod.includes("50%") || payMethod === "Boleto"
        ? "parcial"
        : payMethod === "Crédito"
          ? "pendente"
          : "pago";

    // Transação atômica — evita pedido criado sem entrega ou financeiro parcial
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
          sellerName: quote.sellerName || "TIAGO SOUZA",
          notes: quote.notes,
        })
        .returning();

      // Registro de entrega / retirada
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

      // Cartão Kanban — cria ou atualiza pelo quoteId
      const [existingCard] = await tx.select().from(kanbanCards).where(eq(kanbanCards.quoteId, quoteId));
      const cardData = {
        title: `Pedido ${newOrder.number}`,
        description:
          formattedItems.slice(0, 3).map((i) => `${i.quantity}× ${i.description}`).join(" · ") ||
          "Produção gerada do orçamento",
        column: "backlog",
        customerId: newOrder.customerId,
        customerName: customer ? (customer.tradeName || customer.name) : "Consumidor final",
        productId: formattedItems.find((i) => i.productId)?.productId || null,
        priority: "normal",
        dueDate: newOrder.dueDate || null,
        estimatedValue: String(toNumber(newOrder.total, 0)),
        quoteId,
      };
      if (existingCard) {
        await tx.update(kanbanCards).set(cardData).where(eq(kanbanCards.id, existingCard.id));
      } else {
        await tx.insert(kanbanCards).values(cardData);
      }

      // Lançamento financeiro — status correto conforme pagamento
      const today = new Date().toISOString().slice(0, 10);
      const onCredit = payMethod === "Crédito";
      const settle30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
      await tx.insert(transactions).values({
        type: "receita",
        category: "pedido",
        description: `Pedido ${newOrder.number} — ${customer ? customer.name : "Consumidor final"}`,
        amount: toDecimalString(newOrder.total, 2),
        dueDate: onCredit ? settle30 : today,
        paidDate: financialStatus === "pago" ? today : null,
        status: financialStatus === "pago" ? "pago" : "pendente",
        method: newOrder.paymentMethod,
        customerId: newOrder.customerId,
      });

      return newOrder;
    });

    return Response.json({ ok: true, order, existing: false });
  } catch (e) {
    console.error("[orders/convert]", e);
    return Response.json({ error: e instanceof Error ? e.message : "erro" }, { status: 500 });
  }
}
