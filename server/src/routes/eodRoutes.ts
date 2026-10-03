import { Router, type Request, type Response } from "express";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { Employee } from "../models/Employee.js";
import { EodUpdate } from "../models/EodUpdate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { writeAudit } from "../services/auditService.js";
import { eodListSchema, eodReviewSchema, eodSaveSchema } from "../validators/eodValidators.js";

export const listEod = async (request: Request, response: Response): Promise<void> => {
  const date = String(request.query.date);
  if (request.user!.role === "SUPER_ADMIN") {
    const [employees, updates] = await Promise.all([
      Employee.find({ isActive: true, dateOfJoining: { $lte: new Date(`${date}T23:59:59+05:30`) } }).select("firstName lastName employeeId department status").populate("department", "name").sort({ firstName: 1 }).lean(),
      EodUpdate.find({ date, status: "SUBMITTED" }).lean()
    ]);
    response.json({ success: true, data: { employees, updates } });
  } else {
    const employee = await Employee.findOne({ user: request.user!.id, isActive: true });
    if (!employee) throw new AppError("An active employee profile is required to write EOD updates", 403);
    const updates = await EodUpdate.find({ employee: employee._id, date }).lean();
    response.json({ success: true, data: { employees: [], updates } });
  }
};
export const saveEod = async (request: Request, response: Response): Promise<void> => {
  const employee = await Employee.findOne({ user: request.user!.id, isActive: true });
  if (!employee) throw new AppError("An active employee profile is required to write EOD updates", 403);
  const input = request.body;
  const existing = await EodUpdate.findOne({ employee: employee._id, date: input.date });
  if (existing?.status === "SUBMITTED" && input.status === "DRAFT") throw new AppError("A submitted EOD cannot be changed back to a draft", 409);
  const update = await EodUpdate.findOneAndUpdate({ employee: employee._id, date: input.date, ...(input.status === "DRAFT" ? { status: "DRAFT" } : {}) }, {
    $set: { ...input, employee: employee._id, ...(input.status === "SUBMITTED" ? { submittedAt: new Date() } : {}) },
    $unset: { acknowledgedAt: 1, acknowledgedBy: 1, managerComment: 1 }
  }, { new: true, upsert: true, runValidators: true });
  await writeAudit({ user: request.user!.id, action: "EOD_SAVED", entityType: "EodUpdate", entityId: update!.id, newValue: { date: input.date, status: input.status } });
  response.json({ success: true, data: { update } });
};
export const reviewEod = async (request: Request, response: Response): Promise<void> => {
  if (request.user!.role !== "SUPER_ADMIN") throw new AppError("Only the super admin can review EOD updates", 403);
  const update = await EodUpdate.findOneAndUpdate({ _id: String(request.params.id), status: "SUBMITTED" }, { $set: { acknowledgedBy: request.user!.id, acknowledgedAt: new Date(), managerComment: request.body.managerComment } }, { new: true, runValidators: true });
  if (!update) throw new AppError("Submitted EOD update not found", 404);
  await writeAudit({ user: request.user!.id, action: "EOD_REVIEWED", entityType: "EodUpdate", entityId: update.id });
  response.json({ success: true, data: { update } });
};
export const eodRouter = Router();
eodRouter.use(authenticate);
eodRouter.get("/", validate(eodListSchema), asyncHandler(listEod));
eodRouter.put("/", validate(eodSaveSchema), asyncHandler(saveEod));
eodRouter.patch("/:id/review", validate(eodReviewSchema), asyncHandler(reviewEod));
