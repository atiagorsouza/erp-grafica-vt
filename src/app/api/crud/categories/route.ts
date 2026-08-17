import { crudHandler, db } from "@/lib/crud";
import { printerCategories } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return crudHandler(req, {
    onCreate: (d) =>
      db
        .insert(printerCategories)
        .values(d as never)
        .returning()
        .then((r) => r[0]),
    onUpdate: (id, d) =>
      db
        .update(printerCategories)
        .set(d as never)
        .where(eq(printerCategories.id, id))
        .returning()
        .then((r) => r[0]),
    onDelete: (id) =>
      db.delete(printerCategories).where(eq(printerCategories.id, id)),
  });
}
