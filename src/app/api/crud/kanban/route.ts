import { db } from "@/lib/crud";
import { kanbanCards } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

type AnyRow = Record<string, unknown>;

export async function POST(req: Request) {
  let body: AnyRow;
  try {
    body = (await req.json()) as AnyRow;
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const op = String(body.op || "");
  const id = Number(body.id);
  const d = (body.data as AnyRow) || {};

  try {
    /* Operação especial: sincroniza coluna do card pelo quoteId do pedido */
    if (op === "syncByQuote") {
      const quoteId = Number(body.quoteId);
      if (!Number.isFinite(quoteId)) {
        return Response.json({ error: "quoteId obrigatório" }, { status: 400 });
      }
      const [existing] = await db
        .select()
        .from(kanbanCards)
        .where(eq(kanbanCards.quoteId, quoteId));
      if (existing) {
        const [updated] = await db
          .update(kanbanCards)
          .set({ ...(body.data as object), updatedAt: new Date() } as never)
          .where(eq(kanbanCards.id, existing.id))
          .returning();
        return Response.json({ ok: true, row: updated });
      }
      return Response.json({ ok: true, row: null, note: "card not found for quoteId" });
    }

    if (op === "create") {
      const row = await db
        .insert(kanbanCards)
        .values(d as never)
        .returning()
        .then((r) => r[0]);
      return Response.json({ ok: true, row });
    }

    if (op === "update") {
      if (!Number.isFinite(id)) return Response.json({ error: "id obrigatório" }, { status: 400 });
      const row = await db
        .update(kanbanCards)
        .set({ ...(d as object), updatedAt: new Date() } as never)
        .where(eq(kanbanCards.id, id))
        .returning()
        .then((r) => r[0]);
      return Response.json({ ok: true, row });
    }

    if (op === "delete") {
      if (!Number.isFinite(id)) return Response.json({ error: "id obrigatório" }, { status: 400 });
      await db.delete(kanbanCards).where(eq(kanbanCards.id, id));
      return Response.json({ ok: true });
    }

    return Response.json({ error: "op inválido" }, { status: 400 });
  } catch (e) {
    console.error("[kanban]", e);
    return Response.json({ error: e instanceof Error ? e.message : "erro interno" }, { status: 500 });
  }
}
