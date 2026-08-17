import { crudHandler, db } from "@/lib/crud";
import { customers } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return crudHandler(req, {
    onCreate: (d) =>
      db
        .insert(customers)
        .values({ ...(d as object), updatedAt: new Date() } as never)
        .returning()
        .then((r) => r[0]),
    onUpdate: (id, d) =>
      db
        .update(customers)
        .set({ ...(d as object), updatedAt: new Date() } as never)
        .where(eq(customers.id, id))
        .returning()
        .then((r) => r[0]),
    onDelete: (id) => db.delete(customers).where(eq(customers.id, id)),
  });
}
