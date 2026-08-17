import "server-only";

import { z } from "zod";
import { db } from "@/db";
import {
  sales,
  products,
  productMaterials,
  materials,
  stockMovements,
  transactions,
  cashSessions,
} from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { nextDocumentNumber } from "@/lib/documents";
import { getPricingDefaults } from "@/lib/settings";
import {
  applyDiscount,
  cardFeeAmount,
  grossUp,
  round2,
  toDecimalString,
  toNumber,
  toPositive,
} from "@/lib/money";

/* ==================================================================
 *  VALIDAÇÃO (Zod)
 *
 *  `z.coerce.number().finite()` é o que barra o bug do NaN: o cliente
 *  mandava "NaN" como string e o numeric do PostgreSQL aceitava.
 * ================================================================== */

const finiteNumber = z.coerce.number().finite();

export const saleItemSchema = z.object({
  productId: z.coerce.number().int().positive().nullable().optional(),
  description: z.string().trim().min(1, "Descrição obrigatória").max(200),
  quantity: finiteNumber.positive("Quantidade deve ser maior que zero").max(1_000_000),
  unitPrice: finiteNumber.min(0, "Preço não pode ser negativo").max(10_000_000),
});

export const paymentSchema = z.object({
  method: z.string().trim().min(1).max(40),
  amount: finiteNumber.min(0).max(10_000_000),
});

export const saleInputSchema = z.object({
  clientRef: z.string().trim().min(8).max(64).optional(),
  customerId: z.coerce.number().int().positive().nullable().optional(),
  type: z.enum(["produto", "servico", "mixto"]).default("produto"),
  items: z.array(saleItemSchema).min(1, "Carrinho vazio"),
  discount: finiteNumber.min(0).default(0),
  discountMode: z.enum(["value", "percent"]).default("value"),
  /** método único (legado) ou lista de pagamentos (split) */
  paymentMethod: z.string().trim().max(40).nullable().optional(),
  payments: z.array(paymentSchema).optional(),
  receivedAmount: finiteNumber.min(0).optional(),
  cashSessionId: z.coerce.number().int().positive().nullable().optional(),
  /** venda a descoberto exige confirmação explícita do operador */
  allowNegativeStock: z.boolean().default(false),
  /** dados do cupom e impressão */
  sellerName: z.string().trim().max(100).optional(),
  deliveryMode: z.string().trim().max(100).optional(),
  deliveryDate: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(500).optional(),
});

export type SaleInput = z.infer<typeof saleInputSchema>;

export type SaleError = { error: string; status: number; details?: unknown };

const CARD_METHODS = new Set(["Débito", "Crédito"]);

/* ==================================================================
 *  CRIAÇÃO DE VENDA
 * ================================================================== */

export async function createSale(raw: unknown) {
  /* ---------- 1. validação de forma ---------- */
  const parsed = saleInputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      error: first ? `${first.path.join(".") || "dados"}: ${first.message}` : "Dados inválidos",
      status: 400,
      details: parsed.error.flatten(),
    } satisfies SaleError;
  }
  const input = parsed.data;

  /* ---------- 2. idempotência ---------- */
  if (input.clientRef) {
    const [existing] = await db
      .select()
      .from(sales)
      .where(eq(sales.clientRef, input.clientRef));
    if (existing) return { ok: true as const, row: existing, duplicated: true };
  }

  /* ---------- 3. preço vem do BANCO, não do cliente ----------
   * O cliente enviava subtotal/total já calculados; era possível
   * forjar `total: "0.01"` num produto de R$ 500.               */
  const productIds = [...new Set(input.items.map((i) => i.productId).filter((id): id is number => !!id))];
  /* busca individual: o carrinho tem poucos itens e evita a quirk do
   * driver com `= ANY($1)` gerado pelo inArray nesta versão do Drizzle. */
  const productMap = new Map<number, typeof products.$inferSelect>();
  for (const id of productIds) {
    const [row] = await db.select().from(products).where(eq(products.id, id));
    if (row) productMap.set(row.id, row);
  }

  type ResolvedLine = {
    productId: number | null;
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
    product?: typeof products.$inferSelect;
  };

  const validLines: ResolvedLine[] = [];
  for (const item of input.items) {
    const product = item.productId ? productMap.get(item.productId) : undefined;
    if (item.productId && !product) {
      return { error: `Produto ${item.productId} não encontrado`, status: 422 } satisfies SaleError;
    }
    if (product && product.active === false) {
      return { error: `Produto "${product.name}" está inativo`, status: 422 } satisfies SaleError;
    }
    // produto cadastrado → preço do banco; item avulso → preço digitado
    const unitPrice = product ? toNumber(product.finalPrice, 0) : toPositive(item.unitPrice);
    if (product && unitPrice <= 0) {
      return { error: `Produto "${product.name}" está sem preço final definido`, status: 422 } satisfies SaleError;
    }
    const quantity = toPositive(item.quantity);
    validLines.push({
      productId: item.productId ?? null,
      description: product ? String(product.name) : item.description,
      quantity,
      unitPrice: round2(unitPrice),
      total: round2(unitPrice * quantity),
      product,
    });
  }

  /* ---------- 4. totais recalculados no servidor ---------- */
  const defaults = await getPricingDefaults();
  const subtotal = round2(validLines.reduce((sum, l) => sum + l.total, 0));
  const discount = applyDiscount(subtotal, input.discount, input.discountMode);
  const net = round2(subtotal - discount);

  const methods = input.payments?.length
    ? input.payments.map((p) => p.method)
    : [input.paymentMethod || "PIX"];
  /* taxa de maquininha só incide sobre a parcela paga em cartão */
  const cardBase = input.payments?.length
    ? round2(input.payments.filter((p) => CARD_METHODS.has(p.method)).reduce((s, p) => s + toPositive(p.amount), 0))
    : CARD_METHODS.has(methods[0])
      ? net
      : 0;
  const feeRate = methods.includes("Crédito")
    ? defaults.cardFeeCreditRate
    : methods.includes("Débito")
      ? defaults.cardFeeRate
      : 0;

  /* gross-up: total / (1 - taxa). O antigo usava base * (1 + taxa) e
   * o líquido ficava abaixo do preço de tabela. */
  const fee = cardBase > 0 ? cardFeeAmount(cardBase, feeRate) : 0;
  const total = round2(net + fee);

  /* imposto POR DENTRO — o finalPrice do motor de preços já embute o
   * imposto, então aqui apenas registramos a parcela embutida para o
   * fiscal/relatório. NÃO é somado ao total (evita cobrar duas vezes). */
  const taxRate = toNumber(defaults.taxRate, 0);
  const taxes = taxRate > 0 && taxRate < 1 ? round2(net - net / (1 + taxRate)) : 0;

  /* ---------- 5. troco ---------- */
  const isCash = methods.includes("Dinheiro");
  const received = input.receivedAmount !== undefined ? toPositive(input.receivedAmount) : null;
  if (isCash && received !== null && received > 0 && received < total) {
    return { error: `Valor recebido (${received.toFixed(2)}) é menor que o total (${total.toFixed(2)})`, status: 422 } satisfies SaleError;
  }
  const change = isCash && received !== null && received > 0 ? round2(received - total) : null;

  /* ---------- 6. conferência de estoque ANTES de gravar ---------- */
  const shortages = await checkStock(validLines);
  if (shortages.length > 0 && !input.allowNegativeStock) {
    return {
      error: `Estoque insuficiente: ${shortages.map((s) => `${s.name} (tem ${s.available}, precisa de ${s.required})`).join("; ")}`,
      status: 409,
      details: { shortages },
    } satisfies SaleError;
  }

  /* ---------- 7. sessão de caixa ---------- */
  let cashSessionId = input.cashSessionId ?? null;
  if (!cashSessionId) {
    const [open] = await db.select().from(cashSessions).where(eq(cashSessions.status, "aberto")).limit(1);
    cashSessionId = open?.id ?? null;
  }

  const number = await nextDocumentNumber("sale");

  /* ---------- 8. tudo ou nada ----------
   * Antes: venda, baixa de estoque e movimentos rodavam soltos; uma
   * falha no meio deixava estoque baixado sem venda (ou o inverso). */
  try {
    const row = await db.transaction(async (tx) => {
      const [sale] = await tx
        .insert(sales)
        .values({
          number,
          clientRef: input.clientRef ?? null,
          customerId: input.customerId ?? null,
          type: input.type,
          items: validLines.map(({ productId, description, quantity, unitPrice, total: lineTotal }) => ({
            productId,
            description,
            quantity,
            unitPrice,
            total: lineTotal,
          })),
          subtotal: toDecimalString(subtotal),
          discount: toDecimalString(discount),
          taxes: toDecimalString(taxes),
          cardFee: toDecimalString(fee),
          total: toDecimalString(total),
          paymentMethod: methods.join(" + "),
          payments: input.payments?.length ? input.payments : [{ method: methods[0], amount: total }],
          receivedAmount: received !== null ? toDecimalString(received, 2) : null,
          changeAmount: change !== null ? toDecimalString(change, 2) : null,
          sellerName: input.sellerName ?? null,
          deliveryMode: input.deliveryMode ?? null,
          deliveryDate: input.deliveryDate ?? null,
          notes: input.notes ?? null,
          cashSessionId,
          status: "concluida",
        })
        .returning();

      await applyStockExit(tx, validLines, number);

      /* lançamento financeiro — antes o PDV não alimentava o caixa */
      const onCredit = methods.includes("Crédito");
      const today = new Date().toISOString().slice(0, 10);
      const settleDate = onCredit
        ? new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)
        : today;
      await tx.insert(transactions).values({
        type: "receita",
        category: "venda",
        description: `Venda ${number}${input.customerId ? "" : " · consumidor não identificado"}`,
        amount: toDecimalString(total, 2),
        dueDate: settleDate,
        paidDate: onCredit ? null : today,
        status: onCredit ? "pendente" : "pago",
        method: methods.join(" + "),
        customerId: input.customerId ?? null,
      });

      return sale;
    });

    return { ok: true as const, row, warnings: shortages.length ? { shortages } : undefined };
  } catch (e) {
    /* clientRef duplicado por corrida: devolve a venda já gravada */
    if (input.clientRef && String(e).includes("client_ref")) {
      const [existing] = await db.select().from(sales).where(eq(sales.clientRef, input.clientRef));
      if (existing) return { ok: true as const, row: existing, duplicated: true };
    }
    throw e;
  }
}

/* ==================================================================
 *  ESTOQUE
 * ================================================================== */

type Line = { productId: number | null; quantity: number; product?: typeof products.$inferSelect };

/** Soma tudo que a venda consome e compara com o disponível. */
async function checkStock(lines: Line[]) {
  const needProduct = new Map<number, number>();
  const needMaterial = new Map<number, number>();

  for (const line of lines) {
    const product = line.product;
    if (!product) continue;
    if (product.trackStock) {
      needProduct.set(product.id, (needProduct.get(product.id) || 0) + line.quantity);
    }
    if (product.baseMaterialId) {
      const used = toNumber(product.baseMaterialQty, 0) * line.quantity;
      if (used > 0) needMaterial.set(product.baseMaterialId, (needMaterial.get(product.baseMaterialId) || 0) + used);
    }
    const extras = await db.select().from(productMaterials).where(eq(productMaterials.productId, product.id));
    for (const extra of extras) {
      const used = toNumber(extra.quantity, 0) * line.quantity;
      if (used > 0 && extra.materialId) {
        needMaterial.set(extra.materialId, (needMaterial.get(extra.materialId) || 0) + used);
      }
    }
  }

  const shortages: { name: string; available: number; required: number }[] = [];

  for (const [id, required] of needProduct) {
    const [row] = await db.select().from(products).where(eq(products.id, id));
    const available = toNumber(row?.stock, 0);
    if (available < required) {
      shortages.push({ name: String(row?.name || `Produto ${id}`), available, required: round2(required) });
    }
  }
  for (const [id, required] of needMaterial) {
    const [row] = await db.select().from(materials).where(eq(materials.id, id));
    const available = toNumber(row?.stock, 0);
    if (available < required) {
      shortages.push({ name: String(row?.name || `Material ${id}`), available, required: round2(required) });
    }
  }
  return shortages;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function applyStockExit(tx: Tx, lines: Line[], reference: string) {
  for (const line of lines) {
    const product = line.product;
    if (!product || line.quantity <= 0) continue;

    if (product.trackStock) {
      await tx.update(products).set({ stock: sql`${products.stock} - ${line.quantity}` }).where(eq(products.id, product.id));
      await tx.insert(stockMovements).values({
        kind: "saida", targetType: "product", productId: product.id,
        quantity: String(line.quantity), reason: "venda", reference, automatic: true,
      });
    }

    if (product.baseMaterialId) {
      const used = toNumber(product.baseMaterialQty, 0) * line.quantity;
      if (used > 0) {
        await tx.update(materials).set({ stock: sql`${materials.stock} - ${used}` }).where(eq(materials.id, product.baseMaterialId));
        await tx.insert(stockMovements).values({
          kind: "saida", targetType: "material", materialId: product.baseMaterialId,
          quantity: String(used), reason: "venda", reference, automatic: true,
        });
      }
    }

    const extras = await tx.select().from(productMaterials).where(eq(productMaterials.productId, product.id));
    for (const extra of extras) {
      const used = toNumber(extra.quantity, 0) * line.quantity;
      if (used <= 0 || !extra.materialId) continue;
      await tx.update(materials).set({ stock: sql`${materials.stock} - ${used}` }).where(eq(materials.id, extra.materialId));
      await tx.insert(stockMovements).values({
        kind: "saida", targetType: "material", materialId: extra.materialId,
        quantity: String(used), reason: "venda", reference, automatic: true,
      });
    }
  }
}

/* ==================================================================
 *  CANCELAMENTO COM ESTORNO
 * ================================================================== */

export async function cancelSale(saleId: number, reason: string) {
  const [sale] = await db.select().from(sales).where(eq(sales.id, saleId));
  if (!sale) return { error: "Venda não encontrada", status: 404 } satisfies SaleError;
  if (sale.status === "cancelada") return { error: "Venda já está cancelada", status: 409 } satisfies SaleError;

  await db.transaction(async (tx) => {
    /* devolve ao estoque tudo que a venda tirou */
    const movements = await tx
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.reference, sale.number), eq(stockMovements.kind, "saida")));

    for (const mv of movements) {
      const qty = toNumber(mv.quantity, 0);
      if (qty <= 0) continue;
      if (mv.targetType === "product" && mv.productId) {
        await tx.update(products).set({ stock: sql`${products.stock} + ${qty}` }).where(eq(products.id, mv.productId));
      } else if (mv.targetType === "material" && mv.materialId) {
        await tx.update(materials).set({ stock: sql`${materials.stock} + ${qty}` }).where(eq(materials.id, mv.materialId));
      }
      await tx.insert(stockMovements).values({
        kind: "entrada", targetType: mv.targetType, productId: mv.productId, materialId: mv.materialId,
        quantity: String(qty), reason: "devolucao", reference: sale.number,
        notes: `Estorno do cancelamento: ${reason}`, automatic: true,
      });
    }

    /* estorna o financeiro com um lançamento de contrapartida */
    await tx.insert(transactions).values({
      type: "despesa",
      category: "estorno",
      description: `Cancelamento da venda ${sale.number} — ${reason}`,
      amount: toDecimalString(sale.total, 2),
      paidDate: new Date().toISOString().slice(0, 10),
      status: "pago",
      method: sale.paymentMethod,
      customerId: sale.customerId,
    });

    await tx
      .update(sales)
      .set({ status: "cancelada", canceledAt: new Date(), cancelReason: reason })
      .where(eq(sales.id, saleId));
  });

  return { ok: true as const };
}
