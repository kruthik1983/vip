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

type SortBy = "RECENT" | "NAME_ASC" | "NAME_DESC";

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

function getProgressPercent(candidate: CandidateRow) {
    const total = candidate.assessmentQuestionStats.totalQuestions;
    const answered = candidate.assessmentQuestionStats.answeredQuestions;
    if (!total || total <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((answered / total) * 100)));
}

function getProgressWidthClass(percent: number) {
    if (percent <= 0) return "w-0";
    if (percent <= 25) return "w-1/4";
    if (percent <= 50) return "w-1/2";
    if (percent <= 75) return "w-3/4";
    return "w-full";
}

function csvEscape(value: string) {
    if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

export default function CandidatesInfoPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();

    const interviewId = useMemo(() => Number(params?.id), [params]);

    const [isLoading, setIsLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [data, setData] = useState<CandidatesPayload | null>(null);
    const [expandedApplicationIds, setExpandedApplicationIds] = useState<number[]>([]);

    const [searchText, setSearchText] = useState("");
    const [statusFilter, setStatusFilter] = useState("ALL");
    const [reportFilter, setReportFilter] = useState<"ALL" | "DECLARED" | "PENDING">("ALL");
    const [credentialFilter, setCredentialFilter] = useState<"ALL" | "NEEDS_ATTENTION">("ALL");
    const [sortBy, setSortBy] = useState<SortBy>("RECENT");

    function toggleQuestions(applicationId: number) {
        setExpandedApplicationIds((prev) =>
            prev.includes(applicationId) ? prev.filter((id) => id !== applicationId) : [...prev, applicationId],
        );
    }

    function expandAllVisible(visibleApplicationIds: number[]) {
        setExpandedApplicationIds(visibleApplicationIds);
    }

    function collapseAllVisible(visibleApplicationIds: number[]) {
        setExpandedApplicationIds((prev) => prev.filter((id) => !visibleApplicationIds.includes(id)));
    }

    function clearFilters() {
        setSearchText("");
        setStatusFilter("ALL");
        setReportFilter("ALL");
        setCredentialFilter("ALL");
        setSortBy("RECENT");
    }

    async function fetchCandidates() {
        setIsLoading(true);
        setErrorMessage(null);

        const currentAdmin = await getCurrentOrganizationAdmin();
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
            headers: { Authorization: `Bearer ${token}` },
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            setErrorMessage(result.error ?? "Failed to load candidates information");
            setIsLoading(false);
            return;
        }

        setData(result.data as CandidatesPayload);
        setIsLoading(false);
    }

    useEffect(() => {
        let mounted = true;

        async function loadCandidates() {
            const currentAdmin = await getCurrentOrganizationAdmin();
            if (!mounted) return;
            if (!currentAdmin) {
                router.replace("/organization/organization_auth");
                return;
            }
            await fetchCandidates();
        }

        void loadCandidates();

        return () => {
            mounted = false;
        };
    }, [interviewId, router]);

    const statusOptions = useMemo(() => {
        const unique = Array.from(new Set((data?.candidates ?? []).map((c) => c.applicationStatus))).filter(Boolean);
        return ["ALL", ...unique];
    }, [data?.candidates]);

    const metrics = useMemo(() => {
        const source = data?.candidates ?? [];
        const reportsDeclared = source.filter((c) => c.reportStatus === "DECLARED").length;
        const needsCredentialAttention = source.filter(
            (c) => c.assessmentCredentialStatus !== "GENERATED" || c.interviewCredentialStatus !== "GENERATED",
        ).length;
        const slotAssigned = source.filter((c) => c.applicationStatus === "SLOT_ASSIGNED").length;

        return {
            total: source.length,
            reportsDeclared,
            needsCredentialAttention,
            slotAssigned,
        };
    }, [data?.candidates]);

    const filteredCandidates = useMemo(() => {
        const query = searchText.trim().toLowerCase();

        const rows = (data?.candidates ?? []).filter((candidate) => {
            const matchSearch =
                !query ||
                candidate.candidateName.toLowerCase().includes(query) ||
                candidate.candidateEmail.toLowerCase().includes(query) ||
                String(candidate.applicationId).includes(query);

            const matchStatus = statusFilter === "ALL" || candidate.applicationStatus === statusFilter;

            const matchReport = reportFilter === "ALL" || candidate.reportStatus === reportFilter;

            const matchCredential =
                credentialFilter === "ALL" ||
                candidate.assessmentCredentialStatus !== "GENERATED" ||
                candidate.interviewCredentialStatus !== "GENERATED";

            return matchSearch && matchStatus && matchReport && matchCredential;
        });

        if (sortBy === "NAME_ASC") {
            return [...rows].sort((a, b) => a.candidateName.localeCompare(b.candidateName));
        }

        if (sortBy === "NAME_DESC") {
            return [...rows].sort((a, b) => b.candidateName.localeCompare(a.candidateName));
        }

        return [...rows].sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime());
    }, [credentialFilter, data?.candidates, reportFilter, searchText, sortBy, statusFilter]);

    function exportFilteredCsv() {
        const rows = filteredCandidates;
        if (rows.length === 0) {
            return;
        }

        const header = [
            "Application ID",
            "Candidate Name",
            "Email",
            "Phone",
            "Status",
            "Report Status",
            "Applied At",
            "Assessment Slot",
            "Interview Slot",
            "Assessment Credential",
            "Interview Credential",
            "Answered",
            "Total Questions",
            "Correct Answers",
        ];

        const lines = rows.map((c) => [
            String(c.applicationId),
            c.candidateName,
            c.candidateEmail,
            c.candidatePhone ?? "",
            c.applicationStatus,
            c.reportStatus,
            formatDateTime(c.appliedAt),
            c.assessmentSlot,
            c.interviewSlot,
            c.assessmentCredentialStatus,
            c.interviewCredentialStatus,
            String(c.assessmentQuestionStats.answeredQuestions),
            String(c.assessmentQuestionStats.totalQuestions),
            String(c.assessmentQuestionStats.correctAnswers),
        ]);

        const csv = [header, ...lines]
            .map((line) => line.map((cell) => csvEscape(cell)).join(","))
            .join("\n");

        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `interview-${interviewId}-candidates.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    if (isLoading) {
        return (
            <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f3f9f7] text-slate-900">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(16,185,129,0.18),transparent_35%),radial-gradient(circle_at_84%_16%,rgba(56,189,248,0.18),transparent_35%)]" />
                <div className="relative rounded-2xl border border-slate-200 bg-white/90 px-6 py-4 shadow-lg">
                    Loading candidates information...
                </div>
            </div>
        );
    }

    const visibleApplicationIds = filteredCandidates.map((candidate) => candidate.applicationId);

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#f3f9f7] px-6 py-10 text-slate-900 lg:px-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(16,185,129,0.18),transparent_35%),radial-gradient(circle_at_84%_16%,rgba(56,189,248,0.18),transparent_35%)]" />

            <div className="relative mx-auto max-w-7xl space-y-6">
                <header className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.45)] sm:p-8">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-cyan-700">Candidates Overview</p>
                            <h1 className="mt-2 text-3xl font-semibold">{data?.interviewTitle || `Interview #${interviewId}`}</h1>
                            <p className="mt-2 text-sm text-slate-600">Total candidates: {data?.totalCandidates ?? 0}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={exportFilteredCsv}
                                className="inline-flex rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800"
                            >
                                Export CSV
                            </button>
                            <Link
                                href={`/organization/manage-interviews/${interviewId}`}
                                className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800"
                            >
                                Back to Interview
                            </Link>
                        </div>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <p className="text-xs uppercase tracking-wide text-slate-600">Total</p>
                            <p className="mt-1 text-2xl font-semibold text-slate-900">{metrics.total}</p>
                        </article>
                        <article className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                            <p className="text-xs uppercase tracking-wide text-violet-700">Reports Declared</p>
                            <p className="mt-1 text-2xl font-semibold text-violet-900">{metrics.reportsDeclared}</p>
                        </article>
                        <article className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                            <p className="text-xs uppercase tracking-wide text-amber-700">Needs Credential Attention</p>
                            <p className="mt-1 text-2xl font-semibold text-amber-900">{metrics.needsCredentialAttention}</p>
                        </article>
                        <article className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
                            <p className="text-xs uppercase tracking-wide text-cyan-700">Slot Assigned</p>
                            <p className="mt-1 text-2xl font-semibold text-cyan-900">{metrics.slotAssigned}</p>
                        </article>
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                        <input
                            type="text"
                            aria-label="Search candidates"
                            placeholder="Search name, email, or app ID"
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900"
                        />
                        <select
                            aria-label="Filter by application status"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900"
                        >
                            {statusOptions.map((status) => (
                                <option key={status} value={status}>
                                    {status}
                                </option>
                            ))}
                        </select>
                        <select
                            aria-label="Filter by report status"
                            value={reportFilter}
                            onChange={(e) => setReportFilter(e.target.value as "ALL" | "DECLARED" | "PENDING")}
                            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900"
                        >
                            <option value="ALL">All report states</option>
                            <option value="DECLARED">Report declared</option>
                            <option value="PENDING">Report pending</option>
                        </select>
                        <select
                            aria-label="Filter by credential status"
                            value={credentialFilter}
                            onChange={(e) => setCredentialFilter(e.target.value as "ALL" | "NEEDS_ATTENTION")}
                            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900"
                        >
                            <option value="ALL">All credential states</option>
                            <option value="NEEDS_ATTENTION">Needs credential attention</option>
                        </select>
                        <select
                            aria-label="Sort candidates"
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as SortBy)}
                            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900"
                        >
                            <option value="RECENT">Sort: Recently Applied</option>
                            <option value="NAME_ASC">Sort: Name A-Z</option>
                            <option value="NAME_DESC">Sort: Name Z-A</option>
                        </select>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => expandAllVisible(visibleApplicationIds)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                        >
                            Expand Visible
                        </button>
                        <button
                            type="button"
                            onClick={() => collapseAllVisible(visibleApplicationIds)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                        >
                            Collapse Visible
                        </button>
                        <button
                            type="button"
                            onClick={clearFilters}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                        >
                            Clear Filters
                        </button>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
                            Showing {filteredCandidates.length} of {data?.candidates.length ?? 0}
                        </div>
                    </div>
                </header>

                {errorMessage ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        {errorMessage}
                    </div>
                ) : null}

                <div className="grid gap-4">
                    {filteredCandidates.length === 0 ? (
                        <div className="rounded-3xl border border-slate-200 bg-white/92 p-8 text-center text-sm text-slate-500">
                            No matching candidates found.
                        </div>
                    ) : (
                        filteredCandidates.map((candidate) => {
                            const progressPercent = getProgressPercent(candidate);

                            return (
                                <article
                                    key={candidate.applicationId}
                                    className="rounded-3xl border border-slate-200 bg-white/92 p-5 shadow-[0_16px_45px_-34px_rgba(15,23,42,0.5)]"
                                >
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <h2 className="text-lg font-semibold text-slate-900">{candidate.candidateName}</h2>
                                            <p className="text-sm text-slate-600">{candidate.candidateEmail}</p>
                                            <p className="text-sm text-slate-500">{candidate.candidatePhone || "-"}</p>
                                            <p className="mt-1 text-xs text-slate-500">
                                                Applied: {formatDateTime(candidate.appliedAt)} • App ID: {candidate.applicationId}
                                            </p>
                                        </div>

                                        <div className="flex flex-wrap gap-2">
                                            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                                                {candidate.applicationStatus}
                                            </span>
                                            <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
                                                Report: {candidate.reportStatus}
                                            </span>
                                            <Link
                                                href={`/organization/manage-interviews/${interviewId}/candidate-info/${candidate.applicationId}`}
                                                className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700"
                                            >
                                                Open Report
                                            </Link>
                                        </div>
                                    </div>

                                    <div className="mt-4 grid gap-3 lg:grid-cols-3">
                                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                                            <p className="font-semibold">Assessment Slot</p>
                                            <p className="mt-1">{candidate.assessmentSlot}</p>
                                            <p className="mt-1 text-emerald-700">Credential: {candidate.assessmentCredentialStatus}</p>
                                            <p className="mt-1 text-emerald-700">
                                                Valid: {formatDateTime(candidate.assessmentValidFrom)} to {formatDateTime(candidate.assessmentValidUntil)}
                                            </p>
                                        </div>

                                        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
                                            <p className="font-semibold">Interview Slot</p>
                                            <p className="mt-1">{candidate.interviewSlot}</p>
                                            <p className="mt-1 text-sky-700">Credential: {candidate.interviewCredentialStatus}</p>
                                            <p className="mt-1 text-sky-700">
                                                Valid: {formatDateTime(candidate.interviewValidFrom)} to {formatDateTime(candidate.interviewValidUntil)}
                                            </p>
                                        </div>

                                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                                            <p className="font-semibold">Assessment Progress</p>
                                            <p className="mt-1">
                                                Answered: {candidate.assessmentQuestionStats.answeredQuestions}/
                                                {candidate.assessmentQuestionStats.totalQuestions}
                                            </p>
                                            <p className="mt-1">Correct: {candidate.assessmentQuestionStats.correctAnswers}</p>
                                            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-amber-100">
                                                <div
                                                    className={`h-full rounded-full bg-amber-500 transition-all ${getProgressWidthClass(progressPercent)}`}
                                                />
                                            </div>
                                            <p className="mt-1 text-[11px] text-amber-700">Completion: {progressPercent}%</p>
                                        </div>

                                    </div>

                                    <div className="mt-3 flex items-center justify-between">
                                        <button
                                            type="button"
                                            onClick={() => toggleQuestions(candidate.applicationId)}
                                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                                        >
                                            {expandedApplicationIds.includes(candidate.applicationId)
                                                ? "Hide Question Responses"
                                                : "View Question Responses"}
                                        </button>
                                    </div>

                                    {expandedApplicationIds.includes(candidate.applicationId) ? (
                                        <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                                            {candidate.assessmentQuestionDetails.length === 0 ? (
                                                <p className="text-sm text-slate-500">
                                                    No generated questions found for this candidate yet.
                                                </p>
                                            ) : (
                                                candidate.assessmentQuestionDetails.map((item) => (
                                                    <div
                                                        key={`${candidate.applicationId}-${item.questionId}`}
                                                        className="rounded-lg border border-slate-200 bg-white p-3"
                                                    >
                                                        <p className="text-sm font-semibold text-slate-900">
                                                            Q{item.questionOrder}. {item.questionText}
                                                        </p>
                                                        <p className="mt-1 text-xs text-slate-600">
                                                            Selected: {item.selectedOptionLabel || "Not answered"}
                                                        </p>
                                                        <p className="mt-1 text-xs text-slate-500">
                                                            Status: {item.isCorrect === null ? "Pending" : item.isCorrect ? "Correct" : "Incorrect"}
                                                        </p>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    ) : null}
                                </article>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
