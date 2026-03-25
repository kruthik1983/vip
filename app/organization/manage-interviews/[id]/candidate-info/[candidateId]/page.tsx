"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getCurrentOrganizationAdmin } from "@/lib/organization-auth";
import { supabase } from "@/lib/supabase";

type ReportPayload = {
    id: number;
    report_type: string;
    score: number | null;
    transcript_summary: string | null;
    strengths: string[] | null;
    weaknesses: string[] | null;
    hire_recommendation: string | null;
    detailed_analysis: string | null;
    generated_at: string | null;
    generated_by: string | null;
};

type CandidateReportData = {
    interview: {
        id: number;
        title: string;
        positionTitle: string | null;
    };
    candidate: {
        applicationId: number;
        candidateName: string;
        candidateEmail: string;
        candidatePhone: string | null;
        resumePath: string | null;
        resumeUrl: string | null;
        status: string;
        appliedAt: string;
    };
    completion: {
        completedAssessment: boolean;
        completedInterview: boolean;
        canGenerate: boolean;
    };
    assessment: {
        score: number | null;
        totalQuestions: number | null;
        correctAnswers: number | null;
        durationSeconds: number | null;
        submittedAt: string | null;
    } | null;
    interviewSession: {
        id: number;
        score: number | null;
        totalQuestionsAsked: number | null;
        durationSeconds: number | null;
        endedAt: string | null;
    } | null;
    interviewVideo: {
        filePath: string;
        mimeType: string | null;
        durationSeconds: number | null;
        signedUrl: string | null;
        signedFromBucket: string | null;
    } | null;
    transcript: Array<{
        index: number;
        questionText: string;
        candidateAnswer: string;
        askedAt: string;
        answeredAt: string;
        durationSeconds: number | null;
    }>;
    assessmentDetails: Array<{
        questionId: number;
        questionOrder: number;
        questionText: string;
        selectedOptionLabel: string | null;
        isCorrect: boolean | null;
    }>;
    decision: {
        id: number;
        decision: "ACCEPT" | "REJECT";
        notes: string | null;
        decidedAt: string;
    } | null;
    report: ReportPayload | null;
};

function formatDate(value: string | null) {
    if (!value) {
        return "-";
    }

    return new Date(value).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    });
}

export default function CandidateAiReportPage() {
    const params = useParams<{ id: string; candidateId: string }>();
    const router = useRouter();

    const interviewId = useMemo(() => Number(params?.id), [params]);
    const candidateId = useMemo(() => Number(params?.candidateId), [params]);

    const [isLoading, setIsLoading] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isDeciding, setIsDeciding] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [data, setData] = useState<CandidateReportData | null>(null);

    async function fetchData() {
        if (!Number.isInteger(interviewId) || !Number.isInteger(candidateId) || interviewId <= 0 || candidateId <= 0) {
            setErrorMessage("Invalid interview or candidate id");
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

        const response = await fetch(`/api/organization/interviews/manage/${interviewId}/candidate-info/${candidateId}`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            setErrorMessage(result.error ?? "Failed to load candidate report");
            setIsLoading(false);
            return;
        }

        setData(result.data as CandidateReportData);
        setIsLoading(false);
    }

    useEffect(() => {
        let mounted = true;

        async function bootstrap() {
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

            await fetchData();
        }

        void bootstrap();

        return () => {
            mounted = false;
        };
    }, [interviewId, candidateId, router]);

    async function generateReport() {
        setErrorMessage(null);
        setSuccessMessage(null);
        setIsGenerating(true);

        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;

            if (!token) {
                setErrorMessage("No active session. Please sign in again.");
                return;
            }

            const response = await fetch(`/api/organization/interviews/manage/${interviewId}/candidate-info/${candidateId}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ action: "GENERATE" }),
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                setErrorMessage(result.error ?? "Failed to generate report");
                return;
            }

            setSuccessMessage("AI report generated successfully.");
            await fetchData();
        } catch (error) {
            setErrorMessage("Failed to generate report");
            console.error(error);
        } finally {
            setIsGenerating(false);
        }
    }

    async function submitDecision(action: "ACCEPT" | "REJECT") {
        setErrorMessage(null);
        setSuccessMessage(null);
        setIsDeciding(true);

        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;

            if (!token) {
                setErrorMessage("No active session. Please sign in again.");
                return;
            }

            const response = await fetch(`/api/organization/interviews/manage/${interviewId}/candidate-info/${candidateId}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ action }),
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                setErrorMessage(result.error ?? "Failed to update candidate decision");
                return;
            }

            setSuccessMessage(result.message || "Decision updated");
            await fetchData();
        } catch (error) {
            setErrorMessage("Failed to update decision");
            console.error(error);
        } finally {
            setIsDeciding(false);
        }
    }

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#070b16] text-white">
                <p className="text-sm text-slate-300">Loading candidate AI report...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#070b16] px-6 py-10 text-white lg:px-10">
            <div className="mx-auto max-w-5xl space-y-6">
                <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">Candidate AI Report</p>
                            <h1 className="mt-2 text-3xl font-semibold">{data?.candidate.candidateName || "Candidate"}</h1>
                            <p className="mt-1 text-sm text-slate-300">{data?.candidate.candidateEmail}</p>
                            <p className="mt-1 text-sm text-slate-400">Phone: {data?.candidate.candidatePhone || "-"}</p>
                            <p className="mt-1 text-sm text-slate-400">Applied: {formatDate(data?.candidate.appliedAt ?? null)}</p>
                            <p className="mt-1 text-sm text-slate-400">Current Status: {data?.candidate.status || "-"}</p>
                            <p className="mt-2 text-sm text-slate-400">
                                Interview: {data?.interview.title || `#${interviewId}`}
                                {data?.interview.positionTitle ? ` (${data.interview.positionTitle})` : ""}
                            </p>
                            {data?.candidate.resumeUrl ? (
                                <a
                                    href={data.candidate.resumeUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-3 inline-flex rounded border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/20"
                                >
                                    View Resume
                                </a>
                            ) : (
                                <p className="mt-2 text-xs text-slate-500">Resume not available</p>
                            )}
                        </div>
                        <Link
                            href={`/organization/manage-interviews/${interviewId}/candidates-info`}
                            className="inline-flex rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                        >
                            Back to Candidates
                        </Link>
                    </div>
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

                <div className="grid gap-4 sm:grid-cols-3">
                    <div className="rounded-xl border border-white/15 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-wider text-slate-300">Assessment</p>
                        <p className="mt-2 text-sm text-slate-200">{data?.completion.completedAssessment ? "Completed" : "Pending"}</p>
                        <p className="mt-1 text-xs text-slate-400">Score: {data?.assessment?.score ?? "-"}</p>
                    </div>
                    <div className="rounded-xl border border-white/15 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-wider text-slate-300">Interview</p>
                        <p className="mt-2 text-sm text-slate-200">{data?.completion.completedInterview ? "Completed" : "Pending"}</p>
                        <p className="mt-1 text-xs text-slate-400">Questions: {data?.interviewSession?.totalQuestionsAsked ?? "-"}</p>
                    </div>
                    <div className="rounded-xl border border-white/15 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-wider text-slate-300">Report Status</p>
                        <p className="mt-2 text-sm text-slate-200">{data?.report ? "Generated" : "Not Generated"}</p>
                        <p className="mt-1 text-xs text-slate-400">Generated at: {formatDate(data?.report?.generated_at ?? null)}</p>
                    </div>
                </div>

                <div className="rounded-2xl border border-white/15 bg-white/5 p-5 backdrop-blur-xl">
                    <p className="text-sm font-semibold text-slate-100">Interview Recording</p>
                    {data?.interviewVideo?.signedUrl ? (
                        <div className="mt-3 space-y-2">
                            <video
                                controls
                                preload="metadata"
                                className="w-full rounded-lg border border-white/10 bg-black/40"
                                src={data.interviewVideo.signedUrl}
                            />
                            <p className="text-xs text-slate-400">
                                Duration: {data.interviewVideo.durationSeconds ?? "-"}s | Format: {data.interviewVideo.mimeType || "-"}
                            </p>
                        </div>
                    ) : (
                        <p className="mt-2 text-sm text-slate-400">Interview video recording is not available.</p>
                    )}
                </div>

                <div className="rounded-2xl border border-cyan-300/30 bg-cyan-400/10 p-5 backdrop-blur-xl">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="text-sm font-semibold text-cyan-100">Generate Combined AI Report</p>
                            <p className="mt-1 text-xs text-cyan-50/90">
                                Uses assessment responses + interview transcript + recording/proctoring signals.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={generateReport}
                            disabled={!data?.completion.canGenerate || isGenerating}
                            className="inline-flex rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-2 text-sm font-semibold text-[#041022] transition hover:brightness-110 disabled:opacity-70"
                        >
                            {isGenerating ? "Generating..." : data?.report ? "Regenerate Report" : "Generate Report"}
                        </button>
                    </div>
                    {!data?.completion.canGenerate ? (
                        <p className="mt-3 text-xs text-amber-200">
                            Report can be generated only after both assessment and interview are completed.
                        </p>
                    ) : null}
                </div>

                {data?.report ? (
                    <div className="space-y-4 rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl">
                        <div className="flex flex-wrap gap-3">
                            <span className="rounded-full border border-emerald-300/40 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                                Recommendation: {data.report.hire_recommendation || "-"}
                            </span>
                            <span className="rounded-full border border-cyan-300/40 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-200">
                                Score: {data.report.score ?? "-"}
                            </span>
                            <span className="rounded-full border border-slate-300/30 bg-slate-400/10 px-3 py-1 text-xs font-semibold text-slate-200">
                                Engine: {data.report.generated_by || "AI"}
                            </span>
                        </div>

                        <div>
                            <p className="text-xs uppercase tracking-wider text-slate-300">Summary</p>
                            <p className="mt-2 text-sm text-slate-100">{data.report.transcript_summary || "-"}</p>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="rounded-lg border border-emerald-300/30 bg-emerald-400/10 p-4">
                                <p className="text-xs uppercase tracking-wider text-emerald-200">Strengths</p>
                                <ul className="mt-2 space-y-1 text-sm text-emerald-100">
                                    {(data.report.strengths ?? []).length > 0 ? (
                                        (data.report.strengths ?? []).map((item, idx) => <li key={`s-${idx}`}>• {item}</li>)
                                    ) : (
                                        <li>• -</li>
                                    )}
                                </ul>
                            </div>
                            <div className="rounded-lg border border-rose-300/30 bg-rose-400/10 p-4">
                                <p className="text-xs uppercase tracking-wider text-rose-200">Weaknesses</p>
                                <ul className="mt-2 space-y-1 text-sm text-rose-100">
                                    {(data.report.weaknesses ?? []).length > 0 ? (
                                        (data.report.weaknesses ?? []).map((item, idx) => <li key={`w-${idx}`}>• {item}</li>)
                                    ) : (
                                        <li>• -</li>
                                    )}
                                </ul>
                            </div>
                        </div>

                        <div>
                            <p className="text-xs uppercase tracking-wider text-slate-300">Detailed Analysis</p>
                            <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-4 text-xs text-slate-200">
                                {data.report.detailed_analysis || "-"}
                            </pre>
                        </div>

                        <div className="rounded-xl border border-amber-300/30 bg-amber-400/10 p-4">
                            <p className="text-xs uppercase tracking-wider text-amber-200">Final Decision</p>
                            <p className="mt-2 text-sm text-amber-100">
                                {data.decision ? `Already ${data.decision.decision} on ${formatDate(data.decision.decidedAt)}` : "No decision yet"}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-3">
                                <button
                                    type="button"
                                    onClick={() => submitDecision("ACCEPT")}
                                    disabled={isDeciding}
                                    className="inline-flex rounded-lg bg-gradient-to-r from-emerald-500 to-green-500 px-4 py-2 text-sm font-semibold text-[#041022] transition hover:brightness-110 disabled:opacity-70"
                                >
                                    {isDeciding ? "Saving..." : "Accept"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => submitDecision("REJECT")}
                                    disabled={isDeciding}
                                    className="inline-flex rounded-lg bg-gradient-to-r from-rose-500 to-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-70"
                                >
                                    {isDeciding ? "Saving..." : "Reject"}
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}

                <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl">
                    <p className="text-sm font-semibold text-slate-100">Interview Transcript</p>
                    {(data?.transcript ?? []).length === 0 ? (
                        <p className="mt-2 text-sm text-slate-400">No transcript responses available.</p>
                    ) : (
                        <div className="mt-3 space-y-3">
                            {(data?.transcript ?? []).map((item) => (
                                <div key={`t-${item.index}`} className="rounded-lg border border-white/10 bg-black/20 p-3">
                                    <p className="text-xs text-cyan-200">Q{item.index}. {item.questionText}</p>
                                    <p className="mt-1 text-sm text-slate-100">{item.candidateAnswer}</p>
                                    <p className="mt-1 text-[11px] text-slate-500">
                                        Duration: {item.durationSeconds ?? "-"}s | Answered: {formatDate(item.answeredAt)}
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl">
                    <p className="text-sm font-semibold text-slate-100">Assessment Details</p>
                    {(data?.assessmentDetails ?? []).length === 0 ? (
                        <p className="mt-2 text-sm text-slate-400">No assessment response details available.</p>
                    ) : (
                        <div className="mt-3 space-y-3">
                            {(data?.assessmentDetails ?? []).map((item) => (
                                <div key={`a-${item.questionId}`} className="rounded-lg border border-white/10 bg-black/20 p-3">
                                    <p className="text-xs text-violet-200">Q{item.questionOrder}. {item.questionText}</p>
                                    <p className="mt-1 text-sm text-slate-100">Selected Option: {item.selectedOptionLabel || "Not answered"}</p>
                                    <p className="mt-1 text-[11px] text-slate-400">
                                        Status: {item.isCorrect === null ? "Pending" : item.isCorrect ? "Correct" : "Incorrect"}
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
