"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentOrganizationAdmin } from "@/lib/organization-auth";
import { supabase } from "@/lib/supabase";

interface AssessmentSlot {
    slotStartUtc: string;
    slotEndUtc: string;
}

interface InterviewSlot {
    slotStartUtc: string;
    slotEndUtc: string;
}

interface AssessmentOption {
    label: string;
    text: string;
    isCorrect: boolean;
}

interface AssessmentQuestion {
    questionText: string;
    options: AssessmentOption[];
}

interface InterviewQuestion {
    questionText: string;
    difficulty: "EASY" | "MEDIUM" | "HARD";
}

function Part2Content() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const interviewId = searchParams.get("interviewId");

    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const [campaignStartUtc, setCampaignStartUtc] = useState<string | null>(null);
    const [campaignEndUtc, setCampaignEndUtc] = useState<string | null>(null);

    const [assessmentSlots, setAssessmentSlots] = useState<AssessmentSlot[]>([]);
    const [assessmentFirstSlotTime, setAssessmentFirstSlotTime] = useState("09:00");
    const [assessmentSlotCount, setAssessmentSlotCount] = useState("5");
    const [assessmentSlotCapacity, setAssessmentSlotCapacity] = useState("10");

    const [interviewSlots, setInterviewSlots] = useState<InterviewSlot[]>([]);
    const [interviewFirstSlotTime, setInterviewFirstSlotTime] = useState("09:30");
    const [interviewSlotCount, setInterviewSlotCount] = useState("5");
    const [interviewSlotCapacity, setInterviewSlotCapacity] = useState("10");

    const [isAiGenerated, setIsAiGenerated] = useState(true);
    const [assessmentQuestions, setAssessmentQuestions] = useState<AssessmentQuestion[]>([]);
    const [newAssessmentQuestion, setNewAssessmentQuestion] = useState<AssessmentQuestion>({
        questionText: "",
        options: [
            { label: "A", text: "", isCorrect: false },
            { label: "B", text: "", isCorrect: false },
            { label: "C", text: "", isCorrect: false },
            { label: "D", text: "", isCorrect: false },
        ],
    });

    const [interviewQuestions, setInterviewQuestions] = useState<InterviewQuestion[]>([]);
    const [newInterviewQuestion, setNewInterviewQuestion] = useState<InterviewQuestion>({
        questionText: "",
        difficulty: "MEDIUM",
    });

    const [schedulePreview, setSchedulePreview] = useState<{
        assessmentStart: string | null;
        assessmentEnd: string | null;
        interviewStart: string | null;
        interviewEnd: string | null;
    }>({ assessmentStart: null, assessmentEnd: null, interviewStart: null, interviewEnd: null });

    useEffect(() => {
        let mounted = true;

        async function loadData() {
            const currentAdmin = await getCurrentOrganizationAdmin();

            if (!mounted) {
                return;
            }

            if (!currentAdmin) {
                router.replace("/organization/organization_auth");
                return;
            }

            if (!interviewId || parseInt(interviewId) <= 0) {
                setErrorMessage("Invalid interview ID");
                setIsLoading(false);
                return;
            }

            const { data: interviewData, error } = await supabase
                .from("interviews")
                .select("campaign_start_utc, campaign_end_utc")
                .eq("id", parseInt(interviewId))
                .single();

            if (!mounted) return;

            if (error || !interviewData) {
                setErrorMessage("Failed to load interview campaign window");
                setIsLoading(false);
                return;
            }

            setCampaignStartUtc(interviewData.campaign_start_utc);
            setCampaignEndUtc(interviewData.campaign_end_utc);
            setIsLoading(false);
        }

        void loadData();

        return () => {
            mounted = false;
        };
    }, [router, interviewId]);

    function handleAutoGenerateAssessmentSlots() {
        setErrorMessage(null);

        if (!campaignStartUtc || !campaignEndUtc) {
            setErrorMessage("Campaign window not loaded. Please refresh the page.");
            return;
        }

        const campaignStart = new Date(campaignStartUtc);
        const [hours, minutes] = assessmentFirstSlotTime.split(":");
        const firstSlotStart = new Date(
            campaignStart.getUTCFullYear(),
            campaignStart.getUTCMonth(),
            campaignStart.getUTCDate(),
            parseInt(hours),
            parseInt(minutes),
            0,
            0,
        );

        const slotCount = parseInt(assessmentSlotCount);
        const capacity = parseInt(assessmentSlotCapacity);

        if (!slotCount || slotCount <= 0) {
            setErrorMessage("Number of assessment slots must be at least 1");
            return;
        }

        if (!capacity || capacity <= 0) {
            setErrorMessage("Assessment capacity must be at least 1");
            return;
        }

        const generatedSlots: AssessmentSlot[] = Array.from({ length: slotCount }, (_, index) => {
            const slotStart = new Date(firstSlotStart.getTime() + index * 60 * 60 * 1000);
            const slotEnd = new Date(slotStart.getTime() + 20 * 60 * 1000);

            return {
                slotStartUtc: slotStart.toISOString(),
                slotEndUtc: slotEnd.toISOString(),
            };
        });

        const campaignEnd = new Date(campaignEndUtc);
        const lastAssessmentEnd = new Date(generatedSlots[generatedSlots.length - 1].slotEndUtc);
        if (lastAssessmentEnd > campaignEnd) {
            setErrorMessage("Assessment slots exceed campaign end window. Reduce slot count or choose an earlier start time.");
            return;
        }

        setAssessmentSlots(generatedSlots);

        if (generatedSlots.length > 0) {
            const firstStart = new Date(generatedSlots[0].slotStartUtc);
            const lastEnd = new Date(generatedSlots[generatedSlots.length - 1].slotEndUtc);
            setSchedulePreview((prev) => ({
                ...prev,
                assessmentStart: firstStart.toISOString(),
                assessmentEnd: lastEnd.toISOString(),
            }));
        }
    }

    function handleRemoveAssessmentSlot(index: number) {
        setAssessmentSlots(assessmentSlots.filter((_, i) => i !== index));
    }

    function handleAutoGenerateInterviewSlots() {
        setErrorMessage(null);

        if (!campaignStartUtc || !campaignEndUtc) {
            setErrorMessage("Campaign window not loaded. Please refresh the page.");
            return;
        }

        if (assessmentSlots.length === 0) {
            setErrorMessage("Generate assessment slots first before interview slots");
            return;
        }

        const campaignStart = new Date(campaignStartUtc);
        const [hours, minutes] = interviewFirstSlotTime.split(":");
        const firstSlotStart = new Date(
            campaignStart.getUTCFullYear(),
            campaignStart.getUTCMonth(),
            campaignStart.getUTCDate(),
            parseInt(hours),
            parseInt(minutes),
            0,
            0,
        );

        const slotCount = parseInt(interviewSlotCount);
        const capacity = parseInt(interviewSlotCapacity);

        if (!slotCount || slotCount <= 0) {
            setErrorMessage("Number of interview slots must be at least 1");
            return;
        }

        if (!capacity || capacity <= 0) {
            setErrorMessage("Interview capacity must be at least 1");
            return;
        }

        for (let i = 0; i < Math.min(slotCount, assessmentSlots.length); i++) {
            const assessmentEnd = new Date(assessmentSlots[i].slotEndUtc);
            const interviewStart = new Date(firstSlotStart.getTime() + i * 60 * 60 * 1000);

            if (assessmentEnd > interviewStart) {
                setErrorMessage(
                    `Slot ${i + 1}: Assessment ends at ${assessmentEnd.toLocaleTimeString()} but interview starts at ${interviewStart.toLocaleTimeString()}. Overlapping times not allowed.`,
                );
                return;
            }
        }

        const generatedSlots: InterviewSlot[] = Array.from({ length: slotCount }, (_, index) => {
            const slotStart = new Date(firstSlotStart.getTime() + index * 60 * 60 * 1000);
            const slotEnd = new Date(slotStart.getTime() + 40 * 60 * 1000);

            return {
                slotStartUtc: slotStart.toISOString(),
                slotEndUtc: slotEnd.toISOString(),
            };
        });

        const campaignEnd = new Date(campaignEndUtc);
        const lastInterviewEnd = new Date(generatedSlots[generatedSlots.length - 1].slotEndUtc);
        if (lastInterviewEnd > campaignEnd) {
            setErrorMessage("Interview slots exceed campaign end window. Reduce slot count or choose an earlier start time.");
            return;
        }

        setInterviewSlots(generatedSlots);

        if (generatedSlots.length > 0) {
            const firstStart = new Date(generatedSlots[0].slotStartUtc);
            const lastEnd = new Date(generatedSlots[generatedSlots.length - 1].slotEndUtc);
            setSchedulePreview((prev) => ({
                ...prev,
                interviewStart: firstStart.toISOString(),
                interviewEnd: lastEnd.toISOString(),
            }));
        }
    }

    function handleRemoveInterviewSlot(index: number) {
        setInterviewSlots(interviewSlots.filter((_, i) => i !== index));
    }

    function handleAddAssessmentQuestion() {
        setErrorMessage(null);

        if (!newAssessmentQuestion.questionText.trim()) {
            setErrorMessage("Question text is required");
            return;
        }

        if (newAssessmentQuestion.options.some((opt) => !opt.text.trim())) {
            setErrorMessage("All options must have text");
            return;
        }

        if (!newAssessmentQuestion.options.some((opt) => opt.isCorrect)) {
            setErrorMessage("Select the correct option");
            return;
        }

        setAssessmentQuestions([...assessmentQuestions, newAssessmentQuestion]);

        setNewAssessmentQuestion({
            questionText: "",
            options: [
                { label: "A", text: "", isCorrect: false },
                { label: "B", text: "", isCorrect: false },
                { label: "C", text: "", isCorrect: false },
                { label: "D", text: "", isCorrect: false },
            ],
        });
    }

    function handleRemoveAssessmentQuestion(index: number) {
        setAssessmentQuestions(assessmentQuestions.filter((_, i) => i !== index));
    }

    function handleAddInterviewQuestion() {
        setErrorMessage(null);

        if (!newInterviewQuestion.questionText.trim()) {
            setErrorMessage("Interview question text is required");
            return;
        }

        setInterviewQuestions([...interviewQuestions, newInterviewQuestion]);

        setNewInterviewQuestion({
            questionText: "",
            difficulty: "MEDIUM",
        });
    }

    function handleRemoveInterviewQuestion(index: number) {
        setInterviewQuestions(interviewQuestions.filter((_, i) => i !== index));
    }

    async function handleSavePart2() {
        setErrorMessage(null);

        if (assessmentSlots.length === 0 && interviewSlots.length === 0) {
            setErrorMessage("Generate at least one assessment or interview slot");
            return;
        }

        if (!isAiGenerated && assessmentQuestions.length === 0) {
            setErrorMessage("Add at least one assessment question for custom mode");
            return;
        }

        if (interviewQuestions.length === 0) {
            setErrorMessage("Add at least one interview fallback question");
            return;
        }

        if (assessmentSlots.length > 0 && interviewSlots.length > 0) {
            for (let i = 0; i < Math.min(assessmentSlots.length, interviewSlots.length); i++) {
                const assessmentEnd = new Date(assessmentSlots[i].slotEndUtc);
                const interviewStart = new Date(interviewSlots[i].slotStartUtc);

                if (assessmentEnd > interviewStart) {
                    setErrorMessage(
                        `Slot pair ${i + 1}: Assessment ends at ${assessmentEnd.toLocaleTimeString()} but interview starts at ${interviewStart.toLocaleTimeString()}. Overlapping times not allowed.`,
                    );
                    return;
                }
            }
        }

        setIsSaving(true);

        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;

            if (!token) {
                setErrorMessage("No active session. Please sign in again.");
                setIsSaving(false);
                return;
            }

            const payload = {
                interviewId: parseInt(interviewId || "0"),
                assessmentSlotConfig: {
                    enabled: assessmentSlots.length > 0,
                    firstSlotStartUtc: assessmentSlots.length > 0 ? assessmentSlots[0].slotStartUtc : null,
                    numberOfSlots: assessmentSlots.length,
                    maxCandidatesPerSlot: parseInt(assessmentSlotCapacity) || 1,
                },
                interviewSlotConfig: {
                    enabled: interviewSlots.length > 0,
                    firstSlotStartUtc: interviewSlots.length > 0 ? interviewSlots[0].slotStartUtc : null,
                    numberOfSlots: interviewSlots.length,
                    maxCandidatesPerSlot: parseInt(interviewSlotCapacity) || 1,
                },
                assessment: {
                    isAiGenerated,
                    questions: !isAiGenerated ? assessmentQuestions : undefined,
                },
                interview: {
                    fallbackQuestions: interviewQuestions,
                },
            };

            const response = await fetch("/api/organization/interviews/part-2", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(payload),
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                setErrorMessage(result.error ?? "Failed to save Part 2");
                setIsSaving(false);
                return;
            }

            router.push(`/organization/create-interview/part-3?interviewId=${interviewId}`);
        } catch (error) {
            setErrorMessage("Error saving Part 2. Please try again.");
            console.error(error);
            setIsSaving(false);
        }
    }

    if (isLoading) {
        return (
            <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f3f9f7] text-slate-900">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(16,185,129,0.18),transparent_35%),radial-gradient(circle_at_84%_16%,rgba(56,189,248,0.18),transparent_35%),radial-gradient(circle_at_50%_100%,rgba(20,184,166,0.10),transparent_44%)]" />
                <div className="relative rounded-2xl border border-slate-200 bg-white/85 px-6 py-4 shadow-lg backdrop-blur"><p className="text-sm text-slate-600">Loading...</p></div>
            </div>
        );
    }

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#f3f9f7] px-6 py-10 text-slate-900 lg:px-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(16,185,129,0.18),transparent_35%),radial-gradient(circle_at_84%_16%,rgba(56,189,248,0.18),transparent_35%),radial-gradient(circle_at_50%_100%,rgba(20,184,166,0.10),transparent_44%)]" />
            <div className="relative mx-auto max-w-5xl space-y-6">
                <div className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.35)] sm:p-8">
                    <p className="text-xs uppercase tracking-[0.18em] text-emerald-700">Step 2 of 3</p>
                    <h1 className="mt-2 text-3xl font-semibold">Interview Configuration</h1>
                    <p className="mt-2 text-sm text-slate-600">Configure slot schedules, assessment mode, and interview fallback questions.</p>
                </div>

                {errorMessage ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</div> : null}

                <section className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.25)] space-y-4">
                    <h2 className="text-lg font-semibold">Assessment Slots (20 min each)</h2>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div>
                            <label className="mb-2 block text-xs font-medium text-slate-600">First Slot Time (UTC)</label>
                            <input type="time" value={assessmentFirstSlotTime} onChange={(e) => setAssessmentFirstSlotTime(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/30" />
                        </div>
                        <div>
                            <label className="mb-2 block text-xs font-medium text-slate-600">Number of Slots</label>
                            <input type="number" min="1" value={assessmentSlotCount} onChange={(e) => setAssessmentSlotCount(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/30" />
                        </div>
                        <div>
                            <label className="mb-2 block text-xs font-medium text-slate-600">Candidates per Slot</label>
                            <input type="number" min="1" value={assessmentSlotCapacity} onChange={(e) => setAssessmentSlotCapacity(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/30" />
                        </div>
                    </div>
                    <button onClick={handleAutoGenerateAssessmentSlots} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110">Generate Assessment Slots</button>
                    {assessmentSlots.length > 0 ? (
                        <div className="space-y-2">
                            {assessmentSlots.map((slot, idx) => {
                                const start = new Date(slot.slotStartUtc);
                                const end = new Date(slot.slotEndUtc);
                                return (
                                    <div key={idx} className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                                        <p className="text-sm text-emerald-900">{start.toLocaleDateString()} {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} to {end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} UTC</p>
                                        <button onClick={() => handleRemoveAssessmentSlot(idx)} className="text-xs font-semibold text-rose-700">Remove</button>
                                    </div>
                                );
                            })}
                        </div>
                    ) : null}
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.25)] space-y-4">
                    <h2 className="text-lg font-semibold">Interview Slots (40 min each)</h2>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div>
                            <label className="mb-2 block text-xs font-medium text-slate-600">First Slot Time (UTC)</label>
                            <input type="time" value={interviewFirstSlotTime} onChange={(e) => setInterviewFirstSlotTime(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/30" />
                        </div>
                        <div>
                            <label className="mb-2 block text-xs font-medium text-slate-600">Number of Slots</label>
                            <input type="number" min="1" value={interviewSlotCount} onChange={(e) => setInterviewSlotCount(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/30" />
                        </div>
                        <div>
                            <label className="mb-2 block text-xs font-medium text-slate-600">Candidates per Slot</label>
                            <input type="number" min="1" value={interviewSlotCapacity} onChange={(e) => setInterviewSlotCapacity(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/30" />
                        </div>
                    </div>
                    <button onClick={handleAutoGenerateInterviewSlots} className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110">Generate Interview Slots</button>
                    {interviewSlots.length > 0 ? (
                        <div className="space-y-2">
                            {interviewSlots.map((slot, idx) => {
                                const start = new Date(slot.slotStartUtc);
                                const end = new Date(slot.slotEndUtc);
                                return (
                                    <div key={idx} className="flex items-center justify-between rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2">
                                        <p className="text-sm text-cyan-900">{start.toLocaleDateString()} {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} to {end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} UTC</p>
                                        <button onClick={() => handleRemoveInterviewSlot(idx)} className="text-xs font-semibold text-rose-700">Remove</button>
                                    </div>
                                );
                            })}
                        </div>
                    ) : null}
                </section>

                {(schedulePreview.assessmentStart || schedulePreview.interviewStart) ? (
                    <section className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.25)]">
                        <h2 className="text-lg font-semibold">Schedule Preview</h2>
                        <div className="mt-3 space-y-2 text-sm text-slate-700">
                            {schedulePreview.assessmentStart ? <p>Assessment: {new Date(schedulePreview.assessmentStart).toLocaleString()} to {new Date(schedulePreview.assessmentEnd as string).toLocaleString()}</p> : null}
                            {schedulePreview.interviewStart ? <p>Interview: {new Date(schedulePreview.interviewStart).toLocaleString()} to {new Date(schedulePreview.interviewEnd as string).toLocaleString()}</p> : null}
                        </div>
                    </section>
                ) : null}

                <section className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.25)] space-y-4">
                    <h2 className="text-lg font-semibold">Assessment Questions</h2>
                    <div className="flex gap-3">
                        <button onClick={() => { setIsAiGenerated(true); setAssessmentQuestions([]); }} className={`flex-1 rounded-xl border px-4 py-3 text-sm font-semibold ${isAiGenerated ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-600"}`}>AI Generated</button>
                        <button onClick={() => setIsAiGenerated(false)} className={`flex-1 rounded-xl border px-4 py-3 text-sm font-semibold ${!isAiGenerated ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-300 bg-white text-slate-600"}`}>Custom Questions</button>
                    </div>
                    {isAiGenerated ? (
                        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">AI will generate MCQs from the role and skills data.</p>
                    ) : (
                        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                            <textarea rows={2} placeholder="Question text" value={newAssessmentQuestion.questionText} onChange={(e) => setNewAssessmentQuestion({ ...newAssessmentQuestion, questionText: e.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
                            {newAssessmentQuestion.options.map((option, idx) => (
                                <div key={option.label} className="flex items-center gap-2">
                                    <input type="text" placeholder={`Option ${option.label}`} value={option.text} onChange={(e) => {
                                        const updated = [...newAssessmentQuestion.options];
                                        updated[idx].text = e.target.value;
                                        setNewAssessmentQuestion({ ...newAssessmentQuestion, options: updated });
                                    }} className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
                                    <label className="text-xs text-slate-700"><input type="radio" name="correct-option" checked={option.isCorrect} onChange={() => {
                                        const updated = newAssessmentQuestion.options.map((o) => ({ ...o, isCorrect: o.label === option.label }));
                                        setNewAssessmentQuestion({ ...newAssessmentQuestion, options: updated });
                                    }} className="mr-1" />Correct</label>
                                </div>
                            ))}
                            <button onClick={handleAddAssessmentQuestion} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white">Add Question</button>
                            {assessmentQuestions.length > 0 ? (
                                <div className="space-y-2">
                                    {assessmentQuestions.map((q, idx) => (
                                        <div key={idx} className="rounded-xl border border-amber-200 bg-white px-3 py-2">
                                            <p className="text-sm font-semibold text-slate-900">{idx + 1}. {q.questionText}</p>
                                            <button onClick={() => handleRemoveAssessmentQuestion(idx)} className="mt-1 text-xs text-rose-700">Remove</button>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    )}
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.25)] space-y-4">
                    <h2 className="text-lg font-semibold">Interview Fallback Questions</h2>
                    <textarea rows={2} placeholder="Fallback question" value={newInterviewQuestion.questionText} onChange={(e) => setNewInterviewQuestion({ ...newInterviewQuestion, questionText: e.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
                    <select value={newInterviewQuestion.difficulty} onChange={(e) => setNewInterviewQuestion({ ...newInterviewQuestion, difficulty: e.target.value as "EASY" | "MEDIUM" | "HARD" })} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
                        <option value="EASY">Easy</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="HARD">Hard</option>
                    </select>
                    <button onClick={handleAddInterviewQuestion} className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white">Add Question</button>
                    {interviewQuestions.length > 0 ? (
                        <div className="space-y-2">
                            {interviewQuestions.map((q, idx) => (
                                <div key={idx} className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2">
                                    <p className="text-sm font-semibold text-slate-900">{idx + 1}. {q.questionText}</p>
                                    <p className="text-xs text-cyan-800">Difficulty: {q.difficulty}</p>
                                    <button onClick={() => handleRemoveInterviewQuestion(idx)} className="mt-1 text-xs text-rose-700">Remove</button>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </section>

                <div className="flex gap-3">
                    <Link href={`/organization/create-interview?interviewId=${interviewId}&step=1`} className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800">Back to Part 1</Link>
                    <button onClick={handleSavePart2} disabled={isSaving} className="ml-auto inline-flex rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 px-6 py-2 text-sm font-semibold text-white disabled:opacity-70">{isSaving ? "Saving..." : "Next: Part 3"}</button>
                </div>
            </div>
        </div>
    );
}

export default function Part2Page() {
    return (
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#f3f9f7] text-slate-700">Loading...</div>}>
            <Part2Content />
        </Suspense>
    );
}
