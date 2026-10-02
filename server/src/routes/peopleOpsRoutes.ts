import { Router } from "express"; import * as controller from "../controllers/peopleOpsController.js"; import { authenticate, requirePermission } from "../middleware/auth.js"; import { validate } from "../middleware/validate.js"; import { asyncHandler } from "../utils/asyncHandler.js"; import { roleAssignmentSchema, createRoleSchema, administratorSchema, createLeavePolicySchema, leavePolicyIdSchema, leaveReviewSchema, leaveSchema, recognitionSchema, rolePermissionsSchema, roleSectionAccessSchema, updateLeavePolicySchema } from "../validators/peopleOpsValidators.js";
export const peopleOpsRouter = Router(); peopleOpsRouter.use(authenticate);
peopleOpsRouter.get("/leaves", asyncHandler(controller.leaves));
peopleOpsRouter.get("/leaves/balances", asyncHandler(controller.leaveBalances));
peopleOpsRouter.get("/leaves/team-calendar", asyncHandler(controller.teamCalendar));
peopleOpsRouter.get("/leave-policies", asyncHandler(controller.leavePolicies));
peopleOpsRouter.post("/leave-policies", requirePermission("settings.manage"), validate(createLeavePolicySchema), asyncHandler(controller.createLeavePolicy));
peopleOpsRouter.patch("/leave-policies/:id", requirePermission("settings.manage"), validate(updateLeavePolicySchema), asyncHandler(controller.updateLeavePolicy));
peopleOpsRouter.delete("/leave-policies/:id", requirePermission("settings.manage"), validate(leavePolicyIdSchema), asyncHandler(controller.deleteLeavePolicy));
peopleOpsRouter.post("/leaves", validate(leaveSchema), asyncHandler(controller.requestLeave));
peopleOpsRouter.patch("/leaves/:id/review", requirePermission("performance.review"), validate(leaveReviewSchema), asyncHandler(controller.reviewLeave));
peopleOpsRouter.get("/recognition", asyncHandler(controller.recognition)); peopleOpsRouter.post("/recognition", requirePermission("performance.review"), validate(recognitionSchema), asyncHandler(controller.award));
peopleOpsRouter.get("/roles", requirePermission("settings.manage"), asyncHandler(controller.roles)); peopleOpsRouter.put("/roles/:id/permissions", requirePermission("settings.manage"), validate(rolePermissionsSchema), asyncHandler(controller.permissions));
peopleOpsRouter.put("/roles/:id/section-access", requirePermission("settings.manage"), validate(roleSectionAccessSchema), asyncHandler(controller.sectionAccess));
peopleOpsRouter.get("/administrators", requirePermission("settings.manage"), asyncHandler(controller.administrators));
peopleOpsRouter.post("/administrators", requirePermission("settings.manage"), validate(administratorSchema), asyncHandler(controller.createAdministrator));

peopleOpsRouter.post("/roles", requirePermission("settings.manage"), validate(createRoleSchema), asyncHandler(controller.createRole));

peopleOpsRouter.put("/roles/:id/assignment", requirePermission("settings.manage"), validate(roleAssignmentSchema), asyncHandler(controller.assignRole));
