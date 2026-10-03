import { Schema, type Types } from "mongoose";
import { tenantModel } from "../tenancy/tenantModel.js";
import type { EodPriority, EodResponseValue, EodTemplateDefinition, EodWorkSummary } from "@mobius-ems/shared";

export interface EodUpdateDocument {
  employee: Types.ObjectId;
  date: string;
  accomplishments: string;
  inProgress: string;
  nextPlan: string;
  blockers: string;
  health: "ON_TRACK" | "AT_RISK" | "BLOCKED";
  status: "DRAFT" | "SUBMITTED";
  submittedAt?: Date;
  acknowledgedAt?: Date;
  acknowledgedBy?: Types.ObjectId;
  managerComment?: string;
  importantNote?: string;
  remarks?: string;
  departmentSnapshot?: { id: string; name: string };
  designationSnapshot?: { id: string; name: string };
  teamSnapshot?: { id: string; name: string };
  reportingManagerSnapshot?: { id: string; name: string };
  template?: Types.ObjectId;
  templateVersion?: number;
  templateSnapshot?: EodTemplateDefinition;
  systemSummary?: EodWorkSummary;
  responses?: Record<string, EodResponseValue>;
  priorities?: EodPriority[];
  reportedCompleted?: number;
  review?: { state: string; comment: string; reviewedBy: string; reviewedAt: Date };
}
const schema = new Schema<EodUpdateDocument>({
  employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
  date: { type: String, required: true },
  accomplishments: { type: String, trim: true, maxlength: 4000, default: "" },
  inProgress: { type: String, trim: true, maxlength: 4000, default: "" },
  nextPlan: { type: String, trim: true, maxlength: 4000, default: "" },
  blockers: { type: String, trim: true, maxlength: 4000, default: "" },
  health: { type: String, enum: ["ON_TRACK", "AT_RISK", "BLOCKED"], default: "ON_TRACK" },
  status: { type: String, enum: ["DRAFT", "SUBMITTED"], default: "DRAFT" },
  submittedAt: Date,
  acknowledgedAt: Date,
  acknowledgedBy: { type: Schema.Types.ObjectId, ref: "User" },
  managerComment: { type: String, trim: true, maxlength: 2000 },
  importantNote: { type: String, maxlength: 4000, default: "" },
  remarks: { type: String, maxlength: 4000, default: "" },
  departmentSnapshot: Schema.Types.Mixed,
  designationSnapshot: Schema.Types.Mixed,
  teamSnapshot: Schema.Types.Mixed,
  reportingManagerSnapshot: Schema.Types.Mixed,
  template: { type: Schema.Types.ObjectId, ref: "EodTemplate" },
  templateVersion: Number,
  templateSnapshot: Schema.Types.Mixed,
  systemSummary: Schema.Types.Mixed,
  responses: { type: Schema.Types.Mixed, default: {} },
  priorities: { type: Schema.Types.Mixed, default: [] },
  reportedCompleted: { type: Number, min: 0 },
  review: Schema.Types.Mixed
}, { timestamps: true });
schema.index({ employee: 1, date: 1 }, { unique: true });
schema.index({ status: 1, date: 1 });
schema.index({ "departmentSnapshot.id": 1, date: 1 });
export const EodUpdate = tenantModel<EodUpdateDocument>("EodUpdate", schema);
