"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getCurrentOrganizationAdmin } from "@/lib/organization-auth";
import { supabase } from "@/lib/supabase";

type CandidateRow = {
    applicationId: number;
    candidateName: string;
    candidateEmail: string;
    candidatePhone: string | null;
    applicationStatus: string;
    appliedAt: string;
    assessmentSlot: string;
    interviewSlot: string;
    assessmentCredentialStatus: "GENERATED" | "PENDING";
    interviewCredentialStatus: "GENERATED" | "PENDING";
    assessmentToken: string | null;
    assessmentValidFrom: string | null;
    assessmentValidUntil: string | null;
    interviewToken: string | null;
    interviewValidFrom: string | null;
    interviewValidUntil: string | null;
    reportStatus: "DECLARED" | "PENDING";
    assessmentQuestionStats: {
        totalQuestions: number;
        answeredQuestions: number;
        correctAnswers: number;
    };
    assessmentQuestionDetails: Array<{
        questionId: number;
        questionOrder: number;
        questionText: string;
        selectedOptionLabel: string | null;
        isCorrect: boolean | null;
    }>;
};

type CandidatesPayload = {
    interviewId: number;
    interviewTitle: string;
    totalCandidates: number;
    candidates: CandidateRow[];
};

function formatDateTime(value: string | null) {
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

function badgeClass(status: string | null | undefined) {
    const normalized = (status ?? "").toUpperCase();

    if (normalized === "GENERATED") {
        return "border-emerald-400/40 bg-emerald-400/10 text-emerald-200";
    }

    if (normalized === "PENDING") {
        return "border-amber-400/40 bg-amber-400/10 text-amber-200";
    }

    if (normalized === "SLOT_ASSIGNED") {
        return "border-cyan-400/40 bg-cyan-400/10 text-cyan-200";
    }

    if (normalized === "APPLIED") {
        return "border-violet-400/40 bg-violet-400/10 text-violet-200";
    }

    if (normalized === "REJECTED") {
        return "border-rose-400/40 bg-rose-400/10 text-rose-200";
    }

    return "border-slate-300/30 bg-slate-400/10 text-slate-200";
}

export default function CandidatesInfoPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();

    const interviewId = useMemo(() => Number(params?.id), [params]);

    const [isLoading, setIsLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [data, setData] = useState<CandidatesPayload | null>(null);
    const [expandedApplicationIds, setExpandedApplicationIds] = useState<number[]>([]);

    function toggleQuestions(applicationId: number) {
        setExpandedApplicationIds((prev) =>
            prev.includes(applicationId)
                ? prev.filter((id) => id !== applicationId)
                : [...prev, applicationId],
        );
    }

    useEffect(() => {
        let mounted = true;

        async function loadCandidates() {
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

            const response = await fetch(`/api/organization/interviews/manage/${interviewId}/candidates-info`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            const result = await response.json();

            if (!mounted) {
                return;
            }

            if (!response.ok || !result.success) {
                setErrorMessage(result.error ?? "Failed to load candidates information");
                setIsLoading(false);
                return;
            }

            setData(result.data as CandidatesPayload);
            setIsLoading(false);
        }

        void loadCandidates();

        return () => {
            mounted = false;
        };
    }, [interviewId, router]);

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#070b16] text-white">
                <p className="text-sm text-slate-300">Loading candidates information...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#070b16] px-6 py-10 text-white lg:px-10">
            <div className="mx-auto max-w-[1400px] space-y-6">
                <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">Candidates Overview</p>
                            <h1 className="mt-2 text-3xl font-semibold">
                                {data?.interviewTitle || `Interview #${interviewId}`}
                            </h1>
                            <p className="mt-2 text-sm text-slate-300">
                                Total candidates: {data?.totalCandidates ?? 0}
                            </p>
                        </div>
                        <Link
                            href={`/organization/manage-interviews/${interviewId}`}
                            className="inline-flex rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                        >
                            Back to Interview
                        </Link>
                    </div>
                </div>

                {errorMessage ? (
                    <div className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                        {errorMessage}
                    </div>
                ) : null}

                <div className="overflow-x-auto rounded-2xl border border-white/15 bg-white/5 backdrop-blur-xl">
                    <table className="min-w-[1300px] w-full border-collapse text-sm">
                        <thead>
                            <tr className="border-b border-white/10 bg-white/5 text-left text-xs uppercase tracking-wider text-slate-300">
                                <th className="px-4 py-3">Candidate</th>
                                <th className="px-4 py-3">Application Status</th>
                                <th className="px-4 py-3">Assessment Slot</th>
                                <th className="px-4 py-3">Interview Slot</th>
                                <th className="px-4 py-3">Assessment Credentials</th>
                                <th className="px-4 py-3">Interview Credentials</th>
                                <th className="px-4 py-3">Assessment Q&A</th>
                                <th className="px-4 py-3">Report</th>
                                <th className="px-4 py-3">Applied At</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(data?.candidates ?? []).length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                                        No candidates found for this interview yet.
                                    </td>
                                </tr>
                            ) : (
                                (data?.candidates ?? []).flatMap((candidate) => ([
                                    <tr key={`row-${candidate.applicationId}`} className="border-b border-white/5 align-top">
                                        <td className="px-4 py-3">
                                            <p className="font-medium text-white">{candidate.candidateName}</p>
                                            <p className="text-slate-300">{candidate.candidateEmail}</p>
                                            <p className="text-slate-400">{candidate.candidatePhone || "-"}</p>
                                            <p className="mt-1 text-xs text-slate-500">Application ID: {candidate.applicationId}</p>
                                        </td>

                                        <td className="px-4 py-3">
                                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass(candidate.applicationStatus)}`}>
                                                {candidate.applicationStatus || "-"}
                                            </span>
                                        </td>

                                        <td className="px-4 py-3 text-slate-300">{candidate.assessmentSlot}</td>
                                        <td className="px-4 py-3 text-slate-300">{candidate.interviewSlot}</td>

                                        <td className="px-4 py-3">
                                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass(candidate.assessmentCredentialStatus)}`}>
                                                {candidate.assessmentCredentialStatus || "PENDING"}
                                            </span>
                                            <p className="mt-2 break-all font-mono text-xs text-cyan-200">
                                                {candidate.assessmentToken || "-"}
                                            </p>
                                            <p className="mt-1 text-xs text-slate-400">
                                                Valid: {formatDateTime(candidate.assessmentValidFrom)} to {formatDateTime(candidate.assessmentValidUntil)}
                                            </p>
                                        </td>

                                        <td className="px-4 py-3">
                                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass(candidate.interviewCredentialStatus)}`}>
                                                {candidate.interviewCredentialStatus || "PENDING"}
                                            </span>
                                            <p className="mt-2 break-all font-mono text-xs text-cyan-200">
                                                {candidate.interviewToken || "-"}
                                            </p>
                                            <p className="mt-1 text-xs text-slate-400">
                                                Valid: {formatDateTime(candidate.interviewValidFrom)} to {formatDateTime(candidate.interviewValidUntil)}
                                            </p>
                                        </td>

                                        <td className="px-4 py-3">
                                            <p className="text-xs text-slate-300">
                                                Answered: {candidate.assessmentQuestionStats.answeredQuestions}/{candidate.assessmentQuestionStats.totalQuestions}
                                            </p>
                                            <p className="mt-1 text-xs text-slate-400">
                                                Correct: {candidate.assessmentQuestionStats.correctAnswers}
                                            </p>
                                            <button
                                                type="button"
                                                onClick={() => toggleQuestions(candidate.applicationId)}
                                                className="mt-2 rounded border border-cyan-300/30 bg-cyan-400/10 px-2 py-1 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/20"
                                            >
                                                {expandedApplicationIds.includes(candidate.applicationId)
                                                    ? "Hide Questions"
                                                    : "View Questions"}
                                            </button>
                                        </td>

                                        <td className="px-4 py-3">
                                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass(candidate.reportStatus)}`}>
                                                {candidate.reportStatus || "PENDING"}
                                            </span>
                                            <Link
                                                href={`/organization/manage-interviews/${interviewId}/candidate-info/${candidate.applicationId}`}
                                                className="mt-2 inline-flex rounded border border-cyan-300/30 bg-cyan-400/10 px-2 py-1 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/20"
                                            >
                                                View Report
                                            </Link>
                                        </td>

                                        <td className="px-4 py-3 text-slate-300">{formatDateTime(candidate.appliedAt)}</td>
                                    </tr>
                                    ,
                                    expandedApplicationIds.includes(candidate.applicationId) ? (
                                        <tr key={`details-${candidate.applicationId}`} className="border-b border-white/5 bg-white/[0.02]">
                                            <td colSpan={9} className="px-4 py-3">
                                                <div className="space-y-2">
                                                    <p className="text-xs uppercase tracking-wider text-slate-400">Generated Assessment Questions</p>
                                                    {candidate.assessmentQuestionDetails.length === 0 ? (
                                                        <p className="text-sm text-slate-400">No generated questions found for this candidate yet.</p>
                                                    ) : (
                                                        <div className="space-y-2">
                                                            {candidate.assessmentQuestionDetails.map((item) => (
                                                                <div key={`${candidate.applicationId}-${item.questionId}`} className="rounded-lg border border-white/10 bg-white/5 p-3">
                                                                    <p className="text-sm font-semibold text-slate-100">Q{item.questionOrder}. {item.questionText}</p>
                                                                    <p className="mt-1 text-xs text-slate-300">Selected: {item.selectedOptionLabel || "Not answered"}</p>
                                                                    <p className="mt-1 text-xs text-slate-400">
                                                                        Status: {item.isCorrect === null ? "Pending" : item.isCorrect ? "Correct" : "Incorrect"}
                                                                    </p>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ) : null
                                ]))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
