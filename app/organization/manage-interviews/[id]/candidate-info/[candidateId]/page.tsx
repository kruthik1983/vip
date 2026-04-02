"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
        photoPath: string | null;
        photoUrl: string | null;
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
    const [activeTab, setActiveTab] = useState<"report" | "transcript" | "assessment">("report");

    const candidateInitials = useMemo(() => {
        const source = data?.candidate.candidateName?.trim() || "Candidate";
        const parts = source.split(/\s+/).filter(Boolean);
        if (parts.length === 0) return "C";
        if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
        return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
    }, [data?.candidate.candidateName]);

    const fetchData = useCallback(async () => {
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
            headers: { Authorization: `Bearer ${token}` },
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            setErrorMessage(result.error ?? "Failed to load candidate report");
            setIsLoading(false);
            return;
        }

        setData(result.data as CandidateReportData);
        setIsLoading(false);
    }, [candidateId, interviewId]);

    useEffect(() => {
        let mounted = true;

        async function bootstrap() {
            setIsLoading(true);
            setErrorMessage(null);

            const currentAdmin = await getCurrentOrganizationAdmin();
            if (!mounted) return;

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
    }, [fetchData, router]);

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
            <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f3f9f7] text-slate-900">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(16,185,129,0.18),transparent_35%),radial-gradient(circle_at_84%_16%,rgba(56,189,248,0.18),transparent_35%)]" />
                <div className="relative rounded-2xl border border-slate-200 bg-white/90 px-6 py-4 shadow-lg">Loading candidate report...</div>
            </div>
        );
    }

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#f3f9f7] px-6 py-10 text-slate-900 lg:px-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(16,185,129,0.18),transparent_35%),radial-gradient(circle_at_84%_16%,rgba(56,189,248,0.18),transparent_35%)]" />
            <div className="relative mx-auto max-w-6xl space-y-6">
                <header className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.45)] sm:p-8">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-4">
                            {data?.candidate.photoUrl ? (
                                <Image
                                    src={data.candidate.photoUrl}
                                    alt={`${data.candidate.candidateName} photo`}
                                    width={80}
                                    height={80}
                                    className="h-20 w-20 rounded-xl border border-slate-200 object-cover"
                                />
                            ) : (
                                <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-xl font-semibold text-slate-600">
                                    {candidateInitials}
                                </div>
                            )}
                            <div>
                                <p className="text-xs uppercase tracking-[0.18em] text-cyan-700">Candidate Evaluation</p>
                                <h1 className="mt-2 text-3xl font-semibold">{data?.candidate.candidateName || "Candidate"}</h1>
                                <p className="mt-1 text-sm text-slate-600">{data?.candidate.candidateEmail} • {data?.candidate.candidatePhone || "-"}</p>
                                <p className="mt-1 text-sm text-slate-500">Applied: {formatDate(data?.candidate.appliedAt ?? null)} • Status: {data?.candidate.status || "-"}</p>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            {data?.candidate.resumeUrl ? <a href={data.candidate.resumeUrl} target="_blank" rel="noreferrer" className="inline-flex rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800">Resume</a> : null}
                            <Link href={`/organization/manage-interviews/${interviewId}/candidates-info`} className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800">Back to Candidates</Link>
                        </div>
                    </div>
                </header>

                {errorMessage ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</div> : null}
                {successMessage ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</div> : null}

                <section className="grid gap-4 sm:grid-cols-4">
                    <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs uppercase tracking-wide text-emerald-700">Assessment</p><p className="mt-1 text-sm font-semibold text-emerald-900">{data?.completion.completedAssessment ? "Completed" : "Pending"}</p></article>
                    <article className="rounded-2xl border border-sky-200 bg-sky-50 p-4"><p className="text-xs uppercase tracking-wide text-sky-700">Interview</p><p className="mt-1 text-sm font-semibold text-sky-900">{data?.completion.completedInterview ? "Completed" : "Pending"}</p></article>
                    <article className="rounded-2xl border border-violet-200 bg-violet-50 p-4"><p className="text-xs uppercase tracking-wide text-violet-700">AI Report</p><p className="mt-1 text-sm font-semibold text-violet-900">{data?.report ? "Generated" : "Not Generated"}</p></article>
                    <article className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="text-xs uppercase tracking-wide text-amber-700">Decision</p><p className="mt-1 text-sm font-semibold text-amber-900">{data?.decision ? data.decision.decision : "Pending"}</p></article>
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="text-sm font-semibold text-slate-900">Generate Combined AI Report</p>
                            <p className="mt-1 text-xs text-slate-600">Uses assessment responses, transcript and proctoring/video context.</p>
                        </div>
                        <button type="button" onClick={generateReport} disabled={!data?.completion.canGenerate || isGenerating} className="inline-flex rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-70">
                            {isGenerating ? "Generating..." : data?.report ? "Regenerate Report" : "Generate Report"}
                        </button>
                    </div>
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
                    <div className="flex flex-wrap gap-2">
                        <button onClick={() => setActiveTab("report")} className={`rounded-full border px-3 py-1 text-xs font-semibold ${activeTab === "report" ? "border-cyan-200 bg-cyan-50 text-cyan-800" : "border-slate-300 bg-white text-slate-700"}`}>AI Report</button>
                        <button onClick={() => setActiveTab("transcript")} className={`rounded-full border px-3 py-1 text-xs font-semibold ${activeTab === "transcript" ? "border-cyan-200 bg-cyan-50 text-cyan-800" : "border-slate-300 bg-white text-slate-700"}`}>Transcript</button>
                        <button onClick={() => setActiveTab("assessment")} className={`rounded-full border px-3 py-1 text-xs font-semibold ${activeTab === "assessment" ? "border-cyan-200 bg-cyan-50 text-cyan-800" : "border-slate-300 bg-white text-slate-700"}`}>Assessment</button>
                    </div>

                    {activeTab === "report" ? (
                        <div className="mt-4 space-y-4">
                            {data?.report ? (
                                <>
                                    <div className="flex flex-wrap gap-2 text-xs">
                                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-700">Recommendation: {data.report.hire_recommendation || "-"}</span>
                                        <span className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 font-semibold text-cyan-700">Score: {data.report.score ?? "-"}</span>
                                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-semibold text-slate-700">Engine: {data.report.generated_by || "AI"}</span>
                                    </div>
                                    <div>
                                        <p className="text-xs uppercase tracking-wider text-slate-500">Summary</p>
                                        <p className="mt-1 text-sm text-slate-700">{data.report.transcript_summary || "-"}</p>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs uppercase tracking-wider text-emerald-700">Strengths</p><ul className="mt-2 space-y-1 text-sm text-emerald-900">{(data.report.strengths ?? []).length > 0 ? (data.report.strengths ?? []).map((item, idx) => <li key={`s-${idx}`}>- {item}</li>) : <li>-</li>}</ul></div>
                                        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4"><p className="text-xs uppercase tracking-wider text-rose-700">Weaknesses</p><ul className="mt-2 space-y-1 text-sm text-rose-900">{(data.report.weaknesses ?? []).length > 0 ? (data.report.weaknesses ?? []).map((item, idx) => <li key={`w-${idx}`}>- {item}</li>) : <li>-</li>}</ul></div>
                                    </div>
                                    <div>
                                        <p className="text-xs uppercase tracking-wider text-slate-500">Detailed Analysis</p>
                                        <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">{data.report.detailed_analysis || "-"}</pre>
                                    </div>
                                </>
                            ) : (
                                <p className="text-sm text-slate-500">No AI report generated yet.</p>
                            )}
                        </div>
                    ) : null}

                    {activeTab === "transcript" ? (
                        <div className="mt-4 space-y-3">
                            {(data?.transcript ?? []).length === 0 ? (
                                <p className="text-sm text-slate-500">No transcript responses available.</p>
                            ) : (
                                (data?.transcript ?? []).map((item) => (
                                    <div key={`t-${item.index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                        <p className="text-xs text-cyan-700">Q{item.index}. {item.questionText}</p>
                                        <p className="mt-1 text-sm text-slate-800">{item.candidateAnswer}</p>
                                        <p className="mt-1 text-[11px] text-slate-500">Duration: {item.durationSeconds ?? "-"}s • Answered: {formatDate(item.answeredAt)}</p>
                                    </div>
                                ))
                            )}
                        </div>
                    ) : null}

                    {activeTab === "assessment" ? (
                        <div className="mt-4 space-y-3">
                            {(data?.assessmentDetails ?? []).length === 0 ? (
                                <p className="text-sm text-slate-500">No assessment response details available.</p>
                            ) : (
                                (data?.assessmentDetails ?? []).map((item) => (
                                    <div key={`a-${item.questionId}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                        <p className="text-xs text-violet-700">Q{item.questionOrder}. {item.questionText}</p>
                                        <p className="mt-1 text-sm text-slate-800">Selected Option: {item.selectedOptionLabel || "Not answered"}</p>
                                        <p className="mt-1 text-[11px] text-slate-500">Status: {item.isCorrect === null ? "Pending" : item.isCorrect ? "Correct" : "Incorrect"}</p>
                                    </div>
                                ))
                            )}
                        </div>
                    ) : null}
                </section>

                <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.2)]">
                    <p className="text-xs uppercase tracking-wider text-amber-700">Final Decision</p>
                    <p className="mt-2 text-sm text-amber-900">{data?.decision ? `Already ${data.decision.decision} on ${formatDate(data.decision.decidedAt)}` : "No decision yet"}</p>
                    <div className="mt-3 flex flex-wrap gap-3">
                        <button type="button" onClick={() => submitDecision("ACCEPT")} disabled={isDeciding} className="inline-flex rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-70">{isDeciding ? "Saving..." : "Accept"}</button>
                        <button type="button" onClick={() => submitDecision("REJECT")} disabled={isDeciding} className="inline-flex rounded-xl bg-gradient-to-r from-rose-600 to-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-70">{isDeciding ? "Saving..." : "Reject"}</button>
                    </div>
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
                    <p className="text-sm font-semibold text-slate-900">Interview Recording</p>
                    {data?.interviewVideo?.signedUrl ? (
                        <div className="mt-3 space-y-2">
                            <video controls preload="metadata" className="w-full rounded-lg border border-slate-200 bg-black/10" src={data.interviewVideo.signedUrl} />
                            <p className="text-xs text-slate-500">Duration: {data.interviewVideo.durationSeconds ?? "-"}s • Format: {data.interviewVideo.mimeType || "-"}</p>
                        </div>
                    ) : (
                        <p className="mt-2 text-sm text-slate-500">Interview video recording is not available.</p>
                    )}
                </section>
            </div>
        </div>
    );
}
