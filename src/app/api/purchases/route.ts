import { db } from "@/db";
import { purchases, materials, stockMovements } from "@/db/schema";
import { nextDocumentNumber } from "@/lib/documents";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

type PurchaseItem = { materialId: number; quantity: number; unitCost: number; label?: string };

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const op = body.op;
  try {
    if (op === "create") {
      const d = body.data || {};
      const items: PurchaseItem[] = Array.isArray(d.items) ? d.items : [];
      const subtotal = items.reduce((sum, i) => sum + Number(i.quantity || 0) * Number(i.unitCost || 0), 0);
      const number = await nextDocumentNumber("purchase");
      const [row] = await db
        .insert(purchases)
        .values({
          number,
          supplierId: d.supplierId ? Number(d.supplierId) : null,
          status: d.status || "rascunho",
          items,
          subtotal: String(subtotal),
          freight: String(d.freight || 0),
          discount: String(d.discount || 0),
          total: String(subtotal + Number(d.freight || 0) - Number(d.discount || 0)),
          expectedDate: d.expectedDate || null,
          notes: d.notes || null,
        })
        .returning();
      return Response.json({ ok: true, row });
    }

    if (op === "receive") {
      const purchaseId = Number(body.purchaseId);
      const [purchase] = await db.select().from(purchases).where(eq(purchases.id, purchaseId));
      if (!purchase) return Response.json({ error: "Compra não encontrada" }, { status: 404 });
      if (purchase.status === "recebido") return Response.json({ ok: true, row: purchase, alreadyReceived: true });
      const items = (purchase.items || []) as PurchaseItem[];
      for (const item of items) {
        const quantity = Number(item.quantity || 0);
        const unitCost = Number(item.unitCost || 0);
        if (!item.materialId || quantity <= 0) continue;
        await db
          .update(materials)
          .set({
            stock: sql`${materials.stock} + ${quantity}`,
            unitCost: String(unitCost),
          })
          .where(eq(materials.id, item.materialId));
        await db.insert(stockMovements).values({
          kind: "entrada",
          targetType: "material",
          materialId: item.materialId,
          quantity: String(quantity),
          unitCost: String(unitCost),
          reason: "compra",
          reference: purchase.number,
          notes: "Recebimento automático de compra.",
          automatic: true,
        });
      }
      const [row] = await db
        .update(purchases)
        .set({ status: "recebido", receivedAt: new Date() })
        .where(eq(purchases.id, purchaseId))
        .returning();
      return Response.json({ ok: true, row });
    }

    return Response.json({ error: "op inválido" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "erro" }, { status: 500 });
  }
}
