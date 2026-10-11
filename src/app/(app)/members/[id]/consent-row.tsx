import { Tag } from "@/components/tag";
import { fmtStamp } from "@/lib/format";
import { recordConsentAction } from "../actions";

/** "Privacy consent" on the member page: the date it was given, or a tag and a one-click "Record consent" for members who have none. */
export function ConsentRow({ memberId, consentAt, canRecord }: { memberId: string; consentAt: Date | null; canRecord: boolean }) {
  if (consentAt) return <>Given on {fmtStamp(consentAt)}</>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Tag label="No consent recorded" style={3} />
      {canRecord && (
        <form action={recordConsentAction.bind(null, memberId)}>
          <button className="text-sm text-accent underline">Record consent</button>
        </form>
      )}
    </span>
  );
}
