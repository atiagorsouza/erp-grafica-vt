import { db } from "@/db";
import { orders, customers, deliveries, transactions, kanbanCards } from "@/db/schema";
import { nextDocumentNumber } from "@/lib/documents";
import { eq } from "drizzle-orm";
import { applyDiscount, round2, toDecimalString, toNumber, toPositive } from "@/lib/money";

export const dynamic = "force-dynamic";

type OrderItemInput = {
  productId?: number | null;
  serviceId?: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  total?: number;
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
      const itemsInput = Array.isArray(d.items) ? (d.items as OrderItemInput[]) : [];
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

      const number = await nextDocumentNumber("order");
      const customerId = d.customerId ? Number(d.customerId) : null;

      const [customer] = customerId
        ? await db.select().from(customers).where(eq(customers.id, customerId))
        : [null];

      const [row] = await db
        .insert(orders)
        .values({
          number,
          quoteId: d.quoteId ? Number(d.quoteId) : null,
          customerId,
          status: String(d.status || "confirmado"),
          productionStatus: String(d.productionStatus || "aguardando"),
          artStatus: String(d.artStatus || "nao_enviada"),
          deliveryStatus: String(d.deliveryStatus || "a_definir"),
          financialStatus: String(d.financialStatus || "pago"),
          priority: String(d.priority || "normal"),
          dueDate: d.dueDate ? String(d.dueDate) : null,
          items,
          subtotal: toDecimalString(subtotal),
          discount: toDecimalString(discount),
          taxes: toDecimalString(taxes),
          shippingFee: toDecimalString(shippingFee),
          total: toDecimalString(total),
          paymentMethod: d.paymentMethod ? String(d.paymentMethod) : "A definir",
          channel: d.channel ? String(d.channel) : "Atendimento",
          sellerName: d.sellerName ? String(d.sellerName) : "TIAGO SOUZA",
          notes: d.notes ? String(d.notes) : null,
        })
        .returning();

      // Cria entrega / retirada inicial
      await db.insert(deliveries).values({
        orderId: row.id,
        customerId,
        method: "retirada",
        status: "aguardando",
        addressSnapshot: customer
          ? [customer.street, customer.number, customer.district, customer.city, customer.state, customer.cep]
              .filter(Boolean)
              .join(", ")
          : null,
        notes: "Gerada na criação do pedido.",
      });

      // Cria cartão Kanban de Produção
      await db.insert(kanbanCards).values({
        title: `Pedido ${row.number}`,
        description: items.slice(0, 3).map((i) => `${i.quantity}× ${i.description}`).join(" · ") || "Ordem de produção criada diretamente",
        column: "backlog",
        customerId,
        customerName: customer ? (customer.tradeName || customer.name) : "Consumidor final",
        priority: String(row.priority || "normal"),
        dueDate: row.dueDate || null,
      });

      // Cria lançamento no Financeiro
      await db.insert(transactions).values({
        type: "receita",
        category: "pedido",
        description: `Pedido ${row.number} — ${customer ? customer.name : "Consumidor final"}`,
        amount: toDecimalString(total, 2),
        dueDate: new Date().toISOString().slice(0, 10),
        paidDate: new Date().toISOString().slice(0, 10),
        status: "pago",
        method: row.paymentMethod,
        customerId,
      });

      return Response.json({ ok: true, row });
    }

    if (op === "update") {
      const id = Number(body.id);
      if (!Number.isFinite(id)) return Response.json({ error: "id obrigatório" }, { status: 400 });

      const itemsInput = Array.isArray(d.items) ? (d.items as OrderItemInput[]) : [];
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

      const customerId = d.customerId ? Number(d.customerId) : null;

      const [updated] = await db
        .update(orders)
        .set({
          customerId,
          status: d.status ? String(d.status) : undefined,
          productionStatus: d.productionStatus ? String(d.productionStatus) : undefined,
          artStatus: d.artStatus ? String(d.artStatus) : undefined,
          deliveryStatus: d.deliveryStatus ? String(d.deliveryStatus) : undefined,
          financialStatus: d.financialStatus ? String(d.financialStatus) : undefined,
          priority: d.priority ? String(d.priority) : undefined,
          dueDate: d.dueDate !== undefined ? (d.dueDate ? String(d.dueDate) : null) : undefined,
          items: items.length > 0 ? items : undefined,
          subtotal: toDecimalString(subtotal),
          discount: toDecimalString(discount),
          taxes: toDecimalString(taxes),
          shippingFee: toDecimalString(shippingFee),
          total: toDecimalString(total),
          paymentMethod: d.paymentMethod ? String(d.paymentMethod) : undefined,
          channel: d.channel ? String(d.channel) : undefined,
          sellerName: d.sellerName ? String(d.sellerName) : undefined,
          notes: d.notes !== undefined ? (d.notes ? String(d.notes) : null) : undefined,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, id))
        .returning();

      return Response.json({ ok: true, row: updated });
    }

    if (op === "delete") {
      const id = Number(body.id);
      if (!Number.isFinite(id)) return Response.json({ error: "id obrigatório" }, { status: 400 });
      await db.delete(orders).where(eq(orders.id, id));
      return Response.json({ ok: true });
    }

    return Response.json({ error: "op inválido" }, { status: 400 });
  } catch (e) {
    console.error("[orders]", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "erro interno" },
      { status: 500 }
    );
  }
}
