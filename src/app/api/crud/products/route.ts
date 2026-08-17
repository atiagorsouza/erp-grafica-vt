import { db } from "@/lib/crud";
import {
  products,
  productFinishings,
  productMaterials,
  stockMovements,
} from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Comp = {
  id: number;
  quantity: number;
  chargeMode?: string;
  batchSize?: number;
};

function genSku(name: string, id: number) {
  const slug = (name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toUpperCase()
    .slice(0, 6);
  return `PRO-${slug || "ITEM"}${String(id).padStart(3, "0")}`;
}

export async function POST(req: Request) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const op = body.op;
  const d = body.data || {};

  const productData = {
    name: d.name,
    description: d.description || null,
    productCategoryId: d.productCategoryId ? Number(d.productCategoryId) : null,
    printerId: d.printerId ? Number(d.printerId) : null,
    printerCategoryId: d.printerCategoryId ? Number(d.printerCategoryId) : null,
    printFormatId: d.printFormatId ? Number(d.printFormatId) : null,
    colorMode: d.colorMode || "mono",
    pagesPerUnit: String(d.pagesPerUnit ?? 1),
    copies: String(d.copies ?? 1),
    calculationMode: d.calculationMode || "unit",
    defaultQuantity: String(d.defaultQuantity ?? 1),
    piecesPerSheet: String(d.piecesPerSheet ?? 1),
    printSides: Number(d.printSides ?? 1),
    wastePercent: String(d.wastePercent ?? 0),
    setupSheets: Number(d.setupSheets ?? 0),
    minOrderQty: String(d.minOrderQty ?? 1),
    operationalRate: String(d.operationalRate ?? 0),
    roundingStep: String(d.roundingStep ?? 0.01),
    baseMaterialId: d.baseMaterialId ? Number(d.baseMaterialId) : null,
    baseMaterialQty: String(d.baseMaterialQty ?? 1),
    baseServiceId: d.baseServiceId ? Number(d.baseServiceId) : null,
    margin: String(d.margin ?? 0.4),
    costSnapshot: String(d.costSnapshot ?? 0),
    sellPrice: String(d.sellPrice ?? 0),
    finalPrice: String(d.finalPrice ?? 0),
    breakdown: d.breakdown ?? null,
    active: d.active ?? true,
    trackStock: d.trackStock ?? false,
    stock: String(d.stock ?? 0),
    minStock: String(d.minStock ?? 0),
  };

  const finishings: Comp[] = Array.isArray(d.finishings) ? d.finishings : [];
  const materials: Comp[] = Array.isArray(d.materials) ? d.materials : [];

  try {
    if (op === "create") {
      const [row] = await db
        .insert(products)
        .values(productData as never)
        .returning();
      // gera SKU automático
      const sku = genSku(row.name, row.id);
      await db.update(products).set({ sku }).where(eq(products.id, row.id));
      // se rastreia estoque e já entrou com saldo inicial > 0, registra movimento
      if (productData.trackStock && Number(productData.stock) > 0) {
        await db.insert(stockMovements).values({
          kind: "entrada",
          targetType: "product",
          productId: row.id,
          quantity: productData.stock,
          reason: "ajuste",
          notes: "Estoque inicial",
          automatic: true,
        });
      }
      await syncComponents(row.id, finishings, materials);
      return Response.json({ ok: true, row: { ...row, sku } });
    }
    if (op === "update") {
      const id = Number(body.id);
      await db
        .update(products)
        .set(productData as never)
        .where(eq(products.id, id));
      await syncComponents(id, finishings, materials);
      const [row] = await db
        .select()
        .from(products)
        .where(eq(products.id, id));
      return Response.json({ ok: true, row });
    }
    if (op === "delete") {
      await db.delete(products).where(eq(products.id, Number(body.id)));
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

async function syncComponents(
  productId: number,
  finishings: Comp[],
  materials: Comp[]
) {
  await db
    .delete(productFinishings)
    .where(eq(productFinishings.productId, productId));
  await db
    .delete(productMaterials)
    .where(eq(productMaterials.productId, productId));
  for (const f of finishings) {
    await db.insert(productFinishings).values({
      productId,
      finishingId: f.id,
      quantity: String(f.quantity ?? 1),
      chargeMode: f.chargeMode || "per_piece",
      batchSize: String(f.batchSize ?? 1),
    });
  }
  for (const m of materials) {
    await db.insert(productMaterials).values({
      productId,
      materialId: m.id,
      quantity: String(m.quantity ?? 1),
    });
  }
}
