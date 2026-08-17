import { db } from "@/lib/crud";
import { stockMovements, materials, products } from "@/db/schema";
import { eq, sql, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Módulo de Estoque — Entradas e Saídas.
 * Toda movimentação registrada aqui atualiza automaticamente o saldo
 * do material ou produto (somando ou subtraindo conforme o tipo).
 *
 *   op = "create"  -> registra movimento + ajusta saldo
 *   op = "delete"  -> remove movimento + reverte o saldo
 *   op = "list"    -> lista movimentações (com filtro opcional)
 */
export async function GET() {
  const rows = await db
    .select()
    .from(stockMovements)
    .orderBy(desc(stockMovements.createdAt))
    .limit(200);
  return Response.json({ ok: true, rows });
}

export async function POST(req: Request) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const op = body.op;

  try {
    if (op === "create") {
      const d = body.data || {};
      const kind = d.kind as "entrada" | "saida" | "ajuste";
      const targetType = d.targetType as "material" | "product";
      const quantity = Number(d.quantity || 0);
      if (!quantity || quantity <= 0) {
        return Response.json(
          { error: "Quantidade deve ser maior que zero" },
          { status: 400 }
        );
      }

      const [row] = await db
        .insert(stockMovements)
        .values({
          kind,
          targetType,
          materialId: targetType === "material" ? Number(d.targetId) : null,
          productId: targetType === "product" ? Number(d.targetId) : null,
          quantity: String(quantity),
          unitCost: String(d.unitCost ?? 0),
          reason: d.reason || "ajuste",
          reference: d.reference || null,
          notes: d.notes || null,
          automatic: false,
        })
        .returning();

      const delta = kind === "saida" ? -quantity : quantity;
      if (targetType === "material") {
        await db
          .update(materials)
          .set({ stock: sql`${materials.stock} + ${delta}` })
          .where(eq(materials.id, Number(d.targetId)));
      } else {
        await db
          .update(products)
          .set({ stock: sql`${products.stock} + ${delta}` })
          .where(eq(products.id, Number(d.targetId)));
      }

      return Response.json({ ok: true, row });
    }

    if (op === "delete") {
      const id = Number(body.id);
      const [mv] = await db
        .select()
        .from(stockMovements)
        .where(eq(stockMovements.id, id));
      if (!mv) return Response.json({ error: "não encontrado" }, { status: 404 });

      // reverte o efeito no saldo
      const qty = Number(mv.quantity);
      const revertDelta = mv.kind === "saida" ? qty : -qty;
      if (mv.targetType === "material" && mv.materialId) {
        await db
          .update(materials)
          .set({ stock: sql`${materials.stock} + ${revertDelta}` })
          .where(eq(materials.id, mv.materialId));
      } else if (mv.targetType === "product" && mv.productId) {
        await db
          .update(products)
          .set({ stock: sql`${products.stock} + ${revertDelta}` })
          .where(eq(products.id, mv.productId));
      }
      await db.delete(stockMovements).where(eq(stockMovements.id, id));
      return Response.json({ ok: true });
    }

    return Response.json({ error: "op inválido" }, { status: 400 });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "erro" },
      { status: 500 }
    );
  }
}
