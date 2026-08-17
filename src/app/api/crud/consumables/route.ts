import { crudHandler, db } from "@/lib/crud";
import { printerConsumables } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return crudHandler(req, {
    onCreate: (d) =>
      db
        .insert(printerConsumables)
        .values(d as never)
        .returning()
        .then((r) => r[0]),
    onUpdate: (id, d) =>
      db
        .update(printerConsumables)
        .set(d as never)
        .where(eq(printerConsumables.id, id))
        .returning()
        .then((r) => r[0]),
    onDelete: (id) =>
      db.delete(printerConsumables).where(eq(printerConsumables.id, id)),
  });
}
