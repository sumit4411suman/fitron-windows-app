import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { EDITION } from "../env";
import { addMember, expect, signUp, sql, test, unique } from "../support";
import { orgOf } from "./helpers";

// Phase 9: files. A member document is uploaded on the member's page; its record (name, kind, size, type) is in the
// database and its bytes in storage. On the Local Edition that is the data folder's documents\<gym>\… folder, never
// beside the program. A file removed outside FITRON is "not found", not an error page.
test("a member document is stored privately, opened only through FITRON, and a missing file is not found", async ({ page }) => {
  const gym = await signUp(page, { tag: "docs" });
  const memberId = await addMember(page, `Divya ${unique()}`);
  await page.goto(`/members/${memberId}?tab=documents`);
  const form = page.locator("#upload");
  await form.getByLabel("Title").fill("Aadhaar card");
  await form.getByLabel("File", { exact: true }).setInputFiles({ name: "aadhaar.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n% FITRON test document\n") });
  await form.getByRole("button", { name: "Upload document" }).click();
  await expect(page.getByText("Aadhaar card").first()).toBeVisible();

  const orgId = await orgOf(gym.email);
  const [doc] = await sql<{ id: string; storageKey: string; size: number; mime: string; fileName: string }>(`select id, "storageKey", size, mime, "fileName" from "MemberDocument" where "orgId" = $1`, [orgId]);
  expect(doc).toMatchObject({ size: 32, mime: "application/pdf", fileName: "aadhaar.pdf" });
  expect(doc!.storageKey.startsWith(`${orgId}/members/${memberId}/`)).toBe(true);

  const res = await page.request.get(`/documents/${doc!.id}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  expect(res.headers()["cache-control"]).toContain("no-store");
  expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");
  // Signed out, the same address answers nothing.
  expect((await page.context().browser()!.newContext().then((c) => c.request.get(`${page.url().split("/members")[0]}/documents/${doc!.id}`, { maxRedirects: 0 }))).status()).not.toBe(200);

  if (EDITION === "local") {
    const file = path.join(process.cwd(), ".local-e2e", "documents", ...doc!.storageKey.split("/"));
    expect(existsSync(file), "in the data folder's documents").toBe(true);
    unlinkSync(file);
    expect((await page.request.get(`/documents/${doc!.id}`)).status()).toBe(404);
    expect(await sql(`select 1 from "MemberDocument" where id = $1`, [doc!.id]), "the record stays").toHaveLength(1);
  }
});
