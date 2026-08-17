import { db } from "@/db";
import {
  notifications,
  materials,
  orders,
  deliveries,
  crmActivities,
} from "@/db/schema";
import { and, asc, desc, eq, isNull, lte, or } from "drizzle-orm";

export const dynamic = "force-dynamic";

type AppNotification = {
  id: string | number;
  type: "info" | "success" | "warning" | "danger";
  title: string;
  body?: string | null;
  href?: string | null;
  readAt?: Date | null;
  createdAt: Date;
  system?: boolean;
};

export async function GET() {
  try {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const [stored, lowStock, pendingArts, pendingDeliveries, dueActivities] =
      await Promise.all([
        db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(30),
        db
          .select()
          .from(materials)
          .where(lte(materials.stock, materials.minStock))
          .limit(8),
        db
          .select()
          .from(orders)
          .where(or(eq(orders.artStatus, "pendente"), eq(orders.artStatus, "revisao")))
          .limit(8),
        db
          .select()
          .from(deliveries)
          .where(or(eq(deliveries.status, "aguardando"), eq(deliveries.status, "separado")))
          .limit(8),
        db
          .select()
          .from(crmActivities)
          .where(and(isNull(crmActivities.completedAt), lte(crmActivities.dueAt, tomorrow)))
          .orderBy(asc(crmActivities.dueAt))
          .limit(8),
      ]);

    const system: AppNotification[] = [
      ...lowStock.map((m) => ({
        id: `stock-${m.id}`,
        type: "warning" as const,
        title: "Estoque no mínimo",
        body: `${m.name}: ${Number(m.stock)} ${m.unit} (mínimo ${Number(m.minStock)})`,
        href: "/estoque",
        createdAt: now,
        system: true,
      })),
      ...pendingArts.map((order) => ({
        id: `art-${order.id}`,
        type: "warning" as const,
        title: "Arte precisa de atenção",
        body: `${order.number}: status ${order.artStatus}`,
        href: "/pedidos",
        createdAt: now,
        system: true,
      })),
      ...pendingDeliveries.map((delivery) => ({
        id: `delivery-${delivery.id}`,
        type: "info" as const,
        title: "Entrega aguardando andamento",
        body: `${delivery.method} · status ${delivery.status}`,
        href: "/pedidos",
        createdAt: now,
        system: true,
      })),
      ...dueActivities.map((activity) => ({
        id: `activity-${activity.id}`,
        type: "info" as const,
        title: "Próxima ação de CRM",
        body: activity.title,
        href: activity.customerId ? `/clientes?id=${activity.customerId}` : "/clientes",
        createdAt: activity.dueAt || activity.createdAt,
        system: true,
      })),
    ];

    const list = [...system, ...stored].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return Response.json({
      ok: true,
      notifications: list,
      unreadCount: system.length + stored.filter((item) => !item.readAt).length,
      refreshedAt: now,
    });
  } catch {
    return Response.json({ ok: false, notifications: [], unreadCount: 0 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    if (body.op === "create") {
      const [row] = await db
        .insert(notifications)
        .values({
          type: body.data?.type || "info",
          title: body.data?.title || "Notificação",
          body: body.data?.body || null,
          href: body.data?.href || null,
        })
        .returning();
      return Response.json({ ok: true, row });
    }
    if (body.op === "read") {
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(eq(notifications.id, Number(body.id)));
      return Response.json({ ok: true });
    }
    if (body.op === "read-all") {
      await db.update(notifications).set({ readAt: new Date() }).where(isNull(notifications.readAt));
      return Response.json({ ok: true });
    }
    return Response.json({ error: "op inválido" }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "erro" },
      { status: 500 }
    );
  }
}
