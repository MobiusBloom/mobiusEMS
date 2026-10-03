import { useEffect, useState } from "react";
import { Award, Bot, Download, Plus, Trash2, X, Building2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { organizationApi } from "./organizationApi";
import type { DesignationSkillItem, NamedEntity } from "./types";

interface DesignationSkillsModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetDesignation?: NamedEntity | null;
  allDesignations?: NamedEntity[];
  catalogRoles?: { role: string; skillCount: number }[];
  onSaved?: () => void;
  initialShowAi?: boolean;
}

export const DesignationSkillsModal = ({
  isOpen,
  onClose,
  targetDesignation,
  allDesignations = [],
  catalogRoles = [],
  onSaved,
  initialShowAi = true,
}: DesignationSkillsModalProps) => {
  const [selectedId, setSelectedId] = useState<string>(targetDesignation?._id || "");
  const [targetSkills, setTargetSkills] = useState<DesignationSkillItem[]>([]);
  const [selectedTemplateRole, setSelectedTemplateRole] = useState<string>("");
  const [showAiBuilder, setShowAiBuilder] = useState(initialShowAi);
  const [aiJd, setAiJd] = useState("");
  const [aiLevel, setAiLevel] = useState("Senior");
  const [aiSkillCount, setAiSkillCount] = useState<number>(8);
  const [aiAppendMode, setAiAppendMode] = useState<boolean>(false);
  const [isGeneratingAi, setIsGeneratingAi] = useState<boolean>(false);
  const [isLoadingTemplate, setIsLoadingTemplate] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [aiFeedback, setAiFeedback] = useState<string | null>(null);

  // Derive active designation
  const activeDesignation = selectedId
    ? allDesignations.find((d) => d._id === selectedId) || targetDesignation
    : targetDesignation;

  // Sync state when target or designations change
  useEffect(() => {
    if (targetDesignation) {
      setSelectedId(targetDesignation._id);
      setTargetSkills(targetDesignation.customSkills || []);
      setSelectedTemplateRole(targetDesignation.catalogRole || "");
      setShowAiBuilder(initialShowAi || !targetDesignation.customSkills?.length);
    }
  }, [targetDesignation, initialShowAi]);

  useEffect(() => {
    if (!targetDesignation && allDesignations.length > 0 && !selectedId) {
      const first = allDesignations[0];
      setSelectedId(first._id);
      setTargetSkills(first.customSkills || []);
      setSelectedTemplateRole(first.catalogRole || "");
      setShowAiBuilder(initialShowAi || !first.customSkills?.length);
    }
  }, [targetDesignation, allDesignations, initialShowAi, selectedId]);

  const handleSelectDesignation = (id: string) => {
    setSelectedId(id);
    const found = allDesignations.find((d) => d._id === id);
    if (found) {
      setTargetSkills(found.customSkills || []);
      setSelectedTemplateRole(found.catalogRole || "");
      setShowAiBuilder(!found.customSkills?.length);
    }
    setAiFeedback(null);
  };

  const handleGenerateSkillsWithAi = async () => {
    if (!activeDesignation) {
      setAiFeedback("Please select a designation first.");
      return;
    }
    try {
      setIsGeneratingAi(true);
      setAiFeedback(null);
      const requestedCount = Math.max(1, Math.min(50, Number(aiSkillCount) || 8));
      const res = await organizationApi.generateSkillsWithAi({
        designationTitle: activeDesignation.name,
        department: activeDesignation.department?.name,
        level: aiLevel,
        jobDescription: aiJd.trim() || undefined,
        skillCount: requestedCount,
      });

      const generated: DesignationSkillItem[] = (res.skills || []).map((s) => ({
        id: s.id || `skill-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        name: s.name,
        category: s.category || "Technical",
        level: s.level || "Intermediate",
        tools: s.tools || "",
        description: s.description || "",
        assessmentQuestion: s.assessmentQuestion || "",
      }));

      if (aiAppendMode) {
        setTargetSkills((prev) => [...prev, ...generated]);
        setAiFeedback(`Added ${generated.length} AI-generated skills to ${activeDesignation.name}!`);
      } else {
        setTargetSkills(generated);
        setAiFeedback(`Generated ${generated.length} skills tailored for ${activeDesignation.name}!`);
      }
      setShowAiBuilder(false);
    } catch (err) {
      setAiFeedback((err instanceof Error ? err.message : "") || "Failed to generate skills. Please try again.");
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const handleAddCustomSkill = () => {
    const newSkill: DesignationSkillItem = {
      id: `skill-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: "",
      category: "Technical",
      level: "Basic",
      tools: "",
      description: "",
      assessmentQuestion: "",
    };
    setTargetSkills((prev) => [...prev, newSkill]);
  };

  const handleSkillChange = (index: number, field: keyof DesignationSkillItem, value: string) => {
    setTargetSkills((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const handleDeleteSkill = (index: number) => {
    setTargetSkills((prev) => prev.filter((_, i) => i !== index));
  };

  const handleLoadTemplate = async () => {
    if (!selectedTemplateRole) return;
    if (
      targetSkills.length > 0 &&
      !window.confirm(
        `Replace the current ${targetSkills.length} skills with the "${selectedTemplateRole}" catalog template?`
      )
    ) {
      return;
    }
    try {
      setIsLoadingTemplate(true);
      const res = await organizationApi.getSkillCatalogForRole(selectedTemplateRole);
      setTargetSkills(res.items || []);
    } catch {
      alert("Failed to load catalog template");
    } finally {
      setIsLoadingTemplate(false);
    }
  };

  const handleSave = async () => {
    if (!activeDesignation) {
      alert("No designation selected.");
      return;
    }
    const emptySkill = targetSkills.find((s) => !s.name.trim());
    if (emptySkill) {
      alert("All skills must have a valid name.");
      return;
    }
    try {
      setIsSaving(true);
      await organizationApi.updateDesignationSkills(activeDesignation._id, {
        skills: targetSkills,
        catalogRole: selectedTemplateRole || undefined,
      });
      setAiFeedback("✓ Skills successfully saved to designation! Employees can now complete this assessment.");
      if (onSaved) onSaved();
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (err) {
      alert((err instanceof Error ? err.message : "") || "Failed to save designation skills");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[94vh] w-full max-w-4xl flex-col rounded-3xl bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid size-9 place-items-center rounded-xl bg-brand-50 text-brand-700">
                <Award size={20} />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold text-slate-900">
                    {activeDesignation ? `Skill Assessment: ${activeDesignation.name}` : "AI Skill Builder"}
                  </h2>
                  {activeDesignation?.code && (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                      {activeDesignation.code}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-bold text-brand-800">
                    <Award size={13} className="text-brand-600" />
                    {targetSkills.length} Skills Required
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  Define required competencies & evaluation questions. Employees holding this title will self-rate against these criteria.
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="grid size-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {/* Designation Selector (if multiple available) */}
        {allDesignations.length > 1 && (
          <div className="flex flex-wrap items-center gap-3 border-b bg-slate-100/70 px-6 py-2.5 text-xs">
            <span className="font-semibold text-slate-600">Active Designation:</span>
            <select
              className="h-8 rounded-lg border border-slate-300 bg-white px-3 font-medium text-slate-800 focus:border-brand-500 focus:outline-hidden"
              value={selectedId}
              onChange={(e) => handleSelectDesignation(e.target.value)}
            >
              {allDesignations.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name} {d.department?.name ? `(${d.department.name})` : ""} — {d.customSkills?.length ? `${d.customSkills.length} skills` : "Unconfigured"}
                </option>
              ))}
            </select>
            {activeDesignation?.department && (
              <span className="inline-flex items-center gap-1 text-slate-500">
                <Building2 size={12} /> {activeDesignation.department.name}
              </span>
            )}
          </div>
        )}

        {/* Toolbar: AI Skill Builder toggle, Direct Number Skills Buttons, Template Catalog & Add Skill */}
        <div className="border-b bg-slate-50/80 px-6 py-3.5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={showAiBuilder ? "primary" : "secondary"}
                className="h-9 text-xs font-semibold shadow-xs"
                onClick={() => setShowAiBuilder(!showAiBuilder)}
              >
                <Bot size={14} className="mr-1.5" />
                {showAiBuilder ? "Hide AI Skill Builder" : "AI Skill Builder (from JD)"}
              </Button>

              {/* EDITABLE NUMBER FIELD FOR SKILLS */}
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1 shadow-2xs">
                <label htmlFor="ai-skill-count-toolbar" className="text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Skills to Generate:
                </label>
                <input
                  id="ai-skill-count-toolbar"
                  type="number"
                  min={1}
                  max={50}
                  value={aiSkillCount || ""}
                  onChange={(e) => {
                    const val = e.target.value === "" ? 0 : Number(e.target.value);
                    setAiSkillCount(val);
                  }}
                  className="h-7 w-16 rounded-lg border border-slate-300 bg-slate-50 px-2 text-center text-xs font-bold text-slate-800 focus:border-brand-500 focus:bg-white focus:outline-hidden"
                  placeholder="8"
                />
                <span className="text-[11px] font-medium text-slate-400">skills</span>
              </div>

              <div className="h-4 w-px bg-slate-200 mx-1 hidden sm:block" />

              {catalogRoles.length > 0 && (
                <>
                  <select
                    className="h-9 rounded-xl border bg-white px-3 text-xs text-slate-700 shadow-xs focus:border-brand-500 focus:outline-hidden"
                    value={selectedTemplateRole}
                    onChange={(e) => setSelectedTemplateRole(e.target.value)}
                  >
                    <option value="">Choose Catalog Template...</option>
                    {catalogRoles.map((c) => (
                      <option key={c.role} value={c.role}>
                        {c.role} ({c.skillCount} skills)
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-9 text-xs"
                    disabled={!selectedTemplateRole || isLoadingTemplate}
                    onClick={handleLoadTemplate}
                  >
                    <Download size={13} className="mr-1" />
                    {isLoadingTemplate ? "Loading..." : "Import"}
                  </Button>
                </>
              )}
            </div>

            <Button
              type="button"
              className="h-9 text-xs"
              onClick={handleAddCustomSkill}
            >
              <Plus size={14} className="mr-1" />
              Add Custom Skill
            </Button>
          </div>
        </div>

        {/* Compact Single-Row Skills Navigation Subheader (Outside scroll area, strictly 1 row, never obscures cards) */}
        {targetSkills.length > 0 && (
          <div className="border-b bg-slate-50/95 px-6 py-2 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 shrink-0">
              <span className="flex items-center gap-1.5 font-bold text-slate-700">
                <Award size={14} className="text-brand-600" />
                <span>Skills ({targetSkills.length}):</span>
              </span>
              <select
                className="h-7 max-w-[200px] rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 focus:border-brand-500 focus:outline-hidden"
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  if (!isNaN(idx)) {
                    const el = document.getElementById(`skill-card-${idx}`);
                    el?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                }}
                defaultValue=""
              >
                <option value="" disabled>Jump to skill...</option>
                {targetSkills.map((s, idx) => (
                  <option key={s.id || idx} value={idx}>
                    #{idx + 1}: {s.name ? (s.name.length > 25 ? s.name.substring(0, 25) + "..." : s.name) : `Skill ${idx + 1}`}
                  </option>
                ))}
              </select>
            </div>

            {/* Horizontal scrollable mini-number badges (strictly 1 line, no wrapping) */}
            <div className="flex items-center gap-1 overflow-x-auto py-0.5 max-w-xl scrollbar-thin">
              {targetSkills.map((s, idx) => (
                <button
                  key={s.id || idx}
                  type="button"
                  onClick={() => {
                    const el = document.getElementById(`skill-card-${idx}`);
                    el?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className="size-6 shrink-0 rounded-md border border-slate-200 bg-white text-[11px] font-bold text-slate-700 hover:border-brand-500 hover:bg-brand-600 hover:text-white transition shadow-2xs"
                  title={`Jump to Skill #${idx + 1}: ${s.name || "Untitled"}`}
                >
                  {idx + 1}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Are you sure you want to remove all ${targetSkills.length} skills?`)) {
                    setTargetSkills([]);
                  }
                }}
                className="text-[11px] font-medium text-slate-400 hover:text-red-600 transition"
                title="Clear all skills"
              >
                Clear all
              </button>
              <span className="rounded-full bg-brand-600 px-2.5 py-0.5 text-[11px] font-bold text-white shadow-2xs hidden md:inline-block">
                {targetSkills.length} Required
              </span>
            </div>
          </div>
        )}

        {/* Scrollable Skills List & AI Builder */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* AI Skill Builder Panel */}
          {showAiBuilder && (
            <div className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50/70 via-white to-sky-50/50 p-5 shadow-xs">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <div className="grid size-7 place-items-center rounded-lg bg-brand-600 text-white shadow-xs">
                    <Bot size={15} />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-800">
                    AI Skill Builder for {activeDesignation?.name || "Selected Role"}
                  </h3>
                  <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-[10px] font-semibold text-brand-700">
                    AI Powered
                  </span>
                </div>
                <span className="text-xs text-slate-500 font-medium">
                  Dept: {activeDesignation?.department?.name || "General"}
                </span>
              </div>
              
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                Paste your Job Description (JD), key deliverables, or responsibilities below. The AI will extract and structure technical & operational competencies, proficiency tiers, tools, and evidence-based workplace assessment questions.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Target Seniority / Level
                  </label>
                  <select
                    className="mt-1 h-9 w-full rounded-xl border bg-white px-3 text-xs text-slate-700 shadow-xs"
                    value={aiLevel}
                    onChange={(e) => setAiLevel(e.target.value)}
                  >
                    <option value="Junior / Associate">Junior / Associate</option>
                    <option value="Mid-level">Mid-level</option>
                    <option value="Senior">Senior</option>
                    <option value="Lead / Principal">Lead / Principal</option>
                    <option value="Manager / Head">Manager / Head</option>
                    <option value="Executive / C-Level">Executive / C-Level</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Number of Skills to Generate (1–50)
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={aiSkillCount || ""}
                    onChange={(e) => {
                      const val = e.target.value === "" ? 0 : Number(e.target.value);
                      setAiSkillCount(val);
                    }}
                    placeholder="Enter custom count (e.g. 5, 8, 15, 25, 43)..."
                    className="mt-1 h-9 w-full text-xs font-semibold"
                  />
                  <span className="mt-1 block text-[10px] text-slate-400">
                    Type any custom number of skills (1 to 50).
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Insertion Mode
                  </label>
                  <div className="mt-1 flex h-9 items-center gap-4 rounded-xl border bg-white px-3 text-xs text-slate-700">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="aiMode"
                        checked={!aiAppendMode}
                        onChange={() => setAiAppendMode(false)}
                      />
                      <span>Replace all</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="aiMode"
                        checked={aiAppendMode}
                        onChange={() => setAiAppendMode(true)}
                      />
                      <span>Append</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <label className="block text-xs font-medium text-slate-600">
                  Job Description (JD) / Requirements & Responsibilities <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <textarea
                  rows={4}
                  value={aiJd}
                  onChange={(e) => setAiJd(e.target.value)}
                  placeholder={`Paste full Job Description (JD) here...\nExample: Responsible for cloud architecture, microservices design, leading a team of 15 engineers, maintaining 99.99% uptime, CI/CD automation and managing technical roadmap.\n(Leave blank to auto-generate standard competencies for ${activeDesignation?.name || "this role"})`}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-hidden"
                />
              </div>

              <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <p className="text-[11px] text-slate-500">
                  💡 Tip: Pasting an actual JD produces exact matching assessment criteria and tools.
                </p>
                <Button
                  type="button"
                  disabled={isGeneratingAi || !activeDesignation}
                  onClick={handleGenerateSkillsWithAi}
                  className="h-9 px-4 text-xs bg-brand-600 hover:bg-brand-700 text-white font-medium shadow-sm"
                >
                  <Bot size={13} className={isGeneratingAi ? "mr-1.5 animate-spin" : "mr-1.5"} />
                  {isGeneratingAi ? `Analyzing JD & Generating ${aiSkillCount || 8} Skills...` : `Generate ${aiSkillCount || 8} Skills from JD`}
                </Button>
              </div>
            </div>
          )}

          {/* AI Feedback Banner */}
          {aiFeedback && (
            <div className={`rounded-xl px-4 py-2.5 text-xs font-medium ${aiFeedback.includes("Failed") || aiFeedback.includes("error") ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
              {aiFeedback}
            </div>
          )}

          {targetSkills.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center">
              <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-600 mb-3">
                <Bot size={24} />
              </div>
              <h3 className="text-sm font-semibold text-slate-800">No Assessment Skills Configured</h3>
              <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                Use our AI Skill Builder with your Job Description (JD), choose a catalog template, or add custom skills manually.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button
                  className="h-8 px-3 text-xs bg-brand-600 text-white"
                  onClick={() => setShowAiBuilder(true)}
                >
                  <Bot size={13} className="mr-1" /> Open AI Skill Builder
                </Button>
                <Button variant="secondary" className="h-8 px-3 text-xs" onClick={handleAddCustomSkill}>
                  <Plus size={13} className="mr-1" /> Add Custom Skill
                </Button>
              </div>
            </div>
          ) : (
            <>
              {targetSkills.map((skill, index) => (
                <div
                  id={`skill-card-${index}`}
                  key={skill.id || index}
                  className="group relative scroll-mt-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft transition hover:border-brand-200"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-2.5">
                      <span className="grid size-7 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white shadow-xs">
                        {index + 1}
                      </span>
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                          Skill #{index + 1} of {targetSkills.length}
                        </span>
                        <span className="ml-2 text-[11px] font-medium text-brand-600">
                          (Required for employee self-assessment)
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      title="Remove Skill"
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition"
                      onClick={() => handleDeleteSkill(index)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-600">
                        Skill Name <span className="text-red-500">*</span>
                      </label>
                      <Input
                        required
                        placeholder="e.g. Distributed Systems Architecture"
                        className="mt-1 text-sm font-medium"
                        value={skill.name}
                        onChange={(e) => handleSkillChange(index, "name", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600">
                        Category
                      </label>
                      <Input
                        placeholder="e.g. Backend, Leadership, Domain"
                        className="mt-1 text-sm"
                        value={skill.category}
                        onChange={(e) => handleSkillChange(index, "category", e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="mt-3 grid gap-4 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600">
                        Proficiency Level
                      </label>
                      <select
                        className="mt-1 h-10 w-full rounded-xl border bg-white px-3 text-sm text-slate-800"
                        value={skill.level}
                        onChange={(e) =>
                          handleSkillChange(index, "level", e.target.value as "Basic" | "Intermediate" | "Advanced")
                        }
                      >
                        <option value="Basic">Basic</option>
                        <option value="Intermediate">Intermediate</option>
                        <option value="Advanced">Advanced</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-600">
                        Tools & Software
                      </label>
                      <Input
                        placeholder="e.g. Docker, Kubernetes, AWS, Terraform"
                        className="mt-1 text-sm"
                        value={skill.tools || ""}
                        onChange={(e) => handleSkillChange(index, "tools", e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="mt-3">
                    <label className="block text-xs font-medium text-slate-600">
                      What does competency look like in this role?
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Describe specific responsibilities, behaviors, or technical standards..."
                      className="mt-1 w-full rounded-xl border bg-white p-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-hidden"
                      value={skill.description}
                      onChange={(e) => handleSkillChange(index, "description", e.target.value)}
                    />
                  </div>

                  <div className="mt-3 rounded-xl border border-brand-100 bg-brand-50/50 p-3">
                    <label className="block text-xs font-medium text-brand-900">
                      Assessment / Evaluation Question for Employee
                    </label>
                    <textarea
                      rows={2}
                      placeholder="e.g. Describe a project where you solved a severe architectural bottleneck..."
                      className="mt-1 w-full rounded-lg border border-brand-200 bg-white p-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-hidden"
                      value={skill.assessmentQuestion || ""}
                      onChange={(e) => handleSkillChange(index, "assessmentQuestion", e.target.value)}
                    />
                  </div>

                  {/* Benchmark Score Buttons 1 to 10 */}
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Benchmark Rating Required (1–10) which employee needs to achieve:
                    </label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score) => {
                        const currentScore = skill.assessmentQuestion?.match(/\[Target:\s*(\d+)\/10\]/)?.[1];
                        const isSelected = currentScore
                          ? Number(currentScore) === score
                          : score === (skill.level === "Advanced" ? 8 : skill.level === "Intermediate" ? 6 : 5);
                        return (
                          <button
                            key={score}
                            type="button"
                            onClick={() => {
                              const cleanQ = (skill.assessmentQuestion || "").replace(/\s*\[Target:\s*\d+\/10\]/g, "").trim();
                              handleSkillChange(index, "assessmentQuestion", `${cleanQ} [Target: ${score}/10]`.trim());
                            }}
                            className={`grid size-7 place-items-center rounded-lg text-xs font-bold transition ${
                              isSelected
                                ? "bg-brand-600 text-white shadow-xs ring-2 ring-brand-300"
                                : "bg-white text-slate-700 hover:bg-slate-200 border border-slate-300"
                            }`}
                            title={`Require benchmark rating of ${score}/10`}
                          >
                            {score}
                          </button>
                        );
                      })}
                      <span className="ml-2 text-xs font-medium text-slate-500">
                        {skill.assessmentQuestion?.match(/\[Target:\s*(\d+)\/10\]/)?.[1]
                          ? `(Target: ${skill.assessmentQuestion.match(/\[Target:\s*(\d+)\/10\]/)![1]}/10 points)`
                          : `(Default: ${skill.level === "Advanced" ? 8 : skill.level === "Intermediate" ? 6 : 5}/10 points)`}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t bg-slate-50 px-6 py-4">
          <div className="text-xs text-slate-500">
            {targetSkills.length} {targetSkills.length === 1 ? "skill" : "skills"} configured
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isSaving || !activeDesignation}
              onClick={handleSave}
              className="bg-brand-600 hover:bg-brand-700 text-white"
            >
              {isSaving ? "Saving..." : "Save Assessment Skills"}
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
};
