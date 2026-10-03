import { Schema, type Types } from "mongoose";
import type { EodSection, EodTemplateDefinition } from "@mobius-ems/shared";
import { tenantModel } from "../tenancy/tenantModel.js";
export interface EodTemplateDocument {
  name: string; department?: Types.ObjectId; designation?: Types.ObjectId; isDefault: boolean; isActive: boolean;
  version: number; sections: EodSection[]; adapter: EodTemplateDefinition["adapter"]; createdBy: Types.ObjectId; updatedBy: Types.ObjectId;
}
const schema = new Schema<EodTemplateDocument>({
  name: { type: String, required: true, maxlength: 120 },
  department: { type: Schema.Types.ObjectId, ref: "Department" }, designation: { type: Schema.Types.ObjectId, ref: "Designation" },
  isDefault: { type: Boolean, default: false }, isActive: { type: Boolean, default: true }, version: { type: Number, default: 1, min: 1 },
  sections: { type: Schema.Types.Mixed, required: true }, adapter: { type: String, enum: ["GENERAL", "ENGINEERING", "SALES", "AI_ML", "HR", "MARKETING"], default: "GENERAL" },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }, updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });
schema.index({ department: 1, designation: 1, isActive: 1, version: -1 });
export const EodTemplate = tenantModel<EodTemplateDocument>("EodTemplate", schema);
