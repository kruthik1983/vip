"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type InterviewQuestion = {
    id: number;
    questionText: string;
    difficultyLevel: string;
    questionOrder: number;
};

type InterviewData = {
    sessionId: number;
    candidateName: string;
    interviewTitle: string;
    positionTitle: string | null;
    durationMinutes: number | null;
    endedAt: string | null;
    result: {
        totalQuestionsAsked: number | null;
        score: number | null;
        durationSeconds: number | null;
    } | null;
    questions: InterviewQuestion[];
};

function CandidateInterviewContent() {
    const searchParams = useSearchParams();
    const token = useMemo(() => searchParams.get("token")?.trim() || "", [searchParams]);

    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [data, setData] = useState<InterviewData | null>(null);
    const [answers, setAnswers] = useState<Record<number, string>>({});

    useEffect(() => {
        let mounted = true;

        async function loadInterview() {
            setIsLoading(true);
            setErrorMessage(null);

            if (!token) {
                setErrorMessage("Missing interview token");
                setIsLoading(false);
                return;
            }

            const response = await fetch(`/api/candidate/interview?token=${encodeURIComponent(token)}`);
            const result = await response.json();

            if (!mounted) {
                return;
            }

            if (!response.ok || !result.success) {
                setErrorMessage(result.error ?? "Failed to load interview");
                setIsLoading(false);
                return;
            }

            setData(result.data as InterviewData);
            setIsLoading(false);
        }

        void loadInterview();

        return () => {
            mounted = false;
        };
    }, [token]);

    function updateAnswer(questionId: number, text: string) {
        setAnswers((prev) => ({ ...prev, [questionId]: text }));
    }

    async function handleSubmit() {
        if (!token || !data) {
            return;
        }

        setErrorMessage(null);
        setSuccessMessage(null);
        setIsSubmitting(true);

        try {
            const responses = data.questions.map((q) => ({
                fallbackQuestionId: q.id,
                questionText: q.questionText,
                candidateAnswer: answers[q.id] || "",
            }));

            const response = await fetch("/api/candidate/interview", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ token, responses }),
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                setErrorMessage(result.error ?? "Failed to submit interview");
                setIsSubmitting(false);
                return;
            }

            setSuccessMessage("Interview submitted successfully.");

            const reload = await fetch(`/api/candidate/interview?token=${encodeURIComponent(token)}`);
            const reloadResult = await reload.json();
            if (reload.ok && reloadResult.success) {
                setData(reloadResult.data as InterviewData);
            }
        } catch (error) {
            setErrorMessage("Failed to submit interview");
            console.error(error);
        } finally {
            setIsSubmitting(false);
        }
    }

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#070b16] text-white">
                <p className="text-sm text-slate-300">Loading interview...</p>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="min-h-screen bg-[#070b16] px-6 py-10 text-white lg:px-10">
                <div className="mx-auto max-w-2xl rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                    {errorMessage ?? "Interview unavailable"}
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#070b16] px-6 py-10 text-white lg:px-10">
            <div className="mx-auto max-w-4xl space-y-6">
                <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
                    <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">Candidate Interview</p>
                    <h1 className="mt-2 text-3xl font-semibold">{data.positionTitle ?? data.interviewTitle}</h1>
                    <p className="mt-2 text-sm text-slate-300">Candidate: {data.candidateName}</p>
                    <p className="mt-1 text-sm text-slate-300">Duration: {data.durationMinutes ?? "-"} minutes</p>
                </div>

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

                {data.endedAt ? (
                    <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-6 backdrop-blur-xl">
                        <h2 className="text-lg font-semibold text-emerald-100">Interview Submitted</h2>
                        <p className="mt-2 text-sm text-emerald-200">
                            Total Questions Answered: {data.result?.totalQuestionsAsked ?? "-"}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {(data.questions.length === 0 ? [{ id: 0, questionText: "Please introduce yourself and summarize your relevant experience.", difficultyLevel: "MEDIUM", questionOrder: 1 }] : data.questions).map((question) => (
                            <div key={question.id} className="rounded-2xl border border-white/15 bg-white/5 p-5 backdrop-blur-xl">
                                <p className="text-sm font-semibold text-cyan-100">Q{question.questionOrder}. {question.questionText}</p>
                                <p className="mt-1 text-xs text-slate-400">Difficulty: {question.difficultyLevel}</p>
                                <label htmlFor={`answer-${question.id}`} className="mt-3 block text-xs uppercase tracking-wider text-slate-300">
                                    Your Answer
                                </label>
                                <textarea
                                    id={`answer-${question.id}`}
                                    rows={5}
                                    value={answers[question.id] || ""}
                                    onChange={(event) => updateAnswer(question.id, event.target.value)}
                                    placeholder="Type your answer here"
                                    className="mt-1 w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
                                />
                            </div>
                        ))}

                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={isSubmitting}
                            className="inline-flex rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-400 px-5 py-2 text-sm font-semibold text-[#041022] transition hover:brightness-110 disabled:opacity-70"
                        >
                            {isSubmitting ? "Submitting..." : "Submit Interview"}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function CandidateInterviewPage() {
    return (
        <Suspense
            fallback={<div className="flex min-h-screen items-center justify-center bg-[#070b16] text-white">Loading interview...</div>}
        >
            <CandidateInterviewContent />
        </Suspense>
    );
}
