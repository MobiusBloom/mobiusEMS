import { Schema, type Types } from "mongoose";
import { tenantModel } from "../tenancy/tenantModel.js";
import { PRIORITIES } from "./Project.js";

export const EXTRACTED_TASK_STATUSES = ["READY", "NEEDS_REVIEW", "CREATED", "SKIPPED"] as const;

export interface ExtractedTaskDocument {
  taskImport: Types.ObjectId;
  snippet: string;
  employee?: Types.ObjectId;
  assigneeText?: string;
  confidence: number;
  action: string;
  dueDate?: Date;
  priority: typeof PRIORITIES[number];
  dependency?: string;
  status: typeof EXTRACTED_TASK_STATUSES[number];
  task?: Types.ObjectId;
}

const schema = new Schema<ExtractedTaskDocument>({
  taskImport: { type: Schema.Types.ObjectId, ref: "TaskImport", required: true, index: true },
  snippet: { type: String, required: true, maxlength: 3000 },
  employee: { type: Schema.Types.ObjectId, ref: "Employee", index: true },
  assigneeText: { type: String, trim: true, maxlength: 160 },
  confidence: { type: Number, min: 0, max: 1, required: true },
  action: { type: String, required: true, trim: true, maxlength: 200 },
  dueDate: Date,
  priority: { type: String, enum: PRIORITIES, default: "MEDIUM" },
  dependency: { type: String, trim: true, maxlength: 500 },
  status: { type: String, enum: EXTRACTED_TASK_STATUSES, required: true, index: true },
  task: { type: Schema.Types.ObjectId, ref: "Task", index: true }
}, { timestamps: true, versionKey: false });

schema.index({ taskImport: 1, status: 1 });
export const ExtractedTask = tenantModel<ExtractedTaskDocument>("ExtractedTask", schema);
