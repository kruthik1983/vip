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
    const [questionSearch, setQuestionSearch] = useState("");

    useEffect(() => {
        let mounted = true;

        async function loadDetails() {
            setIsLoading(true);
            setErrorMessage(null);

            const currentAdmin = await getCurrentOrganizationAdmin();
            if (!mounted) return;

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
                headers: { Authorization: `Bearer ${token}` },
            });

            const result = await response.json();
            if (!mounted) return;

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

    const filteredAssessmentQuestions = useMemo(() => {
        const query = questionSearch.trim().toLowerCase();
        if (!query) return assessmentQuestions;
        return assessmentQuestions.filter((q) => q.question_text.toLowerCase().includes(query));
    }, [assessmentQuestions, questionSearch]);

    const filteredFallbackQuestions = useMemo(() => {
        const query = questionSearch.trim().toLowerCase();
        if (!query) return fallbackQuestions;
        return fallbackQuestions.filter((q) => q.question_text.toLowerCase().includes(query));
    }, [fallbackQuestions, questionSearch]);

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

            setSuccessMessage("Questions updated successfully.");
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

    async function copyApplicationLink() {
        if (!details?.applicationLink?.application_link) return;
        await navigator.clipboard.writeText(details.applicationLink.application_link);
        setSuccessMessage("Application link copied.");
    }

    if (isLoading) {
        return (
            <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f3f9f7] text-slate-900">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(16,185,129,0.18),transparent_35%),radial-gradient(circle_at_84%_16%,rgba(56,189,248,0.18),transparent_35%)]" />
                <div className="relative rounded-2xl border border-slate-200 bg-white/90 px-6 py-4 shadow-lg">Loading interview details...</div>
            </div>
        );
    }

    if (!details) {
        return (
            <div className="min-h-screen bg-[#f3f9f7] px-6 py-10 text-slate-900 lg:px-10">
                <div className="mx-auto max-w-4xl space-y-4">
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage ?? "Interview details not available"}</div>
                    <Link href="/organization/manage-interviews" className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800">Back to Manage Interviews</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#f3f9f7] px-6 py-10 text-slate-900 lg:px-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(16,185,129,0.18),transparent_35%),radial-gradient(circle_at_84%_16%,rgba(56,189,248,0.18),transparent_35%)]" />
            <div className="relative mx-auto max-w-7xl space-y-6">
                <header className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.45)] sm:p-8">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-emerald-700">Interview Workspace</p>
                            <h1 className="mt-2 text-3xl font-semibold">{details.job?.position_title ?? details.interview.title}</h1>
                            <p className="mt-2 text-sm text-slate-600">Interview ID: {details.interview.id} • Status: {details.interview.status}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Link href={`/organization/manage-interviews/${details.interview.id}/candidates-info`} className="inline-flex rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-800">View Candidates</Link>
                            <Link href="/organization/manage-interviews" className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800">Back</Link>
                        </div>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-4">
                        <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs uppercase tracking-wide text-emerald-700">Assessment Slots</p><p className="mt-1 text-2xl font-semibold text-emerald-900">{details.assessmentSlots.length}</p></article>
                        <article className="rounded-2xl border border-sky-200 bg-sky-50 p-4"><p className="text-xs uppercase tracking-wide text-sky-700">Interview Slots</p><p className="mt-1 text-2xl font-semibold text-sky-900">{details.interviewSlots.length}</p></article>
                        <article className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="text-xs uppercase tracking-wide text-amber-700">Assessment Questions</p><p className="mt-1 text-2xl font-semibold text-amber-900">{assessmentQuestions.length}</p></article>
                        <article className="rounded-2xl border border-violet-200 bg-violet-50 p-4"><p className="text-xs uppercase tracking-wide text-violet-700">Fallback Questions</p><p className="mt-1 text-2xl font-semibold text-violet-900">{fallbackQuestions.length}</p></article>
                    </div>
                </header>

                {errorMessage ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</div> : null}
                {successMessage ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</div> : null}

                <section className="grid gap-6 lg:grid-cols-2">
                    <div className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)] space-y-2">
                        <h2 className="text-lg font-semibold">Job & Timeline</h2>
                        <p className="text-sm text-slate-700"><span className="text-slate-500">Title:</span> {details.interview.title}</p>
                        <p className="text-sm text-slate-700"><span className="text-slate-500">Campaign Start:</span> {formatDateTime(details.interview.campaign_start_utc)}</p>
                        <p className="text-sm text-slate-700"><span className="text-slate-500">Campaign End:</span> {formatDateTime(details.interview.campaign_end_utc)}</p>
                        <p className="text-sm text-slate-700"><span className="text-slate-500">Assessment Duration:</span> {details.interview.assessment_duration_minutes} mins</p>
                        <p className="text-sm text-slate-700"><span className="text-slate-500">Interview Duration:</span> {details.interview.interview_duration_minutes} mins</p>
                        <p className="text-sm text-slate-700"><span className="text-slate-500">Skills:</span> {(details.job?.skills_required ?? []).join(", ") || "-"}</p>
                        <p className="text-sm text-slate-700"><span className="text-slate-500">CTC:</span> {details.job?.ctc_min ?? "-"} to {details.job?.ctc_max ?? "-"}</p>
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)] space-y-3">
                        <h2 className="text-lg font-semibold">Application Link</h2>
                        {details.applicationLink ? (
                            <>
                                <p className="break-all rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{details.applicationLink.application_link}</p>
                                <p className="text-sm text-slate-700"><span className="text-slate-500">Valid Until:</span> {formatDateTime(details.applicationLink.valid_until)}</p>
                                <button onClick={() => void copyApplicationLink()} className="inline-flex rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800">Copy Link</button>
                            </>
                        ) : (
                            <p className="text-sm text-slate-500">No active application link.</p>
                        )}
                    </div>
                </section>

                <section className="grid gap-6 lg:grid-cols-2">
                    <div className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
                        <h2 className="text-lg font-semibold">Assessment Slots</h2>
                        <div className="mt-3 space-y-2">
                            {details.assessmentSlots.map((slot, index) => (
                                <div key={slot.id} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                                    #{index + 1} {formatDateTime(slot.slot_start_utc)} - {formatDateTime(slot.slot_end_utc)}
                                    <p className="text-xs text-emerald-700">Capacity {slot.assigned_candidates}/{slot.max_candidates}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
                        <h2 className="text-lg font-semibold">Interview Slots</h2>
                        <div className="mt-3 space-y-2">
                            {details.interviewSlots.map((slot, index) => (
                                <div key={slot.id} className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-900">
                                    #{index + 1} {formatDateTime(slot.slot_start_utc)} - {formatDateTime(slot.slot_end_utc)}
                                    <p className="text-xs text-cyan-700">Capacity {slot.assigned_candidates}/{slot.max_candidates}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)] space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-lg font-semibold">Question Studio</h2>
                        <input type="text" placeholder="Search question text" value={questionSearch} onChange={(e) => setQuestionSearch(e.target.value)} className="w-full max-w-xs rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
                    </div>

                    <div className="grid gap-6 xl:grid-cols-2">
                        <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                            <div className="flex items-center justify-between"><h3 className="font-semibold text-amber-900">Assessment Questions</h3><button onClick={addAssessmentQuestion} className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-semibold text-white">Add</button></div>
                            {filteredAssessmentQuestions.map((question) => {
                                const qIndex = assessmentQuestions.findIndex((q) => q.id === question.id);
                                return (
                                    <div key={question.id} className="space-y-2 rounded-xl border border-amber-200 bg-white p-3">
                                        <div className="flex justify-between"><span className="text-xs text-amber-700">Question {qIndex + 1}</span><button onClick={() => removeAssessmentQuestion(qIndex)} className="text-xs text-rose-700">Delete</button></div>
                                        <textarea rows={2} value={question.question_text} onChange={(e) => updateAssessmentQuestionText(qIndex, e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                                        <div className="grid gap-2 sm:grid-cols-2">
                                            {question.options.map((option, optIndex) => (
                                                <div key={option.label} className="rounded-lg border border-slate-200 p-2">
                                                    <label className="text-xs text-slate-600">Option {option.label}</label>
                                                    <input type="text" value={option.text} onChange={(e) => updateAssessmentOptionText(qIndex, optIndex, e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" />
                                                    <label className="mt-1 inline-flex items-center gap-1 text-xs text-slate-700"><input type="radio" name={`correct-${question.id}`} checked={question.correct_option_label === option.label} onChange={() => setAssessmentCorrectOption(qIndex, option.label)} />Correct</label>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50 p-4">
                            <div className="flex items-center justify-between"><h3 className="font-semibold text-sky-900">Interview Fallback Questions</h3><button onClick={addFallbackQuestion} className="rounded-lg bg-sky-600 px-3 py-1 text-xs font-semibold text-white">Add</button></div>
                            {filteredFallbackQuestions.map((question) => {
                                const qIndex = fallbackQuestions.findIndex((q) => q.id === question.id);
                                return (
                                    <div key={question.id} className="space-y-2 rounded-xl border border-sky-200 bg-white p-3">
                                        <div className="flex justify-between"><span className="text-xs text-sky-700">Question {qIndex + 1}</span><button onClick={() => removeFallbackQuestion(qIndex)} className="text-xs text-rose-700">Delete</button></div>
                                        <textarea rows={2} value={question.question_text} onChange={(e) => updateFallbackQuestionText(qIndex, e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                                        <select value={question.difficulty_level} onChange={(e) => updateFallbackQuestionDifficulty(qIndex, e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                                            <option value="EASY">Easy</option>
                                            <option value="MEDIUM">Medium</option>
                                            <option value="HARD">Hard</option>
                                        </select>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex justify-end">
                        <button onClick={handleSaveQuestions} disabled={isSaving} className="inline-flex rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-70">{isSaving ? "Saving..." : "Save Question Updates"}</button>
                    </div>
                </section>
            </div>
        </div>
    );
}
