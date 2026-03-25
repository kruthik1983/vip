"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type QuestionOption = {
    label: string;
    text: string;
};

type AssessmentQuestion = {
    id: number;
    questionText: string;
    questionOrder: number;
    options: QuestionOption[];
};

type AssessmentData = {
    attemptId: number;
    candidateName: string;
    interviewTitle: string;
    positionTitle: string | null;
    durationMinutes: number | null;
    sessionValidUntil: string | null;
    submittedAt: string | null;
    result: {
        totalQuestions: number | null;
        correctAnswers: number | null;
        score: number | null;
        durationSeconds: number | null;
    } | null;
    selectedAnswers: Record<number, string>;
    questions: AssessmentQuestion[];
};

function CandidateAssessmentContent() {
    const searchParams = useSearchParams();
    const token = useMemo(() => searchParams.get("token")?.trim() || "", [searchParams]);

    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [data, setData] = useState<AssessmentData | null>(null);
    const [answers, setAnswers] = useState<Record<number, string>>({});
    const [isDraftReady, setIsDraftReady] = useState(false);
    const [isAutoSaving, setIsAutoSaving] = useState(false);
    const [isSavingOnNext, setIsSavingOnNext] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [lastAutoSavedAt, setLastAutoSavedAt] = useState<string | null>(null);
    const [nowMs, setNowMs] = useState(Date.now());
    const [markedForReview, setMarkedForReview] = useState<number[]>([]);
    const [isReviewPageOpen, setIsReviewPageOpen] = useState(false);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [hasAutoSubmittedOnExpiry, setHasAutoSubmittedOnExpiry] = useState(false);

    useEffect(() => {
        let mounted = true;

        async function loadAssessment() {
            setIsLoading(true);
            setIsDraftReady(false);
            setErrorMessage(null);

            if (!token) {
                setErrorMessage("Missing assessment token");
                setIsLoading(false);
                return;
            }

            const response = await fetch(`/api/candidate/assessment?token=${encodeURIComponent(token)}`);
            const result = await response.json();

            if (!mounted) {
                return;
            }

            if (!response.ok || !result.success) {
                setErrorMessage(result.error ?? "Failed to load assessment");
                setIsLoading(false);
                return;
            }

            const loadedData = result.data as AssessmentData;
            setData(loadedData);
            setAnswers(loadedData.selectedAnswers ?? {});
            setHasUnsavedChanges(false);
            setCurrentQuestionIndex(0);
            setIsReviewPageOpen(false);
            setHasAutoSubmittedOnExpiry(false);

            const storageKey = `assessment-review-${token}`;
            const storedMarks = localStorage.getItem(storageKey);

            if (storedMarks) {
                try {
                    const parsed = JSON.parse(storedMarks) as number[];
                    const validIds = new Set(loadedData.questions.map((q) => q.id));
                    setMarkedForReview(
                        Array.isArray(parsed)
                            ? parsed.filter((id) => Number.isInteger(id) && validIds.has(id))
                            : [],
                    );
                } catch {
                    setMarkedForReview([]);
                }
            } else {
                setMarkedForReview([]);
            }

            setIsDraftReady(true);
            setIsLoading(false);
        }

        void loadAssessment();

        return () => {
            mounted = false;
        };
    }, [token]);

    function updateAnswer(questionId: number, optionLabel: string) {
        setAnswers((prev) => ({ ...prev, [questionId]: optionLabel }));
        setHasUnsavedChanges(true);
    }

    useEffect(() => {
        const interval = setInterval(() => setNowMs(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (!token) {
            return;
        }

        localStorage.setItem(`assessment-review-${token}`, JSON.stringify(markedForReview));
    }, [markedForReview, token]);

    useEffect(() => {
        if (!data) {
            return;
        }

        const validIds = new Set(data.questions.map((q) => q.id));
        setMarkedForReview((prev) => prev.filter((id) => validIds.has(id)));
    }, [data]);

    async function saveDraft(trigger: "auto" | "next") {
        if (!token || !data || !isDraftReady || data.submittedAt || !hasUnsavedChanges) {
            return true;
        }

        if (data.sessionValidUntil && new Date(data.sessionValidUntil).getTime() <= Date.now()) {
            return false;
        }

        if (trigger === "auto") {
            setIsAutoSaving(true);
        } else {
            setIsSavingOnNext(true);
        }

        try {
            const responses = Object.entries(answers).map(([questionId, selectedOptionLabel]) => ({
                questionId: Number(questionId),
                selectedOptionLabel,
            }));

            const response = await fetch("/api/candidate/assessment", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ token, responses }),
            });

            const result = await response.json();
            if (response.ok && result.success) {
                setLastAutoSavedAt(result.data?.savedAt ?? new Date().toISOString());
                setHasUnsavedChanges(false);
                return true;
            }

            if (trigger === "next") {
                setErrorMessage(result.error ?? "Could not save your response. Please retry.");
            }
            return false;
        } catch (error) {
            console.error("Autosave failed:", error);
            if (trigger === "next") {
                setErrorMessage("Could not save your response. Please retry.");
            }
            return false;
        } finally {
            if (trigger === "auto") {
                setIsAutoSaving(false);
            } else {
                setIsSavingOnNext(false);
            }
        }
    }

    useEffect(() => {
        if (!token || !data || !isDraftReady || data.submittedAt) {
            return;
        }

        const interval = setInterval(() => {
            void saveDraft("auto");
        }, 120000);

        return () => clearInterval(interval);
    }, [answers, data, hasUnsavedChanges, isDraftReady, token]);

    function formatSavedTime(value: string) {
        return new Date(value).toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
        });
    }

    function formatRemaining(remainingMs: number) {
        const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    const sessionValidUntilMs = data?.sessionValidUntil ? new Date(data.sessionValidUntil).getTime() : null;
    const remainingMs = sessionValidUntilMs ? sessionValidUntilMs - nowMs : null;
    const isExpired = !data?.submittedAt && remainingMs !== null && remainingMs <= 0;
    const isWarning = !data?.submittedAt && remainingMs !== null && remainingMs > 0 && remainingMs <= 5 * 60 * 1000;

    const allQuestions = data?.questions ?? [];
    const currentQuestion = allQuestions[currentQuestionIndex] ?? null;
    const isCurrentQuestionAnswered = currentQuestion ? Boolean(answers[currentQuestion.id]) : false;
    const totalQuestions = allQuestions.length;
    const attemptedCount = allQuestions.filter((q) => Boolean(answers[q.id])).length;
    const reviewCount = markedForReview.length;
    const notAttemptedCount = totalQuestions - attemptedCount;

    function toggleMarkForReview(questionId: number) {
        setMarkedForReview((prev) =>
            prev.includes(questionId)
                ? prev.filter((id) => id !== questionId)
                : [...prev, questionId],
        );
    }

    function jumpToQuestion(questionId: number) {
        const index = allQuestions.findIndex((q) => q.id === questionId);
        if (index >= 0) {
            setCurrentQuestionIndex(index);
        }
    }

    async function goToNextQuestion() {
        if (currentQuestionIndex >= totalQuestions - 1) {
            return;
        }

        if (!isCurrentQuestionAnswered) {
            setErrorMessage("Please select an answer before moving to the next question.");
            return;
        }

        const saved = await saveDraft("next");
        if (!saved) {
            return;
        }

        setCurrentQuestionIndex((prev) => Math.min(prev + 1, totalQuestions - 1));
    }

    function goToPreviousQuestion() {
        setCurrentQuestionIndex((prev) => Math.max(prev - 1, 0));
    }

    async function openReviewPage() {
        const saved = await saveDraft("next");
        if (!saved) {
            return;
        }

        setIsReviewPageOpen(true);
    }

    function editQuestionFromReview(questionId: number) {
        jumpToQuestion(questionId);
        setIsReviewPageOpen(false);
    }

    async function submitAssessment(trigger: "manual" | "auto-timeout" = "manual") {
        if (!token || !data) {
            return;
        }

        setErrorMessage(null);
        if (trigger === "manual") {
            setSuccessMessage(null);
        }
        setIsSubmitting(true);

        await saveDraft("next");

        try {
            const responses = data.questions.map((q) => ({
                questionId: q.id,
                selectedOptionLabel: answers[q.id] || "",
            }));

            const response = await fetch("/api/candidate/assessment", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ token, responses }),
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                setErrorMessage(result.error ?? "Failed to submit assessment");
                setIsSubmitting(false);
                return;
            }

            setSuccessMessage("Assessment submitted successfully.");
            localStorage.removeItem(`assessment-review-${token}`);
            setData((prev) => {
                if (!prev) {
                    return prev;
                }

                return {
                    ...prev,
                    submittedAt: new Date().toISOString(),
                    result: {
                        totalQuestions: result.data?.totalQuestions ?? null,
                        correctAnswers: result.data?.correctAnswers ?? null,
                        score: result.data?.score ?? null,
                        durationSeconds: result.data?.durationSeconds ?? null,
                    },
                };
            });
        } catch (error) {
            setErrorMessage("Failed to submit assessment");
            console.error(error);
        } finally {
            setIsSubmitting(false);
        }
    }

    useEffect(() => {
        if (!data || data.submittedAt || !isExpired || isSubmitting || hasAutoSubmittedOnExpiry) {
            return;
        }

        setHasAutoSubmittedOnExpiry(true);
        setErrorMessage(null);
        setSuccessMessage("Time is over. Submitting your assessment automatically...");
        void submitAssessment("auto-timeout");
    }, [data, hasAutoSubmittedOnExpiry, isExpired, isSubmitting]);

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#070b16] text-white">
                <p className="text-sm text-slate-300">Loading assessment...</p>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="min-h-screen bg-[#070b16] px-6 py-10 text-white lg:px-10">
                <div className="mx-auto max-w-2xl rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                    {errorMessage ?? "Assessment unavailable"}
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#070b16] px-6 py-10 text-white lg:px-10">
            <div className="mx-auto max-w-4xl space-y-6">
                <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
                    <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">Candidate Assessment</p>
                    <h1 className="mt-2 text-3xl font-semibold">{data.positionTitle ?? data.interviewTitle}</h1>
                    <p className="mt-2 text-sm text-slate-300">Candidate: {data.candidateName}</p>
                    <p className="mt-1 text-sm text-slate-300">Duration: {data.durationMinutes ?? "-"} minutes</p>
                    {!data.submittedAt && remainingMs !== null ? (
                        <p className={`mt-2 text-sm font-semibold ${isExpired ? "text-rose-300" : isWarning ? "text-amber-200" : "text-emerald-200"}`}>
                            Time Left: {formatRemaining(remainingMs)}
                        </p>
                    ) : null}
                </div>

                {isWarning ? (
                    <div className="rounded-xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                        Less than 5 minutes remaining. Please review quickly and submit.
                    </div>
                ) : null}

                {isExpired ? (
                    <div className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                        Assessment time has expired. Refresh to view latest status.
                    </div>
                ) : null}

                {errorMessage ? (
                    <div className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                        {errorMessage}
                    </div>
                ) : null}

                {successMessage ? (
                    <div className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
                        {successMessage}
                    </div>
                ) : null}

                {data.submittedAt ? (
                    <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-6 backdrop-blur-xl">
                        <h2 className="text-lg font-semibold text-emerald-100">Assessment Submitted</h2>
                        <p className="mt-2 text-sm text-emerald-200">
                            Score: {data.result?.score ?? "-"}% ({data.result?.correctAnswers ?? "-"}/{data.result?.totalQuestions ?? "-"})
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="rounded-2xl border border-white/15 bg-white/5 p-5 backdrop-blur-xl">
                            <p className="text-xs uppercase tracking-[0.14em] text-slate-300">Assessment Overview</p>
                            <div className="mt-3 grid gap-2 sm:grid-cols-3">
                                <p className="rounded-lg border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
                                    Attempted: {attemptedCount}
                                </p>
                                <p className="rounded-lg border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                                    Marked For Review: {reviewCount}
                                </p>
                                <p className="rounded-lg border border-slate-300/30 bg-slate-400/10 px-3 py-2 text-xs text-slate-200">
                                    Not Attempted: {notAttemptedCount}
                                </p>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-300">
                                <span className="rounded border border-emerald-300/30 bg-emerald-400/10 px-2 py-1">Attempted</span>
                                <span className="rounded border border-amber-300/30 bg-amber-400/10 px-2 py-1">Review</span>
                                <span className="rounded border border-slate-300/30 bg-slate-400/10 px-2 py-1">Not Attempted</span>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2">
                                {data.questions.map((q) => {
                                    const isAttempted = Boolean(answers[q.id]);
                                    const isMarked = markedForReview.includes(q.id);
                                    const isActive = !isReviewPageOpen && currentQuestion?.id === q.id;
                                    const className = isMarked
                                        ? "border-amber-300/40 bg-amber-400/10 text-amber-100"
                                        : isAttempted
                                            ? "border-emerald-300/40 bg-emerald-400/10 text-emerald-200"
                                            : "border-slate-300/30 bg-slate-400/10 text-slate-200";

                                    return (
                                        <button
                                            key={`jump-${q.id}`}
                                            type="button"
                                            onClick={() => isReviewPageOpen ? editQuestionFromReview(q.id) : jumpToQuestion(q.id)}
                                            className={`rounded border px-2 py-1 text-xs font-semibold ${className} ${isActive ? "ring-2 ring-cyan-300/60" : ""}`}
                                        >
                                            Q{q.questionOrder}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {!isReviewPageOpen && currentQuestion ? (
                            <div className="rounded-2xl border border-white/15 bg-white/5 p-5 backdrop-blur-xl">
                                <div className="mb-3 flex items-center justify-between">
                                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">
                                        Question {currentQuestionIndex + 1} of {totalQuestions}
                                    </p>
                                    <div className="h-2 w-40 overflow-hidden rounded bg-white/10">
                                        <div
                                            className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400"
                                            style={{ width: `${((currentQuestionIndex + 1) / Math.max(totalQuestions, 1)) * 100}%` }}
                                        />
                                    </div>
                                </div>
                                <p className="text-base font-semibold text-cyan-100">Q{currentQuestion.questionOrder}. {currentQuestion.questionText}</p>
                                <button
                                    type="button"
                                    disabled={isExpired || isSubmitting}
                                    onClick={() => toggleMarkForReview(currentQuestion.id)}
                                    className={`mt-2 rounded border px-2 py-1 text-xs font-semibold ${markedForReview.includes(currentQuestion.id)
                                        ? "border-amber-300/40 bg-amber-400/10 text-amber-100"
                                        : "border-white/20 bg-white/5 text-slate-200"}`}
                                >
                                    {markedForReview.includes(currentQuestion.id) ? "Marked For Review" : "Mark For Review"}
                                </button>
                                <div className="mt-3 space-y-2">
                                    {currentQuestion.options.map((option) => (
                                        <label key={`${currentQuestion.id}-${option.label}`} className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
                                            <input
                                                type="radio"
                                                name={`question-${currentQuestion.id}`}
                                                value={option.label}
                                                disabled={isExpired || isSubmitting}
                                                checked={answers[currentQuestion.id] === option.label}
                                                onChange={() => {
                                                    setErrorMessage(null);
                                                    updateAnswer(currentQuestion.id, option.label);
                                                }}
                                            />
                                            <span>
                                                <strong>{option.label}.</strong> {option.text}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                                <div className="mt-4 flex items-center justify-between gap-2">
                                    <button
                                        type="button"
                                        onClick={goToPreviousQuestion}
                                        disabled={currentQuestionIndex === 0 || isSubmitting || isSavingOnNext}
                                        className="rounded border border-white/20 bg-white/5 px-4 py-2 text-sm text-slate-200 disabled:opacity-50"
                                    >
                                        Previous
                                    </button>
                                    <button
                                        type="button"
                                        onClick={goToNextQuestion}
                                        disabled={currentQuestionIndex >= totalQuestions - 1 || isSubmitting || isSavingOnNext || isExpired || !isCurrentQuestionAnswered}
                                        className="rounded bg-gradient-to-r from-emerald-500 to-cyan-400 px-4 py-2 text-sm font-semibold text-[#041022] disabled:opacity-60"
                                    >
                                        {isSavingOnNext ? "Saving..." : "Save & Next"}
                                    </button>
                                </div>

                                {!isCurrentQuestionAnswered ? (
                                    <p className="mt-2 text-xs text-amber-200">Select an option to enable Next.</p>
                                ) : null}

                                <div className="mt-3 flex justify-end">
                                    <button
                                        type="button"
                                        onClick={openReviewPage}
                                        disabled={isSubmitting || isSavingOnNext || isExpired}
                                        className="rounded border border-cyan-300/40 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-60"
                                    >
                                        Go To Review Page
                                    </button>
                                </div>
                            </div>
                        ) : null}

                        {isReviewPageOpen ? (
                            <div className="rounded-2xl border border-white/15 bg-white/5 p-5 backdrop-blur-xl">
                                <h3 className="text-lg font-semibold text-cyan-100">Final Review Page</h3>
                                <p className="mt-1 text-sm text-slate-300">Review all questions before final submission. Click any question to edit.</p>

                                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                                    <p className="rounded-lg border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
                                        Attempted: {attemptedCount}
                                    </p>
                                    <p className="rounded-lg border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                                        Marked For Review: {reviewCount}
                                    </p>
                                    <p className="rounded-lg border border-slate-300/30 bg-slate-400/10 px-3 py-2 text-xs text-slate-200">
                                        Not Attempted: {notAttemptedCount}
                                    </p>
                                </div>

                                <div className="mt-4 space-y-2">
                                    {allQuestions.map((q) => {
                                        const selected = answers[q.id] || "Not answered";
                                        const isMarked = markedForReview.includes(q.id);

                                        return (
                                            <button
                                                key={`review-row-${q.id}`}
                                                type="button"
                                                onClick={() => editQuestionFromReview(q.id)}
                                                className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-sm text-slate-200 hover:border-cyan-300/40"
                                            >
                                                <span>Q{q.questionOrder}. {q.questionText}</span>
                                                <span className="ml-3 text-xs text-slate-300">
                                                    {selected}{isMarked ? " | Review" : ""}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="mt-5 flex items-center justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setIsReviewPageOpen(false)}
                                        className="rounded border border-white/20 bg-white/5 px-4 py-2 text-sm text-slate-200"
                                    >
                                        Back To Questions
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void submitAssessment();
                                        }}
                                        disabled={isSubmitting || isExpired}
                                        className="rounded bg-gradient-to-r from-emerald-500 to-cyan-400 px-4 py-2 text-sm font-semibold text-[#041022] disabled:opacity-70"
                                    >
                                        {isSubmitting ? "Submitting..." : "Submit Assessment"}
                                    </button>
                                </div>
                            </div>
                        ) : null}

                        <p className="text-xs text-slate-400">
                            {isAutoSaving
                                ? "Autosaving..."
                                : lastAutoSavedAt
                                    ? `Draft saved at ${formatSavedTime(lastAutoSavedAt)}`
                                    : "Draft autosaves every 2 minutes."}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function CandidateAssessmentPage() {
    return (
        <Suspense
            fallback={<div className="flex min-h-screen items-center justify-center bg-[#070b16] text-white">Loading assessment...</div>}
        >
            <CandidateAssessmentContent />
        </Suspense>
    );
}
