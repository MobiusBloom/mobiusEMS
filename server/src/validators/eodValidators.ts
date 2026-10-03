import { z } from "zod";

export const eodToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Choose a valid calendar date").refine(value => value <= eodToday(), "Future EOD updates are not allowed");
const text = z.string().trim().max(4000).default("");
export const eodInput = z.object({
  date, accomplishments: text, inProgress: text, nextPlan: text, blockers: text,
  health: z.enum(["ON_TRACK", "AT_RISK", "BLOCKED"]),
  status: z.enum(["DRAFT", "SUBMITTED"])
}).superRefine((value, context) => {
  if (value.status !== "SUBMITTED") return;
  if (!value.accomplishments && !value.inProgress) context.addIssue({ code: "custom", path: ["accomplishments"], message: "Describe completed work or work in progress" });
  if (!value.nextPlan) context.addIssue({ code: "custom", path: ["nextPlan"], message: "Add your next working day's priorities" });
  if (value.health !== "ON_TRACK" && !value.blockers) context.addIssue({ code: "custom", path: ["blockers"], message: "Describe the risk or blocker and support needed" });
});
export const eodSaveSchema = z.object({ body: eodInput });
export const eodListSchema = z.object({ query: z.object({ date }) });
export const eodReviewSchema = z.object({ params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }), body: z.object({ managerComment: z.string().trim().max(2000).default("") }) });
