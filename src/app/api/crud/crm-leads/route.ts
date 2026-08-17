import { crudHandler, db } from "@/lib/crud";
import { crmLeads } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return crudHandler(req, {
    onCreate: (d) => db.insert(crmLeads).values(d as never).returning().then((r) => r[0]),
    onUpdate: (id, d) =>
      db
        .update(crmLeads)
        .set({ ...(d as object), updatedAt: new Date() } as never)
        .where(eq(crmLeads.id, id))
        .returning()
        .then((r) => r[0]),
    onDelete: (id) => db.delete(crmLeads).where(eq(crmLeads.id, id)),
  });
}
