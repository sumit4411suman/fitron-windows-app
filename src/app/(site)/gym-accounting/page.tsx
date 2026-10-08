import { GYM_ACCOUNTING } from "@/lib/domain/gym-pages";
import { GymPageView, gymPageMetadata } from "../gym-page";

export const metadata = gymPageMetadata(GYM_ACCOUNTING);

export default function Page() {
  return <GymPageView page={GYM_ACCOUNTING} />;
}
