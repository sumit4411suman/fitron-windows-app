import * as z from "zod";
import "@/lib/zod-config";
import { PRIORITIES, TOPICS } from "@/lib/domain/support";

export const ticketInput = z.object({
  topic: z.enum(TOPICS, { error: "Pick a topic." }),
  priority: z.enum(PRIORITIES, { error: "Pick a priority." }),
  subject: z.string().trim().min(4, { error: "Add a short subject." }).max(120, { error: "Keep the subject under 120 characters." }),
  message: z.string().trim().min(10, { error: "Describe the problem in a sentence or two." }).max(4000, { error: "Keep the message under 4,000 characters." }),
});
export type TicketInput = z.infer<typeof ticketInput>;
