import Link from "next/link";
import { requirePermission } from "@/lib/auth/current";
import { isLow, listProducts } from "@/lib/services/pos";
import { Badge, Button, Empty, Input, LinkButton, PageHeader, ScrollRegion } from "@/components/ui";
import { formatInr } from "@/lib/format";

export const metadata = { title: "Products & stock · Fitron" };

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const u = await requirePermission("products.manage");
  const { q } = await searchParams;
  const products = await listProducts(u, { q: typeof q === "string" ? q : undefined });
  const low = products.filter((p) => p.active && isLow(p));
  const value = products.reduce((a, p) => a + (p.stock && p.stock > 0 ? p.stock * p.cost : 0), 0);
  return (
    <>
      <PageHeader
        title="Products & stock"
        subtitle={`${products.filter((p) => p.active).length} products · stock worth ${formatInr(value)} at cost${low.length ? ` · ${low.length} to reorder` : ""}`}
        actions={
          <>
            <LinkButton href="/pos">Counter sale</LinkButton>
            <LinkButton href="/products/new" variant="primary">
              Add product
            </LinkButton>
          </>
        }
      />
      <form className="mb-4 flex gap-2">
        <Input name="q" defaultValue={typeof q === "string" ? q : ""} placeholder="Name or SKU" aria-label="Search products" />
        <Button>Search</Button>
      </form>
      {products.length === 0 ? (
        <Empty>No products yet.</Empty>
      ) : (
        <ScrollRegion label="Products table" className="rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Product</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 text-right font-medium">Price</th>
                <th className="px-4 py-2 text-right font-medium">Cost</th>
                <th className="px-4 py-2 text-right font-medium">Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {products.map((p) => (
                <tr key={p.id} className={p.active ? "" : "text-muted"}>
                  <td className="px-4 py-2.5">
                    <Link href={`/products/${p.id}`} className="font-semibold hover:text-accent">
                      {p.name}
                    </Link>
                    <span className="block text-xs text-muted">
                      {p.sku}
                      {u.branchIds.length > 1 ? ` · ${p.branch.name}` : ""}
                      {p.active ? "" : " · not sold"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">{p.category}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatInr(p.price)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatInr(p.cost)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {p.stock === null ? "—" : p.stock}
                    {p.active && isLow(p) && (
                      <span className="ml-2">
                        <Badge tone="alert">Reorder</Badge>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </>
  );
}
