import { crudHandler, db } from "@/lib/crud";
import { pricingTables } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return crudHandler(req, {
    onCreate: (d) =>
      db
        .insert(pricingTables)
        .values(d as never)
        .returning()
        .then((r) => r[0]),
    onUpdate: (id, d) =>
      db
        .update(pricingTables)
        .set(d as never)
        .where(eq(pricingTables.id, id))
        .returning()
        .then((r) => r[0]),
    onDelete: (id) =>
      db.delete(pricingTables).where(eq(pricingTables.id, id)),
  });
}
