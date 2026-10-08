import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current";
import { isFitronAdmin } from "@/lib/integrations/fitron-team";
import { listContent, saveContent } from "@/lib/services/trainer-content";
import { UserError } from "@/lib/services/errors";
import { Badge, Button, Input, Notice, PageHeader, TABLE, TD, TH, TR, ScrollRegion } from "@/components/ui";
import { fmtStamp } from "@/lib/format";
import { AdminTabs } from "../../tabs";

export const metadata = { title: "Form videos · FITRON" };

async function saveVideo(fd: FormData) {
  "use server";
  const u = await requireUser();
  if (!isFitronAdmin(u.email)) notFound();
  const ex = String(fd.get("ex") ?? "");
  try {
    await saveContent(u, ex, String(fd.get("videoUrl") ?? ""), String(fd.get("note") ?? ""));
  } catch (e) {
    if (e instanceof UserError) redirect(`/fitron-admin/trainer/content?error=${encodeURIComponent(e.message)}&ex=${encodeURIComponent(ex)}`);
    throw e;
  }
  revalidatePath("/fitron-admin/trainer/content");
  redirect(`/fitron-admin/trainer/content?saved=${encodeURIComponent(ex)}`);
}

/** FITRON team only: one form video per exercise in the AI Trainer's library. */
export default async function ContentPage({ searchParams }: PageProps<"/fitron-admin/trainer/content">) {
  const u = await requireUser();
  if (!isFitronAdmin(u.email)) notFound();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const rows = await listContent();
  const done = rows.filter((r) => r.embed).length;
  return (
    <>
      <PageHeader title="Exercise form videos" subtitle={`${done} of ${rows.length} exercises have a video. Members see it on the exercise card (Form video) and in full screen.`} />
      <AdminTabs current="/fitron-admin/trainer/content" />
      {str("error") && (
        <Notice tone="alert">
          {str("ex")}: {str("error")}
        </Notice>
      )}
      {str("saved") && <Notice tone="ok">Saved {str("saved")}.</Notice>}
      <p className="mb-4 text-sm text-muted">Paste a YouTube link (a Short works best: vertical, under a minute) or a direct .mp4. Leave the link empty and save to remove a video.</p>
      <ScrollRegion label="Content table">
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Exercise</th>
              <th className={TH}>Video link</th>
              <th className={TH}>Note (shown under the video)</th>
              <th className={TH}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ex} className={TR}>
                <td className={`${TD} whitespace-nowrap font-medium`}>
                  {r.ex}
                  {r.embed ? <Badge tone="ok">{r.embed.kind === "youtube" ? "YouTube" : r.embed.kind === "video" ? "file" : "link"}</Badge> : null}
                  {r.updatedAt ? <div className="text-[11px] font-normal text-muted">{r.updatedBy} · {fmtStamp(r.updatedAt)}</div> : null}
                </td>
                <td className={TD} colSpan={3}>
                  <form action={saveVideo} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="ex" value={r.ex} />
                    <Input name="videoUrl" defaultValue={r.videoUrl} placeholder="https://youtube.com/shorts/…" className="min-w-[260px] flex-[2]" />
                    <Input name="note" defaultValue={r.note} placeholder="e.g. Keep the bar over mid-foot" className="min-w-[200px] flex-1" maxLength={200} />
                    <Button variant="primary">Save</Button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </>
  );
}
