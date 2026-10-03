import { complete } from "./llmService.js";
import { AppError } from "../utils/AppError.js";
import type { DesignationSkillItem } from "../models/Designation.js";

export interface GenerateSkillsInput {
  designationTitle: string;
  department?: string;
  level?: string;
  jobDescription?: string;
  skillCount?: number;
}

const parseJson = (text: string): unknown => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    throw new AppError("Failed to parse AI skills output. Please try again.", 502, "AI_INVALID_RESPONSE");
  }
};

const normalizeLevel = (val: unknown): "Basic" | "Intermediate" | "Advanced" => {
  const str = String(val ?? "").toLowerCase();
  if (str.includes("adv") || str.includes("expert") || str.includes("senior") || str.includes("lead")) return "Advanced";
  if (str.includes("inter") || str.includes("mid")) return "Intermediate";
  return "Basic";
};

const formatTools = (tools: unknown): string => {
  if (Array.isArray(tools)) return tools.map(String).join(", ");
  if (typeof tools === "string") return tools.trim();
  return "";
};

const generateFallbackSkills = (input: GenerateSkillsInput, count: number): DesignationSkillItem[] => {
  const title = input.designationTitle.trim();
  const dept = input.department?.trim() || "Professional";
  const baseTopics = [
    { name: `${title} Core Execution`, category: dept, level: "Basic" as const, tools: "Standard Workplace Tools", desc: `Apply fundamentals and standard operational procedures for ${title}.`, q: `Describe a recent project where you demonstrated core ${title} competencies.` },
    { name: "Workflow Optimization", category: "Operations", level: "Basic" as const, tools: "Spreadsheets, Documentation, Task Trackers", desc: `Organize, prioritize, and track day-to-day deliverables with minimal oversight.`, q: `How do you prioritize competing deadlines and ensure zero defect delivery?` },
    { name: "Technical Quality & Compliance", category: "Technical", level: "Intermediate" as const, tools: "Quality Checklists, Monitoring, SOPs", desc: `Maintain high quality standards, peer review, and compliance in ${dept} deliverables.`, q: `Share an instance where you identified a defect or discrepancy and resolved it before release.` },
    { name: "Cross-Functional Collaboration", category: "Communication", level: "Intermediate" as const, tools: "Slack, Microsoft Teams, Jira", desc: `Coordinate with upstream and downstream stakeholders to unblock dependencies.`, q: `How have you resolved an inter-departmental blocker to deliver a key business outcome?` },
    { name: "Strategic Problem Solving", category: "Strategy", level: "Advanced" as const, tools: "Root Cause Analysis, Analytics Dashboards", desc: `Diagnose complex root causes and design sustainable, scalable solutions.`, q: `Walk through a difficult technical or business challenge you diagnosed and resolved systematically.` },
    { name: "Mentorship & Knowledge Sharing", category: "Leadership", level: "Advanced" as const, tools: "Internal Wikis, Knowledge Bases", desc: `Guide team members, conduct coaching, and author internal documentation.`, q: `Provide an example where your documentation or mentoring directly improved team performance.` }
  ];

  const skills: DesignationSkillItem[] = [];
  for (let i = 0; i < count; i++) {
    const topic = baseTopics[i % baseTopics.length]!;
    const suffix = i >= baseTopics.length ? ` (Part ${Math.floor(i / baseTopics.length) + 1})` : "";
    skills.push({
      id: `skill-${Date.now()}-${i + 1}`,
      name: `${topic.name}${suffix}`,
      category: topic.category,
      level: topic.level,
      tools: topic.tools,
      description: topic.desc,
      assessmentQuestion: topic.q
    });
  }
  return skills;
};

export const generateDesignationSkills = async (input: GenerateSkillsInput): Promise<DesignationSkillItem[]> => {
  const title = input.designationTitle?.trim();
  if (!title) {
    throw new AppError("Designation title is required to generate skills", 400, "MISSING_DESIGNATION_TITLE");
  }

  const count = Math.max(1, Math.min(50, Number(input.skillCount) || 8));

  const system = `You are an expert workforce competency architect and HR assessment specialist.
Generate a structured, rigorous list of core skills and competency assessments tailored to the specified job designation and job description (JD).
Ensure the skills are balanced across proficiency levels (Basic, Intermediate, Advanced) and functional categories.
Each skill must have:
- name: concise, specific skill or competency title (e.g., "Distributed Cloud Architecture", "Outbound B2B Pipeline Generation")
- category: functional domain (e.g., "Technical", "Operations", "Leadership", "Architecture", "Analytics")
- level: exactly "Basic", "Intermediate", or "Advanced"
- tools: comma-separated list of relevant modern industry tools and technologies
- description: 1-2 sentence standard defining what mastery entails in day-to-day work
- assessmentQuestion: practical workplace assessment question for the employee to demonstrate real proof/evidence of this skill

Return ONLY a valid JSON array of skill objects. Do NOT include markdown code blocks, backticks, or any additional text.`;

  const user = `Designation: ${title}
Department: ${input.department || "General"}
Level: ${input.level || "Professional"}
Job Description (JD) / Responsibilities:
${input.jobDescription?.trim() || `Core responsibilities, delivery standards, and technical/operational duties expected of a high-performing ${title}.`}

Generate exactly ${count} skills with practical assessment questions.`;

  try {
    const maxTokens = Math.max(2000, Math.min(6000, count * 220));
    const result = await complete({
      system,
      user,
      temperature: 0.2,
      maxTokens
    });

    const parsed = parseJson(result.text);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("AI did not return an array of skills");
    }

    const skills: DesignationSkillItem[] = parsed.slice(0, count).map((item: Record<string, unknown>, idx: number) => {
      const name = String(item.name || `Skill ${idx + 1}`).trim();
      const category = String(item.category || input.department || "General").trim();
      const level = normalizeLevel(item.level);
      const tools = formatTools(item.tools);
      const description = String(item.description || `Apply ${name} effectively in ${title} responsibilities.`).trim();
      const assessmentQuestion = String(item.assessmentQuestion || `Describe a real work situation where you demonstrated ${name} as a ${title}. What actions did you take and what was the outcome?`).trim();

      return {
        id: `skill-${Date.now()}-${idx + 1}-${Math.random().toString(36).substring(2, 6)}`,
        name,
        category,
        level,
        tools,
        description,
        assessmentQuestion
      };
    });

    return skills;
  } catch (err) {
    console.warn("AI skill generation error, using fallback skill builder generator:", err);
    return generateFallbackSkills(input, count);
  }
};
