import { z } from "zod";
import { EOD_FIELD_TYPES, EOD_DATA_SOURCES } from "@mobius-ems/shared";

export const eodToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Choose a valid calendar date");
const date = calendarDate.refine(value => value <= eodToday(), "Future EOD updates are not allowed");
export const eodId = z.string().regex(/^[a-f\d]{24}$/i);
const text = z.string().trim().max(4000).default("");
const priority = z.object({ task: eodId.optional(), priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]), expectedOutcome: z.string().trim().min(1).max(500), expectedCompletion: calendarDate.optional(), note: z.string().trim().max(1000).optional() });
export const eodInput = z.object({
  date, accomplishments: text, inProgress: text, nextPlan: text, blockers: text,
  importantNote: text, remarks: text,
  responses: z.record(z.string().regex(/^[a-z][a-zA-Z0-9_]{0,63}$/), z.union([z.string().trim().max(4000), z.number().finite().min(-1e12).max(1e12), z.boolean(), z.array(z.string().max(120)).max(30)])).refine(value => Object.keys(value).length <= 100, "Too many responses").default({}),
  priorities: z.array(priority).max(3).default([]), reportedCompleted: z.number().int().min(0).max(10000).nullable().optional(),
  health: z.enum(["ON_TRACK", "AT_RISK", "BLOCKED"]),
  status: z.enum(["DRAFT", "SUBMITTED"])
}).superRefine((value, context) => {
  if (value.status !== "SUBMITTED") return;
  if (!value.accomplishments && !value.inProgress) context.addIssue({ code: "custom", path: ["accomplishments"], message: "Describe completed work or work in progress" });
  if (!value.nextPlan && !value.priorities.length) context.addIssue({ code: "custom", path: ["nextPlan"], message: "Add your next working day's priorities" });
  if (value.health !== "ON_TRACK" && !value.blockers) context.addIssue({ code: "custom", path: ["blockers"], message: "Describe the risk or blocker and support needed" });
});
export const eodSaveSchema = z.object({ body: eodInput });
export const eodListSchema = z.object({ query: z.object({ date }) });
export const eodReviewSchema = z.object({ params: z.object({ id: eodId }), body: z.object({ managerComment: z.string().trim().max(2000).default(""), state: z.enum(["ACKNOWLEDGED", "FEEDBACK", "NEEDS_CLARIFICATION", "SUPPORT_REQUIRED"]).default("ACKNOWLEDGED"), revision: z.string().datetime().optional() }) });
export const eodDetailSchema = z.object({ params: z.object({ id: eodId }) });
export const eodAnalyticsQuery = z.object({ start: date, end: date, department: eodId.optional(), team: eodId.optional(), manager: eodId.optional(), employee: eodId.optional(), project: eodId.optional(), health: z.enum(["ON_TRACK", "AT_RISK", "BLOCKED"]).optional(), status: z.enum(["SUBMITTED", "MISSING"]).optional(), blockerDays: z.coerce.number().min(1).max(90).default(2), lowCoverage: z.coerce.number().min(0).max(100).default(60) }).refine(value => value.start <= value.end, "Start must precede end").refine(value => (Date.parse(value.end) - Date.parse(value.start)) / 86400000 < 366, "Maximum range is 366 days");
export const eodAnalyticsSchema = z.object({ query: eodAnalyticsQuery });
const field = z.object({ key: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,63}$/).refine(value => !["constructor", "prototype", "__proto__"].includes(value)), label: z.string().trim().min(1).max(120), type: z.enum(EOD_FIELD_TYPES), required: z.boolean().default(false), options: z.array(z.string().trim().min(1).max(120)).max(30).optional(), source: z.enum(EOD_DATA_SOURCES).optional() }).superRefine((value, ctx) => {
  if (["SELECT", "MULTI_SELECT"].includes(value.type) && !value.options?.length) ctx.addIssue({ code: "custom", path: ["options"], message: "Select fields require options" });
  if (value.source && !["NUMBER", "CURRENCY"].includes(value.type)) ctx.addIssue({ code: "custom", path: ["source"], message: "System metrics require a numeric field" });
});
export const eodTemplateInput = z.object({ name: z.string().trim().min(1).max(120), department: eodId.optional(), designation: eodId.optional(), isDefault: z.boolean().default(false), isActive: z.boolean().default(true), adapter: z.enum(["GENERAL", "ENGINEERING", "SALES", "AI_ML", "HR", "MARKETING"]).default("GENERAL"), sections: z.array(z.object({ key: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,63}$/), title: z.string().trim().min(1).max(120), fields: z.array(field).max(20) })).max(10) }).superRefine((value, ctx) => {
  const keys = value.sections.flatMap(section => section.fields.map(item => item.key));
  if (keys.length > 100 || new Set(keys).size !== keys.length || new Set(value.sections.map(s => s.key)).size !== value.sections.length) ctx.addIssue({ code: "custom", path: ["sections"], message: "Use unique section/field keys and at most 100 fields" });
  if (value.designation && !value.department) ctx.addIssue({ code: "custom", path: ["department"], message: "Designation templates require a department" });
});
export const eodTemplateCreateSchema = z.object({ body: eodTemplateInput });
export const eodTemplateUpdateSchema = z.object({ params: z.object({ id: eodId }), body: eodTemplateInput });
