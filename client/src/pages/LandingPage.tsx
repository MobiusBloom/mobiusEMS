import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Award,
  BarChart3,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileSearch,
  Mic,
  ShieldCheck,
  Users,
} from "lucide-react";
import teamImg from "@/assets/team-collaboration.jpg";
import engineeringImg from "@/assets/engineering-delivery.jpg";
import talentImg from "@/assets/talent-interview.jpg";
import { useAuth } from "@/features/auth/AuthProvider";
import { MarketingNavbar } from "@/components/MarketingNavbar";
import { MarketingFooter } from "@/components/MarketingFooter";
import { productSuite, productSuiteStages } from "@/data/productSuite";
import {
  Particles,
  BorderBeam,
  FlipWords,
  NumberTicker,
  CardSpotlight,
  Marquee,
  ShimmerButton,
  SparklesText,
} from "@/components/inspira";
import "./landing.css";

type ShowroomKey =
  | "Command center"
  | "Executive analytics"
  | "Smart attendance"
  | "AI Resume Screener"
  | "Skill matrix & gaps"
  | "Global workforce";

const showroom: Record<
  ShowroomKey,
  { eyebrow: string; title: string; body: string; proof: string[]; accent: string }
> = {
  "Command center": {
    eyebrow: "Team delivery oversight",
    title: "See reporting lines and unblock work live.",
    body: "Reporting hierarchy views, task review queues, and active blocker alerts with team notes so leadership unblocks delivery without status meetings.",
    proof: ["Reporting line hierarchy", "Live blocker resolution", "Task review queues"],
    accent: "#e8623c",
  },
  "Executive analytics": {
    eyebrow: "Executive analytics",
    title: "Real-time metrics and burnout prevention.",
    body: "Measure on-time delivery rates, completion velocity, and remaining estimated hours per person to defend employee wellbeing.",
    proof: ["Live executive analytics", "On-time delivery %", "Workload capacity radar"],
    accent: "#13896b",
  },
  "Smart attendance": {
    eyebrow: "Geofenced workplace presence",
    title: "Zero-hardware check-in with 300m geofencing.",
    body: "Mobile browser check-ins verified against office coordinates. Automated 11:30 AM late detection, 4-hour half-day rules, and manager regularization without biometric machines.",
    proof: ["Smart workplace geofencing", "Zero biometric hardware", "Live office register"],
    accent: "#136f63",
  },
  "AI Resume Screener": {
    eyebrow: "Advisory recruitment",
    title: "Automated CV fit and qualification scoring.",
    body: "Parse PDF and DOCX resumes against saved Job Descriptions with transparent fit scoring, matched skills, and human decision governance.",
    proof: ["Resume library & ATS", "Documented fit score", "Human-in-the-loop decisions"],
    accent: "#0284c7",
  },
  "Skill matrix & gaps": {
    eyebrow: "Organizational capability",
    title: "Department matrices and competency gaps.",
    body: "Map team capability heatmaps to uncover critical organizational gaps, evaluate verified skills, and recommend targeted training paths.",
    proof: ["Capability matrix heatmap", "Critical gap detection", "Targeted training paths"],
    accent: "#b45309",
  },
  "Global workforce": {
    eyebrow: "Enterprise governance",
    title: "Interactive geo-map and compliance control.",
    body: "Visualize hybrid and remote employee hubs, track geofenced attendance, and enforce granular role-based permissions with immutable audit logs.",
    proof: ["Interactive employee map", "Granular role permissions", "Secure enterprise workspace"],
    accent: "#1e293b",
  },
};
type HumanStoryKey = "leadership" | "engineering" | "recruitment";

interface HumanStoryItem {
  id: HumanStoryKey;
  tabLabel: string;
  role: string;
  badgeIcon: typeof Users;
  headline: string;
  highlightText: string;
  story: string;
  image: string;
  imageAlt: string;
  liveTag: string;
  stat1: { value: number; suffix?: string; label: string };
  stat2: { value: string; label: string };
  ctaText: string;
}

const humanStories: Record<HumanStoryKey, HumanStoryItem> = {
  leadership: {
    id: "leadership",
    tabLabel: "Executive Leadership",
    role: "Operational Governance",
    badgeIcon: Users,
    headline: "Behind every great metric is a",
    highlightText: "trusted team",
    story: "Traditional software treats employees like rows in a database. MobiusEMS gives leadership grounded operational evidence, defends focus time against burnout, and ensures high-stakes decisions remain 100% human-led.",
    image: teamImg,
    imageAlt: "Executive leadership and managers reviewing operational performance together",
    liveTag: "Executive Operations · Live Leadership Insights",
    stat1: { value: 94, suffix: "%", label: "Review satisfaction score" },
    stat2: { value: "100%", label: "Human-led decisions (Zero black-box AI)" },
    ctaText: "Explore executive analytics",
  },
  engineering: {
    id: "engineering",
    tabLabel: "Engineering & Delivery",
    role: "Sprint Delivery & Resolution",
    badgeIcon: CheckCircle2,
    headline: "Unblock critical sprints without",
    highlightText: "status chasing",
    story: "Engineers shouldn't spend half their week in standup meetings just to say they're blocked. With transparent team delivery and active blocker resolution, roadblocks are cleared in minutes with root-cause tags so sprints stay on schedule.",
    image: engineeringImg,
    imageAlt: "Software engineering lead and developers collaborating around dual monitors to resolve an architecture blocker",
    liveTag: "Engineering Sprint · 3.4x Faster Resolution",
    stat1: { value: 92, suffix: "%", label: "On-time delivery rate" },
    stat2: { value: "0", label: "Status update meetings required" },
    ctaText: "Explore sprint velocity",
  },
  recruitment: {
    id: "recruitment",
    tabLabel: "Talent & People Ops",
    role: "Empathetic Candidate Screening",
    badgeIcon: FileSearch,
    headline: "AI screens the resumes.",
    highlightText: "Humans hire the talent.",
    story: "Our recruitment engine parses candidate resumes against job descriptions in seconds and flags missing criteria. But our strict governance ensures algorithms never reject people autonomously—final interviews remain deeply human.",
    image: talentImg,
    imageAlt: "HR director and hiring manager conducting an authentic candidate interview in a modern conference room",
    liveTag: "People Ops · Explainable Fit Scoring",
    stat1: { value: 94, suffix: "%", label: "JD match explanation precision" },
    stat2: { value: "100%", label: "Panel-verified interview decisions" },
    ctaText: "Explore recruitment ATS",
  },
};

const taskRows = [["Launch campaign", "Design", "In review"], ["Client onboarding", "Success", "On track"], ["Quarterly forecast", "Operations", "Attention"]];

export const LandingPage = () => {
  const { user } = useAuth();
  const [activeView, setActiveView] = useState<ShowroomKey>("Command center");
  const [activeStory, setActiveStory] = useState<HumanStoryKey>("leadership");
  const active = showroom[activeView];
  const currentStory = humanStories[activeStory];
  const destination = user ? "/" : "/register";
  useEffect(() => {
    document.title = "MobiusEMS — Complete Operating System for Modern Companies";
    if (window.location.hash) {
      const el = document.getElementById(window.location.hash.slice(1));
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
      }
    }
  }, []);

  return <div className="lp">
    <a className="sr-only focus:not-sr-only" href="#main-content">Skip to content</a>
    <MarketingNavbar />

    <main id="main-content">
      <section className="lp-hero">
        <div className="lp-hero-copy">
          <p className="lp-kicker"><span>01</span> THE COMPLETE WORKFORCE OPERATING SYSTEM</p>
          <h1>
            Run the company.<br/>
            <em>
              Not the{" "}
              <FlipWords
                words={["chaos.", "tool sprawl.", "friction.", "blindspots.", "burnout."]}
                className="text-[#e8623c]"
              />
            </em>
          </h1>
          <p>People, project delivery, verified skills, performance intelligence, and AI—connected in one unified operating system so leadership and teams move in sync without tool sprawl.</p>
          <div className="lp-hero-actions">
            <Link to={destination}>
              <ShimmerButton
                background="#e8623c"
                shimmerColor="#ffffff"
                className="text-sm font-bold py-3.5 px-6 gap-2.5 shadow-xl shadow-orange-900/20"
              >
                Create your workspace <ArrowRight size={18}/>
              </ShimmerButton>
            </Link>
            <a href="#product" className="lp-play-link"><span>↘</span> See MobiusEMS in action</a>
          </div>
          <div className="lp-hero-note"><ShieldCheck size={15}/> Built for human decisions. AI assists and organizes evidence; your people decide.</div>
        </div>

        <div className="lp-product-world relative overflow-hidden" aria-label="Illustrative MobiusEMS product preview">
          {/* Mature Ambient Aurora Glow */}
          <div className="absolute top-[28%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[720px] h-[360px] bg-gradient-to-b from-emerald-400/20 via-teal-400/10 to-transparent rounded-full blur-3xl pointer-events-none animate-aurora-glow" aria-hidden="true" />
          <Particles className="opacity-20" quantity={20} color="#b6e0c6" />
          <span className="lp-world-label">YOUR COMPANY, IN MOTION</span><span className="lp-world-orbit orbit-one"/><span className="lp-world-orbit orbit-two"/>
          <div className="lp-app-shell relative">
            <BorderBeam size={35} duration={12} borderWidth={1.5} colorFrom="#34d399" colorTo="#e8623c" borderRadius={14} />
            <aside className="lp-app-rail"><b className="lp-rail-mark">8</b>{["⌂", "◎", "✓", "◌", "↗"].map((item, index) => <span className={index === 0 ? "active" : ""} key={index}>{item}</span>)}</aside>
            <div className="lp-app-main">
              <div className="lp-app-top"><div><small>MONDAY · COMMAND CENTER</small><strong>Good morning, team.</strong></div><span>Live Delivery Overview</span></div>
              <div className="lp-app-grid">
                <div className="lp-app-focus">
                  <p>THIS WEEK</p>
                  <h2>Work is moving.<br/><em>Three things need you.</em></h2>
                  <div className="lp-app-stats">
                    <span><small>OPEN WORK</small><strong><NumberTicker value={24} /></strong></span>
                    <span><small>ON-TIME</small><strong><NumberTicker value={86} suffix="%" /></strong></span>
                    <span><small>IN REVIEW</small><strong><NumberTicker value={5} /></strong></span>
                  </div>
                  <div className="lp-mini-chart"><div><strong>Delivery rhythm</strong><small>Last 7 days</small></div><div>{[36, 52, 44, 70, 58, 82, 66].map((height, index) => <i key={index} style={{ height: `${height}%` }}/>)}</div></div>
                </div>
                <div className="lp-app-side">
                  <div className="lp-ai-pulse">
                    <span><Bot size={15}/> <SparklesText text="MOBIUSEMS AI" colors={{ first: "#a7d9c3", second: "#f5c94b" }} /></span>
                    <strong>What deserves attention?</strong>
                    <p>Two reviews are ready for approval, all team deliverables are unblocked, and sprint velocity is tracking at 94% on-time delivery.</p>
                    <button type="button">Open insight <ArrowRight size={13}/></button>
                  </div>
                  <div className="lp-team-pulse">
                    <span>TEAM PULSE</span>
                    <strong><NumberTicker value={18} /> of 21</strong>
                    <small>people checked in today</small>
                    <div><i/><i/><i/><i/></div>
                  </div>
                </div>
              </div>
              <div className="lp-task-strip">{taskRows.map(([task, team, state]) => <div key={task}><span>{task[0]}</span><p><strong>{task}</strong><small>{team}</small></p><em className={state === "Attention" ? "warn" : ""}>{state}</em></div>)}</div>
            </div>
          </div>
          <div className="lp-float-card lp-float-left"><Mic size={16}/><span><small>VOICE → TASK</small><strong>2 assignments ready</strong></span></div>
          <div className="lp-float-card lp-float-right"><CheckCircle2 size={16} className="text-emerald-500"/><span><small>SPRINT VELOCITY</small><strong>Milestone 100% unblocked</strong></span></div>
        </div>
      </section>

      <section className="lp-ribbon" aria-label="Platform capabilities">
        <p className="shrink-0 font-bold tracking-widest text-[9px] mr-6">ONE UNIFIED ENGINE FOR</p>
        <Marquee pauseOnHover repeat={4} duration="28s" className="py-0 flex-1">
          {["Employee 360", "Team Delivery Hub", "Sprint Resolution", "Skill Matrix", "Performance Snapshots", "Burnout Radar", "Multilingual Voice", "Attendance Geofencing", "AI Workspace", "Email Automation"].map(item => (
            <span key={item} className="flex items-center gap-4 text-sm font-semibold tracking-wide whitespace-nowrap">
              {item} <i className="not-italic text-amber-200">✦</i>
            </span>
          ))}
        </Marquee>
      </section>

      {/* Editorial Human Collaboration Showcase */}
      <section className="lp-human-story max-w-[1360px] mx-auto px-4 sm:px-8 mt-20 sm:mt-28 mb-20 sm:mb-28 scroll-mt-32" id="human-advantage" aria-label="Human-first workforce collaboration">
        {/* Section Framing Header */}
        <div className="text-center max-w-3xl mx-auto mb-10 sm:mb-14">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-800/20 bg-emerald-800/10 px-4 py-1.5 text-xs font-semibold text-emerald-900 mb-3.5">
            <Users size={14} /> The Human Advantage
          </span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-[#102d2c] leading-[1.12]">
            Software built around <em className="text-[#e8623c]">real people</em>, not spreadsheets.
          </h2>
          <p className="mt-3.5 text-xs sm:text-sm md:text-base text-[#5c6c67] leading-relaxed max-w-2xl mx-auto">
            Technology should elevate human judgment, not replace it. Explore how MobiusEMS equips every role—from frontline engineers and hiring directors to executive leadership.
          </p>

          {/* Interactive Perspective Switcher Tabs */}
          <div className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3.5 mt-7">
            {(Object.keys(humanStories) as HumanStoryKey[]).map((key) => {
              const story = humanStories[key];
              const Icon = story.badgeIcon;
              const isActive = activeStory === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveStory(key)}
                  className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer ${
                    isActive
                      ? "bg-[#102d2c] text-white shadow-md ring-2 ring-[#102d2c]/20 scale-105"
                      : "bg-white text-slate-700 hover:bg-slate-50 border border-[#d9ddd3] hover:border-slate-400 shadow-xs"
                  }`}
                >
                  <Icon size={15} className={isActive ? "text-emerald-400" : "text-slate-500"} />
                  {story.tabLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* The Grand & Spacious Dark Emerald Showcase Card */}
        <div className="relative rounded-3xl overflow-hidden border border-[#102d2c]/15 bg-[#102d2c] text-white shadow-2xl min-h-[580px] lg:min-h-[640px] transition-all duration-300">
          <div className="grid lg:grid-cols-12 items-stretch min-h-[580px] lg:min-h-[640px]">
            {/* Big, Majestic Image Column */}
            <div className="lg:col-span-7 relative min-h-[380px] sm:min-h-[460px] lg:min-h-full overflow-hidden group">
              <img
                key={currentStory.image}
                src={currentStory.image}
                alt={currentStory.imageAlt}
                className="absolute inset-0 h-full w-full object-cover object-center transform group-hover:scale-105 transition-all duration-700 animate-human-fade"
                loading="lazy"
                decoding="async"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#102d2c] via-transparent to-transparent lg:bg-gradient-to-r lg:from-transparent lg:via-transparent lg:to-[#102d2c]" />
              <div className="absolute bottom-6 left-6 rounded-xl bg-black/70 backdrop-blur-md border border-white/20 px-4 py-2.5 text-xs sm:text-sm text-white z-10 shadow-xl">
                <span className="font-semibold text-emerald-400">● {currentStory.liveTag}</span>
              </div>
            </div>

            {/* Spacious, Beautifully Padded Content Column */}
            <div className="lg:col-span-5 p-8 sm:p-10 lg:p-14 flex flex-col justify-between z-10">
              <div className="space-y-5">
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5 text-xs font-semibold text-emerald-300 w-fit">
                  <currentStory.badgeIcon size={14} /> {currentStory.role}
                </span>
                <h3 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight leading-tight">
                  {currentStory.headline}{" "}
                  <em className="text-[#34d399]">{currentStory.highlightText}.</em>
                </h3>
                <p className="text-xs sm:text-sm lg:text-base leading-relaxed text-slate-300">
                  {currentStory.story}
                </p>
              </div>

              <div className="pt-8 mt-8 border-t border-white/15">
                <div className="grid grid-cols-2 gap-6 mb-6">
                  <div>
                    <strong className="block text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white">
                      <NumberTicker value={currentStory.stat1.value} suffix={currentStory.stat1.suffix} />
                    </strong>
                    <small className="text-xs text-slate-400 leading-tight block mt-1">{currentStory.stat1.label}</small>
                  </div>
                  <div>
                    <strong className="block text-2xl sm:text-3xl lg:text-4xl font-extrabold text-emerald-400">
                      {currentStory.stat2.value}
                    </strong>
                    <small className="text-xs text-slate-400 leading-tight block mt-1">{currentStory.stat2.label}</small>
                  </div>
                </div>

                <div>
                  <Link to={destination}>
                    <ShimmerButton
                      background="#ffffff"
                      shimmerColor="#e8623c"
                      className="text-[#102d2c] font-bold text-xs sm:text-sm py-3.5 px-6 gap-2 rounded-full shadow-lg hover:shadow-xl"
                    >
                      {currentStory.ctaText} <ArrowRight size={15} />
                    </ShimmerButton>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-opening scroll-mt-24" id="product"><div className="lp-opening-number">02</div><div><p className="lp-kicker">YOUR COMPANY SHOULD NOT FEEL LIKE 12 DIFFERENT TOOLS</p><h2>From the first check-in<br/>to the final review—<br/><em>one shared story.</em></h2></div><p className="lp-opening-copy">MobiusEMS connects the records that usually live apart. A task informs workload. Completed work becomes evidence. Evidence shapes a better growth conversation. Nothing important disappears between tools.</p></section>

      <section className="lp-showroom">
        <div className="lp-showroom-tabs" role="tablist" aria-label="Explore MobiusEMS">{(Object.keys(showroom) as ShowroomKey[]).map((key, index) => <button type="button" role="tab" aria-selected={activeView === key} className={activeView === key ? "active" : ""} onClick={() => setActiveView(key)} key={key}><span>0{index + 1}</span>{key}</button>)}</div>
        <div className="lp-showroom-scene" style={{ "--scene-accent": active.accent } as CSSProperties}>
          <div className="lp-showroom-copy"><p>{active.eyebrow}</p><h3>{active.title}</h3><div>{active.body}</div><ul>{active.proof.map(item => <li key={item}><Check size={15}/>{item}</li>)}</ul></div>
          <div className="lp-showroom-ui" aria-live="polite"><div className="lp-ui-head"><span/><span/><span/><p>mobius-ems / {activeView.toLowerCase().replace(/[\s&]+/g, "-")}</p></div>
            {activeView === "Command center" && <div className="lp-scene-delivery">
              <div className="lp-scene-title"><span>Team Delivery & Resolution Hub</span><strong>Engineering Team · 3 Members Active</strong></div>
              <div className="lp-surv-roster">
                <div className="lp-surv-chip"><span className="avatar">AS</span><div><strong>Aarav Sharma</strong><small>Senior Lead</small></div><span className="badge-warn">UNBLOCKED</span></div>
                <div className="lp-surv-chip"><span className="avatar">PM</span><div><strong>Priya Mehta</strong><small>Backend Eng</small></div><span className="font-bold text-slate-500">4 Open</span></div>
                <div className="lp-surv-chip"><span className="avatar">RV</span><div><strong>Rahul Verma</strong><small>Frontend Eng</small></div><span className="font-bold text-emerald-600">1 In Review</span></div>
              </div>
              <div className="lp-blocker-card">
                <div className="lp-blocker-head"><CheckCircle2 size={13}/> SPRINT MILESTONE · READY FOR LAUNCH</div>
                <p className="lp-blocker-title">Employee 360 & Skill Gap Benchmarking Rollout</p>
                <p className="lp-blocker-quote">&ldquo;Milestone sign-off complete: HR Operations approved department competency thresholds. Automated notification dispatched to 48 employees.&rdquo;</p>
                <div className="lp-blocker-footer"><span>Owner: Aarav Sharma · Sprint on schedule</span><button type="button">View Milestone ↗</button></div>
              </div>
            </div>}

            {activeView === "Executive analytics" && <div className="lp-scene-exec">
              <div className="lp-exec-telemetry">
                <span className="lp-telemetry-pill"><span className="inline-block size-2 animate-ping rounded-full bg-emerald-500"/> Live Leadership Analytics</span>
                <span><strong><NumberTicker value={86.4} decimalPlaces={1} suffix="%" /></strong> On-Time Delivery Rate</span>
              </div>
              <table className="lp-radar-table">
                <thead><tr><th>Employee</th><th>Tasks</th><th>Remaining Hours</th><th>Burnout Status</th></tr></thead>
                <tbody>
                  <tr>
                    <td><strong>Priya Mehta</strong><br/><small>Backend</small></td>
                    <td>6 tasks</td>
                    <td><span>42h</span><div className="lp-load-bar"><div className="lp-load-bar-fill bg-red-500" style={{ width: "92%" }}/></div></td>
                    <td><span className="lp-status-pill lp-status-red">Overloaded</span></td>
                  </tr>
                  <tr>
                    <td><strong>Rahul Verma</strong><br/><small>Frontend</small></td>
                    <td>4 tasks</td>
                    <td><span>26h</span><div className="lp-load-bar"><div className="lp-load-bar-fill bg-amber-500" style={{ width: "56%" }}/></div></td>
                    <td><span className="lp-status-pill lp-status-amber">High Load</span></td>
                  </tr>
                  <tr>
                    <td><strong>Ananya Iyer</strong><br/><small>Design & UX</small></td>
                    <td>2 tasks</td>
                    <td><span>14h</span><div className="lp-load-bar"><div className="lp-load-bar-fill bg-emerald-500" style={{ width: "28%" }}/></div></td>
                    <td><span className="lp-status-pill lp-status-green">Balanced</span></td>
                  </tr>
                </tbody>
              </table>
              <small className="italic text-[10px] text-slate-500">Workload hours radar protects staff from burnout; strictly separated from review scores.</small>
            </div>}

            {activeView === "Smart attendance" && <div className="lp-scene-attendance">
              <div className="lp-attendance-pacing">
                <div><small className="text-[9px] text-slate-300">TODAY&apos;S WORKPLACE ATTENDANCE · BENGALURU HQ</small><strong className="block text-sm"><NumberTicker value={88.5} decimalPlaces={1} suffix="%" /> Checked In (46 of 52 Active)</strong></div>
                <span className="text-[10px] font-semibold text-emerald-400">300m Geofence Verified</span>
              </div>
              <div className="lp-attendance-kanban">
                <div className="lp-attendance-col">
                  <div className="lp-attendance-col-title"><span>ON-TIME ARRIVALS</span><strong>38</strong></div>
                  <div className="lp-attendance-item"><strong>Aarav Sharma</strong><small>Senior Lead · 09:12 AM</small><span className="status status-on-time">● Present (300m verified)</span></div>
                  <div className="lp-attendance-item"><strong>Priya Mehta</strong><small>Backend Eng · 09:35 AM</small><span className="status status-on-time">● Present (300m verified)</span></div>
                </div>
                <div className="lp-attendance-col">
                  <div className="lp-attendance-col-title"><span>LATE / REGULARIZATION</span><strong>4</strong></div>
                  <div className="lp-attendance-item"><strong>Rahul Verma</strong><small>Frontend Eng · 11:42 AM</small><span className="status status-late">● Late (11:30 cutoff)</span></div>
                  <div className="lp-attendance-item"><strong>Kavya Reddy</strong><small>Operations Analyst</small><span className="status status-late">● Reg Request Pending</span></div>
                </div>
                <div className="lp-attendance-col">
                  <div className="lp-attendance-col-title"><span>APPROVED LEAVE</span><strong>2</strong></div>
                  <div className="lp-attendance-item"><strong>Ananya Iyer</strong><small>UI Specialist</small><span className="status status-leave">● Casual Leave (Day 1/2)</span></div>
                  <div className="lp-attendance-item"><strong>Dev Kulkarni</strong><small>Data Analyst</small><span className="status status-leave">● Sick Leave (Approved)</span></div>
                </div>
              </div>
            </div>}

            {activeView === "AI Resume Screener" && <div className="lp-scene-screener">
              <div className="lp-screener-card">
                <div className="lp-screener-header">
                  <div>
                    <strong className="block text-xs">Pooja Deshmukh, B.Tech</strong>
                    <small className="text-[9px] text-slate-500">JD-102 · Senior Full-Stack Engineer</small>
                  </div>
                  <span className="lp-score-badge"><Check size={12}/> <NumberTicker value={94} suffix="%" /> Fit</span>
                </div>
                <div className="lp-skill-chips">
                  <span className="lp-chip-match"><Check size={10}/> React & TypeScript</span>
                  <span className="lp-chip-match"><Check size={10}/> Node.js & Microservices</span>
                  <span className="lp-chip-match"><Check size={10}/> PostgreSQL & Indexing</span>
                  <span className="lp-chip-miss">! AWS Solution Architect Cert</span>
                </div>
                <div className="lp-human-advisory">
                  <strong>Human-in-the-loop:</strong> Algorithmic scores are advisory. Employment decisions require human interview panels.
                </div>
              </div>
            </div>}

            {activeView === "Skill matrix & gaps" && <div className="lp-scene-matrix">
              <div className="lp-matrix-preview">
                <div className="lp-matrix-row border-b pb-1 font-bold text-slate-500"><span>Capability</span><span>Lead</span><span>Senior</span><span>Staff</span></div>
                <div className="lp-matrix-row"><span>Distributed Arch</span><span className="lp-matrix-badge lp-matrix-expert">Expert</span><span className="lp-matrix-badge lp-matrix-proficient">Proficient</span><span className="lp-matrix-badge lp-matrix-expert">Expert</span></div>
                <div className="lp-matrix-row"><span>Cloud Infra</span><span className="lp-matrix-badge lp-matrix-proficient">Proficient</span><span className="lp-matrix-badge lp-matrix-gap">CRITICAL GAP</span><span className="lp-matrix-badge lp-matrix-gap">GAP</span></div>
                <div className="lp-matrix-row"><span>Security & Access Control</span><span className="lp-matrix-badge lp-matrix-expert">Expert</span><span className="lp-matrix-badge lp-matrix-proficient">Proficient</span><span className="lp-matrix-badge lp-matrix-proficient">Proficient</span></div>
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-2 text-[10px] text-amber-800">
                <AlertTriangle size={14} className="shrink-0 text-amber-600"/><span>2 team gaps detected in Cloud Infra · Suggested training auto-assigned</span>
              </div>
            </div>}

            {activeView === "Global workforce" && <div className="lp-scene-geo">
              <div className="lp-geo-grid">
                <div className="lp-geo-card"><small>Bengaluru Tech HQ</small><strong><NumberTicker value={48} /> Employees</strong><span>45 Checked In (94%)</span></div>
                <div className="lp-geo-card"><small>Mumbai Operations Hub</small><strong><NumberTicker value={32} /> Employees</strong><span>30 Checked In (94%)</span></div>
                <div className="lp-geo-card"><small>Delhi NCR Branch</small><strong><NumberTicker value={24} /> Employees</strong><span>22 Checked In (92%)</span></div>
                <div className="lp-geo-card"><small>Remote & Hybrid</small><strong><NumberTicker value={16} /> Employees</strong><span>15 Active Today</span></div>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-100 p-2 text-[10px] text-slate-500"><span>Tenant: Multi-Org Isolated</span><span>Audit Logging: 100% Immutable</span></div>
            </div>}
          </div>
        </div>
      </section>

      <section className="lp-ai-story scroll-mt-24" id="intelligence">
        <div className="lp-ai-heading"><span className="lp-section-number">03</span><p className="lp-kicker"><SparklesText text="INTELLIGENCE, WITH STRICT BOUNDARIES" colors={{ first: "#6557d9", second: "#e8623c" }} /></p><h2>AI that knows the work.<br/><em>And knows its place.</em></h2></div>
        <div className="lp-ai-conversation">
          <div className="lp-ai-avatar"><Bot size={31}/><i/></div>
          <p className="lp-ai-question">“What should I pay attention to before the executive review?”</p>
          <div className="lp-ai-answer"><Bot size={18}/><div><strong>Here is the short version.</strong><p>Two tasks are awaiting review, the Q3 appraisal calibration has been cleared by the Lead, and team delivery velocity is tracking on schedule.</p><div><span>View overdue work ↗</span><span>Open team workload ↗</span></div></div></div>
          <small><ShieldCheck size={13}/> Permission-aware · Grounded in available records · Human-reviewed decisions</small>
        </div>
        <div className="lp-ai-capabilities">
          <article><span>01</span><h3>Ask the workplace</h3><p>Get useful answers from records and approved company knowledge you are permitted to access.</p></article>
          <article><span>02</span><h3>Draft the summary</h3><p>Turn verified contributions and delivery evidence into a clear first draft for manager review.</p></article>
          <article><span>03</span><h3>Find the next move</h3><p>Surface workload bottlenecks, review queues, and delivery signals so managers act with context.</p></article>
        </div>
      </section>

      {/* Section 04: The Enterprise Engine */}
      <section className="lp-engine scroll-mt-24" id="enterprise-engine">
        <div className="lp-engine-header">
          <div className="lp-opening-number">04</div>
          <div><p className="lp-kicker">BUILT FOR REAL ENTERPRISE OPERATORS</p><h2>Under the hood.<br/><em>Where standard tools stop.</em></h2></div>
          <p className="lp-engine-intro">Most platforms show simple Kanban cards and stop there. MobiusEMS powers mission-critical workforce operations: hierarchical delivery resolution, verified skill heatmaps, evidence-based performance reviews, and proactive workload defense.</p>
        </div>

        <div className="lp-engine-grid">
          {/* Feature 1: Team Delivery Oversight & Rapid Resolution */}
          <CardSpotlight className="lp-engine-card" color="rgba(19, 137, 107, 0.08)">
            <div>
              <div className="lp-engine-top"><span className="lp-engine-badge badge-forest"><CheckCircle2 size={13}/> TEAM WORK OVERSIGHT</span><span className="font-mono text-xs text-slate-400">01</span></div>
              <h3>Hierarchical Delivery & Real-Time Resolution</h3>
              <p>Managers and team leads maintain clear visibility across reporting lines. When work encounters dependencies, leads clear roadblocks immediately with contextual notes—keeping sprints moving without endless status meetings.</p>
              <div className="lp-engine-features">
                <span><Check size={12}/> Reporting line hierarchy</span>
                <span><Check size={12}/> Rapid roadblock resolution</span>
                <span><Check size={12}/> Live task review queues</span>
              </div>
            </div>
            <div className="lp-engine-mockup">
              <div className="mb-3.5 rounded-lg overflow-hidden h-28 relative border border-slate-200/90 shadow-xs group">
                <img src={engineeringImg} alt="Engineering delivery team" loading="lazy" decoding="async" className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent flex items-end p-2.5">
                  <span className="text-[10px] text-white font-semibold tracking-wide">
                    ● Real-Time Team Delivery · 100% Sprints Unblocked
                  </span>
                </div>
              </div>
              <div className="lp-blocker-card">
                <div className="lp-blocker-head"><CheckCircle2 size={14}/> SPRINT RESOLUTION · ROADBLOCK CLEARED</div>
                <p className="lp-blocker-title">Q3 Appraisal Calibration & Peer Review Cycle</p>
                <p className="lp-blocker-quote">&ldquo;Roadblock cleared in 8 mins: Department Head approved updated evaluation rubrics and compensation bands. All 14 team reviews are 100% on schedule.&rdquo;</p>
                <div className="lp-blocker-footer">
                  <span>Assigned: Aarav Sharma (Engineering Lead) · On Schedule</span>
                  <button type="button">View Milestone ↗</button>
                </div>
              </div>
            </div>
          </CardSpotlight>

          {/* Feature 2: Verified Skill Matrix & Organizational Heatmaps */}
          <CardSpotlight className="lp-engine-card" color="rgba(101, 87, 217, 0.08)">
            <div>
              <div className="lp-engine-top"><span className="lp-engine-badge badge-violet"><Award size={13}/> SKILL MATRIX & GAPS</span><span className="font-mono text-xs text-slate-400">02</span></div>
              <h3>Verified Skill Matrix & Heatmaps</h3>
              <p>Go beyond self-reported claims. Map validated employee skills against role expectations, uncover critical organizational gaps, and build targeted training paths for continuous workforce growth.</p>
              <div className="lp-engine-features">
                <span><Check size={12}/> Evidence-verified capabilities</span>
                <span><Check size={12}/> Department competency heatmaps</span>
                <span><Check size={12}/> Automated role-gap detection</span>
              </div>
            </div>
            <div className="lp-engine-mockup">
              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between font-medium">
                  <span className="text-slate-700">Engineering Capability Heatmap</span>
                  <span className="text-[11px] font-bold text-emerald-600">14 Verified Competencies</span>
                </div>
                <div className="space-y-2 rounded-lg border border-slate-200/80 bg-white p-2.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium text-slate-800">Distributed Systems</span>
                    <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-bold text-emerald-700">Expert · 96%</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium text-slate-800">Cloud Infrastructure</span>
                    <span className="rounded-md bg-amber-50 px-2 py-0.5 font-bold text-amber-700">Gap · Training Active</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium text-slate-800">Security & Access Control</span>
                    <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-bold text-emerald-700">Proficient · 88%</span>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-1 text-[10px] text-slate-500">
                  <span>Role Coverage: 92%</span>
                  <span>Evaluations: Independent</span>
                </div>
              </div>
            </div>
          </CardSpotlight>

          {/* Feature 3: Advisory Candidate Screening & Transparent Fit */}
          <CardSpotlight className="lp-engine-card" color="rgba(19, 137, 107, 0.08)">
            <div>
              <div className="lp-engine-top"><span className="lp-engine-badge badge-forest"><FileSearch size={13}/> ADVISORY RESUME SCREENER</span><span className="font-mono text-xs text-slate-400">03</span></div>
              <h3>Transparent JD Fit & Skill Matching</h3>
              <p>Screen applicant resumes against saved Job Descriptions with transparent criteria matching. Highlights verified skills and missing prerequisites while strictly keeping hiring decisions 100% human-led.</p>
              <div className="lp-engine-features">
                <span><Check size={12}/> PDF & DOCX extraction</span>
                <span><Check size={12}/> Documented fit explanation</span>
                <span><Check size={12}/> Missing criteria alerts</span>
              </div>
            </div>
            <div className="lp-engine-mockup">
              <div className="mb-3.5 rounded-lg overflow-hidden h-28 relative border border-slate-200/90 shadow-xs group">
                <img src={talentImg} alt="HR candidate interview panel" loading="lazy" decoding="async" className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent flex items-end p-2.5">
                  <span className="text-[10px] text-white font-semibold tracking-wide">
                    ● Human Interview Panel · Explainable Fit Verification
                  </span>
                </div>
              </div>
              <div className="lp-screener-card">
                <div className="lp-screener-header">
                  <div>
                    <p className="text-xs font-bold">Pooja Deshmukh · Senior Full-Stack Candidate</p>
                    <p className="text-[10px] text-slate-400">Match against JD-102: Senior Software Engineer</p>
                  </div>
                  <span className="lp-score-badge"><Check size={12}/> 94% Fit</span>
                </div>
                <div className="lp-skill-chips">
                  <span className="lp-chip-match"><Check size={10}/> React & TypeScript</span>
                  <span className="lp-chip-match"><Check size={10}/> Node.js & Express</span>
                  <span className="lp-chip-match"><Check size={10}/> PostgreSQL & Analytics</span>
                  <span className="lp-chip-miss">! System Design Cert Required</span>
                </div>
              </div>
            </div>
          </CardSpotlight>

          {/* Feature 4: Executive Workload Radar & Burnout Defense */}
          <CardSpotlight className="lp-engine-card" color="rgba(245, 158, 11, 0.08)">
            <div>
              <div className="lp-engine-top"><span className="lp-engine-badge badge-amber"><BarChart3 size={13}/> EXECUTIVE ANALYTICS</span><span className="font-mono text-xs text-slate-400">04</span></div>
              <h3>Workload Radar & Burnout Defense</h3>
              <p>Protect team capacity before delivery suffers. Super Admin analytics track remaining estimated hours per person, surface overcommitted engineers, and integrate employee focus rhythms.</p>
              <div className="lp-engine-features">
                <span><Check size={12}/> Real-time operational metrics</span>
                <span><Check size={12}/> Estimated hours capacity</span>
                <span><Check size={12}/> Micro-breaks & mood rhythms</span>
              </div>
            </div>
            <div className="lp-engine-mockup">
              <div className="mb-3.5 rounded-lg overflow-hidden h-28 relative border border-slate-200/90 shadow-xs group">
                <img src={teamImg} alt="Leadership analytics and workload capacity review" loading="lazy" decoding="async" className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent flex items-end p-2.5">
                  <span className="text-[10px] text-white font-semibold tracking-wide">
                    ● Leadership Analytics · Capacity & Burnout Defense
                  </span>
                </div>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Priya M. · 6 open tasks</span>
                  <span className="lp-status-pill lp-status-red">44h · Overloaded</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-red-500" style={{ width: "92%" }}/>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="font-medium">Aarav S. · 3 open tasks</span>
                  <span className="lp-status-pill lp-status-amber">26h · High Load</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-amber-500" style={{ width: "58%" }}/>
                </div>
              </div>
            </div>
          </CardSpotlight>
        </div>
      </section>

      <section className="lp-feature-atlas scroll-mt-24" id="features">
        <div className="lp-feature-atlas-head"><span className="lp-section-number">05</span><div><p className="lp-kicker">EVERY FEATURE HAS A JOB</p><h2>One platform.<br/><em>Zero mystery.</em></h2></div><p>Here is exactly what each part of MobiusEMS does, who it is for, and what it helps your company decide next.</p></div>
        <div className="lp-feature-atlas-grid">
          {[
            ["People 360", "A single source of truth for every employee, team, role, location, and reporting line.", "HR & leadership", "Know who is here, who owns what, and where support is needed."],
            ["Work & Task Tracker", "Turn goals into assigned work with owners, due dates, status, priorities, and review queues.", "Every team", "See what is moving, what is late, and what needs a decision."],
            ["Performance & Contributions", "Connect completed work and verified evidence to fair, review-ready growth conversations.", "Managers", "Replace memory-based reviews with a clear record of impact."],
            ["Onboarding & Development", "Guide new hires through structured steps, then turn skill gaps into focused learning paths.", "People ops", "Move from first day to next capability without dropped handoffs."],
            ["Governance & Security", "Control access by tenant, role, and section while keeping a durable audit trail of sensitive actions.", "Admins & compliance", "Scale confidently without losing accountability."],
            ["Email Automation", "Create repeatable, permission-aware messages for onboarding, reminders, updates, and workflows.", "Operations", "Keep routine communication moving while people focus on judgment."],
          ].map(([title, description, audience, outcome], index) => <article key={title}><div className="lp-feature-atlas-index">0{index + 1}</div><div><span>{audience}</span><h3>{title}</h3><p>{description}</p><strong>→ {outcome}</strong></div></article>)}
        </div>
      </section>

      <section className="lp-complete-suite scroll-mt-24" id="complete-suite" aria-labelledby="complete-suite-title">
        <div className="lp-complete-suite-head">
          <span className="lp-section-number">50</span>
          <div>
            <p className="lp-kicker">THE COMPLETE MOBIUSEMS SUITE</p>
            <h2 id="complete-suite-title">Every capability.<br/><em>One connected platform.</em></h2>
          </div>
          <p>Explore all 50 workforce, people operations, sales, intelligence, and enterprise capabilities in the MobiusEMS product suite.</p>
        </div>
        <div className="lp-complete-suite-stages">
          {productSuiteStages.map(({ stage, label }) => (
            <section key={stage} aria-labelledby={`suite-stage-${stage}`}>
              <div className="lp-complete-suite-stage-head">
                <span>0{stage}</span>
                <h3 id={`suite-stage-${stage}`}>{label}</h3>
              </div>
              <div className="lp-complete-suite-grid">
                {productSuite.filter((feature) => feature.stage === stage).map((feature) => (
                  <article id={feature.id} key={feature.id} className="scroll-mt-28">
                    <span>{feature.id}</span>
                    <h4>{feature.name}</h4>
                    <p>{feature.description}</p>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="lp-voice relative overflow-hidden scroll-mt-24" id="voice">
        <div className="lp-voice-wave" aria-hidden="true">{[24,42,72,38,88,58,98,48,77,32,64,92,54,34,70,44,82,26].map((height,index)=><i key={index} style={{height:`${height}%`}}/>)}</div><div className="lp-voice-copy"><span><Mic size={20}/> MULTILINGUAL VOICE CONTROL</span><h2>Work said out loud.<br/><em>Work ready to move.</em></h2><p>Speak naturally. MobiusEMS turns the note into editable assignments, owners, and deadlines across English and Indian languages. You review everything before it becomes real.</p><blockquote>“Create the launch assets for the Design team, and assign the client follow-up to Client Success by tomorrow.”</blockquote><div><span><Check size={15}/> 2 task previews</span><span><Clock3 size={15}/> Deadline detected</span><span><Users size={15}/> Teams matched</span></div></div></section>

      <section className="lp-chapters scroll-mt-24" id="why"><div className="lp-chapters-intro"><span className="lp-section-number">06</span><p className="lp-kicker">THE POWER OF COMPLETE CONNECTION</p><h2>Less software to manage.<br/>More company to understand.</h2></div><div className="lp-chapter-list">{[[Users, "People & Global Footprint", "Profiles, departments, onboarding, geofenced attendance, and interactive employee maps stay organized."], [CheckCircle2, "Delivery & Sprint Resolution", "Reporting line hierarchy, real-time roadblock resolution, and active review queues without status chasing."], [Award, "Capability & Talent Matrix", "Skill assessments, verified competency heatmaps, and evidence-grounded performance reviews in one workspace."], [ShieldCheck, "Ethical Governance & Control", "Dedicated workspace isolation, role-based access control, and recommendation-only AI keeping decisions 100% human-led."]].map(([Icon, title, text], index) => { const ChapterIcon = Icon as typeof Users; return <CardSpotlight key={title as string} color="rgba(19, 137, 107, 0.06)"><article className="border-0"><span>0{index + 1}</span><ChapterIcon size={24}/><h3>{title as string}</h3><p>{text as string}</p><i>↗</i></article></CardSpotlight>; })}</div></section>

      <section className="lp-outcomes"><p className="lp-kicker">WHAT CHANGES WHEN WORK CONNECTS</p><div>{[["From", "Status chasing", "to", "Live Sprint Resolution"], ["From", "Scattered tools", "to", "Unified Workforce Operations"], ["From", "Reactive burnout", "to", "Workload Capacity Radar"]].map(([beforeLabel,before,afterLabel,after]) => <p key={before}><small>{beforeLabel}</small><span>{before}</span><i>→</i><small>{afterLabel}</small><strong>{after}</strong></p>)}</div></section>

      <section className="lp-principles scroll-mt-24" id="principles"><ShieldCheck size={34}/><p className="lp-kicker">PEOPLE STAY IN CHARGE</p><h2>AI can organize the evidence.<br/>It cannot replace judgment.</h2><p>Granular role-based permissions, immutable audit history, editable previews, and recommendation-only AI keep employment decisions explainable and in human hands.</p></section>

      <section className="lp-faq scroll-mt-24" id="faq"><div><span className="lp-section-number">07</span><p className="lp-kicker">STRAIGHT ANSWERS</p><h2>Before you bring<br/>everyone together.</h2></div><div>{[["What makes MobiusEMS different from simple project tools?", "Traditional tools only track static task cards. MobiusEMS unites dynamic organizational hierarchy, real-time blocker triage, verified skill matrices, explainable performance intelligence, and employee workload analytics into one seamless employee management platform."], ["How does MobiusEMS handle performance reviews?", "Performance evaluations in MobiusEMS are grounded in verified contribution evidence, completed tasks, and transparent weighted KPIs. The platform strictly excludes black-box automated rankings—managers retain full context and make all review decisions."], ["How does the AI Resume Screener work?", "The screener automatically parses PDF and DOCX resumes, matches candidate experience against saved Job Descriptions (JDs), highlights matching vs missing skills, and calculates a documented fit percentage. The AI is advisory; human interviewers make the final hiring decisions."], ["How does MobiusEMS identify and defend against employee burnout?", "The dashboard calculates remaining estimated hours for open work per person and flags overloaded team members on a live Workload Radar, helping managers reassign tasks and promote focus rhythms before burnout occurs."], ["What is the Team Delivery & Resolution Hub?", "It allows team leads, department heads, and managers to filter by reporting lines, clear task dependencies with real-time notes, inspect pending reviews, and keep execution moving smoothly without scheduling meetings."], ["Does AI make decisions about employees?", "Never. AI only answers questions, parses documents, and drafts summaries from permitted records. Managers review the evidence and remain fully responsible for every promotion, compensation, and staffing decision."]].map(([question,answer]) => <details key={question}><summary>{question}<ChevronDown size={18}/></summary><p>{answer}</p></details>)}</div></section>

      <section className="lp-final relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[320px] bg-white/10 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
        <span className="lp-final-orbit"/>
        <b className="lp-final-mark">8</b>
        <p className="lp-kicker">YOUR COMPANY IS ALREADY MOVING</p>
        <h2>Give it one place<br/><em>to move together.</em></h2>
        <div className="relative z-10 flex flex-wrap items-center justify-center gap-5">
          <Link to={destination}>
            <ShimmerButton background="#ffffff" shimmerColor="#e8623c" className="text-stone-900 font-bold text-sm py-4 px-7 gap-2.5 shadow-xl">
              Build your workspace <ArrowRight size={18}/>
            </ShimmerButton>
          </Link>
          <Link to={user ? "/" : "/login"} className="text-white font-semibold text-xs hover:underline">{user ? "Return to workspace" : "Sign in to your team"} ↗</Link>
        </div>
      </section>
    </main>

    <MarketingFooter />
  </div>;
};


