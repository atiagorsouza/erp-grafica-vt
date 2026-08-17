import { crudHandler, db } from "@/lib/crud";
import { commemorativeDates } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return crudHandler(req, {
    onCreate: (d) =>
      db
        .insert(commemorativeDates)
        .values({ ...(d as object) } as never)
        .returning()
        .then((r) => r[0]),
    onUpdate: (id, d) =>
      db
        .update(commemorativeDates)
        .set({ ...(d as object) } as never)
        .where(eq(commemorativeDates.id, id))
        .returning()
        .then((r) => r[0]),
    onDelete: (id) => db.delete(commemorativeDates).where(eq(commemorativeDates.id, id)),
  });
}
