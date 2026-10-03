import { SALES_EOD_SECTIONS, isReferenceSalesReport, SALES_FOLLOWUP_STATUSES, DEPARTMENT_EOD_SECTIONS, departmentEodAdapter } from "@mobius-ems/shared";
import type { EodContext, EodResponseValue, EodTemplateDefinition } from "@mobius-ems/shared";
import { EodTemplate } from "../models/EodTemplate.js";
import { AppError } from "../utils/AppError.js";
import { calendarDate } from "../validators/eodValidators.js";
export const asDto = <T>(value: unknown): T => value === undefined ? value as T : JSON.parse(JSON.stringify(value)) as T;
export const defaultEodTemplate = (employee: EodContext): EodTemplateDefinition => {
  const adapter = departmentEodAdapter(employee);
  return { name: `${employee.department?.name ?? "General"} daily report`, version: adapter === "SALES" ? 2 : 3, adapter, sections: DEPARTMENT_EOD_SECTIONS[adapter] };
};
// Refresh only the original, unsaved built-in draft schemas. Custom templates and
// submitted history retain their fields. Existing manual responses stay editable.
const legacyKeys: Partial<Record<EodTemplateDefinition["adapter"], string[]>> = {
  GENERAL: ["departmentContext"],
  ENGINEERING: ["technicalSummary", "deliveryEvidence", "validationNotes", "implementationDecision", "technicalLearning", "dependency"],
  AI_ML: ["experiment", "objective", "dataset", "model", "evaluationMetric", "previousResult", "currentResult", "observation", "outcome", "keyFinding", "nextExperiment"],
  HR: ["candidatesScreened", "interviewsConducted", "onboardingActivity", "requestsHandled", "pendingHrActions", "importantHrAction", "pendingFollowup"],
  MARKETING: ["campaigns", "contentCompleted", "contentPublished", "enquiriesGenerated", "approvalsPending", "campaignBlockers", "keyResult"]
};
export function refreshBuiltinDraftTemplate(employee: EodContext, snapshot: EodTemplateDefinition, submitted: boolean): EodTemplateDefinition {
  const fields = snapshot.sections.flatMap(section => section.fields);
  const keys = legacyKeys[snapshot.adapter];
  if (submitted || snapshot._id || snapshot.department || snapshot.designation || snapshot.version > 2 || snapshot.sections.length !== 1 || snapshot.sections[0]?.key !== "department" || !keys || keys.length !== fields.length || new Set(fields.map(field => field.key)).size !== keys.length || fields.some(field => field.source || !keys.includes(field.key))) return snapshot;
  const replacement = defaultEodTemplate(employee);
  if (snapshot.adapter !== "GENERAL" && replacement.adapter !== snapshot.adapter) return snapshot;
  if (fields.some(field => replacement.sections.some(section => section.fields.some(next => next.key === field.key && next.type !== field.type)))) return snapshot;
  const extra = fields.filter(field => !replacement.sections.some(section => section.fields.some(next => next.key === field.key)));
  return { ...replacement, sections: [...replacement.sections, ...(extra.length ? [{ key: "previousDraft", title: "Previous Draft Context", fields: extra }] : [])] };
}
export const selectEodTemplate = (templates: EodTemplateDefinition[], employee: EodContext) => {
  const candidates = templates.filter(t => t.isActive !== false && ((t.department === employee.department?._id && (!t.designation || t.designation === employee.designation?._id)) || (!t.department && t.isDefault)));
  const score = (t: EodTemplateDefinition) => (t.department ? 4 : 0) + (t.designation ? 2 : 0) + (t.isDefault ? 1 : 0);
  return candidates.sort((a, b) => score(b) - score(a) || b.version - a.version || (a._id ?? "").localeCompare(b._id ?? ""))[0] ?? defaultEodTemplate(employee);
};
export const resolveEodTemplate = async (employee: EodContext) => selectEodTemplate(asDto<EodTemplateDefinition[]>(await EodTemplate.find({ isActive: true, $or: [{ department: employee.department?._id }, { isDefault: true, department: { $exists: false } }] }).lean()), employee);
export const validateEodResponses = (template: EodTemplateDefinition, responses: Record<string, EodResponseValue>, submitted: boolean) => {
  if (template.adapter === "SALES" && isReferenceSalesReport(template.sections)) validateSalesReport(responses, submitted);
  const fields = new Map(template.sections.flatMap(section => section.fields).map(field => [field.key, field]));
  for (const key of Object.keys(responses)) if (!fields.has(key) || fields.get(key)?.source) throw new AppError(`Unknown or system-generated response: ${key}`, 422);
  for (const field of fields.values()) {
    if (field.source) continue;
    const value = responses[field.key];
    const empty = value === undefined || value === "" || (Array.isArray(value) && !value.length);
    if (empty) { if (submitted && field.required) throw new AppError(`${field.label} is required`, 422); continue; }
    let valid = true;
    switch (field.type) {
      case "NUMBER": case "CURRENCY": valid = typeof value === "number" && Number.isFinite(value); break;
      case "RATING": valid = typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5; break;
      case "CHECKBOX": valid = typeof value === "boolean"; break;
      case "SELECT": valid = typeof value === "string" && !!field.options?.includes(value); break;
      case "MULTI_SELECT": valid = Array.isArray(value) && value.every(item => field.options?.includes(item)); break;
      case "DATE": valid = calendarDate.safeParse(value).success; break;
      default: valid = typeof value === "string";
    }
    if (!valid) throw new AppError(`Invalid response for ${field.label}`, 422);
  }
};

export function validateSalesReport(responses: Record<string, EodResponseValue>, submitted: boolean) {
  for (const field of SALES_EOD_SECTIONS.flatMap(s => s.fields)) {
    const value = responses[field.key];
    if ((field.type === "NUMBER" || field.type === "CURRENCY") && value !== undefined && value !== "" && (typeof value !== "number" || value < 0 || (field.type === "NUMBER" && !Number.isInteger(value)))) throw new AppError(`${field.label} must be a non-negative ${field.type === "NUMBER" ? "whole number" : "amount"}`, 422);
  }
  if (responses.importantFollowups) {
    let rows: unknown;
    try { rows = JSON.parse(String(responses.importantFollowups)); } catch { throw new AppError("Invalid follow-up rows", 422); }
    if (!Array.isArray(rows) || rows.length > 12 || rows.some(r => !r || typeof r.name !== "string" || !r.name.trim() || r.name.length > 120 || typeof r.nextAction !== "string" || r.nextAction.length > 200 || !SALES_FOLLOWUP_STATUSES.includes(r.status) && r.status !== "" || typeof r.expectedValue !== "number" || !Number.isFinite(r.expectedValue) || r.expectedValue < 0 || r.expectedValue > 1e12 || typeof r.expectedDate !== "string" || r.expectedDate !== "" && !calendarDate.safeParse(r.expectedDate).success)) throw new AppError("Invalid follow-up rows", 422);
  }
  if (submitted && Number(responses.dealsClosed) > 0) {
    if (typeof responses.customerNames !== "string" || !responses.customerNames.trim()) throw new AppError("Deals closed > 0 — add customer name(s)", 422);
    if (!(Number(responses.revenueBooked) > 0 || Number(responses.salesClosed) > 0)) throw new AppError("Deals closed but revenue is zero — check the figures", 422);
  }
}
