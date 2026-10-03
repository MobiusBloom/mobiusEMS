import { Schema, type Types } from "mongoose";
import { tenantModel } from "../tenancy/tenantModel.js";

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
  managerComment: { type: String, trim: true, maxlength: 2000 }
}, { timestamps: true });
schema.index({ employee: 1, date: 1 }, { unique: true });
export const EodUpdate = tenantModel<EodUpdateDocument>("EodUpdate", schema);
