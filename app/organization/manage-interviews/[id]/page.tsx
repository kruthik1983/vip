"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getCurrentOrganizationAdmin } from "@/lib/organization-auth";
import { supabase } from "@/lib/supabase";

type AssessmentQuestion = {
    id: number;
    question_text: string;
    question_order: number;
    options: Array<{ label: string; text: string; isCorrect: boolean }>;
    correct_option_label: string;
};

type FallbackQuestion = {
    id: number;
    question_text: string;
    difficulty_level: string;
    question_order: number;
};

type InterviewDetails = {
    interview: {
        id: number;
        title: string;
        status: string;
        campaign_start_utc: string | null;
        campaign_end_utc: string | null;
        assessment_duration_minutes: number;
        interview_duration_minutes: number;
        created_at: string;
        published_at: string | null;
    };
    job: {
        id: number;
        position_title: string;
        job_description: string;
        skills_required: string[] | null;
        ctc_min: number | null;
        ctc_max: number | null;
    } | null;
    assessmentSlots: Array<{
        id: number;
        slot_start_utc: string;
        slot_end_utc: string;
        max_candidates: number;
        assigned_candidates: number;
    }>;
    interviewSlots: Array<{
        id: number;
        slot_start_utc: string;
        slot_end_utc: string;
        max_candidates: number;
        assigned_candidates: number;
    }>;
    assessmentQuestions: AssessmentQuestion[];
    interviewFallbackQuestions: FallbackQuestion[];
    applicationLink: {
        application_link: string;
        application_token: string;
        valid_from: string;
        valid_until: string;
        is_active: boolean;
        created_at: string;
    } | null;
};

const partNavItems = [
    { id: "part-1", label: "Part 1: Job & Interview" },
    { id: "part-2", label: "Part 2: Slots" },
    { id: "part-3", label: "Part 3: Questions" },
];

function formatDateTime(value: string | null) {
    if (!value) return "-";

    return new Date(value).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    });
}

function createEmptyAssessmentQuestion(idSeed: number): AssessmentQuestion {
    return {
        id: idSeed,
        question_text: "",
        question_order: 0,
        options: [
            { label: "A", text: "", isCorrect: true },
            { label: "B", text: "", isCorrect: false },
            { label: "C", text: "", isCorrect: false },
            { label: "D", text: "", isCorrect: false },
        ],
        correct_option_label: "A",
    };
}

function createEmptyFallbackQuestion(idSeed: number): FallbackQuestion {
    return {
        id: idSeed,
        question_text: "",
        difficulty_level: "MEDIUM",
        question_order: 0,
    };
}

function PartHeader({
    partLabel,
    title,
    description,
    accentClass,
}: {
    partLabel: string;
    title: string;
    description?: string;
    accentClass: string;
}) {
    return (
        <div className="rounded-2xl border border-white/15 bg-gradient-to-r from-white/10 to-white/5 p-5 backdrop-blur-xl sm:p-6">
            <div className="flex items-center gap-3">
                <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${accentClass}`}>
                    {partLabel}
                </span>
                <div className="h-px flex-1 bg-white/20" />
            </div>
            <h2 className="mt-3 text-xl font-semibold text-white">{title}</h2>
            {description ? <p className="mt-1 text-sm text-slate-300">{description}</p> : null}
        </div>
    );
}

export default function ManageInterviewDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();

    const interviewId = useMemo(() => Number(params?.id), [params]);

    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    const [details, setDetails] = useState<InterviewDetails | null>(null);
    const [assessmentQuestions, setAssessmentQuestions] = useState<AssessmentQuestion[]>([]);
    const [fallbackQuestions, setFallbackQuestions] = useState<FallbackQuestion[]>([]);
    const [activePart, setActivePart] = useState("part-1");

    useEffect(() => {
        let mounted = true;

        async function loadDetails() {
            setIsLoading(true);
            setErrorMessage(null);

            const currentAdmin = await getCurrentOrganizationAdmin();

            if (!mounted) {
                return;
            }

            if (!currentAdmin) {
                router.replace("/organization/organization_auth");
                return;
            }

            if (!Number.isInteger(interviewId) || interviewId <= 0) {
                setErrorMessage("Invalid interview id");
                setIsLoading(false);
                return;
            }

            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;

            if (!token) {
                setErrorMessage("No active session. Please sign in again.");
                setIsLoading(false);
                return;
            }

            const response = await fetch(`/api/organization/interviews/manage/${interviewId}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            const result = await response.json();

            if (!mounted) {
                return;
            }

            if (!response.ok || !result.success) {
                setErrorMessage(result.error ?? "Failed to load interview details");
                setIsLoading(false);
                return;
            }

            const loadedDetails: InterviewDetails = result.data;
            setDetails(loadedDetails);
            setAssessmentQuestions(loadedDetails.assessmentQuestions);
            setFallbackQuestions(loadedDetails.interviewFallbackQuestions);
            setIsLoading(false);
        }

        void loadDetails();

        return () => {
            mounted = false;
        };
    }, [interviewId, router]);

    useEffect(() => {
        function handleScroll() {
            let currentPart = "part-1";

            for (const item of partNavItems) {
                const section = document.getElementById(item.id);
                if (!section) {
                    continue;
                }

                const rect = section.getBoundingClientRect();
                if (rect.top <= 140) {
                    currentPart = item.id;
                }
            }

            setActivePart((prev) => (prev === currentPart ? prev : currentPart));
        }

        handleScroll();
        window.addEventListener("scroll", handleScroll, { passive: true });

        return () => {
            window.removeEventListener("scroll", handleScroll);
        };
    }, []);

    function handlePartNavigation(partId: string) {
        setActivePart(partId);
        document.getElementById(partId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    async function handleSaveQuestions() {
        setErrorMessage(null);
        setSuccessMessage(null);

        for (const question of assessmentQuestions) {
            if (!question.question_text.trim()) {
                setErrorMessage("Assessment question text cannot be empty");
                return;
            }
        }

        for (const question of fallbackQuestions) {
            if (!question.question_text.trim()) {
                setErrorMessage("Interview fallback question text cannot be empty");
                return;
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
                assessmentQuestions: assessmentQuestions.map((q, index) => ({
                    id: q.id,
                    questionText: q.question_text,
                    questionOrder: index + 1,
                    options: q.options,
                    correctOptionLabel: q.correct_option_label,
                })),
                interviewFallbackQuestions: fallbackQuestions.map((q, index) => ({
                    id: q.id,
                    questionText: q.question_text,
                    difficultyLevel: q.difficulty_level,
                    questionOrder: index + 1,
                })),
            };

            const response = await fetch(`/api/organization/interviews/manage/${interviewId}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(payload),
            });

            const result = await response.json();
            if (!response.ok || !result.success) {
                setErrorMessage(result.error ?? "Failed to save updates");
                setIsSaving(false);
                return;
            }

            setSuccessMessage("Questions updated successfully");
        } catch (error) {
            setErrorMessage("Failed to save changes");
            console.error(error);
        } finally {
            setIsSaving(false);
        }
    }

    function updateAssessmentQuestionText(index: number, value: string) {
        const updated = [...assessmentQuestions];
        updated[index].question_text = value;
        setAssessmentQuestions(updated);
    }

    function updateAssessmentOptionText(qIndex: number, optionIndex: number, value: string) {
        const updated = [...assessmentQuestions];
        updated[qIndex].options[optionIndex].text = value;
        setAssessmentQuestions(updated);
    }

    function setAssessmentCorrectOption(qIndex: number, label: string) {
        const updated = [...assessmentQuestions];
        updated[qIndex].correct_option_label = label;
        updated[qIndex].options = updated[qIndex].options.map((opt) => ({
            ...opt,
            isCorrect: opt.label === label,
        }));
        setAssessmentQuestions(updated);
    }

    function updateFallbackQuestionText(index: number, value: string) {
        const updated = [...fallbackQuestions];
        updated[index].question_text = value;
        setFallbackQuestions(updated);
    }

    function updateFallbackQuestionDifficulty(index: number, value: string) {
        const updated = [...fallbackQuestions];
        updated[index].difficulty_level = value;
        setFallbackQuestions(updated);
    }

    function addAssessmentQuestion() {
        setAssessmentQuestions((prev) => [...prev, createEmptyAssessmentQuestion(Date.now())]);
    }

    function removeAssessmentQuestion(index: number) {
        setAssessmentQuestions((prev) => prev.filter((_, i) => i !== index));
    }

    function addFallbackQuestion() {
        setFallbackQuestions((prev) => [...prev, createEmptyFallbackQuestion(Date.now())]);
    }

    function removeFallbackQuestion(index: number) {
        setFallbackQuestions((prev) => prev.filter((_, i) => i !== index));
    }

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#070b16] text-white">
                <p className="text-sm text-slate-300">Loading interview details...</p>
            </div>
        );
    }

    if (!details) {
        return (
            <div className="min-h-screen bg-[#070b16] px-6 py-10 text-white lg:px-10">
                <div className="mx-auto max-w-4xl space-y-4">
                    <div className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                        {errorMessage ?? "Interview details not available"}
                    </div>
                    <Link
                        href="/organization/manage-interviews"
                        className="inline-flex rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                    >
                        Back to Manage Interviews
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#070b16] px-6 py-10 text-white lg:px-10">
            <div className="mx-auto max-w-6xl space-y-6">
                {(() => {
                    const activeIndex = partNavItems.findIndex((item) => item.id === activePart);
                    return (
                        <div className="sticky top-4 z-20 rounded-2xl border border-white/15 bg-[#0b1224]/90 p-2 backdrop-blur-xl">
                            <div className="relative grid grid-cols-3 gap-1">
                                <div
                                    className="pointer-events-none absolute bottom-1 top-1 rounded-lg bg-white/10 transition-transform duration-300"
                                    style={{
                                        width: `calc((100% - 0.5rem) / 3)`,
                                        transform: `translateX(calc(${Math.max(activeIndex, 0)} * 100% + ${Math.max(activeIndex, 0)} * 0.166rem))`,
                                    }}
                                />

                                {partNavItems.map((item) => {
                                    const isActive = activePart === item.id;
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => handlePartNavigation(item.id)}
                                            className={`relative rounded-lg px-3 py-2 text-xs font-semibold transition ${isActive ? "text-white" : "text-slate-300 hover:text-white"
                                                }`}
                                        >
                                            {item.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })()}

                <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">Manage Interview</p>
                            <h1 className="mt-2 text-3xl font-semibold">{details.job?.position_title ?? details.interview.title}</h1>
                            <p className="mt-2 text-sm text-slate-300">Interview ID: {details.interview.id}</p>
                        </div>
                        <Link
                            href={`/organization/manage-interviews/${details.interview.id}/candidates-info`}
                            className="inline-flex rounded-lg border border-cyan-300/40 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
                        >
                            View Candidates
                        </Link>
                    </div>
                </div>

                {errorMessage && (
                    <div className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                        {errorMessage}
                    </div>
                )}

                {successMessage && (
                    <div className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
                        {successMessage}
                    </div>
                )}

                <section id="part-1" className="space-y-4 scroll-mt-24">
                    <PartHeader
                        partLabel="Part 1"
                        title="Job Details And Interview Details"
                        accentClass="bg-emerald-400/20 text-emerald-200"
                    />

                    <div className="grid gap-6 lg:grid-cols-2">
                        <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl space-y-3">
                            <h2 className="text-lg font-semibold">Interview Details</h2>
                            <p className="text-sm text-slate-300"><span className="text-slate-400">Title:</span> {details.interview.title}</p>
                            <p className="text-sm text-slate-300"><span className="text-slate-400">Status:</span> {details.interview.status}</p>
                            <p className="text-sm text-slate-300"><span className="text-slate-400">Campaign Start:</span> {formatDateTime(details.interview.campaign_start_utc)}</p>
                            <p className="text-sm text-slate-300"><span className="text-slate-400">Campaign End:</span> {formatDateTime(details.interview.campaign_end_utc)}</p>
                            <p className="text-sm text-slate-300"><span className="text-slate-400">Assessment Duration:</span> {details.interview.assessment_duration_minutes} mins</p>
                            <p className="text-sm text-slate-300"><span className="text-slate-400">Interview Duration:</span> {details.interview.interview_duration_minutes} mins</p>
                            <p className="text-sm text-slate-300"><span className="text-slate-400">Created:</span> {formatDateTime(details.interview.created_at)}</p>
                            <p className="text-sm text-slate-300"><span className="text-slate-400">Published:</span> {formatDateTime(details.interview.published_at)}</p>
                        </div>

                        <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl space-y-3">
                            <h2 className="text-lg font-semibold">Job Details</h2>
                            <p className="text-sm text-slate-300"><span className="text-slate-400">Position:</span> {details.job?.position_title ?? "-"}</p>
                            <p className="text-sm text-slate-300"><span className="text-slate-400">Description:</span> {details.job?.job_description ?? "-"}</p>
                            <p className="text-sm text-slate-300"><span className="text-slate-400">Skills:</span> {(details.job?.skills_required ?? []).join(", ") || "-"}</p>
                            <p className="text-sm text-slate-300"><span className="text-slate-400">CTC:</span> {details.job?.ctc_min ?? "-"} to {details.job?.ctc_max ?? "-"}</p>
                            {details.applicationLink ? (
                                <>
                                    <p className="text-sm text-slate-300 break-all"><span className="text-slate-400">Application Link:</span> {details.applicationLink.application_link}</p>
                                    <p className="text-sm text-slate-300"><span className="text-slate-400">Valid Until:</span> {formatDateTime(details.applicationLink.valid_until)}</p>
                                </>
                            ) : (
                                <p className="text-sm text-slate-400">No active application link</p>
                            )}
                        </div>
                    </div>
                </section>

                <section id="part-2" className="space-y-4 scroll-mt-24">
                    <PartHeader
                        partLabel="Part 2"
                        title="Scheduled Assessments And Interview Slots"
                        accentClass="bg-cyan-400/20 text-cyan-200"
                    />

                    <div className="grid gap-6 lg:grid-cols-2">
                        <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl">
                            <h2 className="text-lg font-semibold mb-3">Assessment Slots ({details.assessmentSlots.length})</h2>
                            <div className="space-y-2 text-sm text-slate-300">
                                {details.assessmentSlots.map((slot, index) => (
                                    <div key={slot.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                                        <p>#{index + 1} {formatDateTime(slot.slot_start_utc)} to {formatDateTime(slot.slot_end_utc)}</p>
                                        <p className="text-xs text-slate-400">Capacity {slot.assigned_candidates}/{slot.max_candidates}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl">
                            <h2 className="text-lg font-semibold mb-3">Interview Slots ({details.interviewSlots.length})</h2>
                            <div className="space-y-2 text-sm text-slate-300">
                                {details.interviewSlots.map((slot, index) => (
                                    <div key={slot.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                                        <p>#{index + 1} {formatDateTime(slot.slot_start_utc)} to {formatDateTime(slot.slot_end_utc)}</p>
                                        <p className="text-xs text-slate-400">Capacity {slot.assigned_candidates}/{slot.max_candidates}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                <section id="part-3" className="space-y-4 scroll-mt-24">
                    <PartHeader
                        partLabel="Part 3"
                        title="Add, Delete, And Update Questions"
                        description="You can edit assessment questions and interview fallback questions below."
                        accentClass="bg-amber-400/20 text-amber-200"
                    />

                    <div className="rounded-2xl border border-amber-300/30 bg-amber-400/10 p-6 backdrop-blur-xl space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-semibold text-amber-100">Assessment Questions</h3>
                            <button
                                onClick={addAssessmentQuestion}
                                className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-[#041022] transition hover:brightness-110"
                            >
                                + Add Assessment Question
                            </button>
                        </div>

                        {assessmentQuestions.length === 0 ? (
                            <p className="text-sm text-amber-200">No assessment questions yet.</p>
                        ) : (
                            assessmentQuestions.map((question, qIndex) => (
                                <div key={`${question.id}-${qIndex}`} className="rounded-lg border border-amber-300/20 bg-amber-400/5 p-4 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs text-amber-200">Question {qIndex + 1}</p>
                                        <button
                                            onClick={() => removeAssessmentQuestion(qIndex)}
                                            className="text-xs font-semibold text-rose-300 hover:text-rose-200"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                    <textarea
                                        rows={2}
                                        value={question.question_text}
                                        onChange={(e) => updateAssessmentQuestionText(qIndex, e.target.value)}
                                        className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-amber-400"
                                    />
                                    <div className="grid gap-2 md:grid-cols-2">
                                        {question.options.map((option, optIndex) => (
                                            <div key={`${question.id}-${option.label}`} className="rounded-md border border-white/10 p-2">
                                                <label className="text-xs text-slate-300">Option {option.label}</label>
                                                <input
                                                    type="text"
                                                    value={option.text}
                                                    onChange={(e) => updateAssessmentOptionText(qIndex, optIndex, e.target.value)}
                                                    className="mt-1 w-full rounded border border-white/20 bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:border-amber-400"
                                                />
                                                <label className="mt-2 inline-flex items-center gap-2 text-xs text-amber-200">
                                                    <input
                                                        type="radio"
                                                        name={`correct-${question.id}-${qIndex}`}
                                                        checked={question.correct_option_label === option.label}
                                                        onChange={() => setAssessmentCorrectOption(qIndex, option.label)}
                                                    />
                                                    Correct
                                                </label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="rounded-2xl border border-cyan-300/30 bg-cyan-400/10 p-6 backdrop-blur-xl space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-semibold text-cyan-100">Interview Fallback Questions</h3>
                            <button
                                onClick={addFallbackQuestion}
                                className="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-[#041022] transition hover:brightness-110"
                            >
                                + Add Fallback Question
                            </button>
                        </div>

                        {fallbackQuestions.length === 0 ? (
                            <p className="text-sm text-cyan-200">No fallback questions yet.</p>
                        ) : (
                            fallbackQuestions.map((question, index) => (
                                <div key={`${question.id}-${index}`} className="rounded-lg border border-cyan-300/20 bg-cyan-400/5 p-4 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs text-cyan-200">Question {index + 1}</p>
                                        <button
                                            onClick={() => removeFallbackQuestion(index)}
                                            className="text-xs font-semibold text-rose-300 hover:text-rose-200"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                    <textarea
                                        rows={2}
                                        value={question.question_text}
                                        onChange={(e) => updateFallbackQuestionText(index, e.target.value)}
                                        className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
                                    />
                                    <select
                                        value={question.difficulty_level}
                                        onChange={(e) => updateFallbackQuestionDifficulty(index, e.target.value)}
                                        className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
                                    >
                                        <option value="EASY">Easy</option>
                                        <option value="MEDIUM">Medium</option>
                                        <option value="HARD">Hard</option>
                                    </select>
                                </div>
                            ))
                        )}
                    </div>
                </section>

                <div className="flex flex-wrap gap-3 pt-2">
                    <Link
                        href="/organization/manage-interviews"
                        className="inline-flex rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                    >
                        Back
                    </Link>
                    <button
                        onClick={handleSaveQuestions}
                        disabled={isSaving}
                        className="inline-flex rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-400 px-5 py-2 text-sm font-semibold text-[#041022] transition hover:brightness-110 disabled:opacity-70"
                    >
                        {isSaving ? "Saving..." : "Save Question Updates"}
                    </button>
                </div>
            </div>
        </div>
    );
}
