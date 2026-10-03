import { api } from "@/api/client";
export interface Skill { _id: string; name: string; category: string; description?: string }
export interface SkillClaim { _id: string; skill: Skill; employee?: { _id: string; firstName: string; lastName: string; employeeId: string }; selfRating: number; verifiedRating?: number; yearsOfExperience: number; verificationStatus: string; evidence: { type: string; url?: string; comment?: string }[] }
export interface AssessmentQuestion {
  id: string;
  question: string;
  type: "MCQ" | "OPEN";
  options: string[];
  correctOptionIndex?: number;
  explanation?: string;
  points: number;
}

export interface AssessmentAnswer {
  questionId: string;
  selectedOption?: number;
  textAnswer?: string;
  isCorrect?: boolean;
  earnedPoints?: number;
}

export interface Assessment {
  _id: string;
  name: string;
  skill?: Skill;
  skillName?: string;
  jobDescription?: string;
  difficulty: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "EXPERT";
  maximumScore: number;
  passingScore: number;
  timeLimitMinutes: number;
  assignedEmployee?: {
    user?: string | { _id: string };
    _id: string;
    firstName: string;
    lastName: string;
    employeeId: string;
    department?: { name: string };
    designation?: { name: string };
  };
  assignedCandidate?: { _id: string; name: string; email: string; position?: string; user?: string };
  assignedBy?: { _id: string; name: string };
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  questions?: AssessmentQuestion[];
  answers?: AssessmentAnswer[];
  score?: number;
  percentage?: number;
  result?: "PENDING" | "PASSED" | "FAILED";
  startedAt?: string;
  focusLossCount?: number;
  completedAt?: string;
  timedOut?: boolean;
  attemptDate?: string;
  createdAt: string;
}

export interface GenerateAssessmentInput {
  title: string;
  jobDescription?: string;
  skillName?: string;
  questionCount?: number;
  difficulty?: string;
}

export interface GenerateAssessmentResponse {
  questions: AssessmentQuestion[];
  suggestedTimeMinutes: number;
  suggestedPassingScore: number;
}

export interface AssignAssessmentInput {
  name: string;
  skill?: string;
  skillName?: string;
  jobDescription?: string;
  difficulty: string;
  maximumScore?: number;
  passingScore?: number;
  timeLimitMinutes?: number;
  assignedEmployee?: string;
  assignedEmployees?: string[];
  assignedCandidates?: string[];
  questions?: AssessmentQuestion[];
}

export interface SubmitAssessmentInput {
  answers: {
    questionId: string;
    selectedOption?: number;
    textAnswer?: string;
  }[];
}

export interface CatalogSkill { id: string; role?: string; level: string; category: string; name: string; tools?: string; description: string; assessmentQuestion?: string }
export interface RoleSkillScore extends Omit<CatalogSkill, "id" | "role"> {
  skillId: string;
  rating: number;
  implementationNote: string;
  demonstratedRating?: number;
  velocityRatio?: number;
  credibilityStatus?: "EXCEEDED" | "JUSTIFIED" | "GAP_DETECTED" | "UNTESTED";
  tasksEvaluatedCount?: number;
}
export interface SkillEvidenceAnalytics {
  skillId: string;
  status: "EXCEEDED" | "JUSTIFIED" | "GAP_DETECTED" | "UNTESTED" | "IN_PROGRESS" | "NEEDS_EVIDENCE";
  credibilityStatus?: "EXCEEDED" | "JUSTIFIED" | "GAP_DETECTED" | "UNTESTED";
  demonstratedRating?: number;
  velocityRatio?: number;
  justificationScore: number;
  matchedTasks: number;
  completedTasks: number;
  onTimeRate: number;
  averageQuality: number | null;
  message: string;
  tasks: { id: string; taskId: string; name: string; status: string; estimatedHours?: number; actualHours?: number; onTime: boolean; qualityRating?: number; overdue: boolean }[];
}
export interface RoleSkillAssessment {
  _id: string;
  role: string;
  designation?: string;
  scores: RoleSkillScore[];
  averageRating: number;
  demonstratedAverage?: number;
  overallCredibilityScore?: number;
  departmentRank?: number;
  companyRank?: number;
  submittedAt: string;
  evidenceAnalytics?: SkillEvidenceAnalytics[];
}

export interface SubmittedSkillInfo {
  skillId: string;
  name: string;
  category: string;
  selfRating: number;
  verifiedRating?: number;
  yearsOfExperience?: number;
  verificationStatus: string;
  description?: string;
  evidence?: { type: string; url?: string }[];
}

export interface RoleSkillSubmissionItem {
  employee: {
    _id: string;
    firstName: string;
    lastName: string;
    employeeId: string;
    department?: { _id: string; name: string; code: string };
    designation?: { _id: string; name: string; code: string };
    profilePhotoKey?: string;
  };
  isSubmitted: boolean;
  submissionType?: "ROLE_ASSESSMENT" | "SKILL_CLAIMS" | "ASSESSMENT_TEST";
  assessmentId?: string;
  claimedAverage: number | null;
  demonstratedAverage: number | null;
  overallCredibilityScore: number | null;
  companyRank: number | null;
  departmentRank: number | null;
  submittedAt: string | null;
  skillsCount: number;
  realityGapsCount: number;
  masteryCount: number;
  averageVelocity?: number;
  scores: {
    skillId: string;
    name: string;
    category: string;
    level: string;
    rating: number;
    demonstratedRating?: number;
    velocityRatio?: number;
    credibilityStatus?: "EXCEEDED" | "JUSTIFIED" | "GAP_DETECTED" | "UNTESTED";
    tasksEvaluatedCount?: number;
    implementationNote?: string;
  }[];
}

export interface RoleSkillSubmissionsResponse {
  items: RoleSkillSubmissionItem[];
  stats: {
    totalEmployees: number;
    submittedCount: number;
    pendingCount: number;
    totalRealityGaps: number;
    totalMastery: number;
    averageCredibility: number;
  };
}

export interface RoleAssessmentData {
  assignedRole?: string;
  catalog: CatalogSkill[];
  assessment: RoleSkillAssessment | null;
  designation: { name: string; code: string };
  employee?: RoleSkillSubmissionItem["employee"];
  pendingConfiguration?: boolean;
  submittedSkills?: SubmittedSkillInfo[];
  submissionSource?: "ROLE_ASSESSMENT" | "SKILL_CLAIMS" | "ASSESSMENT_TEST" | null;
}

export const skillApi = {
  list: () => api.get<{ items: Skill[] }>("/api/v1/skills"),
  create: (body: { name: string; category: string; description?: string }) => api.post("/api/v1/skills", body),
  mine: () => api.get<{ items: SkillClaim[]; gap: { roleMatch: number; items: { skill: string; required: number; actual: number; gap: number; isCritical: boolean }[] } }>("/api/v1/skills/mine"),
  claim: (body: { skill: string; selfRating: number; yearsOfExperience: number; description?: string; evidence: { type: string; url?: string }[] }) => api.post("/api/v1/skills/mine", body),
  roleAssessment: () => api.get<RoleAssessmentData>("/api/v1/skills/role-assessment"),
  submitRoleAssessment: (body: { ratings: { skillId: string; rating: number; implementationNote: string }[] }) => api.post<{ assessment: RoleSkillAssessment }>("/api/v1/skills/role-assessment", body),
  submissions: () => api.get<RoleSkillSubmissionsResponse>("/api/v1/skills/submissions"),
  getEmployeeRoleAssessment: (employeeId: string) => api.get<RoleAssessmentData>(`/api/v1/skills/role-assessment/employee/${employeeId}`),
  adminSubmitRoleAssessment: (employeeId: string, body: { ratings: { skillId: string; rating: number; implementationNote?: string }[] }) =>
    api.post<{ assessment: RoleSkillAssessment }>(`/api/v1/skills/role-assessment/employee/${employeeId}`, body),
  leaderboard: (limit = 20) => api.get<{ items: import("@mobius-ems/shared").EmployeeSkillRank[] }>(`/api/v1/skills/leaderboard?limit=${limit}`),
  pending: () => api.get<{ items: SkillClaim[] }>("/api/v1/skills/verifications/pending"),
  verify: (id: string, body: { status: string; verifiedRating?: number; method: string; justification: string }) => api.patch(`/api/v1/skills/verifications/${id}`, body),
  heatmap: () => api.get<{ items: SkillClaim[] }>("/api/v1/skills/heatmap"),
  spof: () => api.get<{ items: import("@mobius-ems/shared").SPOFItem[] }>("/api/v1/skills/spof"),
  assessments: () => api.get<{ items: Assessment[] }>("/api/v1/skills/assessments"),
  assessmentCandidates: () => api.get<{ items: AssessmentCandidate[] }>("/api/v1/skills/assessment-candidates"),
  createAssessmentCandidate: (body: { name: string; email: string; position?: string; password?: string }) => api.post<{ candidate: AssessmentCandidate; temporaryCredentials: { email: string; password: string } }>("/api/v1/skills/assessment-candidates", body),
  generateAssessment: (body: GenerateAssessmentInput) => api.post<GenerateAssessmentResponse>("/api/v1/skills/assessments/generate", body),
  getAssessment: (id: string) => api.get<{ item: Assessment }>(`/api/v1/skills/assessments/${id}`),
  assignAssessment: (body: AssignAssessmentInput) => api.post("/api/v1/skills/assessments", body),
  startAssessment: (id: string) => api.post<{ item: Assessment }>(`/api/v1/skills/assessments/${id}/start`, {}),
  recordAssessmentFocusLoss: (id: string) => api.post<{ count: number }>(`/api/v1/skills/assessments/${id}/focus-loss`, {}),
  submitAssessment: (id: string, body: SubmitAssessmentInput) => api.post<{ item: Assessment }>(`/api/v1/skills/assessments/${id}/submit`, body),
  deleteAssessment: (id: string) => api.delete<{ message: string }>(`/api/v1/skills/assessments/${id}`),
  recordResult: (id: string, body: unknown) => api.patch(`/api/v1/skills/assessments/${id}/result`, body)
};
export interface AssessmentCandidate { _id: string; name: string; email: string; position?: string }
