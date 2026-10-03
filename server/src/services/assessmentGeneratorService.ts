import { complete } from "./llmService.js";
import { AppError } from "../utils/AppError.js";
import type { AssessmentDifficulty, AssessmentQuestion } from "../models/Assessment.js";

export interface GenerateAssessmentInput {
  title: string;
  jobDescription?: string;
  skillName?: string;
  questionCount?: number;
  difficulty?: AssessmentDifficulty;
}

const parseJson = (text: string): unknown => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    throw new AppError("Failed to parse AI assessment questions. Please try again.", 502, "AI_INVALID_RESPONSE");
  }
};

const generateFallbackAssessmentQuestions = (input: GenerateAssessmentInput, count: number): AssessmentQuestion[] => {
  const title = input.title?.trim() || "Workforce Competency";
  const skill = input.skillName?.trim() || title;
  const jd = input.jobDescription?.toLowerCase() || "";

  // Dynamic template questions adapting to title and JD
  const questionBank = [
    {
      q: `When designing or evaluating deliverables for ${title}, which principle is most critical for maintaining high reliability and scalability?`,
      options: [
        "Applying strict separation of concerns, defensive validation, and modular architecture",
        "Coupling all modules tightly into a single monolithic script for execution speed",
        "Skipping automated testing cycles in favor of manual end-user verification",
        "Hardcoding configuration parameters directly into source files for convenience"
      ],
      correct: 0,
      explanation: "Separation of concerns and modularity allow independent scaling, comprehensive unit testing, and maintainability across the system lifecycle."
    },
    {
      q: `In a production environment for ${skill}, how should unexpected exceptions and system errors be handled to prevent cascading outages?`,
      options: [
        "Ignore the error and let the process crash silently without notifications",
        "Implement structured logging, graceful degradation, circuit breakers, and alerts",
        "Restart the entire cluster manually whenever a customer reports an issue",
        "Expose internal stack traces directly to end users in API response payloads"
      ],
      correct: 1,
      explanation: "Circuit breakers, graceful error handling, and structured telemetry preserve system stability and alert engineers immediately."
    },
    {
      q: `Which metric is best suited to evaluate the operational throughput and delivery health of a ${title} workflow?`,
      options: [
        "Raw line count of written documentation and uncommitted files",
        "Cycle time, mean time to resolution (MTTR), and defect escape rate",
        "The number of daily meetings attended by cross-functional stakeholders",
        "Subjective team sentiment without reviewing concrete deliverable milestones"
      ],
      correct: 1,
      explanation: "Cycle time and MTTR are industry-standard metrics that measure execution efficiency, responsiveness, and release quality."
    },
    {
      q: `When collaborating with cross-functional stakeholders on a complex deliverable in ${title}, what is the most effective approach to handle competing priorities?`,
      options: [
        "Deliver only the easiest tasks and postpone high-impact dependencies indefinitely",
        "Align on quantifiable business value, document trade-offs, and establish clear acceptance criteria",
        "Refuse to commit to any deadlines until all ambiguity is 100% resolved",
        "Implement requests in random chronological order regardless of severity"
      ],
      correct: 1,
      explanation: "Value-based prioritization and transparent alignment ensure high-impact company objectives are prioritized effectively."
    },
    {
      q: `Which practice is most effective to ensure security, data integrity, and compliance in ${title} operations?`,
      options: [
        "Principle of least privilege, input sanitization, and automated audit logging",
        "Granting all team members universal root access to avoid permission requests",
        "Storing credential secrets in plain text within public repository branches",
        "Disabling encryption in transit to minimize network latency"
      ],
      correct: 0,
      explanation: "Least privilege access control and audit logging protect tenant boundaries and sensitive company data against misuse."
    },
    {
      q: `In ${title} role execution, what is the best strategy when refactoring legacy processes or codebase components?`,
      options: [
        "Rewrite the entire system from scratch in one batch without backward compatibility",
        "Establish comprehensive automated test coverage first, then refactor incrementally",
        "Change variable names without testing to make code look more modern",
        "Delete legacy error handlers to reduce overall code volume"
      ],
      correct: 1,
      explanation: "Creating regression test baselines before incremental refactoring prevents breaking existing features in production."
    },
    {
      q: `How should performance bottlenecks be diagnosed systematically in ${title} workflows?`,
      options: [
        "Profile with APM telemetry and metrics to locate actual hotspots before optimizing",
        "Guess the slow component and rewrite it based on personal intuition",
        "Upgrade hardware resources immediately without investigating root causes",
        "Disable database indexing to save background compute cycles"
      ],
      correct: 0,
      explanation: "Profiling and telemetry provide empirical evidence of bottlenecks, avoiding wasteful speculative micro-optimizations."
    },
    {
      q: `What is the recommended approach for continuous delivery and version management in ${title}?`,
      options: [
        "Deploy unreviewed changes directly to production on Friday evenings",
        "Automated CI/CD pipelines with linting, unit tests, and canary or blue-green releases",
        "Manual file copy over FTP without version control tracking",
        "Bypassing peer code reviews for all urgent stakeholder requests"
      ],
      correct: 1,
      explanation: "Automated CI/CD pipelines enforce quality gates and rollback safety, ensuring reliable production releases."
    }
  ];

  // If JD contains specific keywords, enhance questions
  if (jd.includes("react") || jd.includes("frontend") || jd.includes("ui")) {
    questionBank.unshift({
      q: "In modern React component architecture, which pattern prevents unnecessary child re-renders when passing callbacks?",
      options: [
        "Wrapping the callback with useCallback and passing stable dependencies",
        "Instantiating new inline arrow functions inside every JSX attribute",
        "Using componentWillMount to force synchronous DOM updates",
        "Storing all local button state in global window variables"
      ],
      correct: 0,
      explanation: "useCallback memoizes callback functions so child components wrapped with React.memo do not re-render unnecessarily."
    });
  }

  if (jd.includes("node") || jd.includes("backend") || jd.includes("api") || jd.includes("database")) {
    questionBank.unshift({
      q: "In high-concurrency Node.js / database backend services, which technique best prevents database connection pool exhaustion?",
      options: [
        "Reusing connection pools, setting max pool sizes, and closing idle connections properly",
        "Opening a brand new MongoDB/Postgres connection on every incoming HTTP request",
        "Disabling keep-alive and increasing request timeouts to 10 minutes",
        "Running all database operations synchronously using blocking thread locks"
      ],
      correct: 0,
      explanation: "Shared connection pooling prevents connection saturation, socket leaks, and database crashes under heavy load."
    });
  }

  const questions: AssessmentQuestion[] = [];
  for (let i = 0; i < count; i++) {
    const template = questionBank[i % questionBank.length]!;
    const suffix = i >= questionBank.length ? ` (Scenario ${Math.floor(i / questionBank.length) + 1})` : "";
    questions.push({
      id: `q-${Date.now()}-${i + 1}`,
      question: `${template.q}${suffix}`,
      type: "MCQ",
      options: [...template.options],
      correctOptionIndex: template.correct,
      explanation: template.explanation,
      points: 10
    });
  }

  return questions;
};

export const generateAssessmentQuestions = async (input: GenerateAssessmentInput): Promise<{
  questions: AssessmentQuestion[];
  suggestedTimeMinutes: number;
  suggestedPassingScore: number;
}> => {
  const title = input.title?.trim();
  if (!title) {
    throw new AppError("Assessment title or role is required to generate questions", 400, "MISSING_TITLE");
  }

  const rawCount = typeof input.questionCount === "number" && !isNaN(input.questionCount)
    ? input.questionCount
    : 10;
  const count = Math.max(1, Math.min(50, rawCount));
  const difficulty = input.difficulty || "INTERMEDIATE";

  const system = `You are an expert technical interviewer, talent assessment specialist, and competency architect.
Your job is to generate a realistic, high-quality, professional assessment with Multiple Choice Questions (MCQs) strictly tailored to the provided Job Description (JD) and role title.

Guidelines:
1. Every question must be directly grounded in the skills, responsibilities, tools, and technical competencies required by the JD and title.
2. Formulate practical workplace scenarios, architectural trade-offs, diagnostic questions, and problem-solving challenges rather than trivial trivia.
3. Every question must have exactly 4 plausible options (A, B, C, D). Only ONE option should be unambiguously correct; the other three must be realistic distractors.
4. Provide the 0-indexed 'correctOptionIndex' (0, 1, 2, or 3).
5. Provide a 1-2 sentence 'explanation' detailing WHY the correct option is the best practice and why distractors fall short.
6. Set 'points' to 10 for each question.
7. Return ONLY a valid JSON array of objects. Do NOT include markdown code blocks, backticks, commentary, or extra text.`;

  const user = `Role / Assessment Title: ${title}
Difficulty Level: ${difficulty}
Target Skill / Domain: ${input.skillName || title}
Job Description (JD) / Key Requirements:
${input.jobDescription?.trim() || `Key professional responsibilities, execution standards, and domain skills expected of a competent ${title}.`}

Generate exactly ${count} Multiple Choice Questions (MCQs) in JSON array format:
[
  {
    "id": "q-1",
    "question": "Question statement...",
    "type": "MCQ",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctOptionIndex": 0,
    "explanation": "Clear explanation of the correct answer...",
    "points": 10
  }
]`;

  try {
    const maxTokens = Math.max(2000, Math.min(8000, count * 260));
    const result = await complete({
      system,
      user,
      temperature: 0.2,
      maxTokens
    });

    const parsed = parseJson(result.text);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("Invalid output array");
    }

    const questions: AssessmentQuestion[] = parsed.slice(0, count).map((item: Record<string, unknown>, index: number) => {
      const options = Array.isArray(item.options) ? item.options.map(String) : ["Option A", "Option B", "Option C", "Option D"];
      while (options.length < 4) options.push(`Option ${String.fromCharCode(65 + options.length)}`);
      const correctOptionIndex = typeof item.correctOptionIndex === "number" && item.correctOptionIndex >= 0 && item.correctOptionIndex < options.length
        ? item.correctOptionIndex
        : 0;

      return {
        id: item.id ? String(item.id) : `q-${Date.now()}-${index + 1}`,
        question: String(item.question || `Question ${index + 1} on ${title}`),
        type: "MCQ",
        options: options.slice(0, 4),
        correctOptionIndex,
        explanation: String(item.explanation || "Valid industry best practice."),
        points: Number(item.points) > 0 ? Number(item.points) : 10
      };
    });

    // If AI generated fewer than count, fill with fallbacks
    if (questions.length < count) {
      const fallbacks = generateFallbackAssessmentQuestions(input, count);
      for (let i = questions.length; i < count; i++) {
        questions.push(fallbacks[i]!);
      }
    }

    const suggestedTimeMinutes = Math.max(10, Math.min(180, Math.round(count * 2.5)));
    const suggestedPassingScore = 70; // 70% standard passing score

    return {
      questions,
      suggestedTimeMinutes,
      suggestedPassingScore
    };
  } catch {
    // If AI completion failed or timed out, use fallback questions
    const questions = generateFallbackAssessmentQuestions(input, count);
    const suggestedTimeMinutes = Math.max(10, Math.min(180, Math.round(count * 2.5)));
    const suggestedPassingScore = 70;

    return {
      questions,
      suggestedTimeMinutes,
      suggestedPassingScore
    };
  }
};
