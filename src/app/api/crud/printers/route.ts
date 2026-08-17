import { crudHandler, db } from "@/lib/crud";
import { printers } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return crudHandler(req, {
    onCreate: (d) =>
      db
        .insert(printers)
        .values(d as never)
        .returning()
        .then((r) => r[0]),
    onUpdate: (id, d) =>
      db
        .update(printers)
        .set(d as never)
        .where(eq(printers.id, id))
        .returning()
        .then((r) => r[0]),
    onDelete: (id) => db.delete(printers).where(eq(printers.id, id)),
  });
}
