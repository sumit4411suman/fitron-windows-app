import { GYM_MANAGEMENT } from "@/lib/domain/gym-pages";
import { GymPageView, gymPageMetadata } from "../gym-page";

export const metadata = gymPageMetadata(GYM_MANAGEMENT);

export default function Page() {
  return <GymPageView page={GYM_MANAGEMENT} />;
}
