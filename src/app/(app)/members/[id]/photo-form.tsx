"use client";

import { changeMemberPhoto } from "../actions";
import { PhotoUpload } from "@/components/photo-upload";

export function MemberPhotoForm({ memberId, hasPhoto }: { memberId: string; hasPhoto: boolean }) {
  return <PhotoUpload hasPhoto={hasPhoto} action={changeMemberPhoto.bind(null, memberId)} />;
}
