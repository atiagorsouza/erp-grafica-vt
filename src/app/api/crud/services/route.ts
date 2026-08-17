import { crudHandler, db } from "@/lib/crud";
import { services } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return crudHandler(req, {
    onCreate: (d) =>
      db
        .insert(services)
        .values(d as never)
        .returning()
        .then((r) => r[0]),
    onUpdate: (id, d) =>
      db
        .update(services)
        .set(d as never)
        .where(eq(services.id, id))
        .returning()
        .then((r) => r[0]),
    onDelete: (id) => db.delete(services).where(eq(services.id, id)),
  });
}
