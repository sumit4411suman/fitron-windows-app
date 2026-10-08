import "server-only";
import { getSetting } from "./settings";
import { withAiDefaults, type AiSettings } from "@/lib/domain/integrations";

export type { AiSettings };
export { DEFAULT_AI } from "@/lib/domain/integrations";

/** Settings › Integrations & AI › Fitron AI: the org-wide switches (defaults on/on/off). */
export const getAiSettings = async (orgId: string): Promise<AiSettings> => withAiDefaults(await getSetting<Partial<AiSettings>>(orgId, "ai"));

/** Whether the assistant is switched on for the gym, on top of the role and plan checks. */
export const aiOn = async (orgId: string) => (await getAiSettings(orgId)).enabled;

export const AI_OFF_MESSAGE = "Fitron AI is switched off in Settings › Integrations & AI.";
