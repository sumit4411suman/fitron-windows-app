import { FILE_PART, missingFiles, readFilePart, storeFilePart } from "@/lib/sync/files";
import { fail, json, withDevice } from "../_lib/http";

// Files of a linked gym (member documents and photos, staff photos, the logo), one piece at a time (src/lib/sync/files.ts).
//   GET                    the files fitron.in's records point to and it does not have (a computer may have them)
//   GET ?key=…&part=n      piece n of a file, with its size and number of pieces in headers; 404 when there is none
//   PUT ?key=…&part=n&parts=m&size=s   piece n of a file a record here points to
export const maxDuration = 60;

const LIMIT = { n: 600, ms: 60_000 };

export async function GET(req: Request) {
  return withDevice(
    req,
    async (dev) => {
      const q = new URL(req.url).searchParams;
      const key = q.get("key");
      if (!key) return json({ missing: (await missingFiles(dev.orgId)).slice(0, 500) });
      const piece = await readFilePart(dev.orgId, key, Number(q.get("part") ?? 0));
      if (!piece) return fail("fitron.in does not have that file.", 404);
      return new Response(new Uint8Array(piece.body), {
        headers: { "content-type": "application/octet-stream", "cache-control": "no-store", "x-file-size": String(piece.size), "x-file-parts": String(piece.parts) },
      });
    },
    LIMIT,
  );
}

export async function PUT(req: Request) {
  return withDevice(
    req,
    async (dev) => {
      const q = new URL(req.url).searchParams;
      const key = q.get("key");
      if (!key) return fail("Say which file.", 400);
      if (Number(req.headers.get("content-length") ?? 0) > FILE_PART) return fail("That piece is too large.", 413);
      const body = new Uint8Array(await req.arrayBuffer());
      if (body.length > FILE_PART) return fail("That piece is too large.", 413);
      const result = await storeFilePart(dev.orgId, key, { part: Number(q.get("part")), parts: Number(q.get("parts")), size: Number(q.get("size")) }, body);
      return json({ result });
    },
    LIMIT,
  );
}
