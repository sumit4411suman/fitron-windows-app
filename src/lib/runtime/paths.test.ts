import path from "node:path";
import { describe, expect, it } from "vitest";
import { dataDirs, defaultDataRoot, localDatabaseUrl, localStorageDir } from "./paths";

// Phase 16: the gym's data lives in the signed-in user's own application-data folder, found from the environment,
// never a fixed drive, user name or the program's folder.

describe("where the gym's data lives", () => {
  it("is %LOCALAPPDATA%\\FITRON on Windows, whatever the user's name", () => {
    const local = path.join("D:", "Profiles", "Rāhul Sharmā", "AppData", "Local");
    expect(defaultDataRoot({ LOCALAPPDATA: local }, "win32", "/unused")).toBe(path.join(local, "FITRON"));
  });

  it("falls back to the user's own profile when LOCALAPPDATA is not set", () => {
    const home = path.join("C:", "Users", "front desk");
    expect(defaultDataRoot({}, "win32", home)).toBe(path.join(home, "AppData", "Local", "FITRON"));
  });

  it("follows the folder the desktop shell resolved (FITRON_DATA_DIR)", () => {
    expect(defaultDataRoot({ FITRON_DATA_DIR: " /data/FITRON ", LOCALAPPDATA: "/ignored" }, "win32", "/home")).toBe(path.resolve("/data/FITRON"));
  });

  it("uses the platform's own folder elsewhere", () => {
    expect(defaultDataRoot({}, "darwin", "/Users/asha")).toBe(path.join("/Users/asha", "Library", "Application Support", "FITRON"));
    expect(defaultDataRoot({ XDG_DATA_HOME: "/xdg" }, "linux", "/home/asha")).toBe(path.join("/xdg", "FITRON"));
    expect(defaultDataRoot({}, "linux", "/home/asha")).toBe(path.join("/home/asha", ".local", "share", "FITRON"));
  });

  it("keeps the database, backups, documents and logs inside it", () => {
    const root = path.join("/x", "FITRON");
    expect(dataDirs(root)).toEqual({
      root,
      data: path.join(root, "data"),
      backups: path.join(root, "backups"),
      documents: path.join(root, "documents"),
      logs: path.join(root, "logs"),
      database: path.join(root, "data", "fitron.db"),
    });
    expect(localDatabaseUrl({ FITRON_DATA_DIR: root })).toBe(`file:${path.join(root, "data", "fitron.db")}`);
    expect(localStorageDir({ FITRON_DATA_DIR: root })).toBe(path.join(root, "documents"));
  });

  it("never uses a database that is not a file (a server address from the computer's settings)", () => {
    const root = path.join("/x", "FITRON");
    expect(localDatabaseUrl({ FITRON_DATA_DIR: root, DATABASE_URL: "postgresql://db.example.com/fitron" })).toBe(`file:${path.join(root, "data", "fitron.db")}`);
  });
});
