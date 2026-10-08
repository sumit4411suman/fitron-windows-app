import { describe, expect, it } from "vitest";
import { poolConfig, withoutSslParams } from "./db-config";

const URL = "postgres://postgres.abc:p%40ss@aws-0-ap-south-1.pooler.supabase.com:5432/postgres";
const PEM = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----";

describe("poolConfig", () => {
  it("is just the connection string when nothing extra is set, as on a Docker server", () => {
    expect(poolConfig({ DATABASE_URL: URL })).toEqual({ connectionString: URL });
    expect(poolConfig({ DATABASE_URL: `${URL}?sslmode=verify-full&sslrootcert=/certs/ca.crt` })).toEqual({
      connectionString: `${URL}?sslmode=verify-full&sslrootcert=/certs/ca.crt`,
    });
  });

  it("treats blank settings, as the installer writes them, as not set", () => {
    expect(poolConfig({ DATABASE_URL: URL, DATABASE_CA: "", DATABASE_POOL_MAX: "" })).toEqual({ connectionString: URL });
    expect(poolConfig({ DATABASE_URL: URL, DATABASE_CA: "   " })).toEqual({ connectionString: URL });
  });

  it("verifies against the certificate authority given as text", () => {
    expect(poolConfig({ DATABASE_URL: URL, DATABASE_CA: PEM })).toEqual({ connectionString: URL, ssl: { ca: PEM } });
  });

  it("accepts the certificate on one line with \\n written out, and ignores spaces around it", () => {
    const oneLine = "-----BEGIN CERTIFICATE-----\\nAAAA\\n-----END CERTIFICATE-----";
    expect(poolConfig({ DATABASE_URL: URL, DATABASE_CA: `  ${oneLine}\n` }).ssl).toEqual({ ca: PEM });
  });

  it("takes the ssl settings out of the string when a certificate is given, because the string would override it", () => {
    const c = poolConfig({ DATABASE_URL: `${URL}?sslmode=require&connect_timeout=30&sslrootcert=/certs/ca.crt`, DATABASE_CA: PEM });
    expect(c.connectionString).toBe(`${URL}?connect_timeout=30`);
    expect(c.ssl).toEqual({ ca: PEM });
  });

  it("limits the connections of one running copy when asked, and ignores nonsense", () => {
    expect(poolConfig({ DATABASE_URL: URL, DATABASE_POOL_MAX: "3" }).max).toBe(3);
    for (const bad of ["abc", "0", "-1", "2.5", " "]) expect(poolConfig({ DATABASE_URL: URL, DATABASE_POOL_MAX: bad }).max).toBeUndefined();
  });

  it("copes with no DATABASE_URL at all (a build that never opens a connection)", () => {
    expect(poolConfig({})).toEqual({ connectionString: undefined });
    expect(poolConfig({ DATABASE_CA: PEM })).toEqual({ connectionString: undefined, ssl: { ca: PEM } });
  });
});

describe("withoutSslParams", () => {
  it("removes only the ssl settings and keeps the rest in order", () => {
    expect(withoutSslParams(`${URL}?application_name=fitron&sslmode=require&connect_timeout=5`)).toBe(`${URL}?application_name=fitron&connect_timeout=5`);
  });

  it("leaves no dangling question mark", () => {
    expect(withoutSslParams(`${URL}?sslmode=verify-full&sslrootcert=/certs/ca.crt`)).toBe(URL);
    expect(withoutSslParams(`${URL}?`)).toBe(URL);
  });

  it("returns the user, password and host untouched, even with unusual characters in the password", () => {
    const odd = "postgres://u:a%3Fb%26c%23d@host:5432/db";
    expect(withoutSslParams(`${odd}?sslmode=require`)).toBe(odd);
  });

  it("does nothing to a string with no query", () => {
    expect(withoutSslParams(URL)).toBe(URL);
  });

  it("matches the names whatever their case", () => {
    expect(withoutSslParams(`${URL}?SSLMODE=require&x=1`)).toBe(`${URL}?x=1`);
  });
});
