"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
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

type AssessmentErrorPayload = {
    opensAt?: string;
    serverNow?: string;
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
    const [assessmentOpensAt, setAssessmentOpensAt] = useState<string | null>(null);

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
                const payload = (result.data ?? {}) as AssessmentErrorPayload;
                setAssessmentOpensAt(payload.opensAt ?? null);
                setIsLoading(false);
                return;
            }

            const loadedData = result.data as AssessmentData;
            setData(loadedData);
            setAssessmentOpensAt(null);
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

    const saveDraft = useCallback(async (trigger: "auto" | "next") => {
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
    }, [answers, data, hasUnsavedChanges, isDraftReady, token]);

    useEffect(() => {
        if (!token || !data || !isDraftReady || data.submittedAt) {
            return;
        }

        const interval = setInterval(() => {
            void saveDraft("auto");
        }, 120000);

        return () => clearInterval(interval);
    }, [answers, data, hasUnsavedChanges, isDraftReady, saveDraft, token]);

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

    function formatCountdownClock(remainingMs: number) {
        const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) {
            return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
        }

        return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    function getQuestionProgressWidthClass(currentIndex: number, total: number) {
        if (total <= 0) return "w-0";
        const percent = ((currentIndex + 1) / total) * 100;
        if (percent <= 10) return "w-[10%]";
        if (percent <= 25) return "w-1/4";
        if (percent <= 50) return "w-1/2";
        if (percent <= 75) return "w-3/4";
        return "w-full";
    }

    const sessionValidUntilMs = data?.sessionValidUntil ? new Date(data.sessionValidUntil).getTime() : null;
    const remainingMs = sessionValidUntilMs ? sessionValidUntilMs - nowMs : null;
    const opensAtMs = assessmentOpensAt ? new Date(assessmentOpensAt).getTime() : null;
    const opensInMs = opensAtMs ? opensAtMs - nowMs : null;
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

    const submitAssessment = useCallback(async (trigger: "manual" | "auto-timeout" = "manual") => {
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
    }, [answers, data, saveDraft, token]);

    useEffect(() => {
        if (!data || data.submittedAt || !isExpired || isSubmitting || hasAutoSubmittedOnExpiry) {
            return;
        }

        setHasAutoSubmittedOnExpiry(true);
        setErrorMessage(null);
        setSuccessMessage("Time is over. Submitting your assessment automatically...");
        void submitAssessment("auto-timeout");
    }, [data, hasAutoSubmittedOnExpiry, isExpired, isSubmitting, submitAssessment]);

    if (isLoading) {
        return (
            <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#fff8ee] text-slate-900">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_12%,rgba(20,184,166,0.18),transparent_35%),radial-gradient(circle_at_86%_20%,rgba(245,158,11,0.2),transparent_32%)]" />
                <p className="relative rounded-xl border border-slate-200 bg-white/90 px-4 py-2 text-sm text-slate-700 shadow-sm">
                    Loading assessment...
                </p>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="min-h-screen bg-[#fff8ee] px-6 py-10 text-slate-900 lg:px-10">
                <div className="mx-auto max-w-2xl space-y-3">
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        {errorMessage ?? "Assessment unavailable"}
                    </div>
                    {opensAtMs && opensInMs !== null && opensInMs > 0 ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                            <p className="font-semibold">Assessment opens in: {formatCountdownClock(opensInMs)}</p>
                            <p className="mt-1 text-xs text-amber-700">
                                Opens at: {new Date(opensAtMs).toLocaleString("en-IN", {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    second: "2-digit",
                                    hour12: true,
                                })}
                            </p>
                        </div>
                    ) : null}
                </div>
            </div>
        );
    }

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#fff8ee] px-6 py-10 text-slate-900 lg:px-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_12%,rgba(20,184,166,0.18),transparent_35%),radial-gradient(circle_at_86%_20%,rgba(245,158,11,0.2),transparent_32%)]" />

            <div className="relative mx-auto max-w-5xl space-y-6">
                <div className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_20px_60px_-34px_rgba(15,23,42,0.45)] sm:p-8">
                    <p className="text-xs uppercase tracking-[0.18em] text-teal-700">Candidate Assessment</p>
                    <h1 className="mt-2 text-3xl font-semibold text-slate-900">{data.positionTitle ?? data.interviewTitle}</h1>
                    <p className="mt-2 text-sm text-slate-600">Candidate: {data.candidateName}</p>
                    <p className="mt-1 text-sm text-slate-600">Duration: {data.durationMinutes ?? "-"} minutes</p>
                    {!data.submittedAt && remainingMs !== null ? (
                        <p className={`mt-2 text-sm font-semibold ${isExpired ? "text-rose-700" : isWarning ? "text-amber-700" : "text-emerald-700"}`}>
                            Time Left: {formatRemaining(remainingMs)}
                        </p>
                    ) : null}
                </div>

                {isWarning ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        Less than 5 minutes remaining. Please review quickly and submit.
                    </div>
                ) : null}

                {isExpired ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        Assessment time has expired. Refresh to view latest status.
                    </div>
                ) : null}

                {errorMessage ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        {errorMessage}
                    </div>
                ) : null}

                {successMessage ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                        {successMessage}
                    </div>
                ) : null}

                {data.submittedAt ? (
                    <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6">
                        <h2 className="text-lg font-semibold text-emerald-900">Assessment Submitted</h2>
                        <p className="mt-2 text-sm text-emerald-800">
                            Score: {data.result?.score ?? "-"}% ({data.result?.correctAnswers ?? "-"}/{data.result?.totalQuestions ?? "-"})
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="rounded-3xl border border-slate-200 bg-white/92 p-5 shadow-[0_18px_45px_-30px_rgba(15,23,42,0.35)]">
                            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Assessment Overview</p>
                            <div className="mt-3 grid gap-2 sm:grid-cols-3">
                                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                                    Attempted: {attemptedCount}
                                </p>
                                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                                    Marked For Review: {reviewCount}
                                </p>
                                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
                                    Not Attempted: {notAttemptedCount}
                                </p>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-600">
                                <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1">Attempted</span>
                                <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1">Review</span>
                                <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1">Not Attempted</span>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2">
                                {data.questions.map((q) => {
                                    const isAttempted = Boolean(answers[q.id]);
                                    const isMarked = markedForReview.includes(q.id);
                                    const isActive = !isReviewPageOpen && currentQuestion?.id === q.id;
                                    const className = isMarked
                                        ? "border-amber-200 bg-amber-50 text-amber-800"
                                        : isAttempted
                                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                            : "border-slate-200 bg-slate-50 text-slate-700";

                                    return (
                                        <button
                                            key={`jump-${q.id}`}
                                            type="button"
                                            onClick={() => isReviewPageOpen ? editQuestionFromReview(q.id) : jumpToQuestion(q.id)}
                                            className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${className} ${isActive ? "ring-2 ring-teal-300" : ""}`}
                                        >
                                            Q{q.questionOrder}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {!isReviewPageOpen && currentQuestion ? (
                            <div className="rounded-3xl border border-slate-200 bg-white/92 p-5 shadow-[0_18px_45px_-30px_rgba(15,23,42,0.35)]">
                                <div className="mb-3 flex items-center justify-between">
                                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-700">
                                        Question {currentQuestionIndex + 1} of {totalQuestions}
                                    </p>
                                    <div className="h-2 w-40 overflow-hidden rounded bg-slate-200">
                                        <div
                                            className={`h-full rounded bg-gradient-to-r from-amber-500 to-teal-500 transition-all ${getQuestionProgressWidthClass(currentQuestionIndex, Math.max(totalQuestions, 1))}`}
                                        />
                                    </div>
                                </div>
                                <p className="text-base font-semibold text-slate-900">Q{currentQuestion.questionOrder}. {currentQuestion.questionText}</p>
                                <button
                                    type="button"
                                    disabled={isExpired || isSubmitting}
                                    onClick={() => toggleMarkForReview(currentQuestion.id)}
                                    className={`mt-2 rounded border px-2 py-1 text-xs font-semibold ${markedForReview.includes(currentQuestion.id)
                                        ? "border-amber-200 bg-amber-50 text-amber-800"
                                        : "border-slate-200 bg-slate-50 text-slate-700"}`}
                                >
                                    {markedForReview.includes(currentQuestion.id) ? "Marked For Review" : "Mark For Review"}
                                </button>
                                <div className="mt-3 space-y-2">
                                    {currentQuestion.options.map((option) => (
                                        <label key={`${currentQuestion.id}-${option.label}`} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
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
                                        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 disabled:opacity-50"
                                    >
                                        Previous
                                    </button>
                                    <button
                                        type="button"
                                        onClick={goToNextQuestion}
                                        disabled={currentQuestionIndex >= totalQuestions - 1 || isSubmitting || isSavingOnNext || isExpired || !isCurrentQuestionAnswered}
                                        className="rounded-lg bg-gradient-to-r from-amber-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                                    >
                                        {isSavingOnNext ? "Saving..." : "Save & Next"}
                                    </button>
                                </div>

                                {!isCurrentQuestionAnswered ? (
                                    <p className="mt-2 text-xs text-amber-700">Select an option to enable Next.</p>
                                ) : null}

                                <div className="mt-3 flex justify-end">
                                    <button
                                        type="button"
                                        onClick={openReviewPage}
                                        disabled={isSubmitting || isSavingOnNext || isExpired}
                                        className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-700 disabled:opacity-60"
                                    >
                                        Go To Review Page
                                    </button>
                                </div>
                            </div>
                        ) : null}

                        {isReviewPageOpen ? (
                            <div className="rounded-3xl border border-slate-200 bg-white/92 p-5 shadow-[0_18px_45px_-30px_rgba(15,23,42,0.35)]">
                                <h3 className="text-lg font-semibold text-slate-900">Final Review Page</h3>
                                <p className="mt-1 text-sm text-slate-600">Review all questions before final submission. Click any question to edit.</p>

                                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                                    <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                                        Attempted: {attemptedCount}
                                    </p>
                                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                                        Marked For Review: {reviewCount}
                                    </p>
                                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
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
                                                className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm text-slate-700 hover:border-teal-300"
                                            >
                                                <span>Q{q.questionOrder}. {q.questionText}</span>
                                                <span className="ml-3 text-xs text-slate-500">
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
                                        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
                                    >
                                        Back To Questions
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void submitAssessment();
                                        }}
                                        disabled={isSubmitting || isExpired}
                                        className="rounded-lg bg-gradient-to-r from-amber-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-70"
                                    >
                                        {isSubmitting ? "Submitting..." : "Submit Assessment"}
                                    </button>
                                </div>
                            </div>
                        ) : null}

                        <p className="text-xs text-slate-500">
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
            fallback={
                <div className="flex min-h-screen items-center justify-center bg-[#fff8ee] text-slate-700">
                    Loading assessment...
                </div>
            }
        >
            <CandidateAssessmentContent />
        </Suspense>
    );
}
