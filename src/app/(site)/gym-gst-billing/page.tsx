import { GYM_GST } from "@/lib/domain/gym-pages";
import { GymPageView, gymPageMetadata } from "../gym-page";

export const metadata = gymPageMetadata(GYM_GST);

export default function Page() {
  return <GymPageView page={GYM_GST} />;
}
