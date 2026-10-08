import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { browserDetails, ErrorScreen } from "./error-screen";

const show = (error: Error & { digest?: string }, home = { href: "/dashboard", label: "Go to the dashboard" }) =>
  renderToStaticMarkup(createElement(ErrorScreen, { error, retry: () => {}, where: "app", home }));

describe("the error screen", () => {
  it("shows the reference to quote, a way to try again, a way out and a way to ask for help", () => {
    const html = show(Object.assign(new Error("hidden"), { digest: "ref-4821" }));
    for (const s of ["ref-4821", "Try again", 'href="/dashboard"', "Go to the dashboard", 'href="/contact?topic=support"', 'role="alert"']) expect(html, s).toContain(s);
  });

  it("never shows the error's own message, which can hold details of the data involved", () => {
    expect(show(Object.assign(new Error("duplicate key asha@example.com"), { digest: "d" }))).not.toContain("asha@example.com");
  });

  it("is still complete when the error has no digest (it came from the browser), and says what broke", () => {
    const html = show(new TypeError("Cannot read properties of undefined (reading 'map')"), { href: "/", label: "Back to fitron.in" });
    expect(html).not.toContain("Reference");
    expect(html).toContain("Back to fitron.in");
    expect(html).toContain("Details for support");
    expect(html).toContain("TypeError: Cannot read properties of undefined (reading &#x27;map&#x27;)");
    expect(html).toContain("Reload page");
  });

  it("keeps the browser's details short", () => {
    expect(browserDetails(new Error("x".repeat(500)))).toHaveLength(200);
  });

  it("adds where in the published code it broke, so a build of the same commit can name the source line", () => {
    const e = new TypeError("i is not a function");
    e.stack = "TypeError: i is not a function\n    at a (https://fitron.in/_next/static/chunks/0f3c2a9e1b.js:1:48213)\n    at b (https://fitron.in/_next/static/chunks/main.js:2:10)";
    expect(browserDetails(e)).toBe("TypeError: i is not a function @ chunks/0f3c2a9e1b.js:1:48213");
  });
});
