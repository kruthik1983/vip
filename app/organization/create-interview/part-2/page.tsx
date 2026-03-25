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

    // Campaign window (loaded from Part 1)
    const [campaignStartUtc, setCampaignStartUtc] = useState<string | null>(null);
    const [campaignEndUtc, setCampaignEndUtc] = useState<string | null>(null);

    // Assessment Slots state (times only - dates auto-derived)
    const [assessmentSlots, setAssessmentSlots] = useState<AssessmentSlot[]>([]);
    const [assessmentFirstSlotTime, setAssessmentFirstSlotTime] = useState("09:00");
    const [assessmentSlotCount, setAssessmentSlotCount] = useState("5");
    const [assessmentSlotCapacity, setAssessmentSlotCapacity] = useState("10");

    // Interview Slots state (times only - dates auto-derived)
    const [interviewSlots, setInterviewSlots] = useState<InterviewSlot[]>([]);
    const [interviewFirstSlotTime, setInterviewFirstSlotTime] = useState("09:30");
    const [interviewSlotCount, setInterviewSlotCount] = useState("5");
    const [interviewSlotCapacity, setInterviewSlotCapacity] = useState("10");

    // Assessment state
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

    // Interview state
    const [interviewQuestions, setInterviewQuestions] = useState<InterviewQuestion[]>([]);
    const [newInterviewQuestion, setNewInterviewQuestion] = useState<InterviewQuestion>({
        questionText: "",
        difficulty: "MEDIUM",
    });

    // Schedule preview state
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

            // Fetch interview data to get campaign window
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

            // Set campaign window from Part 1
            setCampaignStartUtc(interviewData.campaign_start_utc);
            setCampaignEndUtc(interviewData.campaign_end_utc);

            setIsLoading(false);
        }

        void loadData();

        return () => {
            mounted = false;
        };
    }, [router, interviewId]);

    // ===== ASSESSMENT SLOT MANAGEMENT =====
    function handleAutoGenerateAssessmentSlots() {
        setErrorMessage(null);

        if (!campaignStartUtc || !campaignEndUtc) {
            setErrorMessage("Campaign window not loaded. Please refresh the page.");
            return;
        }

        // Use campaign start date with selected time
        const campaignStart = new Date(campaignStartUtc);
        const [hours, minutes] = assessmentFirstSlotTime.split(":");
        const firstSlotStart = new Date(
            campaignStart.getUTCFullYear(),
            campaignStart.getUTCMonth(),
            campaignStart.getUTCDate(),
            parseInt(hours),
            parseInt(minutes),
            0,
            0
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
            const slotEnd = new Date(slotStart.getTime() + 20 * 60 * 1000); // 20 min assessment

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

        // Update schedule preview
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

    // ===== INTERVIEW SLOT MANAGEMENT =====
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

        // Use campaign start date with selected time
        const campaignStart = new Date(campaignStartUtc);
        const [hours, minutes] = interviewFirstSlotTime.split(":");
        const firstSlotStart = new Date(
            campaignStart.getUTCFullYear(),
            campaignStart.getUTCMonth(),
            campaignStart.getUTCDate(),
            parseInt(hours),
            parseInt(minutes),
            0,
            0
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

        // Validate no overlap: interview slots must start after assessment slots end
        for (let i = 0; i < Math.min(slotCount, assessmentSlots.length); i++) {
            const assessmentEnd = new Date(assessmentSlots[i].slotEndUtc);
            const interviewStart = new Date(firstSlotStart.getTime() + i * 60 * 60 * 1000);

            if (assessmentEnd > interviewStart) {
                setErrorMessage(`Slot ${i + 1}: Assessment ends at ${assessmentEnd.toLocaleTimeString()} but interview starts at ${interviewStart.toLocaleTimeString()}. Overlapping times not allowed.`);
                return;
            }
        }

        const generatedSlots: InterviewSlot[] = Array.from({ length: slotCount }, (_, index) => {
            const slotStart = new Date(firstSlotStart.getTime() + index * 60 * 60 * 1000);
            const slotEnd = new Date(slotStart.getTime() + 40 * 60 * 1000); // 40 min interview

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

        // Update schedule preview
        if (generatedSlots.length > 0) {
            const firstStart = new Date(generatedSlots[0].slotStartUtc);
            const lastEnd = new Date(generatedSlots[generatedSlots.length - 1].slotEndUtc);
            setSchedulePreview(prev => ({
                ...prev,
                interviewStart: firstStart.toISOString(),
                interviewEnd: lastEnd.toISOString(),
            }));
        }
    }

    function handleRemoveInterviewSlot(index: number) {
        setInterviewSlots(interviewSlots.filter((_, i) => i !== index));
    }

    // ===== ASSESSMENT QUESTION MANAGEMENT =====
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

        // Reset form
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

    // ===== INTERVIEW QUESTION MANAGEMENT =====
    function handleAddInterviewQuestion() {
        setErrorMessage(null);

        if (!newInterviewQuestion.questionText.trim()) {
            setErrorMessage("Interview question text is required");
            return;
        }

        setInterviewQuestions([...interviewQuestions, newInterviewQuestion]);

        // Reset form
        setNewInterviewQuestion({
            questionText: "",
            difficulty: "MEDIUM",
        });
    }

    function handleRemoveInterviewQuestion(index: number) {
        setInterviewQuestions(interviewQuestions.filter((_, i) => i !== index));
    }

    // ===== SAVE PART 2 =====
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

        // Validate no overlaps if both slot types exist
        if (assessmentSlots.length > 0 && interviewSlots.length > 0) {
            for (let i = 0; i < Math.min(assessmentSlots.length, interviewSlots.length); i++) {
                const assessmentEnd = new Date(assessmentSlots[i].slotEndUtc);
                const interviewStart = new Date(interviewSlots[i].slotStartUtc);

                if (assessmentEnd > interviewStart) {
                    setErrorMessage(
                        `Slot pair ${i + 1}: Assessment ends at ${assessmentEnd.toLocaleTimeString()} ` +
                        `but interview starts at ${interviewStart.toLocaleTimeString()}. Overlapping times not allowed.`
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
                    firstSlotStartUtc: assessmentSlots.length > 0
                        ? assessmentSlots[0].slotStartUtc
                        : null,
                    numberOfSlots: assessmentSlots.length,
                    maxCandidatesPerSlot: parseInt(assessmentSlotCapacity) || 1,
                },
                interviewSlotConfig: {
                    enabled: interviewSlots.length > 0,
                    firstSlotStartUtc: interviewSlots.length > 0
                        ? interviewSlots[0].slotStartUtc
                        : null,
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

            // Redirect to Part 3
            router.push(`/organization/create-interview/part-3?interviewId=${interviewId}`);
        } catch (error) {
            setErrorMessage("Error saving Part 2. Please try again.");
            console.error(error);
            setIsSaving(false);
        }
    }

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#070b16] text-white">
                <p className="text-sm text-slate-300">Loading...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#070b16] px-6 py-10 text-white lg:px-10">
            <div className="mx-auto max-w-4xl space-y-6">
                {/* Header */}
                <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
                    <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">Step 2 of 3</p>
                    <h1 className="mt-2 text-3xl font-semibold">Interview Configuration</h1>
                    <p className="mt-2 text-sm text-slate-400">
                        Set up interview slots, assessment questions, and interview fallback questions.
                    </p>
                </div>

                {/* Error Message */}
                {errorMessage && (
                    <div className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                        {errorMessage}
                    </div>
                )}

                {/* ===== SECTION 1A: ASSESSMENT SLOTS ===== */}
                <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8 space-y-4">
                    <h2 className="text-lg font-semibold text-white">Assessment Slots (20 minutes each)</h2>
                    <p className="text-sm text-slate-400">
                        Generate assessment slots for candidates. Each slot is 20 minutes.
                    </p>

                    {/* Auto Generate Assessment Slots Form */}
                    <div className="rounded-lg border border-blue-300/20 bg-blue-400/10 p-4 space-y-3">
                        <p className="text-xs text-blue-200">
                            ℹ️ Dates are automatically derived from your campaign window set in Part 1. You only need to set the start time.
                        </p>
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-2">
                                    First Slot Time (24h, UTC) <span className="text-rose-400">*</span>
                                </label>
                                <input
                                    type="time"
                                    value={assessmentFirstSlotTime}
                                    onChange={(e) => setAssessmentFirstSlotTime(e.target.value)}
                                    className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-white transition focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400/30"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-2">
                                    Number of Slots <span className="text-rose-400">*</span>
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    value={assessmentSlotCount}
                                    onChange={(e) => setAssessmentSlotCount(e.target.value)}
                                    className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-white transition focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400/30"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-2">
                                    Max Candidates per Slot <span className="text-rose-400">*</span>
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    value={assessmentSlotCapacity}
                                    onChange={(e) => setAssessmentSlotCapacity(e.target.value)}
                                    className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-white transition focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400/30"
                                />
                            </div>
                        </div>

                        <button
                            onClick={handleAutoGenerateAssessmentSlots}
                            className="w-full rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
                        >
                            Generate Assessment Slots
                        </button>
                    </div>

                    {/* Assessment Slots List */}
                    {assessmentSlots.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-xs font-semibold text-slate-300">Generated Assessment Slots ({assessmentSlots.length})</p>
                            {assessmentSlots.map((slot, idx) => {
                                const start = new Date(slot.slotStartUtc);
                                const end = new Date(slot.slotEndUtc);
                                return (
                                    <div key={idx} className="rounded-lg border border-blue-300/20 bg-blue-400/5 p-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex-1">
                                                <p className="text-sm font-medium text-white">
                                                    {start.toLocaleDateString()} - {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} to{" "}
                                                    {end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} UTC
                                                </p>
                                                <p className="text-xs text-slate-400 mt-1">20 minutes</p>
                                            </div>
                                            <button
                                                onClick={() => handleRemoveAssessmentSlot(idx)}
                                                className="text-xs text-rose-300 hover:text-rose-200 font-medium"
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* ===== SECTION 1B: INTERVIEW SLOTS ===== */}
                <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8 space-y-4">
                    <h2 className="text-lg font-semibold text-white">Interview Slots (40 minutes each)</h2>
                    <p className="text-sm text-slate-400">
                        Generate interview slots for candidates. Each slot is 40 minutes. Interview slots must not overlap with assessment slots.
                    </p>

                    {/* Auto Generate Interview Slots Form */}
                    <div className="rounded-lg border border-emerald-300/20 bg-emerald-400/10 p-4 space-y-3">
                        <p className="text-xs text-emerald-200">
                            ℹ️ Dates are automatically derived from your campaign window set in Part 1. Assessment slots must be generated first for validation. You only need to set the start time.
                        </p>
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-2">
                                    First Slot Time (24h, UTC) <span className="text-rose-400">*</span>
                                </label>
                                <input
                                    type="time"
                                    value={interviewFirstSlotTime}
                                    onChange={(e) => setInterviewFirstSlotTime(e.target.value)}
                                    className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-white transition focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/30"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-2">
                                    Number of Slots <span className="text-rose-400">*</span>
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    value={interviewSlotCount}
                                    onChange={(e) => setInterviewSlotCount(e.target.value)}
                                    className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-white transition focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/30"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-2">
                                    Max Candidates per Slot <span className="text-rose-400">*</span>
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    value={interviewSlotCapacity}
                                    onChange={(e) => setInterviewSlotCapacity(e.target.value)}
                                    className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-white transition focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/30"
                                />
                            </div>
                        </div>

                        <button
                            onClick={handleAutoGenerateInterviewSlots}
                            className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-[#041022] transition hover:brightness-110"
                        >
                            Generate Interview Slots
                        </button>
                    </div>

                    {/* Interview Slots List */}
                    {interviewSlots.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-xs font-semibold text-slate-300">Generated Interview Slots ({interviewSlots.length})</p>
                            {interviewSlots.map((slot, idx) => {
                                const start = new Date(slot.slotStartUtc);
                                const end = new Date(slot.slotEndUtc);
                                return (
                                    <div key={idx} className="rounded-lg border border-emerald-300/20 bg-emerald-400/5 p-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex-1">
                                                <p className="text-sm font-medium text-white">
                                                    {start.toLocaleDateString()} - {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} to{" "}
                                                    {end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} UTC
                                                </p>
                                                <p className="text-xs text-slate-400 mt-1">40 minutes</p>
                                            </div>
                                            <button
                                                onClick={() => handleRemoveInterviewSlot(idx)}
                                                className="text-xs text-rose-300 hover:text-rose-200 font-medium"
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* ===== SECTION 2: SCHEDULE PREVIEW ===== */}
                {(assessmentSlots.length > 0 || interviewSlots.length > 0) && (
                    <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8 space-y-4">
                        <h2 className="text-lg font-semibold text-white">Interview Schedule Preview</h2>
                        <div className="rounded-lg border border-indigo-300/20 bg-indigo-400/10 p-4 space-y-3">
                            {schedulePreview.assessmentStart && (
                                <div>
                                    <p className="text-xs font-medium text-slate-300 mb-1">Assessment Window</p>
                                    <p className="text-sm text-indigo-200">
                                        {new Date(schedulePreview.assessmentStart).toLocaleDateString()} {new Date(schedulePreview.assessmentStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} to {new Date(schedulePreview.assessmentEnd!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} UTC
                                    </p>
                                </div>
                            )}
                            {schedulePreview.interviewStart && (
                                <div>
                                    <p className="text-xs font-medium text-slate-300 mb-1">Interview Window</p>
                                    <p className="text-sm text-indigo-200">
                                        {new Date(schedulePreview.interviewStart).toLocaleDateString()} {new Date(schedulePreview.interviewStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} to {new Date(schedulePreview.interviewEnd!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} UTC
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ===== SECTION 3: ASSESSMENT QUESTIONS ===== */}
                <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8 space-y-4">
                    <h2 className="text-lg font-semibold text-white">Assessment Round (20 mins MCQ)</h2>

                    {/* Toggle AI vs Custom */}
                    <div className="flex gap-3">
                        <button
                            onClick={() => {
                                setIsAiGenerated(true);
                                setAssessmentQuestions([]);
                            }}
                            className={`flex-1 rounded-lg border px-4 py-3 text-sm font-semibold transition ${isAiGenerated
                                ? "border-cyan-500 bg-cyan-400/10 text-cyan-200"
                                : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
                                }`}
                        >
                            AI-Generated (Recommended)
                        </button>
                        <button
                            onClick={() => setIsAiGenerated(false)}
                            className={`flex-1 rounded-lg border px-4 py-3 text-sm font-semibold transition ${!isAiGenerated
                                ? "border-amber-500 bg-amber-400/10 text-amber-200"
                                : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
                                }`}
                        >
                            Custom Questions
                        </button>
                    </div>

                    {isAiGenerated ? (
                        <div className="rounded-lg border border-cyan-300/20 bg-cyan-400/10 p-4 text-sm text-cyan-200">
                            ✓ AI will generate MCQ questions based on job description and required skills. You can edit them after creation.
                        </div>
                    ) : (
                        <div className="rounded-lg border border-amber-300/20 bg-amber-400/10 p-4 space-y-3">
                            <p className="text-sm font-semibold text-amber-200">Add Custom MCQ Questions</p>

                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-2">
                                    Question Text <span className="text-rose-400">*</span>
                                </label>
                                <textarea
                                    rows={2}
                                    placeholder="e.g., What is the correct way to handle state in React?"
                                    value={newAssessmentQuestion.questionText}
                                    onChange={(e) =>
                                        setNewAssessmentQuestion({
                                            ...newAssessmentQuestion,
                                            questionText: e.target.value,
                                        })
                                    }
                                    className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-white placeholder-slate-400 transition focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400/30"
                                />
                            </div>

                            <div>
                                <p className="text-xs font-medium text-slate-300 mb-2">Options</p>
                                <div className="space-y-2">
                                    {newAssessmentQuestion.options.map((option, idx) => (
                                        <div key={idx} className="flex gap-2 items-center">
                                            <input
                                                type="text"
                                                placeholder={`Option ${option.label}`}
                                                value={option.text}
                                                onChange={(e) => {
                                                    const updated = [...newAssessmentQuestion.options];
                                                    updated[idx].text = e.target.value;
                                                    setNewAssessmentQuestion({
                                                        ...newAssessmentQuestion,
                                                        options: updated,
                                                    });
                                                }}
                                                className="flex-1 rounded-lg border border-white/20 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-400 transition focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400/30"
                                            />
                                            <label className="flex items-center gap-2 text-xs">
                                                <input
                                                    type="radio"
                                                    name="correct-option"
                                                    checked={option.isCorrect}
                                                    onChange={() => {
                                                        const updated = newAssessmentQuestion.options.map((o) => ({
                                                            ...o,
                                                            isCorrect: o.label === option.label,
                                                        }));
                                                        setNewAssessmentQuestion({
                                                            ...newAssessmentQuestion,
                                                            options: updated,
                                                        });
                                                    }}
                                                    className="h-4 w-4 cursor-pointer"
                                                />
                                                <span className="text-amber-200">Correct</span>
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <button
                                onClick={handleAddAssessmentQuestion}
                                className="w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-[#041022] transition hover:brightness-110"
                            >
                                + Add Question
                            </button>

                            {/* Assessment Questions List */}
                            {assessmentQuestions.length > 0 && (
                                <div className="mt-4 space-y-2 border-t border-amber-300/20 pt-4">
                                    <p className="text-xs font-semibold text-slate-300">Added Questions ({assessmentQuestions.length})</p>
                                    {assessmentQuestions.map((q, idx) => (
                                        <div key={idx} className="rounded-lg border border-amber-300/20 bg-amber-400/5 p-3">
                                            <p className="text-sm font-medium text-white mb-2">
                                                {idx + 1}. {q.questionText}
                                            </p>
                                            <div className="text-xs text-slate-400 space-y-1">
                                                {q.options.map((opt) => (
                                                    <p key={opt.label}>
                                                        {opt.label}. {opt.text} {opt.isCorrect && <span className="text-amber-200">✓</span>}
                                                    </p>
                                                ))}
                                            </div>
                                            <button
                                                onClick={() => handleRemoveAssessmentQuestion(idx)}
                                                className="mt-2 text-xs text-rose-300 hover:text-rose-200"
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* ===== SECTION 4: INTERVIEW FALLBACK QUESTIONS ===== */}
                <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8 space-y-4">
                    <h2 className="text-lg font-semibold text-white">Interview Round (40 mins) - Fallback Questions</h2>
                    <p className="text-sm text-slate-400">
                        Add fallback questions to use if AI fails during live interviews.
                    </p>

                    <div className="rounded-lg border border-cyan-300/20 bg-cyan-400/10 p-4 space-y-3">
                        <div>
                            <label className="block text-xs font-medium text-slate-300 mb-2">
                                Question <span className="text-rose-400">*</span>
                            </label>
                            <textarea
                                rows={2}
                                placeholder="e.g., Describe a challenging project you worked on."
                                value={newInterviewQuestion.questionText}
                                onChange={(e) =>
                                    setNewInterviewQuestion({
                                        ...newInterviewQuestion,
                                        questionText: e.target.value,
                                    })
                                }
                                className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-white placeholder-slate-400 transition focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/30"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-slate-300 mb-2">Difficulty</label>
                            <select
                                value={newInterviewQuestion.difficulty}
                                onChange={(e) =>
                                    setNewInterviewQuestion({
                                        ...newInterviewQuestion,
                                        difficulty: e.target.value as "EASY" | "MEDIUM" | "HARD",
                                    })
                                }
                                className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-white transition focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/30"
                            >
                                <option value="EASY">Easy</option>
                                <option value="MEDIUM">Medium</option>
                                <option value="HARD">Hard</option>
                            </select>
                        </div>

                        <button
                            onClick={handleAddInterviewQuestion}
                            className="w-full rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-[#041022] transition hover:brightness-110"
                        >
                            + Add Question
                        </button>
                    </div>

                    {/* Interview Questions List */}
                    {interviewQuestions.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-xs font-semibold text-slate-300">Added Questions ({interviewQuestions.length})</p>
                            {interviewQuestions.map((q, idx) => (
                                <div key={idx} className="rounded-lg border border-cyan-300/20 bg-cyan-400/5 p-3">
                                    <p className="text-sm font-medium text-white">
                                        {idx + 1}. {q.questionText}
                                    </p>
                                    <p className="text-xs text-cyan-300 mt-1">Difficulty: {q.difficulty}</p>
                                    <button
                                        onClick={() => handleRemoveInterviewQuestion(idx)}
                                        className="mt-2 text-xs text-rose-300 hover:text-rose-200"
                                    >
                                        Remove
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3">
                    <Link
                        href={`/organization/create-interview?interviewId=${interviewId}&step=1`}
                        className="inline-flex rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                    >
                        ← Back to Part 1
                    </Link>
                    <button
                        onClick={handleSavePart2}
                        disabled={isSaving}
                        className="ml-auto inline-flex rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-400 px-6 py-2 text-sm font-semibold text-[#041022] transition hover:shadow-lg hover:shadow-cyan-500/30 disabled:opacity-70"
                    >
                        {isSaving ? "Saving..." : "Next: Part 3"}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function Part2Page() {
    return (
        <Suspense
            fallback={<div className="flex min-h-screen items-center justify-center bg-[#070b16] text-white">Loading...</div>}
        >
            <Part2Content />
        </Suspense>
    );
}
