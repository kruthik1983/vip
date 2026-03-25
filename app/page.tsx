export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#070b16] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-[-120px] h-[340px] w-[340px] rounded-full bg-fuchsia-500/30 blur-3xl" />
        <div className="absolute right-[-120px] top-[120px] h-[360px] w-[360px] rounded-full bg-cyan-400/25 blur-3xl" />
        <div className="absolute bottom-[-140px] left-1/2 h-[360px] w-[360px] -translate-x-1/2 rounded-full bg-blue-500/20 blur-3xl" />
      </div>

      <main className="relative mx-auto flex w-full max-w-7xl flex-col gap-12 px-6 pb-14 pt-8 lg:px-10">
        <nav className="flex items-center justify-between rounded-2xl border border-white/15 bg-white/5 px-4 py-3 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="relative h-10 w-10">
              <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-400" />
              <div className="absolute inset-[3px] rounded-[10px] bg-[#0a1020]" />
              <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[4px] border border-cyan-300/70 bg-cyan-400/20" />
              <div className="absolute right-1 top-1 h-2 w-2 rounded-full bg-fuchsia-400" />
              <div className="absolute bottom-1 left-1 h-1.5 w-1.5 rounded-full bg-indigo-300" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-wide">VIRTUAL INTERVIEW PLATFORM</p>
              <p className="text-xs text-slate-300">AI-driven hiring workflow</p>
            </div>
          </div>
          <div className="hidden items-center gap-3 sm:flex">
            <button className="rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10">
              Live Demo
            </button>
            <button className="rounded-lg bg-gradient-to-r from-violet-500 to-cyan-400 px-4 py-2 text-sm font-semibold text-[#041022] transition hover:brightness-110">
              Start Hiring
            </button>
          </div>
        </nav>

        <section className="grid items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="mb-4 inline-flex items-center rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-medium text-cyan-200">
              Built for fast, structured interview operations
            </div>
            <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              Hire top talent faster with
              <span className="bg-gradient-to-r from-fuchsia-300 via-violet-200 to-cyan-200 bg-clip-text text-transparent">
                {" "}
                one beautiful workflow
              </span>
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
              From candidate application to assessment, interview, AI summary, and HR decision — everything is managed in one unified experience.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#061126] transition hover:bg-slate-100">
                Create Interview
              </button>
              <button className="rounded-xl border border-white/25 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
                View Candidate Pipeline
              </button>
            </div>

            <div className="mt-8 grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Open Roles", value: "24" },
                { label: "Candidates", value: "1.4K" },
                { label: "Completion", value: "93%" },
                { label: "Avg Score", value: "78" },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-white/15 bg-white/5 px-3 py-3 text-center backdrop-blur-sm">
                  <p className="text-lg font-semibold text-white">{item.value}</p>
                  <p className="text-[11px] uppercase tracking-wide text-slate-300">{item.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/15 bg-white/8 p-4 shadow-[0_20px_80px_-20px_rgba(56,189,248,0.45)] backdrop-blur-xl">
            <div className="rounded-2xl border border-white/10 bg-[#091227] p-4">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-200">Hiring Command Center</p>
                <span className="rounded-full border border-emerald-300/30 bg-emerald-300/15 px-2 py-1 text-xs font-medium text-emerald-200">
                  Live
                </span>
              </div>

              <div className="space-y-3">
                {[
                  ["Frontend Engineer", "42 applicants", "Assessment Running"],
                  ["Backend Engineer", "35 applicants", "Interview Stage"],
                  ["Product Engineer", "29 applicants", "Decision Pending"],
                ].map((row) => (
                  <div key={row[0]} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-100">{row[0]}</p>
                      <span className="text-xs text-slate-300">{row[1]}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-700/50">
                      <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-violet-400 to-cyan-300" />
                    </div>
                    <p className="mt-2 text-xs text-slate-300">{row[2]}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              title: "Assessment Engine",
              text: "Timed MCQ rounds with scoring and anti-cheat signals.",
              tone: "from-indigo-500/25 to-violet-500/10",
            },
            {
              title: "Interview Studio",
              text: "Structured Q&A with fallback prompts and recording support.",
              tone: "from-cyan-500/20 to-blue-500/10",
            },
            {
              title: "AI Summaries",
              text: "Auto-generated communication and technical depth insights.",
              tone: "from-fuchsia-500/20 to-purple-500/10",
            },
            {
              title: "Decision + Export",
              text: "Bulk accept/reject plus ready-to-share Excel output.",
              tone: "from-emerald-500/20 to-teal-500/10",
            },
          ].map((card) => (
            <article
              key={card.title}
              className="rounded-2xl border border-white/15 bg-white/5 p-5 backdrop-blur-md"
            >
              <div className={`mb-4 h-1.5 w-16 rounded-full bg-gradient-to-r ${card.tone}`} />
              <h3 className="text-lg font-semibold text-white">{card.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">{card.text}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
