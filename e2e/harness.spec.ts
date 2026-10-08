import { expect, test } from "./support";

// The tests give every browser a made-up address (x-forwarded-for) so the app's per-address limits do not trip. That header
// must go to our own server only. On a request to another site (the AI Trainer loads Google Fonts) it makes the browser ask
// that site's permission first, and the font is refused: a failure that only appears where the internet is reachable.
test("the made-up address is sent to our server and to nobody else", async ({ page }) => {
  const sent = new Map<string, string | undefined>();
  // headers() shows what a route added only once the request has gone out, which allHeaders() waits for.
  page.on("request", (r) => void r.allHeaders().then(() => sent.set(new URL(r.url()).origin, r.headers()["x-forwarded-for"])));
  await page.goto("/login");
  // An image, because the page's own policy does not let a script call other sites, but lets it show their images.
  await page.evaluate(() => void (new Image().src = "https://fonts.gstatic.com/probe.png"));
  await expect.poll(() => sent.has("https://fonts.gstatic.com"), { message: "the cross-site request was made" }).toBe(true);
  expect(sent.get(new URL(page.url()).origin), "our server is told").toMatch(/^10(\.\d+){3}$/);
  expect(sent.get("https://fonts.gstatic.com"), "another site is not").toBeUndefined();
});
