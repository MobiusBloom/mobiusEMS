import { Schema, type Types } from "mongoose";
import { tenantModel } from "../tenancy/tenantModel.js";

export const TASK_IMPORT_MODES = ["AUTO_CREATE", "CONFIRM_FIRST"] as const;
export const TASK_IMPORT_STATUSES = ["PROCESSING", "REVIEW", "COMPLETED", "PARTIAL", "FAILED"] as const;
export const TASK_IMPORT_SOURCES = ["PASTED_TEXT", "PDF", "DOCX", "TXT"] as const;

export interface TaskImportDocument {
  sourceType: typeof TASK_IMPORT_SOURCES[number];
  sourceName?: string;
  rawContent: string;
  creator: Types.ObjectId;
  project: Types.ObjectId;
  mode: typeof TASK_IMPORT_MODES[number];
  status: typeof TASK_IMPORT_STATUSES[number];
  provider?: string;
  aiModel?: string;
  errorMessage?: string;
}

const schema = new Schema<TaskImportDocument>({
  sourceType: { type: String, enum: TASK_IMPORT_SOURCES, required: true, index: true },
  sourceName: { type: String, trim: true, maxlength: 255 },
  rawContent: { type: String, required: true, maxlength: 100_000 },
  creator: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  project: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
  mode: { type: String, enum: TASK_IMPORT_MODES, required: true },
  status: { type: String, enum: TASK_IMPORT_STATUSES, default: "PROCESSING", index: true },
  provider: { type: String, maxlength: 40 },
  aiModel: { type: String, maxlength: 120 },
  errorMessage: { type: String, maxlength: 1000 }
}, { timestamps: true, versionKey: false });

schema.index({ creator: 1, createdAt: -1 });
export const TaskImport = tenantModel<TaskImportDocument>("TaskImport", schema);
