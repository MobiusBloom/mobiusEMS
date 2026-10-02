import type { Request, Response } from "express"; import { AppError } from "../utils/AppError.js"; import * as service from "../services/peopleOpsService.js"; const viewer = (request: Request) => ({ id: request.user!.id, role: request.user!.role });
export const leaves = async (request: Request, response: Response): Promise<void> => { response.json({ success: true, message: "Leave requests retrieved", data: { items: await service.listLeaves(viewer(request)) } }); };
export const leaveBalances = async (request: Request, response: Response): Promise<void> => {
  const year = request.query.year ? Number(request.query.year) : undefined;
  response.json({ success: true, message: "Leave balances retrieved", data: { items: await service.getLeaveBalances(request.user!.id, year) } });
};
export const teamCalendar = async (request: Request, response: Response): Promise<void> => {
  const month = request.query.month as string | undefined;
  response.json({ success: true, message: "Team leave calendar retrieved", data: { items: await service.getTeamLeaveCalendar(viewer(request), month) } });
};
export const leavePolicies = async (_request: Request, response: Response): Promise<void> => {
  response.json({ success: true, message: "Leave policies retrieved", data: { items: await service.listLeavePolicies() } });
};
export const createLeavePolicy = async (request: Request, response: Response): Promise<void> => {
  response.status(201).json({ success: true, message: "Leave policy created", data: { item: await service.createLeavePolicy(request.body, request.user!.id) } });
};
export const updateLeavePolicy = async (request: Request, response: Response): Promise<void> => {
  response.json({ success: true, message: "Leave policy updated", data: { item: await service.updateLeavePolicy(String(request.params.id), request.body, request.user!.id) } });
};
export const deleteLeavePolicy = async (request: Request, response: Response): Promise<void> => {
  response.json({ success: true, message: "Leave policy deleted", data: { item: await service.deleteLeavePolicy(String(request.params.id), request.user!.id) } });
};
export const requestLeave = async (request: Request, response: Response): Promise<void> => { if (request.user!.role !== "EMPLOYEE") throw new AppError("Only employees can request leave", 403); response.status(201).json({ success: true, message: "Leave request submitted", data: { item: await service.requestLeave(request.user!.id, request.body) } }); };
export const reviewLeave = async (request: Request, response: Response): Promise<void> => { response.json({ success: true, message: "Leave request reviewed", data: { item: await service.reviewLeave(String(request.params.id), request.body, viewer(request)) } }); };
export const recognition = async (request: Request, response: Response): Promise<void> => { response.json({ success: true, message: "Recognition retrieved", data: { items: await service.listRecognition(viewer(request)) } }); };
export const award = async (request: Request, response: Response): Promise<void> => { response.status(201).json({ success: true, message: "Recognition awarded", data: { item: await service.awardRecognition(request.body, request.user!.id) } }); };
const requireSuperAdmin = (request: Request) => { if (request.user!.role !== "SUPER_ADMIN") throw new AppError("Only a Super Admin can manage administrator accounts", 403, "SUPER_ADMIN_REQUIRED"); };
export const roles = async (request: Request, response: Response): Promise<void> => { requireSuperAdmin(request); response.json({ success: true, message: "Roles retrieved", data: { items: await service.listRoles() } }); };
export const permissions = async (request: Request, response: Response): Promise<void> => { requireSuperAdmin(request); response.json({ success: true, message: "Role permissions updated", data: { item: await service.updateRolePermissions(String(request.params.id), request.body.permissions, request.user!.id) } }); };
export const sectionAccess = async (request: Request, response: Response): Promise<void> => { requireSuperAdmin(request); response.json({ success: true, message: "Section access updated", data: { item: await service.updateRoleSectionAccess(String(request.params.id), request.body.sections, request.user!.id) } }); };
export const administrators = async (request: Request, response: Response): Promise<void> => { requireSuperAdmin(request); response.json({ success: true, message: "Administrators retrieved", data: { items: await service.listAdministrators() } }); };
export const createAdministrator = async (request: Request, response: Response): Promise<void> => { requireSuperAdmin(request); response.status(201).json({ success: true, message: "Administrator account created", data: await service.createAdministrator(request.body, request.user!.id, { ip: request.ip, userAgent: request.get("user-agent") }) }); };

export const createRole = async (request: Request, response: Response): Promise<void> => { requireSuperAdmin(request); response.status(201).json({ success: true, message: "Role created", data: { item: await service.createRole(request.body, request.user!.id) } }); };

export const assignRole = async (request: Request, response: Response): Promise<void> => { requireSuperAdmin(request); await service.assignRole(String(request.params.id), request.body.email, request.user!.id); response.json({ success: true, message: "Role assigned", data: {} }); };
