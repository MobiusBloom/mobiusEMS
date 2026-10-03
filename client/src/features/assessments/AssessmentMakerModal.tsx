import { useState } from "react";
import { AlertCircle, Bot, CheckCircle2, ChevronDown, ChevronUp, Plus, Trash2, X, Users, Clock, Award } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { skillApi, type AssessmentQuestion } from "@/features/skills/skillApi";
import type { EmployeeRow } from "@/features/organization/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface AssessmentMakerModalProps {
  isOpen: boolean;
  onClose: () => void;
  employees: EmployeeRow[];
  onCreated: () => void;
  employeeLoadError?: string;
}

export const AssessmentMakerModal = ({
  isOpen,
  onClose,
  employees,
  onCreated,
  employeeLoadError,
}: AssessmentMakerModalProps) => {
  const [title, setTitle] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [questionCount, setQuestionCount] = useState<number>(8);
  const [difficulty, setDifficulty] = useState<"BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "EXPERT">("INTERMEDIATE");
  const [timeLimitMinutes, setTimeLimitMinutes] = useState<number>(30);
  const [passingScore, setPassingScore] = useState<number>(70);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [candidateForm, setCandidateForm] = useState({ name: "", email: "", position: "", password: "" });
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password: string } | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [expandedQuestionIdx, setExpandedQuestionIdx] = useState<number | null>(0);
  const queryClient = useQueryClient();
  const candidatesQuery = useQuery({ queryKey: ["assessment-candidates"], queryFn: skillApi.assessmentCandidates, enabled: isOpen });
  const createCandidate = useMutation({
    mutationFn: () => skillApi.createAssessmentCandidate({ name: candidateForm.name, email: candidateForm.email, position: candidateForm.position || undefined, password: candidateForm.password || undefined }),
    onSuccess: async (data) => { setCreatedCredentials(data.temporaryCredentials); setSelectedCandidateIds((current) => [...current, data.candidate._id]); setCandidateForm({ name: "", email: "", position: "", password: "" }); await queryClient.invalidateQueries({ queryKey: ["assessment-candidates"] }); },
  });

  if (!isOpen) return null;

  const filteredEmployees = employees.filter((emp) => {
    const full = `${emp.firstName} ${emp.lastName} ${emp.employeeId} ${emp.department?.name || ""} ${emp.designation?.name || ""}`.toLowerCase();
    return full.includes(employeeSearch.toLowerCase());
  });

  const handleToggleEmployee = (id: string) => {
    setSelectedEmployeeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSelectAllFiltered = () => {
    const allFilteredIds = filteredEmployees.map((e) => e._id);
    const areAllSelected = allFilteredIds.every((id) => selectedEmployeeIds.includes(id));
    if (areAllSelected) {
      setSelectedEmployeeIds((prev) => prev.filter((id) => !allFilteredIds.includes(id)));
    } else {
      setSelectedEmployeeIds((prev) => Array.from(new Set([...prev, ...allFilteredIds])));
    }
  };

  const handleGenerateAi = async () => {
    if (!title.trim()) {
      setFeedback({ type: "error", text: "Please provide an assessment title or target role." });
      return;
    }

    try {
      setIsGenerating(true);
      setFeedback(null);
      const res = await skillApi.generateAssessment({
        title: title.trim(),
        jobDescription: jobDescription.trim() || undefined,
        questionCount: Math.max(1, Math.min(50, Number(questionCount) || 8)),
        difficulty,
      });

      setQuestions(res.questions);
      if (res.suggestedTimeMinutes) setTimeLimitMinutes(res.suggestedTimeMinutes);
      if (res.suggestedPassingScore) setPassingScore(res.suggestedPassingScore);
      setExpandedQuestionIdx(0);
      setFeedback({
        type: "success",
        text: `Successfully generated ${res.questions.length} questions tailored to your job description!`,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text: (err instanceof Error ? err.message : "") || "Failed to generate assessment questions with AI. Please try again.",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAddCustomQuestion = () => {
    const newQ: AssessmentQuestion = {
      id: `custom-q-${Date.now()}`,
      question: "New practical scenario or question prompt...",
      type: "MCQ",
      options: ["Option A", "Option B", "Option C", "Option D"],
      correctOptionIndex: 0,
      explanation: "Explain why this option is correct...",
      points: 10,
    };
    setQuestions((prev) => [...prev, newQ]);
    setExpandedQuestionIdx(questions.length);
  };

  const handleUpdateQuestion = (idx: number, patch: Partial<AssessmentQuestion>) => {
    setQuestions((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx]!, ...patch };
      return next;
    });
  };

  const handleUpdateOption = (qIdx: number, optIdx: number, val: string) => {
    setQuestions((prev) => {
      const next = [...prev];
      const opts = [...next[qIdx]!.options];
      opts[optIdx] = val;
      next[qIdx] = { ...next[qIdx]!, options: opts };
      return next;
    });
  };

  const handleDeleteQuestion = (idx: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== idx));
    if (expandedQuestionIdx === idx) setExpandedQuestionIdx(null);
  };

  const handleAssign = async () => {
    if (!title.trim()) {
      setFeedback({ type: "error", text: "Please specify an assessment title." });
      return;
    }
    if (selectedEmployeeIds.length === 0 && selectedCandidateIds.length === 0) {
      setFeedback({ type: "error", text: "Please select at least one employee or interview applicant." });
      return;
    }
    if (questions.length === 0) {
      setFeedback({ type: "error", text: "Please generate or add at least one question." });
      return;
    }

    try {
      setIsSubmitting(true);
      setFeedback(null);
      const totalPoints = questions.reduce((sum, q) => sum + (q.points || 10), 0);

      await skillApi.assignAssessment({
        name: title.trim(),
        jobDescription: jobDescription.trim() || undefined,
        difficulty,
        maximumScore: totalPoints,
        passingScore: passingScore,
        timeLimitMinutes,
        assignedEmployees: selectedEmployeeIds,
        assignedCandidates: selectedCandidateIds,
        questions,
      });

      onCreated();
      onClose();
    } catch (err) {
      setFeedback({
        type: "error",
        text: (err instanceof Error ? err.message : "") || "Failed to assign assessment. Please check inputs and try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-3xl border border-slate-200 bg-white shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md shadow-brand-500/20">
              <Bot size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-slate-900">AI Assessment Maker & Assignment</h2>
                <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                  AI Powered
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Generate practical assessments directly from Job Descriptions (JD) and assign them to any employee.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid size-9 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {feedback && (
            <div
              className={`flex items-center gap-3 rounded-2xl p-4 text-sm font-medium ${
                feedback.type === "success"
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border border-red-200 bg-red-50 text-red-800"
              }`}
            >
              {feedback.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
              <span>{feedback.text}</span>
            </div>
          )}

          {/* Configuration Grid */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* Left: JD & AI Prompt Setup */}
            <div className="space-y-4 lg:col-span-7">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Assessment Title / Role <span className="text-red-500">*</span>
                </label>
                <Input
                  className="mt-1.5 h-11"
                  placeholder="e.g. Senior Frontend Engineer / AI Architect"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Job Description (JD) / Requirements / Topics
                  </label>
                  <span className="text-[11px] text-slate-400">Optional but recommended</span>
                </div>
                <textarea
                  rows={4}
                  className="mt-1.5 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50/50 p-3.5 text-xs leading-5 text-slate-700 placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  placeholder="Paste job responsibilities, required tech stack, key delivery outcomes, or competencies to test..."
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                />
              </div>

              {/* Assessment Parameters */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Questions Count <span className="text-brand-600">*</span>
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    className="mt-1 h-10 font-semibold"
                    value={questionCount}
                    onChange={(e) => setQuestionCount(Number(e.target.value))}
                  />
                  <span className="mt-0.5 block text-[10px] text-slate-400">1 to 50 questions</span>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Difficulty
                  </label>
                  <select
                    className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 focus:border-brand-500 focus:outline-none"
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}
                  >
                    <option value="BEGINNER">Beginner</option>
                    <option value="INTERMEDIATE">Intermediate</option>
                    <option value="ADVANCED">Advanced</option>
                    <option value="EXPERT">Expert</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Time (Minutes)
                  </label>
                  <div className="relative mt-1">
                    <Input
                      type="number"
                      min={5}
                      max={240}
                      className="h-10 pr-7 font-semibold"
                      value={timeLimitMinutes}
                      onChange={(e) => setTimeLimitMinutes(Number(e.target.value))}
                    />
                    <Clock size={14} className="absolute right-2.5 top-3 text-slate-400" />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Passing Score (%)
                  </label>
                  <div className="relative mt-1">
                    <Input
                      type="number"
                      min={10}
                      max={100}
                      className="h-10 pr-7 font-semibold"
                      value={passingScore}
                      onChange={(e) => setPassingScore(Number(e.target.value))}
                    />
                    <Award size={14} className="absolute right-2.5 top-3 text-slate-400" />
                  </div>
                </div>
              </div>

              {/* Generate AI Button */}
              <div className="pt-2">
                <Button
                  type="button"
                  onClick={handleGenerateAi}
                  disabled={isGenerating || !title.trim()}
                  className="w-full bg-gradient-to-r from-brand-600 to-indigo-600 text-white shadow-md hover:from-brand-700 hover:to-indigo-700"
                >
                  <Bot size={16} className={isGenerating ? "animate-spin mr-1.5" : "mr-1.5"} />
                  {isGenerating
                    ? `Generating ${questionCount} Questions with AI...`
                    : `Generate ${questionCount} Questions with AI`}
                </Button>
              </div>
            </div>

            {/* Right: Employee Assignment Selector */}
            <div className="flex flex-col rounded-2xl border border-slate-200 bg-slate-50/60 p-4 lg:col-span-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-slate-600" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Assign To Employee(s)
                  </span>
                </div>
                <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold text-brand-700">
                  {selectedEmployeeIds.length} selected
                </span>
              </div>

              <div className="mt-3">
                <Input
                  className="h-9 bg-white text-xs"
                  placeholder="Search by name, ID, or designation..."
                  value={employeeSearch}
                  onChange={(e) => setEmployeeSearch(e.target.value)}
                />
              </div>

              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                <span>{filteredEmployees.length} employees available</span>
                <button
                  type="button"
                  onClick={handleSelectAllFiltered}
                  className="font-medium text-brand-600 hover:underline"
                >
                  {filteredEmployees.length > 0 &&
                  filteredEmployees.every((e) => selectedEmployeeIds.includes(e._id))
                    ? "Deselect all"
                    : "Select all filtered"}
                </button>
              </div>

              {/* Scrollable Employee List */}
              <div className="mt-2 flex-1 max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
                {employeeLoadError && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">Could not load employees: {employeeLoadError}</p>}
                {filteredEmployees.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-400">No matching employees found</p>
                ) : (
                  filteredEmployees.map((emp) => {
                    const isSelected = selectedEmployeeIds.includes(emp._id);
                    return (
                      <div
                        key={emp._id}
                        onClick={() => handleToggleEmployee(emp._id)}
                        className={`flex cursor-pointer items-center justify-between rounded-xl p-2.5 text-xs transition ${
                          isSelected
                            ? "border border-brand-300 bg-brand-50/60 text-brand-900"
                            : "border border-transparent hover:bg-slate-50 text-slate-700"
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <p className="font-semibold truncate">
                            {emp.firstName} {emp.lastName}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {emp.employeeId} · {emp.designation?.name || "No Designation"}
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="size-4 rounded text-brand-600 accent-brand-600"
                        />
                      </div>
                    );
                  })
                )}
              </div>

              <div className="mt-4 border-t pt-4">
                <div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wider text-slate-700">Interview applicants</p><span className="text-[10px] font-bold text-brand-700">{selectedCandidateIds.length} selected</span></div>
                <div className="mt-2 max-h-28 space-y-1 overflow-y-auto">
                  {candidatesQuery.data?.items.map((candidate) => <label key={candidate._id} className="flex cursor-pointer items-center justify-between rounded-lg bg-white p-2 text-xs"><span><strong>{candidate.name}</strong><span className="block text-[10px] text-slate-400">{candidate.email} · {candidate.position || "Applicant"}</span></span><input type="checkbox" checked={selectedCandidateIds.includes(candidate._id)} onChange={() => setSelectedCandidateIds((current) => current.includes(candidate._id) ? current.filter((id) => id !== candidate._id) : [...current, candidate._id])}/></label>)}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2"><Input className="h-8 text-xs" placeholder="Applicant name" value={candidateForm.name} onChange={(e) => setCandidateForm({ ...candidateForm, name: e.target.value })}/><Input className="h-8 text-xs" type="email" placeholder="Login email" value={candidateForm.email} onChange={(e) => setCandidateForm({ ...candidateForm, email: e.target.value })}/><Input className="h-8 text-xs" placeholder="Interview role" value={candidateForm.position} onChange={(e) => setCandidateForm({ ...candidateForm, position: e.target.value })}/><Input className="h-8 text-xs" type="password" placeholder="Password (auto if blank)" value={candidateForm.password} onChange={(e) => setCandidateForm({ ...candidateForm, password: e.target.value })}/></div>
                <Button type="button" variant="secondary" className="mt-2 h-8 w-full text-xs" disabled={!candidateForm.name.trim() || !candidateForm.email.trim() || createCandidate.isPending} onClick={() => createCandidate.mutate()}>{createCandidate.isPending ? "Creating login…" : "Create applicant login & select"}</Button>
                {createCandidate.error && <p className="mt-2 text-xs text-red-600">{createCandidate.error.message}</p>}
                {createdCredentials && <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900"><strong>Copy credentials now:</strong><br/>{createdCredentials.email}<br/>{createdCredentials.password}</div>}
              </div>
            </div>
          </div>

          {/* Generated Questions Section */}
          <div className="border-t border-slate-100 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-800">
                  Assessment Questions ({questions.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Total points: {questions.reduce((sum, q) => sum + (q.points || 10), 0)} pts · Passing: {passingScore}%
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={handleAddCustomQuestion}
                className="h-8 px-3 text-xs gap-1.5"
              >
                <Plus size={14} /> Add Question
              </Button>
            </div>

            {questions.length === 0 ? (
              <div className="mt-4 grid min-h-40 place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center">
                <div>
                  <Bot size={28} className="mx-auto text-slate-300 mb-2" />
                  <p className="text-xs font-semibold text-slate-600">No questions generated yet</p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Click &ldquo;Generate Questions with AI&rdquo; above or &ldquo;Add Question&rdquo; to build your assessment.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {questions.map((q, qIdx) => {
                  const isExpanded = expandedQuestionIdx === qIdx;
                  return (
                    <div
                      key={q.id || qIdx}
                      className="overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:border-slate-300"
                    >
                      <div
                        onClick={() => setExpandedQuestionIdx(isExpanded ? null : qIdx)}
                        className="flex cursor-pointer items-center justify-between p-4"
                      >
                        <div className="flex items-center gap-3 min-w-0 pr-4">
                          <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-brand-50 text-xs font-bold text-brand-700">
                            {qIdx + 1}
                          </span>
                          <span className="font-semibold text-xs text-slate-800 truncate">
                            {q.question}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                            {q.points || 10} pts
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteQuestion(qIdx);
                            }}
                            className="text-slate-400 hover:text-red-600 transition"
                          >
                            <Trash2 size={15} />
                          </button>
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-slate-100 bg-slate-50/40 p-4 space-y-4">
                          <div>
                            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                              Question Text
                            </label>
                            <textarea
                              rows={2}
                              className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-800"
                              value={q.question}
                              onChange={(e) => handleUpdateQuestion(qIdx, { question: e.target.value })}
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                              Options (Select the correct answer)
                            </label>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {q.options.map((opt, optIdx) => {
                                const isCorrect = (q.correctOptionIndex ?? 0) === optIdx;
                                return (
                                  <div
                                    key={optIdx}
                                    className={`flex items-center gap-2 rounded-xl border p-2 text-xs transition ${
                                      isCorrect
                                        ? "border-emerald-300 bg-emerald-50/60"
                                        : "border-slate-200 bg-white"
                                    }`}
                                  >
                                    <input
                                      type="radio"
                                      name={`correct-${qIdx}`}
                                      checked={isCorrect}
                                      onChange={() =>
                                        handleUpdateQuestion(qIdx, { correctOptionIndex: optIdx })
                                      }
                                      className="size-4 text-emerald-600 accent-emerald-600"
                                    />
                                    <span className="font-bold text-slate-400">
                                      {String.fromCharCode(65 + optIdx)}:
                                    </span>
                                    <input
                                      type="text"
                                      className="flex-1 bg-transparent text-xs text-slate-800 focus:outline-none"
                                      value={opt}
                                      onChange={(e) => handleUpdateOption(qIdx, optIdx, e.target.value)}
                                    />
                                    {isCorrect && (
                                      <span className="text-[10px] font-bold text-emerald-700 shrink-0">
                                        Correct
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                              Concept Explanation (Shown after completion)
                            </label>
                            <input
                              type="text"
                              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"
                              value={q.explanation || ""}
                              onChange={(e) =>
                                handleUpdateQuestion(qIdx, { explanation: e.target.value })
                              }
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-6 py-4 rounded-b-3xl">
          <div className="text-xs text-slate-500">
            {selectedEmployeeIds.length + selectedCandidateIds.length > 0 ? (
              <span>
                Assigning to <strong className="text-slate-800">{selectedEmployeeIds.length + selectedCandidateIds.length}</strong>{" "}
                person(s) with <strong className="text-slate-800">{questions.length}</strong> questions
              </span>
            ) : (
              <span className="text-amber-600">Select an employee or interview applicant</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              onClick={handleAssign}
              disabled={
                isSubmitting ||
                selectedEmployeeIds.length + selectedCandidateIds.length === 0 ||
                questions.length === 0 ||
                !title.trim()
              }
              className="bg-brand-600 hover:bg-brand-700 text-white shadow-md shadow-brand-600/20"
            >
              {isSubmitting ? "Assigning..." : `Assign Assessment (${selectedEmployeeIds.length + selectedCandidateIds.length})`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
