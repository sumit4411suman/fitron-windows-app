import { getCurrentUser, PLAN_ENDED } from "@/lib/auth/current";
import { parsePaper } from "@/lib/pdf/paper";
import { invoicePdf } from "@/lib/services/invoice-pdf";

// The GST invoice as a PDF on the paper asked for: ?paper=a4 (the default), a5, 80mm or 58mm. Opened in its own
// window it prints at its own size; ?download=1 saves it instead (docs/local-windows/PRINTING.md).
export async function GET(req: Request, ctx: RouteContext<"/invoices/[id]/pdf">) {
  const u = await getCurrentUser();
  if (!u) return new Response("Sign in first.", { status: 401 });
  if (u.planBlocked) return new Response(PLAN_ENDED, { status: 402 });
  if (!u.can("invoices.view")) return new Response("Not allowed.", { status: 403 });
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const pdf = await invoicePdf(u, id, parsePaper(url.searchParams.get("paper"), "a4"));
  if (!pdf) return new Response("Not found.", { status: 404 });
  return new Response(Buffer.from(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${pdf.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
