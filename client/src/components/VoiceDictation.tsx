import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/Button";

type SpeechEvent = { results: ArrayLike<{ isFinal: boolean; 0?: { transcript: string } }> };
type Recognition = { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; abort(): void; onresult: ((event: SpeechEvent) => void) | null; onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null };
type Constructor = new () => Recognition;
const languages = [["en-IN", "English"], ["hi-IN", "हिन्दी"], ["bn-IN", "বাংলা"], ["ta-IN", "தமிழ்"], ["te-IN", "తెలుగు"], ["mr-IN", "मराठी"], ["gu-IN", "ગુજરાતી"], ["kn-IN", "ಕನ್ನಡ"], ["ml-IN", "മലയാളം"], ["pa-IN", "ਪੰਜਾਬੀ"], ["ur-IN", "اردو"]];

export function VoiceDictation({ onTranscript, disabled }: { onTranscript: (text: string) => void; disabled?: boolean }) {
  const recognition = useRef<Recognition | null>(null);
  const callback = useRef(onTranscript);
  callback.current = onTranscript;
  const [language, setLanguage] = useState("en-IN");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const [heard, setHeard] = useState("");
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    if (disabled) recognition.current?.stop();
  }, [disabled]);
  useEffect(() => {
    const speechWindow = window as typeof window & { SpeechRecognition?: Constructor; webkitSpeechRecognition?: Constructor };
    setSupported(Boolean(speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition));
    return () => { if (recognition.current) { recognition.current.onresult = null; recognition.current.onend = null; recognition.current.onerror = null; recognition.current.abort(); } };
  }, []);
  const start = () => {
    const speechWindow = window as typeof window & { SpeechRecognition?: Constructor; webkitSpeechRecognition?: Constructor };
    const SpeechRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const instance = new SpeechRecognition();
    recognition.current = instance;
    instance.lang = language; instance.continuous = true; instance.interimResults = false;
    let delivered = 0;
    let transcript = "";
    instance.onresult = event => {
      for (; delivered < event.results.length; delivered++) {
        const result = event.results[delivered];
        if (!result.isFinal) break;
        const text = result[0]?.transcript.trim();
        if (text) { transcript += `${text} `; callback.current(text); setHeard(transcript.trim()); }
      }
    };
    instance.onerror = event => { setError(event.error === "not-allowed" ? "Microphone access was denied. Allow microphone access in your browser and try again." : event.error === "no-speech" ? "No speech detected. Try again and speak clearly." : "Speech recognition stopped. Check your connection and try again, or type your update."); setListening(false); };
    instance.onend = () => setListening(false);
    setError(""); setHeard("");
    try { instance.start(); setListening(true); }
    catch { setError("Could not start the microphone. Stop any other voice recording and try again."); }
  };
  return <div className="space-y-3 rounded-xl border border-brand-100 bg-brand-50/40 p-4">
    <div className="flex flex-wrap items-end gap-3"><label className="text-sm font-semibold">Speaking language<select className="mt-1 block h-11 rounded-xl border bg-white px-3" disabled={listening || disabled} value={language} onChange={event => setLanguage(event.target.value)}>{languages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><Button type="button" variant="secondary" disabled={!supported || disabled} onClick={() => listening ? recognition.current?.stop() : start()}>{listening ? <MicOff size={16}/> : <Mic size={16}/>} {listening ? "Stop dictation" : "Speak into selected section"}</Button></div>
    <p className="text-sm text-slate-600">{!supported ? "Voice dictation is unavailable in this browser. Try Chrome or Edge, or type your update." : listening ? "Listening… spoken text is appended to the selected section. Stop before changing sections." : "Choose a section below, then speak. Review the text before submitting."}</p>
    {heard && <p role="status" className="whitespace-pre-wrap text-sm text-slate-600">Heard: {heard}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
}
