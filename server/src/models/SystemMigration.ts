import { Schema } from "mongoose";
import { postgresModel } from "../persistence/postgresModel.js";

export interface SystemMigrationDocument { key: string; appliedAt: Date; details?: Record<string, unknown> }
const schema = new Schema<SystemMigrationDocument>({
  key: { type: String, required: true, unique: true },
  appliedAt: { type: Date, required: true, default: Date.now },
  details: Schema.Types.Mixed,
}, { timestamps: true });
export const SystemMigration = postgresModel<SystemMigrationDocument>("SystemMigration", schema);

