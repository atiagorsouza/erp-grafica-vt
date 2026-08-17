import { crudHandler, db } from "@/lib/crud";
import { printFormats } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return crudHandler(req, {
    onCreate: (d) =>
      db.insert(printFormats).values(d as never).returning().then((r) => r[0]),
    onUpdate: (id, d) =>
      db
        .update(printFormats)
        .set(d as never)
        .where(eq(printFormats.id, id))
        .returning()
        .then((r) => r[0]),
    onDelete: (id) => db.delete(printFormats).where(eq(printFormats.id, id)),
  });
}
