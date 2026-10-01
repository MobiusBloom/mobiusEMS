import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Employee } from "../models/Employee.js";
import { Project } from "../models/Project.js";
import { Task, type TaskDocument } from "../models/Task.js";
import { VoiceCommand } from "../models/VoiceCommand.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { writeAudit } from "./auditService.js";
import { createManualTask, createTask, listProjects, listTasks, transitionTask } from "./workService.js";

type Actor = { id: string; role: string; permissions: string[] };
type Option = { id: string; label: string; detail?: string; status?: string; relatedEmployeeIds?: string[] };
export type VoiceDraft = {
  action: "CREATE_TASK" | "UPDATE_STATUS";
  name?: string;
  description?: string;
  project?: string;
  assignedEmployee?: string;
  assigneeHint?: string;
  verbalAssigner?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  complexity?: "EASY" | "MEDIUM" | "HARD" | "VERY_HARD";
  estimatedHours?: number;
  deadline?: string;
  task?: string;
  status?: TaskDocument["status"];
  actualHours?: number;
  completionNote?: string;
  blockerReason?: NonNullable<TaskDocument["blocker"]>["reason"];
  blockerComment?: string;
};

const audioExtensions: Record<string, string> = {
  "audio/webm": ".webm", "audio/ogg": ".ogg", "audio/wav": ".wav", "audio/x-wav": ".wav",
  "audio/mpeg": ".mp3", "audio/mp4": ".mp4", "audio/x-m4a": ".m4a"
};

const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
const words = (value: string) => new Set(normalize(value).split(" ").filter((word) => word.length > 2));
const overlap = (left: string, right: string) => {
  const a = words(left); const b = words(right); if (!a.size || !b.size) return 0;
  return [...a].filter((word) => b.has(word)).length / Math.max(a.size, b.size);
};
const containsAny = (text: string, phrases: readonly string[]) => phrases.some((phrase) => text.includes(normalize(phrase)));
const PROSPECTIVE_COMPLETION_PHRASES = [
  "have to complete", "need to complete", "must complete", "have to finish", "need to finish", "complete by", "finish by",
  "पूरा करना है", "खत्म करना है", "সম্পন্ন করতে হবে", "শেষ করতে হবে", "முடிக்க வேண்டும்", "பூர்த்தி செய்ய வேண்டும்",
  "పూర్తి చేయాలి", "ముగించాలి", "पूर्ण करायचे", "પૂર્ણ કરવાનું", "ಪೂರ್ಣಗೊಳಿಸಬೇಕು", "പൂർത്തിയാക്കണം", "ਪੂਰਾ ਕਰਨਾ ਹੈ", "مکمل کرنا ہے"
] as const;
const ASSIGNMENT_PHRASES = [
  "got a task", "got one task", "received a task", "task from", "assigned me", "assigned to me", "asked me to", "told me to", "gave me a task",
  "मुझे काम मिला", "मुझे टास्क मिला", "काम सौंपा", "আমাকে কাজ দিয়েছে", "எனக்கு பணி கொடுத்த", "నాకు పని ఇచ్చారు",
  "मला काम दिले", "મને કામ આપ્યું", "ನನಗೆ ಕೆಲಸ ನೀಡಿದರು", "എനിക്ക് ജോലി നൽകി", "ਮੈਨੂੰ ਕੰਮ ਦਿੱਤਾ", "مجھے کام دیا"
] as const;
const STATUS_PHRASES = {
  complete: ["complete", "completed", "finished", "done", "submitted", "पूरा", "पूर्ण", "समाप्त", "खत्म", "हो गया", "সম্পন্ন", "শেষ", "முடித்த", "முடிந்தது", "பூர்த்தி", "పూర్తి", "పూర్తయింది", "ముగిసింది", "पूर्ण केले", "संपले", "પૂર્ણ", "સમાપ્ત", "ಪೂರ್ಣ", "ಮುಗಿದಿದೆ", "ಪೂರ್ಣವಾಗಿದೆ", "പൂർത്തിയായി", "കഴിഞ്ഞു", "ਪੂਰਾ", "ਮੁਕੰਮਲ", "ਮੁਕੰਮਲ ਹੋਇਆ", "مکمل", "ختم", "ہو گیا"],
  start: ["start", "started", "begin", "in progress", "शुरू", "आरंभ", "চালু", "শুরু", "தொடங்கு", "ஆரம்பம்", "ప్రారంభ", "सुरू", "શરૂ", "ಪ್ರಾರಂಭ", "തുടങ്ങി", "ਸ਼ੁਰੂ", "شروع"],
  blocked: ["block", "blocked", "stuck", "waiting", "रुका", "अटका", "बाधित", "আটকে", "தடை", "சிக்கி", "ఆగిపోయింది", "अडकले", "અટક્યું", "ಸಿಲುಕಿದೆ", "തടസ്സം", "ਅਟਕਿਆ", "رکا", "پھنسا"],
  reopen: ["reopen", "open again", "फिर खोल", "दोबारा खोल", "আবার খুল", "மீண்டும் திற", "మళ్లీ తెర", "पुन्हा उघड", "ફરી ખોલ", "ಮತ್ತೆ ತೆರ", "വീണ്ടും തുറ", "ਦੁਬਾਰਾ ਖੋਲ੍ਹ", "دوبارہ کھول"],
  cancel: ["cancel", "cancelled", "रद्द", "বাতিল", "ரத்து", "రద్దు", "रद्द करा", "રદ", "ರದ್ದು", "റദ്ദാക്ക", "ਰੱਦ", "منسوخ"]
} as const;
export const detectVoiceStatusIntent = (transcript: string): keyof typeof STATUS_PHRASES | undefined => {
  const text = normalize(transcript);
  if (containsAny(text, PROSPECTIVE_COMPLETION_PHRASES)) return undefined;
  return containsAny(text, STATUS_PHRASES.complete) ? "complete" : containsAny(text, STATUS_PHRASES.blocked) ? "blocked" : containsAny(text, STATUS_PHRASES.reopen) ? "reopen" : containsAny(text, STATUS_PHRASES.cancel) ? "cancel" : containsAny(text, STATUS_PHRASES.start) ? "start" : undefined;
};

export const detectVoiceAction = (transcript: string): VoiceDraft["action"] => {
  const text = normalize(transcript);
  return containsAny(text, ASSIGNMENT_PHRASES) || containsAny(text, PROSPECTIVE_COMPLETION_PHRASES) ? "CREATE_TASK" : detectVoiceStatusIntent(text) ? "UPDATE_STATUS" : "CREATE_TASK";
};

export const parseVoiceDeadline = (transcript: string, timezoneOffsetMinutes = 0, now = new Date()) => {
  const text = normalize(transcript);
  const localNow = new Date(now.getTime() - timezoneOffsetMinutes * 60_000);
  const date = new Date(localNow); date.setUTCHours(17, 0, 0, 0);
  let hasExplicitDate = false;
  if (text.includes("day after tomorrow") || text.includes("परसों")) { date.setUTCDate(date.getUTCDate() + 2); hasExplicitDate = true; }
  else if (text.includes("tomorrow") || text.includes("kal") || text.includes("कल")) { date.setUTCDate(date.getUTCDate() + 1); hasExplicitDate = true; }
  else if (text.includes("today") || text.includes("आज")) { hasExplicitDate = true; }
  else {
    const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const weekday = weekdays.findIndex((item) => text.includes(item));
    if (weekday >= 0) { const difference = (weekday - date.getUTCDay() + 7) % 7 || 7; date.setUTCDate(date.getUTCDate() + difference); hasExplicitDate = true; }
    const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
    if (iso) { date.setUTCFullYear(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])); hasExplicitDate = true; }
  }
  const time = transcript.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i) ?? transcript.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (time) {
    let hour = Number(time[1]); const minute = Number(time[2] ?? 0); const meridiem = time[3]?.toLowerCase().replaceAll(".", "");
    if (meridiem === "pm" && hour < 12) hour += 12; if (meridiem === "am" && hour === 12) hour = 0;
    date.setUTCHours(hour, minute, 0, 0);
    if (!hasExplicitDate && date.getTime() <= localNow.getTime()) date.setUTCDate(date.getUTCDate() + 1);
  } else if (!hasExplicitDate) date.setUTCDate(date.getUTCDate() + 1);
  return new Date(date.getTime() + timezoneOffsetMinutes * 60_000).toISOString();
};

const extractTaskName = (transcript: string) => {
  let name = transcript.trim().replace(/[.!?]+$/, "");
  const markers = [/(?:my|the|a) task is to\s+/i, /(?:i\s+)?(?:have|need) to\s+/i, /(?:manager|lead|supervisor|boss|.+?)\s+(?:asked|told) me to\s+/i, /(?:assigned me|assigned to me)\s+/i, /task (?:of|to|called)\s+/i, /(?:create|add) (?:a )?(?:new )?task (?:to|for|called)?\s*/i];
  for (const marker of markers) { const match = name.match(marker); if (match?.index !== undefined) { name = name.slice(match.index + match[0].length); break; } }
  name = name
    .replace(/^(?:complete|finish|do|prepare|submit)\s+/i, "")
    .replace(/\s+(?:by|before|due(?: on)?|deadline(?: is)?)\s+(?:(?:today|tomorrow|day after tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|20\d{2}-\d{1,2}-\d{1,2})\b|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)).*$/i, "")
    .replace(/\s+(?:with\s+)?(?:low|medium|high|critical)\s+priority.*$/i, "")
    .replace(/\s+estimated\s+(?:at\s+)?\d+(?:\.\d+)?\s*hours?.*$/i, "")
    .replace(/^assign\s+[a-z][a-z\s'-]{1,80}?\s+(?:the\s+)?(?:task\s+)?(?:of|to)\s+/i, "")
    .trim();
  return name.slice(0, 200) || "Voice-created task";
};

const findMention = <T extends { label: string }>(transcript: string, options: T[]) => {
  const text = normalize(transcript);
  return options
    .filter((option) => text.includes(normalize(option.label)))
    .sort((a, b) => b.label.length - a.label.length)[0];
};

export const resolveSpokenProject = (transcript: string, projects: Option[]) => {
  const text = normalize(transcript);
  const ranked = projects.map((project) => {
    const aliases = [project.label, project.detail ?? "", project.label.replace(/\bproject\b/gi, "")].map(normalize).filter(Boolean);
    const score = Math.max(...aliases.map((alias) => {
      if (` ${text} `.includes(` ${alias} `)) return 1;
      const tokens = text.split(" "); const length = alias.split(" ").length;
      return Math.max(0, ...tokens.map((_, index) => {
        const phrase = tokens.slice(index, index + length).join(" ");
        return alias.length >= 6 ? 1 - editDistance(phrase, alias) / Math.max(phrase.length, alias.length) : 0;
      }));
    }));
    return { project, score };
  }).sort((a, b) => b.score - a.score);
  const best = ranked[0]; const next = ranked[1];
  return best && best.score >= 0.85 && (!next || best.score - next.score >= 0.08) ? best.project : undefined;
};

const cleanTaskCommand = (transcript: string, employee?: Option) => {
  let text = transcript;
  if (employee) {
    const name = escapeRegularExpression(employee.label);
    text = text.replace(new RegExp(`\\s*(?:and\\s+)?(?:assign(?:ed)?|are\\s+sign|a\\s+sign)\\s+(?:it\\s+)?to\\s+${name}\\b`, "i"), "");
  }
  return text.replace(/\s*(?:and\s+)?(?:the\s+)?project\s+(?:belongs\s+to|is|called|named)\s+.*$/i, "")
    .replace(/\s+(?:in|under|for)\s+(?:the\s+)?(.+?)\s+project\b.*$/i, "").trim();
};

const escapeRegularExpression = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const editDistance = (left: string, right: string) => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? Math.max(left.length, right.length);
};

const employeeMatchScore = (spoken: string, employee: Option, uniqueFirstNames: Set<string>) => {
  const spokenForms = [normalize(spoken), ...normalize(spoken).split(" ").slice(-2), normalize(spoken).split(" ").at(-1) ?? ""].filter((item) => item.length >= 2);
  const fullName = normalize(employee.label);
  const firstName = fullName.split(" ")[0] ?? "";
  const aliases = [fullName, normalize(employee.detail ?? ""), ...(uniqueFirstNames.has(firstName) ? [firstName] : [])].filter(Boolean);
  let best = 0;
  for (const spokenForm of spokenForms) for (const alias of aliases) {
    if (spokenForm === alias) best = Math.max(best, 1);
    else if (spokenForm.length >= 3 && alias.startsWith(spokenForm)) best = Math.max(best, 0.8 + Math.min(0.15, spokenForm.length / alias.length * 0.15));
    else best = Math.max(best, 1 - editDistance(spokenForm, alias) / Math.max(spokenForm.length, alias.length));
  }
  return best;
};

export const resolveSpokenEmployee = (spoken: string, employees: Option[]) => {
  const firstNameCounts = new Map<string, number>();
  for (const employee of employees) {
    const firstName = normalize(employee.label).split(" ")[0];
    if (firstName) firstNameCounts.set(firstName, (firstNameCounts.get(firstName) ?? 0) + 1);
  }
  const uniqueFirstNames = new Set([...firstNameCounts].filter(([, count]) => count === 1).map(([name]) => name));
  const ranked = employees.map((employee) => ({ employee, score: employeeMatchScore(spoken, employee, uniqueFirstNames) })).sort((left, right) => right.score - left.score);
  const best = ranked[0]; const runnerUp = ranked[1];
  return best && best.score >= 0.72 && (!runnerUp || best.score - runnerUp.score >= 0.08) ? best.employee : undefined;
};

export type VoiceAssignmentSegment = { assignedEmployee?: string; assigneeLabel: string; text: string };
export const splitVoiceAssignments = (transcript: string, employees: Option[]): VoiceAssignmentSegment[] => {
  const markerExpression = /(^|[,;]|\b(?:and|aur)\b|और)\s*([\p{L}\p{N}'-]+(?:\s+[\p{L}\p{N}'-]+){0,2})\s+(?:ko|को)\s+/giu;
  const markerMatches = [...transcript.matchAll(markerExpression)];
  if (markerMatches.length) return markerMatches.map((match, index) => {
    const spokenName = match[2]?.trim() ?? "";
    const employee = resolveSpokenEmployee(spokenName, employees);
    const start = (match.index ?? 0) + match[0].length;
    const end = markerMatches[index + 1]?.index ?? transcript.length;
    const text = transcript.slice(start, end)
      .replace(/[\s,:;–—-]*(?:and|aur|और)\s*$/iu, "")
      .replace(/^[\s,:;–—-]+|[\s,:;–—-]+$/g, "")
      .trim();
    return { assignedEmployee: employee?.id, assigneeLabel: employee?.label ?? spokenName, text };
  }).filter((item) => item.text.length >= 2);

  const firstNameCounts = new Map<string, number>();
  for (const employee of employees) {
    const firstName = normalize(employee.label).split(" ")[0];
    if (firstName) firstNameCounts.set(firstName, (firstNameCounts.get(firstName) ?? 0) + 1);
  }
  const mentions: Array<{ start: number; end: number; employee: Option; aliasLength: number }> = [];
  for (const employee of employees) {
    const firstName = employee.label.trim().split(/\s+/)[0];
    const aliases = [...new Set([
      employee.label,
      employee.detail,
      firstName && firstNameCounts.get(normalize(firstName)) === 1 ? firstName : undefined
    ].filter((value): value is string => Boolean(value?.trim())))].sort((left, right) => right.length - left.length);
    for (const alias of aliases) {
      const expression = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegularExpression(alias)})(?=$|[^\\p{L}\\p{N}])`, "giu");
      for (const match of transcript.matchAll(expression)) {
        const matchedAlias = match[2];
        if (!matchedAlias) continue;
        const start = (match.index ?? 0) + (match[1]?.length ?? 0);
        mentions.push({ start, end: start + matchedAlias.length, employee, aliasLength: matchedAlias.length });
      }
    }
  }
  const ordered = mentions
    .sort((left, right) => left.start - right.start || right.aliasLength - left.aliasLength)
    .filter((mention, index, all) => !all.slice(0, index).some((other) => other.start === mention.start || (other.employee.id === mention.employee.id && other.start === mention.start)));
  return ordered.map((mention, index) => {
    const next = ordered[index + 1];
    const raw = transcript.slice(mention.end, next?.start ?? transcript.length);
    const text = raw
      .replace(/^[\s,:;–—-]*(?:(?:ko|को|के लिए|के लिये)\s+)?(?:(?:should|needs? to|has to|must|will|please)\s+)?/iu, "")
      .replace(/[\s,:;–—-]*(?:and|aur|और)\s*$/iu, "")
      .replace(/^[\s,:;–—-]+|[\s,:;–—-]+$/g, "")
      .trim();
    return { assignedEmployee: mention.employee.id, assigneeLabel: mention.employee.label, text };
  }).filter((item) => item.text.length >= 2);
};

const detectPriority = (text: string): VoiceDraft["priority"] => text.includes("critical") || text.includes("urgent") ? "CRITICAL" : text.includes("high priority") ? "HIGH" : text.includes("low priority") ? "LOW" : "MEDIUM";
const detectComplexity = (text: string): VoiceDraft["complexity"] => text.includes("very hard") ? "VERY_HARD" : text.includes("hard") || text.includes("complex") ? "HARD" : text.includes("easy") || text.includes("simple") ? "EASY" : "MEDIUM";
const hourUnits = ["hour", "hours", "hr", "hrs", "घंटा", "घंटे", "तास", "மணி", "గంట", "గంటలు", "કલાક", "ಗಂಟೆ", "മണിക്കൂർ", "گھنٹہ", "گھنٹے"];
const numberWords: Array<[number, string[]]> = [[1, ["one", "एक", "এক", "ஒன்று", "ఒక", "एक", "એક", "ಒಂದು", "ഒന്ന്", "ਇੱਕ", "ایک"]], [2, ["two", "दो", "দুই", "இரண்டு", "రెండు", "दोन", "બે", "ಎರಡು", "രണ്ട്", "ਦੋ", "دو"]], [3, ["three", "तीन", "তিন", "மூன்று", "మూడు", "तीन", "ત્રણ", "ಮೂರು", "മൂന്ന്", "ਤਿੰਨ", "تین"]], [4, ["four", "चार", "চার", "நான்கு", "నాలుగు", "चार", "ચાર", "ನಾಲ್ಕು", "നാല്", "ਚਾਰ", "چار"]], [5, ["five", "पांच", "पाँच", "পাঁচ", "ஐந்து", "ఐదు", "पाच", "પાંચ", "ಐದು", "അഞ്ച്", "ਪੰਜ", "پانچ"]], [6, ["six", "छह", "ছয়", "ஆறு", "ఆరు", "सहा", "છ", "ಆರು", "ആറ്", "ਛੇ", "چھ"]], [7, ["seven", "सात", "সাত", "ஏழு", "ఏడు", "सात", "સાત", "ಏಳು", "ഏഴ്", "ਸੱਤ", "سات"]], [8, ["eight", "आठ", "আট", "எட்டு", "ఎనిమిది", "आठ", "આઠ", "ಎಂಟು", "എട്ട്", "ਅੱਠ", "آٹھ"]], [9, ["nine", "नौ", "নয়", "ஒன்பது", "తొమ్మిది", "नऊ", "નવ", "ಒಂಬತ್ತು", "ഒൻപത്", "ਨੌਂ", "نو"]], [10, ["ten", "दस", "দশ", "பத்து", "పది", "दहा", "દસ", "ಹತ್ತು", "പത്ത്", "ਦਸ", "دس"]]];
export const detectVoiceHours = (transcript: string) => { const text = normalize(transcript); if (!containsAny(text, hourUnits)) return 1; const numeric = text.match(/\b(\d+(?:\.\d+)?)\b/u); if (numeric) return Number(numeric[1]); return numberWords.find(([, variants]) => containsAny(text, variants))?.[0] ?? 1; };
export const detectMentionedVoiceHours = (transcript: string) => containsAny(normalize(transcript), hourUnits) ? detectVoiceHours(transcript) : undefined;

export const extractVoiceAssigner = (transcript: string) => {
  const patterns = [
    /assigned by\s+(?:the\s+)?(.+?)(?=\s+(?:that|to|by|before|due|with)\b|[.!?]|$)/i,
    /(?:task|work) from\s+(?:the\s+)?(.+?)(?=\s+(?:that|to|which|by|before|due|with)\b|[.!?]|$)/i,
    /(?:my\s+)?(.+?)\s+(?:asked|told) me to\b/i
  ];
  for (const pattern of patterns) { const value = transcript.match(pattern)?.[1]?.trim(); if (value) return value.replace(/^the\s+/i, "").slice(0, 120); }
  const role = transcript.match(/\b(manager|team lead|lead|supervisor|boss)\b/i)?.[1];
  return role ? role.replace(/\b\w/g, (letter) => letter.toUpperCase()) : undefined;
};

type TranscriptionResult = { text: string; language?: string; languageProbability?: number; durationSeconds?: number };

const runTranscribeProcess = (pythonCommand: string, audioPath: string, requestedLanguage?: string) => new Promise<TranscriptionResult>((resolve, reject) => {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const script = path.resolve(dirname, "../../scripts/transcribe_audio.py");
  const args = [script, audioPath, "--model", env.VOICE_WHISPER_MODEL, "--device", env.VOICE_WHISPER_DEVICE, "--compute-type", env.VOICE_WHISPER_COMPUTE_TYPE];
  const language = requestedLanguage && requestedLanguage !== "auto" ? requestedLanguage.split("-").at(0)?.toLowerCase() : env.VOICE_WHISPER_LANGUAGE;
  if (language) args.push("--language", language);
  const child = spawn(pythonCommand, args, { windowsHide: true });
  let stdout = ""; let stderr = ""; let settled = false;
  const timeout = setTimeout(() => { child.kill(); if (!settled) { settled = true; reject(new AppError("Local voice transcription timed out", 504, "VOICE_TIMEOUT")); } }, env.VOICE_TRANSCRIPTION_TIMEOUT_MS);
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); if (stdout.length > 1_000_000) child.kill(); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  child.on("error", (error) => { clearTimeout(timeout); if (!settled) { settled = true; reject(new AppError(`Could not start local Whisper: ${error.message}`, 503, "VOICE_ENGINE_UNAVAILABLE")); } });
  child.on("close", (code) => {
    clearTimeout(timeout); if (settled) return; settled = true;
    try {
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean); const result = JSON.parse(lines.at(-1) ?? "{}") as { text?: string; error?: string; language?: string; languageProbability?: number; durationSeconds?: number };
      if (code !== 0 || result.error) return reject(new AppError(result.error ?? stderr.trim() ?? "Local transcription failed", 503, "VOICE_TRANSCRIPTION_FAILED"));
      if (!result.text?.trim()) return reject(new AppError("No speech was detected in the recording", 422, "NO_SPEECH_DETECTED"));
      resolve({ ...result, text: result.text.trim() });
    } catch { reject(new AppError(stderr.trim() || "Local transcription returned an invalid response", 503, "VOICE_TRANSCRIPTION_FAILED")); }
  });
});

const transcribeProcess = async (audioPath: string, requestedLanguage?: string): Promise<TranscriptionResult> => {
  const commands = [...new Set([env.VOICE_PYTHON_COMMAND, process.platform === "win32" ? "py" : "python3", "python3", "python"])];
  let lastError: unknown;
  for (const command of commands) {
    try { return await runTranscribeProcess(command, audioPath, requestedLanguage); }
    catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("ENOENT") && !message.includes("not installed")) throw error;
    }
  }
  throw lastError ?? new AppError("No Python voice runtime is available", 503, "VOICE_ENGINE_UNAVAILABLE");
};

export const transcribeAudio = async (file: Express.Multer.File, requestedLanguage?: string) => {
  const directory = await mkdtemp(path.join(tmpdir(), "mobius-voice-"));
  const audioPath = path.join(directory, `recording${audioExtensions[file.mimetype] ?? ".webm"}`);
  try { await writeFile(audioPath, file.buffer); return await transcribeProcess(audioPath, requestedLanguage); }
  finally { await rm(directory, { recursive: true, force: true }); }
};

const loadOptions = async (actor: Actor) => {
  const [projectsRaw, tasksRaw] = await Promise.all([listProjects(actor), listTasks({}, actor)]);
  const employeeFilter = actor.role === "EMPLOYEE" ? { user: actor.id, isActive: true } : { isActive: true };
  const employeesRaw = await Employee.find(employeeFilter).select("firstName lastName employeeId").sort({ firstName: 1 }).lean();
  const referenceId = (value: unknown) => {
    if (!value) return undefined;
    if (typeof value === "object" && "_id" in value) return String((value as { _id: unknown })._id);
    return String(value);
  };
  const projects: Option[] = projectsRaw.map((item) => ({
    id: item._id.toString(), label: item.name, detail: item.code,
    relatedEmployeeIds: [referenceId(item.projectManager), ...(item.teamMembers ?? []).map(referenceId)].filter((value): value is string => Boolean(value))
  }));
  const employees: Option[] = employeesRaw.map((item) => ({ id: item._id.toString(), label: `${item.firstName} ${item.lastName}`, detail: item.employeeId }));
  const tasks: Option[] = tasksRaw.map((item) => ({ id: item._id.toString(), label: item.name, detail: item.taskId, status: item.status }));
  return { projects, employees, tasks };
};

export const buildDraft = (transcript: string, actor: Actor, options: Awaited<ReturnType<typeof loadOptions>>, timezoneOffsetMinutes = 0) => {
  const text = normalize(transcript);
  const statusIntent = detectVoiceStatusIntent(text);
  const exactTask = options.tasks.find((task) => task.detail && text.includes(normalize(task.detail)));
  const scoredTask = options.tasks.map((task) => ({ task, score: overlap(transcript, task.label) })).sort((a, b) => b.score - a.score)[0];
  const eligibleTasks = statusIntent === "complete" ? options.tasks.filter((item) => !["COMPLETED", "CANCELLED"].includes(item.status ?? "")) : options.tasks;
  const task = exactTask ?? (scoredTask && scoredTask.score >= 0.25 ? scoredTask.task : eligibleTasks.length === 1 ? eligibleTasks[0] : undefined);
  if (detectVoiceAction(transcript) === "UPDATE_STATUS" && statusIntent) {
    let status: TaskDocument["status"] = statusIntent === "blocked" ? "BLOCKED" : statusIntent === "reopen" ? "REOPENED" : statusIntent === "cancel" ? "CANCELLED" : statusIntent === "start" ? "IN_PROGRESS" : "IN_REVIEW";
    if (statusIntent === "complete" && task?.status === "IN_REVIEW" && actor.role !== "EMPLOYEE") status = "COMPLETED";
    const draft: VoiceDraft = { action: "UPDATE_STATUS", task: task?.id, status, actualHours: detectMentionedVoiceHours(text), completionNote: transcript, blockerReason: "OTHER", blockerComment: status === "BLOCKED" ? transcript : undefined };
    return { draft, confidence: Math.min(0.98, 0.55 + (exactTask ? 0.35 : task ? 0.2 : 0)) };
  }
  const project = resolveSpokenProject(transcript, options.projects) ?? (options.projects.length === 1 ? options.projects[0] : undefined);
  const employee = actor.role === "EMPLOYEE" ? options.employees[0] : findMention(transcript, options.employees);
  const draft: VoiceDraft = {
    action: "CREATE_TASK", name: extractTaskName(cleanTaskCommand(transcript, employee)), description: transcript, project: project?.id,
    assignedEmployee: employee?.id, verbalAssigner: extractVoiceAssigner(transcript) || (actor.role === "EMPLOYEE" ? "Manager (voice-reported)" : undefined),
    priority: detectPriority(text), complexity: detectComplexity(text), estimatedHours: detectMentionedVoiceHours(text) ?? 1, deadline: parseVoiceDeadline(transcript, timezoneOffsetMinutes)
  };
  let confidence = 0.35; if (draft.name && draft.name !== "Voice-created task") confidence += 0.2; if (project) confidence += 0.2; if (employee) confidence += 0.15; if (/today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|20\d{2}-/.test(text)) confidence += 0.1;
  return { draft, confidence: Math.min(0.98, confidence) };
};

const hasDeadlineSignal = (text: string) => /\b(?:today|tomorrow|day after tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|20\d{2}-\d{1,2}-\d{1,2}|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\b|आज|कल|परसों/iu.test(text);
export const buildDrafts = (transcript: string, actor: Actor, options: Awaited<ReturnType<typeof loadOptions>>, timezoneOffsetMinutes = 0) => {
  const single = buildDraft(transcript, actor, options, timezoneOffsetMinutes);
  if (single.draft.action !== "CREATE_TASK" || actor.role === "EMPLOYEE") return { drafts: [single.draft], confidence: single.confidence };
  const assignments = splitVoiceAssignments(transcript, options.employees);
  // A trailing assignee identifies the owner, not the start of the task title.
  if (assignments.length === 1 && single.draft.assignedEmployee && /\b(?:assign(?:ed)?|are\s+sign|a\s+sign)\s+(?:it\s+)?to\b/i.test(transcript)) return { drafts: [single.draft], confidence: single.confidence };
  if (!assignments.length) return { drafts: [single.draft], confidence: single.confidence };
  const sharedProject = resolveSpokenProject(transcript, options.projects) ?? (options.projects.length === 1 ? options.projects[0] : undefined);
  const sharedDeadline = hasDeadlineSignal(transcript) ? parseVoiceDeadline(transcript, timezoneOffsetMinutes) : undefined;
  const results = assignments.map((assignment) => {
    const parsed = buildDraft(assignment.text, actor, options, timezoneOffsetMinutes);
    const employeeProjects = assignment.assignedEmployee ? options.projects.filter((project) => project.relatedEmployeeIds?.includes(assignment.assignedEmployee!)) : [];
    const inferredProject = employeeProjects.length === 1 ? employeeProjects[0] : undefined;
    return {
      draft: {
        ...parsed.draft,
        action: "CREATE_TASK" as const,
        assignedEmployee: assignment.assignedEmployee,
        assigneeHint: assignment.assigneeLabel,
        project: parsed.draft.project ?? sharedProject?.id ?? inferredProject?.id,
        deadline: hasDeadlineSignal(assignment.text) ? parsed.draft.deadline : sharedDeadline ?? parsed.draft.deadline,
        description: assignment.text
      },
      confidence: Math.min(0.98, parsed.confidence + 0.15)
    };
  });
  return { drafts: results.map((item) => item.draft), confidence: Math.min(...results.map((item) => item.confidence)) };
};

export const createPreview = async (transcript: string, actor: Actor, metadata: { language?: string; durationSeconds?: number; timezoneOffsetMinutes?: number } = {}) => {
  const cleanTranscript = transcript.trim(); if (cleanTranscript.length < 2) throw new AppError("Say or type a task command", 422, "EMPTY_TRANSCRIPT");
  const interpretedTranscript = cleanTranscript.replace(/\bbye\s+(?=today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/giu, "by ");
  const options = await loadOptions(actor); const { drafts, confidence } = buildDrafts(interpretedTranscript, actor, options, metadata.timezoneOffsetMinutes); const draft = drafts[0];
  if (!draft) throw new AppError("No task assignment could be extracted", 422, "NO_ASSIGNMENTS_FOUND");
  const storedDraft: Record<string, unknown> = drafts.length === 1 ? { ...draft } : { drafts };
  const command = await VoiceCommand.create({ actor: actor.id, actorRole: actor.role, transcript: cleanTranscript, language: metadata.language, durationSeconds: metadata.durationSeconds, intent: draft.action, confidence, status: "TRANSCRIBED", draft: storedDraft });
  return { command: { id: command.id, transcript: command.transcript, language: command.language, durationSeconds: command.durationSeconds, confidence, status: command.status }, draft, drafts, options };
};

export const confirmCommand = async (id: string, input: VoiceDraft | { drafts: VoiceDraft[] }, actor: Actor) => {
  const command = await VoiceCommand.findById(id); if (!command) throw new AppError("Voice command not found", 404);
  if (command.actor.toString() !== actor.id) throw new AppError("This voice command belongs to another user", 403);
  if (command.status !== "TRANSCRIBED") throw new AppError(`Voice command is already ${command.status.toLowerCase()}`, 409);
  const drafts = "drafts" in input ? input.drafts : [input];
  const firstDraft = drafts[0];
  if (!firstDraft) throw new AppError("Add at least one task assignment", 422, "EMPTY_VOICE_BATCH");
  if (drafts.length > 1 && drafts.some((draft) => draft.action !== "CREATE_TASK")) throw new AppError("Batch voice commands can only create tasks", 422, "INVALID_VOICE_BATCH");
  const creationDrafts = drafts.filter((draft) => draft.action === "CREATE_TASK");
  if (actor.role !== "EMPLOYEE" && creationDrafts.length) {
    if (!actor.permissions.includes("task.create") || !actor.permissions.includes("task.assign")) throw new AppError("You cannot assign tasks", 403);
    if (creationDrafts.some((draft) => !draft.assignedEmployee)) throw new AppError("Choose the employee who should receive every task", 422);
    const projectIds = [...new Set(creationDrafts.map((draft) => draft.project!))];
    const employeeIds = [...new Set(creationDrafts.map((draft) => draft.assignedEmployee!))];
    const [projects, employees] = await Promise.all([
      Project.find({ _id: { $in: projectIds }, isActive: true }).select("_id").lean(),
      Employee.find({ _id: { $in: employeeIds }, isActive: true }).select("_id").lean()
    ]);
    if (projects.length !== projectIds.length) throw new AppError("One or more selected projects are unavailable", 422, "INVALID_VOICE_PROJECT");
    if (employees.length !== employeeIds.length) throw new AppError("One or more selected employees are unavailable", 422, "INVALID_VOICE_ASSIGNEE");
  }
  const tasks: Awaited<ReturnType<typeof createTask>>[] = [];
  for (const draft of drafts) {
    let task: Awaited<ReturnType<typeof createTask>>;
    if (draft.action === "CREATE_TASK") {
      if (actor.role === "EMPLOYEE") task = await createManualTask({ name: draft.name!, description: draft.description, project: draft.project!, verbalAssigner: draft.verbalAssigner || "Voice self-report", priority: draft.priority ?? "MEDIUM", complexity: draft.complexity ?? "MEDIUM", estimatedHours: draft.estimatedHours ?? 1, deadline: new Date(draft.deadline!) }, actor);
      else {
        task = await createTask({ name: draft.name!, description: draft.description, project: draft.project!, assignedEmployee: draft.assignedEmployee!, priority: draft.priority ?? "MEDIUM", complexity: draft.complexity ?? "MEDIUM", estimatedHours: draft.estimatedHours ?? 1, deadline: new Date(draft.deadline!) }, actor.id);
      }
    } else {
      const current = await Task.findById(draft.task!).select("status startDate"); if (!current) throw new AppError("Task not found", 404);
      const trackedHours = draft.actualHours ?? (draft.status === "IN_REVIEW" && current.startDate ? Math.max(0.01, Number(((Date.now() - current.startDate.getTime()) / 3_600_000).toFixed(2))) : undefined);
      if (draft.status === "IN_REVIEW" && ["NOT_STARTED", "BLOCKED"].includes(current.status)) await transitionTask(draft.task!, { status: "IN_PROGRESS", actualHours: trackedHours }, actor);
      task = await transitionTask(draft.task!, { status: draft.status!, actualHours: trackedHours, completionNote: draft.completionNote, blockerReason: draft.status === "BLOCKED" ? (draft.blockerReason ?? "OTHER") : undefined, blockerComment: draft.blockerComment, blockerExternal: false }, actor);
    }
    tasks.push(task);
  }
  const task = tasks[0];
  if (!task) throw new AppError("No task was created", 500, "VOICE_CONFIRMATION_FAILED");
  command.intent = firstDraft.action; command.draft = drafts.length === 1 ? { ...firstDraft } : { drafts }; command.task = task._id; command.tasks = tasks.map((item) => item._id); command.status = "CONFIRMED"; await command.save();
  await writeAudit({ user: actor.id, action: "VOICE_TASK_COMMAND_CONFIRMED", entityType: "VoiceCommand", entityId: command.id, newValue: { intent: firstDraft.action, transcript: command.transcript, tasks: tasks.map((item) => item.id) } });
  return { command, task, tasks };
};

export const cancelCommand = async (id: string, actor: Actor) => {
  const command = await VoiceCommand.findById(id); if (!command) throw new AppError("Voice command not found", 404);
  if (command.actor.toString() !== actor.id) throw new AppError("This voice command belongs to another user", 403);
  if (command.status !== "TRANSCRIBED") throw new AppError(`Voice command is already ${command.status.toLowerCase()}`, 409);
  command.status = "CANCELLED"; await command.save(); return command;
};

export const listHistory = async (actor: Actor) => {
  const filter = actor.role === "SUPER_ADMIN" ? {} : { actor: actor.id };
  return VoiceCommand.find(filter).populate("actor", "name email").populate("task", "taskId name status").populate("tasks", "taskId name status").sort({ createdAt: -1 }).limit(100).lean();
};
