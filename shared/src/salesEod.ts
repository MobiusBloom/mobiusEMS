import type { EodSection, EodResponseValue } from "./eod.js";

export const SALES_FOLLOWUP_STATUSES = ["New", "Contacted", "Demo Scheduled", "Demo Done", "Proposal Sent", "Negotiation", "Hot", "Won", "Lost", "On Hold"];
export interface SalesFollowup { name: string; status: string; nextAction: string; expectedValue: number; expectedDate: string }
const fields = (items: Array<[string, string, string?]>): EodSection["fields"] => items.map(([key, label, type = "NUMBER"]) => ({ key, label, type: type as EodSection["fields"][number]["type"] }));
export const SALES_EOD_SECTIONS: EodSection[] = [
  { key: "salesRevenue", title: "1. Sales & Revenue (Today)", fields: [...fields([["salesClosed", "Sales Closed Today (₹)", "CURRENCY"], ["revenueBooked", "Revenue Booked (₹)", "CURRENCY"], ["revenueCollected", "Revenue Collected (₹)", "CURRENCY"], ["dealsClosed", "No. of Deals Closed"], ["customerNames", "Customer Name(s)", "TEXT"]]), { key: "products", label: "Products Sold", type: "MULTI_SELECT", options: ["Whalexy", "Möbius EMS", "Other"] }] },
  { key: "pipeline", title: "2. Pipeline (Today)", fields: fields([["qualifiedLeads", "New Qualified Leads"], ["demosCompleted", "Demos/Meetings Completed"], ["proposalsSent", "Proposals/Quotations Sent"], ["hotLeads", "Hot Leads"], ["pipelineValue", "Pipeline Value (₹)", "CURRENCY"], ["expectedClosingDate", "Expected Closing Date", "DATE"]]) },
  { key: "salesActivity", title: "3. Sales Activity (Today)", fields: fields([["leadsContacted", "New Leads Contacted"], ["callsMade", "Calls Made"], ["whatsappMessages", "WhatsApp Messages"], ["emailsSent", "Emails Sent"], ["followupsCompleted", "Follow-ups Completed"], ["demosScheduled", "Demos Scheduled"]]) },
  { key: "followups", title: "4. Important Follow-ups", fields: fields([["importantFollowups", "Important follow-ups", "TEXTAREA"]]) },
  { key: "salesBlockers", title: "5. Challenges / Blockers", fields: fields([["objections", "Customer Objections", "TEXTAREA"], ["productDoubts", "Product / Service Doubts", "TEXTAREA"], ["pricingIssues", "Pricing Issues", "TEXTAREA"], ["supportRequired", "Support Required", "TEXTAREA"]]) },
  { key: "tomorrow", title: "6. Tomorrow's Plan", fields: fields([["tomorrowTarget", "Tomorrow's Sales Target (₹)", "CURRENCY"], ["tomorrowDemos", "Demos / Meetings"], ["tomorrowClosures", "Expected Closures (₹)", "CURRENCY"], ["priority1", "Priority lead 1", "TEXT"], ["priority2", "Priority lead 2", "TEXT"], ["priority3", "Priority lead 3", "TEXT"], ["mainObjective", "Main Objective for Tomorrow", "TEXTAREA"]]) },
  { key: "dailySummary", title: "7. Daily Summary", fields: fields([["keyResult", "Today's Key Result", "TEXTAREA"]]) }
];
export const isReferenceSalesReport = (sections: EodSection[]) => sections.some(s => s.key === "salesRevenue") && sections.flatMap(s => s.fields).length === SALES_EOD_SECTIONS.flatMap(s => s.fields).length && SALES_EOD_SECTIONS.flatMap(s => s.fields).every(expected => sections.flatMap(s => s.fields).some(field => field.key === expected.key && field.type === expected.type && !field.source));
export const salesNumber = (values: Record<string, EodResponseValue>, key: string) => typeof values[key] === "number" ? values[key] as number : 0;
export function readSalesFollowups(value?: EodResponseValue): SalesFollowup[] {
  if (typeof value !== "string" || !value) return [];
  try { const rows: unknown = JSON.parse(value); return Array.isArray(rows) ? rows.filter((r): r is SalesFollowup => !!r && typeof r === "object" && typeof r.name === "string" && typeof r.status === "string" && typeof r.nextAction === "string" && typeof r.expectedValue === "number" && typeof r.expectedDate === "string") : []; } catch { return []; }
}
