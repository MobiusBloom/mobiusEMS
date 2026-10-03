import { Router, type Request, type Response } from "express";
import { authenticate, requirePermission, requireAnyPermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { Employee } from "../models/Employee.js";
import { EodUpdate } from "../models/EodUpdate.js";
import { EodTemplate } from "../models/EodTemplate.js";
import { Department } from "../models/Department.js";
import { Designation } from "../models/Designation.js";
import { Task } from "../models/Task.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { writeAudit } from "../services/auditService.js";
import { eodListSchema, eodReviewSchema, eodSaveSchema, eodAnalyticsSchema, eodAnalyticsQuery, eodDetailSchema, eodTemplateCreateSchema, eodTemplateUpdateSchema } from "../validators/eodValidators.js";
import { resolveEodScope } from "../services/eodScopeService.js";
import { asDto, resolveEodTemplate, refreshBuiltinDraftTemplate, validateEodResponses } from "../services/eodTemplateService.js";
import { ownEodSummary } from "../services/eodWorkService.js";
import { employeeContextQuery, getEodAnalytics } from "../services/eodAnalyticsService.js";
import type { EodContext, EodTemplateDefinition } from "@mobius-ems/shared";

export const listEod = async (request: Request, response: Response): Promise<void> => {
  const date = String(request.query.date);
  const scope = await resolveEodScope(request.user!, "view");
  if (scope.level !== "self") {
    const [employees, updates] = await Promise.all([
      employeeContextQuery({ ...scope.employeeFilter, isActive: true, dateOfJoining: { $lte: new Date(`${date}T23:59:59+05:30`) } }),
      EodUpdate.find({ ...scope.reportFilter, date, status: "SUBMITTED" }).lean()
    ]);
    const authorIds = [...new Set(updates.map(update => String(update.employee)).filter(id => !employees.some(employee => employee._id === id)))];
    if (authorIds.length) employees.push(...await employeeContextQuery({ _id: { $in: authorIds } }));
    response.json({ success: true, data: { employees, updates, scope: scope.level } });
  } else {
    const updates = await EodUpdate.find({ employee: scope.ownId, date }).lean();
    response.json({ success: true, data: { employees: [], updates, scope: "self" } });
  }
};
export const myEod = async (request: Request, response: Response): Promise<void> => {
  const employee = asDto<EodContext | undefined>((await employeeContextQuery({ user: request.user!.id, isActive: true }))[0]);
  if (!employee) throw new AppError("An active employee profile is required to write EOD updates", 403);
  const date = String(request.query.date);
  const update = await EodUpdate.findOne({ employee: employee._id, date }).lean();
  const [template, liveSummary] = await Promise.all([update?.templateSnapshot ? refreshBuiltinDraftTemplate(employee, update.templateSnapshot, update.status === "SUBMITTED") : resolveEodTemplate(employee), ownEodSummary(employee, date)]);
  response.json({ success: true, data: { employee, update, template, summary: update?.status === "SUBMITTED" && update.systemSummary ? update.systemSummary : liveSummary, liveSummary } });
};
export const saveEod = async (request: Request, response: Response): Promise<void> => {
  const employee = await Employee.findOne({ user: request.user!.id, isActive: true });
  if (!employee) throw new AppError("An active employee profile is required to write EOD updates", 403);
  const input = request.body;
  const existing = await EodUpdate.findOne({ employee: employee._id, date: input.date });
  if (existing?.status === "SUBMITTED" && input.status === "DRAFT") throw new AppError("A submitted EOD cannot be changed back to a draft", 409);
  const context = asDto<EodContext>((await employeeContextQuery({ _id: employee._id }))[0]);
  const template = existing?.templateSnapshot ? refreshBuiltinDraftTemplate(context, existing.templateSnapshot, existing.status === "SUBMITTED") : await resolveEodTemplate(context);
  validateEodResponses(template, input.responses ?? {}, input.status === "SUBMITTED");
  const taskIds = (input.priorities ?? []).map((p: { task?: string }) => p.task).filter(Boolean);
  if (taskIds.length) {
    const tasks = await Task.find({ _id: { $in: taskIds }, assignedEmployee: employee._id }).distinct("_id");
    if (new Set(taskIds).size !== tasks.length) throw new AppError("Priority tasks must belong to your work", 422);
  }
  const snapshot = (entity?: { _id: string; name: string }) => entity ? { id: entity._id, name: entity.name } : undefined;
  const frozen = existing?.status === "SUBMITTED";
  const organization = frozen ? {} : {
    departmentSnapshot: snapshot(context.department), designationSnapshot: snapshot(context.designation), teamSnapshot: snapshot(context.team),
    reportingManagerSnapshot: context.reportingManager ? { id: context.reportingManager._id, name: `${context.reportingManager.firstName} ${context.reportingManager.lastName}` } : undefined,
    template: template._id, templateVersion: template.version, templateSnapshot: template
  };
  const summary = input.status === "SUBMITTED" ? await ownEodSummary(context, input.date, input.priorities) : undefined;
  const update = await EodUpdate.findOneAndUpdate({ employee: employee._id, date: input.date, ...(input.status === "DRAFT" ? { status: "DRAFT" } : {}) }, {
    $set: { ...input, employee: employee._id, ...organization, ...(input.status === "SUBMITTED" ? { submittedAt: new Date(), systemSummary: summary } : {}) },
    $unset: { acknowledgedAt: 1, acknowledgedBy: 1, managerComment: 1, review: 1 }
  }, { new: true, upsert: true, runValidators: true });
  await writeAudit({ user: request.user!.id, action: "EOD_SAVED", entityType: "EodUpdate", entityId: update!.id, newValue: { date: input.date, status: input.status } });
  response.json({ success: true, data: { update } });
};
export const reviewEod = async (request: Request, response: Response): Promise<void> => {
  const scope = await resolveEodScope(request.user!, "review");
  const target = await EodUpdate.findOne({ ...scope.reportFilter, _id: String(request.params.id), status: "SUBMITTED" });
  if (!target) throw new AppError("Submitted EOD update not found", 404);
  const own = await Employee.findOne({ user: request.user!.id });
  if (own && String(target.employee) === String(own._id)) throw new AppError("You cannot review your own EOD", 403);
  const reviewedAt = new Date();
  const state = request.body.state ?? "ACKNOWLEDGED";
  const revision = request.body.revision ? new Date(request.body.revision) : target.submittedAt;
  const update = await EodUpdate.findOneAndUpdate({ ...scope.reportFilter, _id: target._id, status: "SUBMITTED", ...(revision ? { submittedAt: revision } : {}) }, { $set: { acknowledgedBy: request.user!.id, acknowledgedAt: reviewedAt, managerComment: request.body.managerComment, review: { state, comment: request.body.managerComment, reviewedBy: request.user!.id, reviewedAt } } }, { new: true, runValidators: true });
  if (!update) throw new AppError("This report changed. Refresh before reviewing", 409);
  await writeAudit({ user: request.user!.id, action: "EOD_REVIEWED", entityType: "EodUpdate", entityId: update.id, newValue: { state } });
  response.json({ success: true, data: { update } });
};
export const detailEod = async (request: Request, response: Response): Promise<void> => {
  const scope = await resolveEodScope(request.user!, "view");
  const own = await Employee.findOne({ user: request.user!.id });
  const update = await EodUpdate.findOne({ _id: String(request.params.id), $or: [{ ...scope.reportFilter, status: "SUBMITTED" }, ...(own && request.user!.permissions.includes("eod.view.self") ? [{ employee: own._id }] : [])] }).lean();
  if (!update) throw new AppError("EOD update not found", 404);
  response.json({ success: true, data: { update } });
};
const validateTemplateReferences = async (input: EodTemplateDefinition) => {
  if (input.department && !await Department.exists({ _id: input.department, isActive: true })) throw new AppError("Department not found", 422);
  if (input.designation && !await Designation.exists({ _id: input.designation, isActive: true })) throw new AppError("Designation not found", 422);
};
export const eodRouter = Router();
eodRouter.use(authenticate, requirePermission("section.eod"));
eodRouter.get("/", requireAnyPermission("eod.view.self", "eod.view.team", "eod.view.department", "eod.view.all"), validate(eodListSchema), asyncHandler(listEod));
eodRouter.get("/team", requireAnyPermission("eod.view.team", "eod.view.department", "eod.view.all"), validate(eodListSchema), asyncHandler(listEod));
eodRouter.get("/me", requirePermission("eod.view.self"), validate(eodListSchema), asyncHandler(myEod));
eodRouter.put("/", requirePermission("eod.submit"), validate(eodSaveSchema), asyncHandler(saveEod));
eodRouter.get("/analytics", requireAnyPermission("eod.analytics.self", "eod.analytics.team", "eod.analytics.department", "eod.analytics.all"), validate(eodAnalyticsSchema), asyncHandler(async (req, res) => { res.json({ success: true, data: await getEodAnalytics(req.user!, eodAnalyticsQuery.parse(req.query)) }); }));
eodRouter.get("/templates", requirePermission("eod.template.manage"), asyncHandler(async (_req, res) => { res.json({ success: true, data: { templates: await EodTemplate.find({}).sort({ updatedAt: -1 }).lean(), departments: await Department.find({ isActive: true }).select("name").lean(), designations: await Designation.find({ isActive: true }).select("name").lean() } }); }));
eodRouter.post("/templates", requirePermission("eod.template.manage"), validate(eodTemplateCreateSchema), asyncHandler(async (req, res) => {
  await validateTemplateReferences(req.body);
  const template = await EodTemplate.create({ ...req.body, version: 1, createdBy: req.user!.id, updatedBy: req.user!.id });
  await writeAudit({ user: req.user!.id, action: "EOD_TEMPLATE_CREATED", entityType: "EodTemplate", entityId: template.id });
  res.status(201).json({ success: true, data: { template } });
}));
eodRouter.patch("/templates/:id", requirePermission("eod.template.manage"), validate(eodTemplateUpdateSchema), asyncHandler(async (req, res) => {
  await validateTemplateReferences(req.body);
  const template = await EodTemplate.findOneAndUpdate({ _id: String(req.params.id) }, { $set: { ...req.body, updatedBy: req.user!.id }, $inc: { version: 1 } }, { new: true, runValidators: true });
  if (!template) throw new AppError("Template not found", 404);
  await writeAudit({ user: req.user!.id, action: "EOD_TEMPLATE_UPDATED", entityType: "EodTemplate", entityId: template.id, newValue: { version: template.version } });
  res.json({ success: true, data: { template } });
}));
eodRouter.get("/:id", validate(eodDetailSchema), asyncHandler(detailEod));
eodRouter.patch("/:id/review", requireAnyPermission("eod.review.team", "eod.review.department", "eod.review.all"), validate(eodReviewSchema), asyncHandler(reviewEod));
