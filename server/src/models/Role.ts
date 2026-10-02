import { Schema } from "mongoose";
import { tenantModel } from "../tenancy/tenantModel.js";
import { PERMISSIONS, ROLES, type PermissionName, type RoleName } from "@mobius-ems/shared";

export interface RoleDocument { name: string; baseRole?: RoleName; description: string; permissions: PermissionName[]; isSystem: boolean }
const roleSchema = new Schema<RoleDocument>({
  name: { type: String, trim: true, maxlength: 80, required: true, unique: true, index: true },
  baseRole: { type: String, enum: ROLES },
  description: { type: String, required: true, maxlength: 300 },
  permissions: [{ type: String, enum: PERMISSIONS, required: true }],
  isSystem: { type: Boolean, default: true }
}, { timestamps: true });
export const Role = tenantModel<RoleDocument>("Role", roleSchema);

