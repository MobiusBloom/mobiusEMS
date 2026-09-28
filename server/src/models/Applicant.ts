import { Schema, type Types } from "mongoose";
import { tenantModel } from "../tenancy/tenantModel.js";
import { APPLICANT_STAGES, type ApplicantStage } from "@mobius-ems/shared";

export interface StageNote {
  stage: ApplicantStage;
  note: string;
  updatedAt: Date;
}

export interface ApplicantRecord {
  name: string;
  email?: string;
  phone?: string;
  designation: string;
  jobCategory?: string;
  city?: string;
  state?: string;
  matchScore?: number;
  stage: ApplicantStage;
  stageNotes: StageNote[];
  originalName: string;
  storageProvider: "CLOUDINARY" | "POSTGRESQL";
  storageKey: string;
  format?: string;
  mimeType: string;
  size: number;
  uploadedBy: Types.ObjectId;
  isActive: boolean;
  convertedEmployeeId?: Types.ObjectId;
  convertedAt?: Date;
}

const stageNoteSchema = new Schema<StageNote>({
  stage: { type: String, enum: APPLICANT_STAGES, required: true },
  note: { type: String, required: true, maxlength: 1000 },
  updatedAt: { type: Date, default: Date.now }
}, { _id: false });

const applicantSchema = new Schema<ApplicantRecord>({
  name: { type: String, required: true, trim: true, maxlength: 120, index: true },
  email: { type: String, trim: true, lowercase: true, maxlength: 254 },
  phone: { type: String, trim: true, maxlength: 30 },
  designation: { type: String, required: true, trim: true, maxlength: 120, index: true },
  jobCategory: { type: String, trim: true, maxlength: 160, index: true },
  city: { type: String, trim: true, maxlength: 120, index: true },
  state: { type: String, trim: true, maxlength: 120, index: true },
  matchScore: { type: Number, min: 0, max: 100 },
  stage: { type: String, enum: APPLICANT_STAGES, default: "SOURCED", index: true },
  stageNotes: { type: [stageNoteSchema], default: [] },
  originalName: { type: String, required: true, maxlength: 255 },
  storageProvider: { type: String, enum: ["CLOUDINARY", "POSTGRESQL"], required: true },
  storageKey: { type: String, required: true, unique: true },
  format: String,
  mimeType: { type: String, required: true, maxlength: 120 },
  size: { type: Number, required: true, min: 1 },
  uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  isActive: { type: Boolean, default: true, index: true },
  convertedEmployeeId: { type: Schema.Types.ObjectId, ref: "Employee" },
  convertedAt: Date
}, { timestamps: true });

applicantSchema.index({ createdAt: -1, jobCategory: 1, stage: 1 });
export const Applicant = tenantModel<ApplicantRecord>("Applicant", applicantSchema);

