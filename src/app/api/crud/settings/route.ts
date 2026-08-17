import { crudHandler, db, clearSettingsCache } from "@/lib/crud";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Aceita upsert: op = "save", data = { key, value, category }
 */
export async function POST(req: Request) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  try {
    if (body.op === "save") {
      const { key, value, category } = body.data;
      const existing = await db
        .select()
        .from(settings)
        .where(eq(settings.key, key));
      let row;
      if (existing.length) {
        [row] = await db
          .update(settings)
          .set({ value: String(value ?? ""), category: category || "geral", updatedAt: new Date() })
          .where(eq(settings.key, key))
          .returning();
      } else {
        [row] = await db
          .insert(settings)
          .values({ key, value: String(value ?? ""), category: category || "geral" })
          .returning();
      }
      clearSettingsCache();
      return Response.json({ ok: true, row });
    }
    if (body.op === "delete") {
      await db.delete(settings).where(eq(settings.id, Number(body.id)));
      clearSettingsCache();
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
