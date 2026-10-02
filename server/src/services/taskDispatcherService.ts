import { z } from "zod";
import { Employee } from "../models/Employee.js";
import { ExtractedTask } from "../models/ExtractedTask.js";
import { PRIORITIES, Project } from "../models/Project.js";
import { TaskImport, type TaskImportDocument } from "../models/TaskImport.js";
import { AppError } from "../utils/AppError.js";
import { writeAudit } from "./auditService.js";
import { complete } from "./llmService.js";
import { createTask } from "./workService.js";

type Actor = { id: string; role: string };
type DirectoryEmployee = { id: string; label: string; employeeId: string };
type CommitItem = { extractedTask: string; name: string; assignedEmployee: string; dueDate: Date; priority: typeof PRIORITIES[number]; estimatedHours: number; description?: string };

const extractedSchema = z.array(z.object({
  snippet: z.string().trim().min(1).max(3000),
  action: z.string().trim().min(2).max(200),
  assignee: z.string().trim().max(160).nullish(),
  assigneeId: z.string().trim().nullish(),
  dueDate: z.string().trim().nullish(),
  priority: z.enum(PRIORITIES).catch("MEDIUM"),
  dependency: z.string().trim().max(500).nullish(),
  confidence: z.coerce.number().min(0).max(1).catch(0.5)
})).min(1).max(50);

const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const editDistance = (left: string, right: string) => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) current[rightIndex] = Math.min((current[rightIndex - 1] ?? 0) + 1, (previous[rightIndex] ?? 0) + 1, (previous[rightIndex - 1] ?? 0) + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1));
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? Math.max(left.length, right.length);
};

export const resolveDirectoryEmployee = (spoken: string | null | undefined, id: string | null | undefined, employees: DirectoryEmployee[]) => {
  const byId = id ? employees.find((employee) => employee.id === id) : undefined;
  if (byId) return { employee: byId, score: 1 };
  const query = normalize(spoken ?? "");
  if (!query) return { score: 0 };
  const firstNameCounts = new Map<string, number>();
  for (const employee of employees) { const first = normalize(employee.label).split(" ")[0]; if (first) firstNameCounts.set(first, (firstNameCounts.get(first) ?? 0) + 1); }
  const ranked = employees.map((employee) => {
    const full = normalize(employee.label); const first = full.split(" ")[0] ?? "";
    const aliases = [full, normalize(employee.employeeId), ...(firstNameCounts.get(first) === 1 ? [first] : [])].filter(Boolean);
    const score = Math.max(...aliases.map((alias) => query === alias ? 1 : query.length >= 3 && alias.startsWith(query) ? 0.9 : 1 - editDistance(query, alias) / Math.max(query.length, alias.length)));
    return { employee, score };
  }).sort((left, right) => right.score - left.score);
  const best = ranked[0]; const next = ranked[1];
  return best && best.score >= 0.72 && (!next || best.score - next.score >= 0.08) ? best : { score: best?.score ?? 0 };
};

export const parseDispatcherJson = (text: string) => {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const candidates = [cleaned];
  let start = -1; let quote = false; let escaped = false; const stack: string[] = [];
  for (let index = 0; index < cleaned.length; index += 1) {
    const character = cleaned[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quote = false;
      continue;
    }
    if (character === '"' && start >= 0) { quote = true; continue; }
    if (character === "{" || character === "[") { if (!stack.length) start = index; stack.push(character === "{" ? "}" : "]"); continue; }
    if (start >= 0 && character === stack.at(-1)) {
      stack.pop();
      if (!stack.length) { candidates.push(cleaned.slice(start, index + 1)); start = -1; }
    }
  }
  let parsedJson = false;
  for (const candidate of [...new Set(candidates)]) {
    let value: unknown;
    try { value = JSON.parse(candidate); parsedJson = true; }
    catch { continue; }
    const parsed = extractedSchema.safeParse(Array.isArray(value) ? value : (value as { tasks?: unknown })?.tasks);
    if (parsed.success) return parsed.data;
  }
  throw new AppError(parsedJson ? "AI returned an incomplete task list. Please retry." : "AI returned an invalid task list. Please retry.", 502, "AI_INVALID_RESPONSE");
};

const sourceType = (file?: Express.Multer.File): TaskImportDocument["sourceType"] => {
  if (!file) return "PASTED_TEXT";
  if (file.mimetype === "application/pdf") return "PDF";
  if (file.mimetype.includes("wordprocessingml")) return "DOCX";
  return "TXT";
};

const extractFileText = async (file: Express.Multer.File) => {
  if (file.mimetype === "text/plain") return file.buffer.toString("utf8");
  if (file.mimetype === "application/pdf") {
    if (file.buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new AppError("Invalid PDF file", 422, "INVALID_TASK_SOURCE");
    const { default: pdf } = await import("pdf-parse/lib/pdf-parse.js");
    const parsed = await pdf(file.buffer).catch(() => { throw new AppError("Text could not be extracted from this PDF", 422, "TASK_SOURCE_EXTRACTION_FAILED"); });
    return parsed.text;
  }
  const { default: mammoth } = await import("mammoth");
  const parsed = await mammoth.extractRawText({ buffer: file.buffer }).catch(() => { throw new AppError("Text could not be extracted from this DOCX", 422, "TASK_SOURCE_EXTRACTION_FAILED"); });
  return parsed.value;
};

const createFromExtracted = async (item: { id: string; action: string; snippet: string; employee: unknown; dueDate?: Date; priority: typeof PRIORITIES[number] }, taskImport: { id: string; project: unknown }, actor: Actor, estimatedHours = 1, description?: string) => {
  if (!item.employee || !item.dueDate) throw new AppError("Choose an assignee and deadline before creating this task", 422, "TASK_REVIEW_REQUIRED");
  const task = await createTask({ name: item.action, description: description || item.snippet, project: String(taskImport.project), assignedEmployee: String(item.employee), priority: item.priority, complexity: "MEDIUM", estimatedHours, deadline: item.dueDate, assignmentSource: "AI_DISPATCHER", sourceImport: taskImport.id, sourceSnippet: item.snippet }, actor.id);
  await ExtractedTask.updateOne({ _id: item.id }, { $set: { task: task._id, status: "CREATED" } });
  return task;
};

const responseFor = async (taskImportId: string) => {
  const taskImport = await TaskImport.findById(taskImportId).populate("project", "name code").lean();
  const items = await ExtractedTask.find({ taskImport: taskImportId }).populate("employee", "firstName lastName employeeId").populate("task", "taskId name status").sort({ createdAt: 1 }).lean();
  const employees = await Employee.find({ isActive: true }).select("firstName lastName employeeId").sort({ firstName: 1 }).lean();
  return { taskImport, items, options: { employees: employees.map((employee) => ({ id: employee._id.toString(), label: `${employee.firstName} ${employee.lastName}`, detail: employee.employeeId })) } };
};

export const previewTaskImport = async (input: { text?: string; file?: Express.Multer.File; project: string; mode: TaskImportDocument["mode"] }, actor: Actor) => {
  const rawContent = (input.file ? await extractFileText(input.file) : input.text ?? "").trim();
  if (rawContent.length < 10) throw new AppError("Add enough source text to extract tasks", 422, "TASK_SOURCE_TOO_SHORT");
  if (rawContent.length > 100_000) throw new AppError("Task source is too long", 422, "TASK_SOURCE_TOO_LONG");
  if (!await Project.exists({ _id: input.project, isActive: true })) throw new AppError("Project not found", 404);
  const employeesRaw = await Employee.find({ isActive: true }).select("firstName lastName employeeId").sort({ firstName: 1 }).lean();
  const employees = employeesRaw.map((employee) => ({ id: employee._id.toString(), label: `${employee.firstName} ${employee.lastName}`, employeeId: employee.employeeId }));
  const taskImport = await TaskImport.create({ sourceType: sourceType(input.file), sourceName: input.file?.originalname, rawContent, creator: actor.id, project: input.project, mode: input.mode, status: "PROCESSING" });
  try {
    const now = new Date();
    const directory = employees.map((employee) => `${employee.id} | ${employee.label} | ${employee.employeeId}`).join("\n");
    const generated = await complete({
      system: "Extract actionable work assignments from the source. Return JSON only as {\"tasks\":[...]}. Each task must contain snippet, action, assignee, assigneeId, dueDate, priority, dependency, confidence. Use only an assigneeId from the directory. Use null when unresolved. dueDate must be an ISO timestamp with +05:30 when a deadline is stated; otherwise null. priority is LOW, MEDIUM, HIGH, or CRITICAL. Split separate instructions. Do not invent work.",
      user: `Current time in Asia/Kolkata: ${now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "long" })}\n\nEmployee directory:\n${directory}\n\nSource:\n${rawContent}`,
      temperature: 0,
      maxTokens: 2400
    });
    const extracted = parseDispatcherJson(generated.text);
    taskImport.provider = generated.provider; taskImport.aiModel = generated.model;
    const records = [];
    for (const item of extracted) {
      const resolved = resolveDirectoryEmployee(item.assignee, item.assigneeId, employees);
      const parsedDate = item.dueDate ? new Date(item.dueDate) : undefined;
      const dueDate = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : undefined;
      const confidence = Math.min(item.confidence, resolved.employee ? resolved.score : item.confidence);
      records.push(await ExtractedTask.create({ taskImport: taskImport._id, snippet: item.snippet, employee: resolved.employee?.id, assigneeText: item.assignee ?? undefined, confidence, action: item.action, dueDate, priority: item.priority, dependency: item.dependency ?? undefined, status: resolved.employee && dueDate && confidence >= 0.75 ? "READY" : "NEEDS_REVIEW" }));
    }
    if (input.mode === "AUTO_CREATE") for (const record of records) if (record.status === "READY") await createFromExtracted({ id: record.id, action: record.action, snippet: record.snippet, employee: record.employee, dueDate: record.dueDate, priority: record.priority }, { id: taskImport.id, project: taskImport.project }, actor);
    const remaining = await ExtractedTask.countDocuments({ taskImport: taskImport._id, status: { $ne: "CREATED" } });
    const created = records.length - remaining;
    taskImport.status = remaining ? (created ? "PARTIAL" : "REVIEW") : "COMPLETED";
    await taskImport.save();
    await writeAudit({ user: actor.id, action: "TASK_IMPORT_PREVIEWED", entityType: "TaskImport", entityId: taskImport.id, newValue: { sourceType: taskImport.sourceType, mode: taskImport.mode, extracted: records.length, created } });
    return responseFor(taskImport.id);
  } catch (error) {
    taskImport.status = "FAILED"; taskImport.errorMessage = error instanceof Error ? error.message : "Task extraction failed"; await taskImport.save(); throw error;
  }
};

export const commitTaskImport = async (id: string, items: CommitItem[], actor: Actor) => {
  const taskImport = await TaskImport.findById(id); if (!taskImport) throw new AppError("Task import not found", 404);
  if (taskImport.creator.toString() !== actor.id && actor.role !== "SUPER_ADMIN") throw new AppError("This task import belongs to another user", 403);
  const extracted = await ExtractedTask.find({ _id: { $in: items.map((item) => item.extractedTask) }, taskImport: taskImport._id, status: { $ne: "CREATED" } });
  const byId = new Map(extracted.map((item) => [item.id, item]));
  if (extracted.length !== items.length) throw new AppError("One or more extracted tasks are unavailable", 409, "TASK_IMPORT_CHANGED");
  const tasks = [];
  for (const input of items) {
    const item = byId.get(input.extractedTask)!;
    item.action = input.name; item.employee = input.assignedEmployee as never; item.dueDate = input.dueDate; item.priority = input.priority; item.status = "READY"; await item.save();
    tasks.push(await createFromExtracted({ id: item.id, action: item.action, snippet: item.snippet, employee: item.employee, dueDate: item.dueDate, priority: item.priority }, { id: taskImport.id, project: taskImport.project }, actor, input.estimatedHours, input.description));
  }
  const remaining = await ExtractedTask.countDocuments({ taskImport: taskImport._id, status: { $ne: "CREATED" } });
  taskImport.status = remaining ? "PARTIAL" : "COMPLETED"; await taskImport.save();
  await writeAudit({ user: actor.id, action: "TASK_IMPORT_COMMITTED", entityType: "TaskImport", entityId: taskImport.id, newValue: { tasks: tasks.map((task) => task.id), remaining } });
  return { ...(await responseFor(taskImport.id)), tasks };
};
