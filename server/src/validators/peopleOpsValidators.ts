import { z } from "zod"; import { BADGES } from "../models/Recognition.js"; import { PERMISSIONS, SECTION_PERMISSIONS, ROLES } from "@mobius-ems/shared"; const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid identifier");
export const leaveSchema = z.object({ body: z.object({ type: z.string().trim().min(2).max(100), startDate: z.coerce.date(), endDate: z.coerce.date(), reason: z.string().trim().min(3).max(2000) }).refine((value) => value.endDate >= value.startDate, { path: ["endDate"], message: "End date must be on or after start date" }) });
export const leaveReviewSchema = z.object({ params: z.object({ id: objectId }), body: z.object({ status: z.enum(["APPROVED","REJECTED"]), reviewComment: z.string().trim().max(1000).optional() }) });
export const createLeavePolicySchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(100),
    code: z.string().trim().min(2).max(100).optional(),
    quotaDays: z.number().int().min(0).max(999),
    isPaid: z.boolean().default(true),
    description: z.string().trim().max(500).optional()
  })
});
export const updateLeavePolicySchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    name: z.string().trim().min(2).max(100).optional(),
    quotaDays: z.number().int().min(0).max(999).optional(),
    isPaid: z.boolean().optional(),
    description: z.string().trim().max(500).optional()
  }).refine((b) => Object.keys(b).length > 0, "At least one field is required")
});
export const leavePolicyIdSchema = z.object({ params: z.object({ id: objectId }) });
export const recognitionSchema = z.object({ body: z.object({ employee: objectId, badge: z.enum(BADGES), explanation: z.string().trim().min(5).max(1000), evidence: z.array(z.string().trim().max(500)).max(20).default([]) }) });
export const rolePermissionsSchema = z.object({ params: z.object({ id: objectId }), body: z.object({ permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length) }) });
export const roleSectionAccessSchema = z.object({ params: z.object({ id: objectId }), body: z.object({ sections: z.array(z.enum(SECTION_PERMISSIONS)).max(SECTION_PERMISSIONS.length) }) });
export const administratorSchema = z.object({ body: z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  role: z.string().trim().min(2).max(80),
}) });


export const createRoleSchema = z.object({ body: z.object({ name: z.string().trim().min(2).max(80).regex(/^[a-zA-Z][a-zA-Z0-9 _-]*$/, "Use letters, numbers, spaces, underscores or hyphens").transform(value => value.toUpperCase().replace(/ +/g, "_")).refine(value => !ROLES.includes(value as typeof ROLES[number]), "Built-in role names are reserved"), description: z.string().trim().max(300).default("Custom role"), baseRole: z.enum(ROLES).refine(value => value !== "SUPER_ADMIN", "Custom roles cannot inherit Super Admin"), permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length) }) });

export const roleAssignmentSchema = z.object({ params: z.object({ id: objectId }), body: z.object({ email: z.string().trim().email().transform(value => value.toLowerCase()) }) });
