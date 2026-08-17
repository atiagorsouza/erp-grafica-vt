import { crudHandler, db } from "@/lib/crud";
import { materials } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return crudHandler(req, {
    onCreate: (d) =>
      db
        .insert(materials)
        .values(d as never)
        .returning()
        .then((r) => r[0]),
    onUpdate: (id, d) =>
      db
        .update(materials)
        .set(d as never)
        .where(eq(materials.id, id))
        .returning()
        .then((r) => r[0]),
    onDelete: (id) => db.delete(materials).where(eq(materials.id, id)),
  });
}
