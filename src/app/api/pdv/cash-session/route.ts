import { db } from "@/db";
import { cashSessions, cashMovements, sales } from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { round2, toDecimalString, toNumber, toPositive } from "@/lib/money";

export const dynamic = "force-dynamic";

/** Soma o que deveria estar na gaveta: abertura + vendas em dinheiro + suprimentos − sangrias. */
async function expectedInDrawer(sessionId: number, openingAmount: number) {
  const [cashSales] = await db
    .select({
      total: sql<string>`coalesce(sum(${sales.total} - coalesce(${sales.cardFee}, 0)), 0)`,
    })
    .from(sales)
    .where(
      and(
        eq(sales.cashSessionId, sessionId),
        eq(sales.status, "concluida"),
        sql`${sales.paymentMethod} ILIKE '%Dinheiro%'`
      )
    );

  const movements = await db.select().from(cashMovements).where(eq(cashMovements.sessionId, sessionId));
  const supply = movements.filter((m) => m.kind === "suprimento").reduce((s, m) => s + toNumber(m.amount, 0), 0);
  const withdraw = movements.filter((m) => m.kind === "sangria").reduce((s, m) => s + toNumber(m.amount, 0), 0);

  return round2(openingAmount + toNumber(cashSales?.total, 0) + supply - withdraw);
}

/** GET → sessão aberta (se houver) com seus movimentos. */
export async function GET() {
  const [open] = await db
    .select()
    .from(cashSessions)
    .where(and(eq(cashSessions.status, "aberto"), isNull(cashSessions.closedAt)))
    .limit(1);

  if (!open) return Response.json({ session: null });

  const movements = await db.select().from(cashMovements).where(eq(cashMovements.sessionId, open.id));
  return Response.json({
    session: open,
    movements,
    expected: await expectedInDrawer(open.id, toNumber(open.openingAmount, 0)),
  });
}

/**
 * POST
 *   { op: "open",  openingAmount, operator }
 *   { op: "move",  kind: "sangria"|"suprimento", amount, reason }
 *   { op: "close", countedAmount, notes }   ← conferência cega
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const op = String(body.op || "");

  try {
    if (op === "open") {
      const [already] = await db.select().from(cashSessions).where(eq(cashSessions.status, "aberto")).limit(1);
      if (already) return Response.json({ error: "Já existe um caixa aberto" }, { status: 409 });

      const [row] = await db
        .insert(cashSessions)
        .values({
          status: "aberto",
          operator: String(body.operator || "").trim() || null,
          openingAmount: toDecimalString(toPositive(body.openingAmount), 2),
        })
        .returning();
      return Response.json({ ok: true, session: row });
    }

    const [session] = await db.select().from(cashSessions).where(eq(cashSessions.status, "aberto")).limit(1);
    if (!session) return Response.json({ error: "Nenhum caixa aberto" }, { status: 409 });

    if (op === "move") {
      const kind = String(body.kind || "");
      if (kind !== "sangria" && kind !== "suprimento") {
        return Response.json({ error: "kind deve ser sangria ou suprimento" }, { status: 400 });
      }
      const amount = toPositive(body.amount);
      if (amount <= 0) return Response.json({ error: "Valor deve ser maior que zero" }, { status: 400 });

      const [row] = await db
        .insert(cashMovements)
        .values({
          sessionId: session.id,
          kind,
          amount: toDecimalString(amount, 2),
          reason: String(body.reason || "").trim() || null,
        })
        .returning();
      return Response.json({ ok: true, movement: row });
    }

    if (op === "close") {
      const counted = toPositive(body.countedAmount);
      const expected = await expectedInDrawer(session.id, toNumber(session.openingAmount, 0));
      const [row] = await db
        .update(cashSessions)
        .set({
          status: "fechado",
          countedAmount: toDecimalString(counted, 2),
          expectedAmount: toDecimalString(expected, 2),
          differenceAmount: toDecimalString(round2(counted - expected), 2),
          notes: String(body.notes || "").trim() || null,
          closedAt: new Date(),
        })
        .where(eq(cashSessions.id, session.id))
        .returning();
      return Response.json({ ok: true, session: row, expected, counted, difference: round2(counted - expected) });
    }

    return Response.json({ error: "op inválido" }, { status: 400 });
  } catch (e) {
    console.error("[cash-session]", e);
    return Response.json({ error: e instanceof Error ? e.message : "erro interno" }, { status: 500 });
  }
}
