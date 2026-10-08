import { getCurrentUser, PLAN_ENDED } from "@/lib/auth/current";
import { invoicePdf } from "@/lib/services/invoice-pdf";

export async function GET(_req: Request, ctx: RouteContext<"/invoices/[id]/pdf">) {
  const u = await getCurrentUser();
  if (!u) return new Response("Sign in first.", { status: 401 });
  if (u.planBlocked) return new Response(PLAN_ENDED, { status: 402 });
  if (!u.can("invoices.view")) return new Response("Not allowed.", { status: 403 });
  const { id } = await ctx.params;
  const pdf = await invoicePdf(u, id);
  if (!pdf) return new Response("Not found.", { status: 404 });
  return new Response(Buffer.from(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdf.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
