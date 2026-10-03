import type { SalesRecord } from "../salesApi";

export const LeadOrigin = ({ record }: { record: SalesRecord }) => {
  const employee = record.createdByEmployee;
  if (employee && typeof employee === "object") return <span>{[employee.firstName, employee.lastName].filter(Boolean).join(" ")}{employee.employeeId && <span className="ml-1 text-xs text-slate-500">({employee.employeeId})</span>}</span>;
  if (record.createdBy && typeof record.createdBy === "object") return <span>{record.createdBy.name}</span>;
  return <span className="text-slate-500">Not recorded</span>;
};
