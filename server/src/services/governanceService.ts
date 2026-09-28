import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { Document } from "../models/Document.js"; import { Applicant } from "../models/Applicant.js"; import { ResumeScreening } from "../models/ResumeScreening.js"; import { Employee } from "../models/Employee.js"; import { Skill } from "../models/Skill.js"; import { Department } from "../models/Department.js"; import { Project } from "../models/Project.js"; import { Task } from "../models/Task.js"; import { AuditLog } from "../models/AuditLog.js"; import { Goal } from "../models/Goal.js"; import { KPI } from "../models/KPI.js"; import { EmployeeKPI } from "../models/EmployeeKPI.js"; import { PerformanceSnapshot } from "../models/PerformanceSnapshot.js"; import { EmployeeTraining } from "../models/EmployeeTraining.js"; import { EmployeeSkill } from "../models/EmployeeSkill.js"; import { User } from "../models/User.js"; import { Role } from "../models/Role.js"; import { Designation } from "../models/Designation.js"; import { AppError } from "../utils/AppError.js"; import { deletePrivateObject, openPostgresPrivate, signedPrivateUrl, uploadApplicantPrivate, uploadPrivate } from "./storageService.js"; import { writeAudit } from "./auditService.js"; import { recalculateProfileCompletion } from "./profileCompletionService.js"; import { requireTenantId } from "../tenancy/tenantContext.js";
import { APPLICANT_STAGES, type ApplicantStage } from "@mobius-ems/shared";
const visibleEmployees = async (viewer: { id: string; role: string }) => { if (!["EMPLOYEE","MANAGER"].includes(viewer.role)) return Employee.find({ isActive: true }).distinct("_id"); const own = await Employee.findOne({ user: viewer.id }).select("_id"); return viewer.role === "EMPLOYEE" ? own ? [own._id] : [] : Employee.find({ $or: [{ _id: own?._id }, { reportingManager: own?._id }], isActive: true }).distinct("_id"); };
export const uploadDocument = async (file: Express.Multer.File, metadata: { employee: string; category: string; expiresAt?: string }, actor: { id: string; role: string }) => { const visible = await visibleEmployees(actor); if (!visible.some((id) => id.toString() === metadata.employee)) throw new AppError("Employee documents are outside your scope", 403); const employee = await Employee.findById(metadata.employee); if (!employee) throw new AppError("Employee not found", 404); const expiry = metadata.expiresAt ? new Date(`${metadata.expiresAt}T23:59:59.999+05:30`) : undefined; if (expiry && (Number.isNaN(expiry.getTime()) || expiry.toISOString().slice(0, 10) !== metadata.expiresAt)) throw new AppError("Invalid document expiration date", 422); const stored = await uploadPrivate(file.buffer, `mobius-ems/${employee.employeeId}`, { originalName: file.originalname, mimeType: file.mimetype, category: metadata.category, employeeId: employee.employeeId }); const document = await Document.create({ employee: employee._id, category: metadata.category, originalName: file.originalname, storageProvider: stored.provider, storageKey: stored.key, format: stored.format, mimeType: file.mimetype, size: stored.size, uploadedBy: actor.id, expiresAt: expiry }); await recalculateProfileCompletion(employee.id); await writeAudit({ user: actor.id, action: "DOCUMENT_UPLOADED", entityType: "Document", entityId: document.id, newValue: { employeeId: employee.employeeId, category: metadata.category, mimeType: file.mimetype, size: stored.size, storageProvider: stored.provider, expiresAt: expiry } }); return document; };
export const listDocuments = async (viewer: { id: string; role: string }) => Document.find({ employee: { $in: await visibleEmployees(viewer) }, isActive: true }).populate("employee", "firstName lastName employeeId").populate("uploadedBy", "name").sort({ createdAt: -1 }).lean();
export const listResumes = async (viewer: { id: string; role: string }, department?: string) => { let employeeIds = await visibleEmployees(viewer); if (department) employeeIds = await Employee.find({ _id: { $in: employeeIds }, department, isActive: true }).distinct("_id"); return Document.find({ employee: { $in: employeeIds }, category: "RESUME", isActive: true }).populate({ path: "employee", select: "firstName lastName employeeId designation department", populate: [{ path: "department", select: "name code" }, { path: "designation", select: "name" }] }).populate("uploadedBy", "name").sort({ createdAt: -1 }).lean(); };
export const createApplicant = async (file: Express.Multer.File, metadata: { name: string; designation: string; jobCategory?: string; city?: string; state?: string; email?: string; phone?: string }, actorId: string) => { const stored = await uploadApplicantPrivate(file.buffer, file.originalname, file.mimetype); const applicant = await Applicant.create({ ...metadata, originalName: file.originalname, storageProvider: stored.provider, storageKey: stored.key, format: stored.format, mimeType: file.mimetype, size: stored.size, uploadedBy: actorId, stage: "SOURCED", stageNotes: [] }); await writeAudit({ user: actorId, action: "APPLICANT_CV_UPLOADED", entityType: "Applicant", entityId: applicant.id, newValue: { name: metadata.name, designation: metadata.designation, jobCategory: metadata.jobCategory, city: metadata.city, state: metadata.state, mimeType: file.mimetype, size: stored.size, storageProvider: stored.provider } }); return applicant; };
export const listApplicants = async () => { const applicants = await Applicant.find({ isActive: true }).populate("uploadedBy", "name email").populate("convertedEmployeeId", "firstName lastName employeeId").sort({ createdAt: -1 }).lean(); const missingIds = applicants.filter((item) => item.matchScore === undefined).map((item) => item._id); if (!missingIds.length) return applicants; const screenings = await ResumeScreening.find({ "results.applicant": { $in: missingIds } }).select("results.applicant results.score createdAt").sort({ createdAt: -1 }).lean(); const scores = new Map<string, number>(); for (const screening of screenings) for (const result of screening.results) if (!scores.has(String(result.applicant))) scores.set(String(result.applicant), result.score); return applicants.map((item) => ({ ...item, matchScore: item.matchScore ?? scores.get(String(item._id)) })); };
export const updateApplicantStage = async (id: string, stage: ApplicantStage, note?: string, actorId?: string) => {
  const applicant = await Applicant.findOne({ _id: id, isActive: true });
  if (!applicant) throw new AppError("Applicant not found", 404);
  const oldStage = applicant.stage;
  applicant.stage = stage;
  if (note?.trim()) {
    applicant.stageNotes = applicant.stageNotes || [];
    applicant.stageNotes.push({ stage, note: note.trim(), updatedAt: new Date() });
  }
  await applicant.save();
  if (actorId) {
    await writeAudit({
      user: actorId,
      action: "APPLICANT_STAGE_UPDATED",
      entityType: "Applicant",
      entityId: applicant.id,
      oldValue: { stage: oldStage },
      newValue: { stage, note }
    });
  }
  return applicant;
};
export const convertApplicantToEmployee = async (
  id: string,
  actorId: string,
  options?: { departmentId?: string; designationId?: string; officialEmail?: string }
) => {
  const applicant = await Applicant.findOne({ _id: id, isActive: true });
  if (!applicant) throw new AppError("Applicant not found", 404);
  if (applicant.convertedEmployeeId) throw new AppError("Applicant has already been converted to an employee", 409, "ALREADY_CONVERTED");

  const nameParts = applicant.name.trim().split(/\s+/);
  const firstName = nameParts[0] || "Applicant";
  const lastName = nameParts.slice(1).join(" ") || "Employee";

  let departmentId = options?.departmentId;
  if (!departmentId) {
    const defaultDept = await Department.findOne({ isActive: true }).sort({ createdAt: 1 });
    if (!defaultDept) throw new AppError("No department found to assign the employee to", 400);
    departmentId = defaultDept.id;
  }

  let designationId = options?.designationId;
  if (!designationId) {
    let desig = await Designation.findOne({ isActive: true, name: new RegExp(`^${applicant.designation}$`, "i") });
    if (!desig) {
      desig = await Designation.findOne({ isActive: true }).sort({ createdAt: 1 });
    }
    if (!desig) throw new AppError("No designation found to assign the employee to", 400);
    designationId = desig.id;
  }

  const employeeRole = await Role.findOne({ name: "EMPLOYEE" });
  if (!employeeRole) throw new AppError("Employee role not found; please seed roles", 400);

  let officialEmail = options?.officialEmail?.trim().toLowerCase();
  if (!officialEmail) {
    const baseSlug = `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    officialEmail = `${baseSlug}@mobius.local`;
    let count = 1;
    while (await User.exists({ email: officialEmail })) {
      officialEmail = `${baseSlug}${count}@mobius.local`;
      count++;
    }
  } else {
    if (await User.exists({ email: officialEmail })) {
      throw new AppError("An account already uses this email address", 409, "EMAIL_EXISTS");
    }
  }

  const tempPassword = `Mb!${randomBytes(8).toString("base64url")}1a`;
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  const user = await User.create({
    name: `${firstName} ${lastName}`,
    email: officialEmail,
    passwordHash,
    role: employeeRole._id,
    isActive: true,
    forcePasswordChange: true,
    onboardingComplete: false
  });

  let employeeIdCode = `EMP-${Math.floor(1000 + Math.random() * 9000)}`;
  while (await Employee.exists({ employeeId: employeeIdCode })) {
    employeeIdCode = `EMP-${Math.floor(1000 + Math.random() * 9000)}`;
  }

  const employee = await Employee.create({
    employeeId: employeeIdCode,
    user: user._id,
    firstName,
    lastName,
    officialEmail,
    phone: applicant.phone,
    department: departmentId,
    designation: designationId,
    dateOfJoining: new Date(),
    employmentType: "FULL_TIME",
    status: "ACTIVE",
    personal: { personalEmail: applicant.email },
    onboardingStep: 1,
    profileCompletion: 25,
    isActive: true
  });

  try {
    await Document.create({
      employee: employee._id,
      category: "RESUME",
      originalName: applicant.originalName,
      storageProvider: applicant.storageProvider,
      storageKey: applicant.storageKey,
      format: applicant.format,
      mimeType: applicant.mimeType,
      size: applicant.size,
      uploadedBy: actorId
    });
  } catch (err) {
    // Non-fatal if resume document duplicate key
  }

  applicant.stage = "HIRED";
  applicant.convertedEmployeeId = employee._id;
  applicant.convertedAt = new Date();
  await applicant.save();

  await writeAudit({
    user: actorId,
    action: "APPLICANT_CONVERTED_TO_EMPLOYEE",
    entityType: "Employee",
    entityId: employee.id,
    newValue: {
      applicantId: applicant.id,
      employeeId: employee.employeeId,
      officialEmail: employee.officialEmail
    }
  });

  return {
    employee: await Employee.findById(employee._id).populate("department designation", "name").lean(),
    user: { id: user.id, email: user.email },
    temporaryCredentials: { email: user.email, password: tempPassword }
  };
};
export const applicantCvUrl = async (id: string, actorId: string) => { const applicant = await Applicant.findOne({ _id: id, isActive: true }); if (!applicant) throw new AppError("Applicant not found", 404); await writeAudit({ user: actorId, action: "APPLICANT_CV_VIEWED", entityType: "Applicant", entityId: applicant.id }); return { url: applicant.storageProvider === "POSTGRESQL" ? `/api/v1/governance/applicants/${applicant.id}/cv/file` : signedPrivateUrl(applicant.storageKey) }; };
export const applicantCvStream = async (id: string) => { const applicant = await Applicant.findOne({ _id: id, isActive: true }); if (!applicant) throw new AppError("Applicant not found", 404); if (applicant.storageProvider !== "POSTGRESQL") throw new AppError("Document is stored externally", 409); return { applicant, stream: await openPostgresPrivate(applicant.storageKey) }; };
export const deleteApplicant = async (id: string, actorId: string) => { const applicant = await Applicant.findOne({ _id: id, isActive: true }); if (!applicant) throw new AppError("Applicant not found", 404); await deletePrivateObject({ provider: applicant.storageProvider, key: applicant.storageKey }); applicant.isActive = false; await applicant.save(); await writeAudit({ user: actorId, action: "APPLICANT_CV_DELETED", entityType: "Applicant", entityId: applicant.id, oldValue: { name: applicant.name, designation: applicant.designation, originalName: applicant.originalName } }); return applicant; };
export const documentUrl = async (id: string, viewer: { id: string; role: string }) => { const document = await Document.findOne({ _id: id, employee: { $in: await visibleEmployees(viewer) }, isActive: true }); if (!document) throw new AppError("Document not found", 404); await writeAudit({ user: viewer.id, action: "DOCUMENT_VIEWED", entityType: "Document", entityId: document.id }); return { url: document.storageProvider === "POSTGRESQL" ? `/api/v1/governance/documents/${document.id}/file` : signedPrivateUrl(document.storageKey), expiresInSeconds: document.storageProvider === "POSTGRESQL" ? 0 : 3600 }; };
export const documentStream = async (id: string, viewer: { id: string; role: string }) => { const document = await Document.findOne({ _id: id, employee: { $in: await visibleEmployees(viewer) }, isActive: true }); if (!document) throw new AppError("Document not found", 404); if (document.storageProvider !== "POSTGRESQL") throw new AppError("Document is stored externally", 409); return { document, stream: await openPostgresPrivate(document.storageKey) }; };
export const archiveDocument = async (id: string, viewer: { id: string; role: string }) => { const document = await Document.findOne({ _id: id, employee: { $in: await visibleEmployees(viewer) }, isActive: true }); if (!document) throw new AppError("Document not found", 404); await deletePrivateObject({ provider: document.storageProvider, key: document.storageKey }); document.isActive = false; document.archivedAt = new Date(); await document.save(); await recalculateProfileCompletion(document.employee.toString()); await writeAudit({ user: viewer.id, action: "DOCUMENT_DELETED", entityType: "Document", entityId: document.id, oldValue: { category: document.category, originalName: document.originalName } }); return document; };
const safeRegex = (value: string) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
export const globalSearch = async (q: string, viewer: { id: string; role: string }) => { const regex = safeRegex(q); const employeeIds = await visibleEmployees(viewer); const [employees, skills, departments, projects, tasks] = await Promise.all([Employee.find({ _id: { $in: employeeIds }, $or: [{ firstName: regex }, { lastName: regex }, { employeeId: regex }, { officialEmail: regex }] }).select("firstName lastName employeeId designation").limit(8).lean(), Skill.find({ isActive: true, name: regex }).select("name category").limit(8).lean(), Department.find({ isActive: true, $or: [{ name: regex }, { code: regex }] }).select("name code").limit(8).lean(), Project.find({ isActive: true, $or: [{ name: regex }, { code: regex }] }).select("name code status").limit(8).lean(), Task.find({ isActive: true, assignedEmployee: { $in: employeeIds }, $or: [{ name: regex }, { taskId: regex }] }).select("name taskId status").limit(8).lean()]); return { employees, skills, departments, projects, tasks }; };
export const auditLogs = async (query: { page?: number; action?: string }) => { const page = query.page ?? 1; const filter = query.action ? { action: query.action } : {}; const [items, total] = await Promise.all([AuditLog.find(filter).populate("user", "name email").sort({ createdAt: -1 }).skip((page - 1) * 50).limit(50).lean(), AuditLog.countDocuments(filter)]); return { items, pagination: { page, total, pages: Math.ceil(total / 50) } }; };
export const updateDocumentExpiration = async (id: string, expiresAt: string | null, viewer: { id: string; role: string }) => {
  const document = await Document.findOne({ _id: id, employee: { $in: await visibleEmployees(viewer) }, isActive: true });
  if (!document) throw new AppError("Document not found", 404);
  const expiry = expiresAt ? new Date(`${expiresAt}T23:59:59.999+05:30`) : undefined;
  if (expiry && (Number.isNaN(expiry.getTime()) || expiry.toISOString().slice(0, 10) !== expiresAt)) throw new AppError("Invalid document expiration date", 422);
  const previous = document.expiresAt;
  document.expiresAt = expiry;
  document.expiryReminderDaysSent = [];
  await document.save();
  await writeAudit({ user: viewer.id, action: "DOCUMENT_EXPIRATION_UPDATED", entityType: "Document", entityId: document.id, oldValue: { expiresAt: previous }, newValue: { expiresAt: expiry } });
  return document;
};
export const reportEmployees = async (viewer: { id: string; role: string }) => Employee.find({ _id: { $in: await visibleEmployees(viewer) } }).select("employeeId firstName lastName").sort({ firstName: 1, lastName: 1 }).lean();
export const report = async (type: string, viewer: { id: string; role: string }, employeeId?: string) => {
  const visible = await visibleEmployees(viewer);
  if (employeeId && !visible.some((id) => String(id) === employeeId)) throw new AppError("Employee is outside your report scope", 403);
  const employeeIds = employeeId ? [employeeId] : visible;
  switch (type) {
    case "EMPLOYEE": return Employee.find({ _id: { $in: employeeIds } }).select("employeeId firstName lastName officialEmail department team designation dateOfJoining employmentType officeLocation status").populate("department team designation", "name").lean();
    case "DEPARTMENT": {
      const tenantId = requireTenantId();
      const employee = employeeId ? await Employee.findById(employeeId).select("department") : null;
      return Department.aggregate([{ $match: { isActive: true, ...(employee ? { _id: employee.department } : {}) } }, { $lookup: { from: "employees", let: { departmentId: "$_id", tenantId: "$tenantId" }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$department", "$$departmentId"] }, { $eq: ["$tenantId", "$$tenantId"] }, { $eq: ["$$tenantId", tenantId] }, ...(employeeId ? [{ $eq: ["$_id", employee?._id] }] : [])] } } }], as: "employees" } }, { $project: { name: 1, code: 1, employeeCount: { $size: "$employees" } } }]);
    }
    case "SKILL": return EmployeeSkill.find({ employee: { $in: employeeIds }, isActive: true }).populate("employee skill", "firstName lastName employeeId name category").lean();
    case "SKILL_GAP": return EmployeeSkill.find({ employee: { $in: employeeIds }, verificationStatus: { $in: ["PENDING", "REVIEW_REQUIRED"] } }).populate("employee skill").lean();
    case "TASK_PERFORMANCE": return Task.find({ assignedEmployee: { $in: employeeIds } }).populate("assignedEmployee project", "firstName lastName employeeId name code").lean();
    case "PROJECT": return Project.find({ isActive: true, ...(employeeId ? { $or: [{ projectManager: employeeId }, { teamMembers: employeeId }] } : {}) }).populate("department projectManager", "name firstName lastName").lean();
    case "PERFORMANCE": return PerformanceSnapshot.find({ employee: { $in: employeeIds } }).populate("employee", "firstName lastName employeeId").lean();
    case "KPI": return employeeId ? EmployeeKPI.find({ employee: employeeId }).populate("kpi", "name unit target weight period").lean() : KPI.find({ isActive: true }).lean();
    case "GOAL": return Goal.find({ employee: { $in: employeeIds }, isActive: true }).populate("employee", "firstName lastName employeeId").lean();
    case "TRAINING": return EmployeeTraining.find({ employee: { $in: employeeIds } }).populate("employee training").lean();
    default: throw new AppError("Unsupported report", 422);
  }
};
