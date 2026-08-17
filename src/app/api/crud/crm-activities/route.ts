import { crudHandler, db } from "@/lib/crud";
import { crmActivities } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return crudHandler(req, {
    onCreate: (d) => db.insert(crmActivities).values(d as never).returning().then((r) => r[0]),
    onUpdate: (id, d) =>
      db
        .update(crmActivities)
        .set(d as never)
        .where(eq(crmActivities.id, id))
        .returning()
        .then((r) => r[0]),
    onDelete: (id) => db.delete(crmActivities).where(eq(crmActivities.id, id)),
  });
}
