import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

// The Gym Accounting live demo (public/site/gym-demo.html) is built from the prototype in prototype/ by
// scripts/build-gym-demo.py. These tests keep the two together and catch the kind of slip that broke a whole screen of it.

const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const SCRIPTS = { "fitron-core.js": "a819a434-1149-4258-bd83-0c443778190b", "fitron-app.js": "e196faa5-98bf-4b24-97c1-410aafeb15b2", "fitron-views.js": "fd32c32f-5155-463b-8ef3-47dc694ce5e3" };

function demoFiles() {
  const html = read("public/site/gym-demo.html");
  const m = html.match(/<script type="__bundler\/manifest"[^>]*>([\s\S]*?)<\/script>/);
  const manifest = JSON.parse(m![1]!.replace(/<\\\//g, "</")) as Record<string, { data: string; compressed?: boolean }>;
  const file = (key: string) => {
    const e = manifest[key]!;
    const bytes = Buffer.from(e.data, "base64");
    return (e.compressed ? gunzipSync(bytes) : bytes).toString("utf8");
  };
  return { html, file };
}

describe("the Gym Accounting live demo", () => {
  it("runs the prototype's current code (run scripts/build-gym-demo.py after changing prototype/)", () => {
    const { file } = demoFiles();
    expect(file(SCRIPTS["fitron-core.js"])).toBe(read("prototype/fitron-core.js"));
    expect(file(SCRIPTS["fitron-views.js"])).toBe(read("prototype/fitron-views.js"));
    const app = file(SCRIPTS["fitron-app.js"]);
    expect(app.startsWith("// window.claude.complete for the website demo")).toBe(true);
    expect(app).toContain("fetch('/api/gym-demo/ai'");
    expect(app).toContain("window.__fitronDemoCtx=");
  });

  it("names nothing the browser or the demo itself doesn't define", () => {
    // The browser's names that the prototype uses, and React, which the demo loads before it.
    const browser = ["window", "document", "navigator", "localStorage", "sessionStorage", "location", "history", "screen", "fetch", "FileReader", "Image", "Blob", "File", "FormData", "URL", "URLSearchParams", "Event", "CustomEvent", "KeyboardEvent", "HTMLElement", "Node", "Notification", "matchMedia", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "alert", "confirm", "prompt", "open", "print", "atob", "btoa", "crypto", "performance", "MutationObserver", "ResizeObserver", "IntersectionObserver", "AbortController", "TextEncoder", "TextDecoder", "Intl", "BarcodeDetector", "React", "ReactDOM", "queueMicrotask", "structuredClone", "scrollTo", "innerWidth", "innerHeight", "devicePixelRatio", "addEventListener", "removeEventListener", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "console"];
    const globals = Object.fromEntries([...Object.getOwnPropertyNames(globalThis), ...browser].map((n) => [n, "readonly" as const]));
    const linter = new Linter();
    for (const name of Object.keys(SCRIPTS)) {
      const problems = linter.verify(read(`prototype/${name}`), { languageOptions: { ecmaVersion: 2022, sourceType: "script", globals }, rules: { "no-undef": "error" } });
      expect(problems.map((p) => `${name}:${p.line}: ${p.message}`)).toEqual([]);
    }
  });
});
