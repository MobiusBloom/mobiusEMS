import { api } from "@/api/client"; import type { PermissionName, SectionPermissionName, LeaveBalanceItem, LeavePolicyItem } from "@mobius-ems/shared";
export interface LeaveItem { _id: string; employee: { _id: string; firstName: string; lastName: string; employeeId: string; department?: { _id: string; name: string } }; type: string; startDate: string; endDate: string; reason: string; status: string; reviewComment?: string }
export interface RecognitionItem { _id: string; employee: { firstName: string; lastName: string }; badge: string; explanation: string; awardedAt: string }
export interface RoleItem { _id: string; name: string; description: string; permissions: PermissionName[]; isSystem: boolean; baseRole?: string }
export interface AdministratorItem { _id: string; name: string; email: string; role: { name: string }; isActive: boolean; forcePasswordChange: boolean; lastLoginAt?: string; createdAt: string }
export interface AdministratorCredentials { email: string; password: string }
export const peopleOpsApi = {
  leaves: () => api.get<{ items: LeaveItem[] }>("/api/v1/people-ops/leaves"),
  leaveBalances: (year?: number) => api.get<{ items: LeaveBalanceItem[] }>(`/api/v1/people-ops/leaves/balances${year ? `?year=${year}` : ""}`),
  teamCalendar: (month?: string) => api.get<{ items: LeaveItem[] }>(`/api/v1/people-ops/leaves/team-calendar${month ? `?month=${month}` : ""}`),
  policies: () => api.get<{ items: LeavePolicyItem[] }>("/api/v1/people-ops/leave-policies"),
  createPolicy: (body: { name: string; code?: string; quotaDays: number; isPaid?: boolean; description?: string }) => api.post<{ item: LeavePolicyItem }>("/api/v1/people-ops/leave-policies", body),
  updatePolicy: (id: string, body: { name?: string; quotaDays?: number; isPaid?: boolean; description?: string }) => api.patch<{ item: LeavePolicyItem }>(`/api/v1/people-ops/leave-policies/${id}`, body),
  deletePolicy: (id: string) => api.delete<{ item: LeavePolicyItem }>(`/api/v1/people-ops/leave-policies/${id}`),
  requestLeave: (body: unknown) => api.post("/api/v1/people-ops/leaves", body),
  reviewLeave: (id: string, body: unknown) => api.patch(`/api/v1/people-ops/leaves/${id}/review`, body),
  recognition: () => api.get<{ items: RecognitionItem[] }>("/api/v1/people-ops/recognition"),
  award: (body: unknown) => api.post("/api/v1/people-ops/recognition", body),
  roles: () => api.get<{ items: RoleItem[] }>("/api/v1/people-ops/roles"),
  assignRole: (id: string, email: string) => api.put(`/api/v1/people-ops/roles/${id}/assignment`, { email }),
  createRole: (body: { name: string; description: string; baseRole: string; permissions: PermissionName[] }) => api.post("/api/v1/people-ops/roles", body),
  updateRole: (id: string, permissions: PermissionName[]) => api.put(`/api/v1/people-ops/roles/${id}/permissions`, { permissions }),
  updateRoleSectionAccess: (id: string, sections: SectionPermissionName[]) => api.put(`/api/v1/people-ops/roles/${id}/section-access`, { sections }),
  administrators: () => api.get<{ items: AdministratorItem[] }>("/api/v1/people-ops/administrators"),
  createAdministrator: (body: { name: string; email: string; role: string }) => api.post<{ account: AdministratorItem; temporaryCredentials: AdministratorCredentials }>("/api/v1/people-ops/administrators", body)
};

