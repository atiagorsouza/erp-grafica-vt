import { crudHandler, db } from "@/lib/crud";
import { finishingItems } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return crudHandler(req, {
    onCreate: (d) =>
      db
        .insert(finishingItems)
        .values(d as never)
        .returning()
        .then((r) => r[0]),
    onUpdate: (id, d) =>
      db
        .update(finishingItems)
        .set(d as never)
        .where(eq(finishingItems.id, id))
        .returning()
        .then((r) => r[0]),
    onDelete: (id) =>
      db.delete(finishingItems).where(eq(finishingItems.id, id)),
  });
}
