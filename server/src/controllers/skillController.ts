import type { Request, Response } from "express";
import * as service from "../services/skillService.js";
import { generateAssessmentQuestions } from "../services/assessmentGeneratorService.js";
import { getSkillCredibilityLeaderboard } from "../services/skillCredibilityService.js";
import { AppError } from "../utils/AppError.js";

export const leaderboard = async (request: Request, response: Response): Promise<void> => {
  const items = await getSkillCredibilityLeaderboard(Number(request.query.limit) || 20);
  response.json({ success: true, message: "Skill credibility leaderboard retrieved", data: { items } });
};

export const list = async (_request: Request, response: Response): Promise<void> => { response.json({ success: true, message: "Skills retrieved", data: { items: await service.listSkills() } }); };
export const create = async (request: Request, response: Response): Promise<void> => { response.status(201).json({ success: true, message: "Skill created", data: { item: await service.createSkill(request.body) } }); };
export const claim = async (request: Request, response: Response): Promise<void> => { response.status(201).json({ success: true, message: "Skill submitted for verification", data: { item: await service.claimSkill(request.user!.id, request.body) } }); };
export const mine = async (request: Request, response: Response): Promise<void> => { response.json({ success: true, message: "Employee skills retrieved", data: await service.mySkills(request.user!.id) }); };
export const roleCatalog = async (request: Request, response: Response): Promise<void> => {
  if (request.user!.role !== "EMPLOYEE") {
    if (request.query.employeeId) {
      const data = await service.roleCatalogAssessmentByEmployee(String(request.query.employeeId));
      response.json({ success: true, message: "Role skill catalog retrieved", data });
      return;
    }
    response.json({
      success: true,
      message: "Admin role skill catalog view",
      data: { catalog: [], assessment: null, designation: null, assignedRole: "Administrator" }
    });
    return;
  }
  response.json({ success: true, message: "Role skill catalog retrieved", data: await service.roleCatalogAssessment(request.user!.id) });
};

export const submitRoleCatalog = async (request: Request, response: Response): Promise<void> => {
  if (request.user!.role !== "EMPLOYEE") throw new AppError("Role skill self-assessment is available to employees only", 403);
  response.status(201).json({ success: true, message: "Role skill assessment submitted. It is now locked.", data: { assessment: await service.submitRoleCatalogAssessment(request.user!.id, request.body, { ip: request.ip, userAgent: request.get("user-agent") }) } });
};

export const submissions = async (_request: Request, response: Response): Promise<void> => {
  const data = await service.listRoleSkillSubmissions();
  response.json({ success: true, message: "Skill assessment submissions retrieved", data });
};

export const employeeRoleCatalog = async (request: Request, response: Response): Promise<void> => {
  const data = await service.roleCatalogAssessmentByEmployee(String(request.params.employeeId));
  response.json({ success: true, message: "Employee role skill catalog retrieved", data });
};

export const adminSubmitEmployeeRoleCatalog = async (request: Request, response: Response): Promise<void> => {
  const assessment = await service.submitRoleCatalogAssessmentByEmployee(
    String(request.params.employeeId),
    request.body,
    request.user!.id,
    { ip: request.ip, userAgent: request.get("user-agent") }
  );
  response.status(201).json({ success: true, message: "Role skill assessment submitted successfully", data: { assessment } });
};
export const pending = async (_request: Request, response: Response): Promise<void> => { response.json({ success: true, message: "Pending verifications retrieved", data: { items: await service.pendingVerifications() } }); };
export const verify = async (request: Request, response: Response): Promise<void> => { response.json({ success: true, message: "Skill verification recorded", data: { item: await service.verify(String(request.params.id), request.user!.id, request.body, { ip: request.ip, userAgent: request.get("user-agent") }) } }); };
export const designationSkills = async (request: Request, response: Response): Promise<void> => { response.json({ success: true, message: "Role skill requirements updated", data: { item: await service.setDesignationSkills(String(request.params.id), request.body.requiredSkills) } }); };
export const heatmap = async (_request: Request, response: Response): Promise<void> => { response.json({ success: true, message: "Skill heatmap retrieved", data: { items: await service.heatmap() } }); };
export const spof = async (_request: Request, response: Response): Promise<void> => {
  response.json({ success: true, message: "Single Point of Failure risks retrieved", data: { items: await service.detectSinglePointOfFailures() } });
};

export const assessments = async (request: Request, response: Response): Promise<void> => { response.json({ success: true, message: "Assessments retrieved", data: { items: await service.listAssessments({ id: request.user!.id, role: request.user!.role }) } }); };
export const assessmentCandidates = async (_request: Request, response: Response): Promise<void> => { response.json({ success: true, message: "Assessment applicants retrieved", data: { items: await service.listAssessmentCandidates() } }); };
export const createAssessmentCandidate = async (request: Request, response: Response): Promise<void> => { response.status(201).json({ success: true, message: "Applicant login created", data: await service.createAssessmentCandidate(request.body, request.user!.id) }); };
export const assignAssessment = async (request: Request, response: Response): Promise<void> => { response.status(201).json({ success: true, message: "Assessment assigned", data: { item: await service.assignAssessment(request.body, request.user!.id) } }); };
export const recordAssessmentResult = async (request: Request, response: Response): Promise<void> => { response.json({ success: true, message: "Assessment result recorded", data: { item: await service.recordAssessmentResult(String(request.params.id), request.body, request.user!.id) } }); };

export const generateAssessment = async (request: Request, response: Response): Promise<void> => {
  const result = await generateAssessmentQuestions(request.body);
  response.json({
    success: true,
    message: "Assessment questions generated successfully",
    data: result
  });
};

export const getAssessment = async (request: Request, response: Response): Promise<void> => {
  const item = await service.getAssessmentById(String(request.params.id), {
    id: request.user!.id,
    role: request.user!.role
  });
  response.json({
    success: true,
    message: "Assessment details retrieved",
    data: { item }
  });
};

export const startAssessment = async (request: Request, response: Response): Promise<void> => {
  const item = await service.startAssessment(String(request.params.id), {
    id: request.user!.id,
    role: request.user!.role
  });
  response.json({
    success: true,
    message: "Assessment started",
    data: { item }
  });
};
export const recordAssessmentFocusLoss = async (request: Request, response: Response): Promise<void> => {
  const count = await service.recordAssessmentFocusLoss(String(request.params.id), { id: request.user!.id, role: request.user!.role });
  response.json({ success: true, message: "Focus change recorded", data: { count } });
};

export const submitAssessment = async (request: Request, response: Response): Promise<void> => {
  const item = await service.submitAssessment(String(request.params.id), {
    id: request.user!.id,
    role: request.user!.role
  }, request.body);
  response.json({
    success: true,
    message: "Assessment submitted and evaluated",
    data: { item }
  });
};

export const deleteAssessment = async (request: Request, response: Response): Promise<void> => {
  const result = await service.deleteAssessment(String(request.params.id));
  response.json({
    success: true,
    message: result.message
  });
};
