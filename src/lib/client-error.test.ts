import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportClientError } from "./client-error";

const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { pathname: "/members/9" });
});
afterEach(() => vi.unstubAllGlobals());

describe("reporting a browser error", () => {
  it("sends the kind of page, the error, where in the code it broke and the address without its query, and nothing else", () => {
    const e = new TypeError("Cannot read properties of undefined");
    e.stack = "TypeError: Cannot read properties of undefined\n    at Shell (https://fitron.in/_next/static/chunks/app.js:1:2345)\n    at more";
    reportClientError(e, "app");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/client-error");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ where: "app", message: "TypeError: Cannot read properties of undefined", at: "at Shell (https://fitron.in/_next/static/chunks/app.js:1:2345)", path: "/members/9" });
  });

  it("leaves out errors that have a digest: the server has already logged those", () => {
    reportClientError(Object.assign(new Error("server render failed"), { digest: "123" }), "page");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the same error once, however many times the page renders it", () => {
    for (let i = 0; i < 3; i++) reportClientError(new Error("same one"), "global");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cuts a long message", () => {
    reportClientError(new Error("m".repeat(2000)), "page");
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.message).toHaveLength(300);
  });

  it("never throws, even when the browser cannot send", () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(() => reportClientError(new Error("x"), "page")).not.toThrow();
    vi.stubGlobal("fetch", () => {
      throw new Error("blocked");
    });
    expect(() => reportClientError(new Error("y"), "page")).not.toThrow();
  });
});
