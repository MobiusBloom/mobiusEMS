import { Schema } from "mongoose";
import { postgresModel } from "../persistence/postgresModel.js";
import { PERMISSIONS, type PermissionName } from "@mobius-ems/shared";

export interface PermissionDocument { key: PermissionName; description: string }
const permissionSchema = new Schema<PermissionDocument>({
  key: { type: String, enum: PERMISSIONS, unique: true, required: true, index: true },
  description: { type: String, required: true, maxlength: 300 }
}, { timestamps: true });
export const Permission = postgresModel<PermissionDocument>("Permission", permissionSchema);

