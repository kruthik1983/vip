"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
    assignedAssessmentSlotId: number | null;
    assignedInterviewSlotId: number | null;
    assessmentSlot: string;
    interviewSlot: string;
    assessmentSessionId: number | null;
    assessmentCredentialStatus: "GENERATED" | "PENDING";
    interviewCredentialStatus: "GENERATED" | "PENDING";
    assessmentToken: string | null;
    assessmentValidFrom: string | null;
    assessmentValidUntil: string | null;
    interviewSessionId: number | null;
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

type SlotOption = {
    id: number;
    slotStartUtc: string;
    slotEndUtc: string;
    maxCandidates: number;
    assignedCandidates: number;
    seatsLeft: number;
};

type CandidatesPayload = {
    interviewId: number;
    interviewTitle: string;
    totalCandidates: number;
    assessmentSlots: SlotOption[];
    interviewSlots: SlotOption[];
    candidates: CandidateRow[];
};

type SortBy = "RECENT" | "NAME_ASC" | "NAME_DESC";

type EditCandidateForm = {
    assessmentSlotId: string;
    interviewSlotId: string;
    assessmentSessionToken: string;
    interviewSessionToken: string;
};

type AddCandidateForm = {
    candidateName: string;
    candidateEmail: string;
    candidatePhone: string;
    assessmentSlotId: string;
    interviewSlotId: string;
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

function formatSlotOption(slot: SlotOption) {
    const start = formatDateTime(slot.slotStartUtc);
    const end = formatDateTime(slot.slotEndUtc);

    return `${start} - ${end} (${slot.assignedCandidates}/${slot.maxCandidates})`;
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
    const [editingCandidate, setEditingCandidate] = useState<CandidateRow | null>(null);
    const [editForm, setEditForm] = useState<EditCandidateForm | null>(null);
    const [isSavingEdit, setIsSavingEdit] = useState(false);
    const [editError, setEditError] = useState<string | null>(null);
    const [isResettingCandidateId, setIsResettingCandidateId] = useState<number | null>(null);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isCreatingCandidate, setIsCreatingCandidate] = useState(false);
    const [addCandidateError, setAddCandidateError] = useState<string | null>(null);
    const [addCandidateForm, setAddCandidateForm] = useState<AddCandidateForm>({
        candidateName: "",
        candidateEmail: "",
        candidatePhone: "",
        assessmentSlotId: "",
        interviewSlotId: "",
    });

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

    function openEditModal(candidate: CandidateRow) {
        setEditingCandidate(candidate);
        setEditError(null);
        setEditForm({
            assessmentSlotId: candidate.assignedAssessmentSlotId ? String(candidate.assignedAssessmentSlotId) : "",
            interviewSlotId: candidate.assignedInterviewSlotId ? String(candidate.assignedInterviewSlotId) : "",
            assessmentSessionToken: candidate.assessmentToken ?? "",
            interviewSessionToken: candidate.interviewToken ?? "",
        });
    }

    function closeEditModal() {
        setEditingCandidate(null);
        setEditForm(null);
        setEditError(null);
    }

    function openAddCandidateModal() {
        setAddCandidateError(null);
        setAddCandidateForm({
            candidateName: "",
            candidateEmail: "",
            candidatePhone: "",
            assessmentSlotId: "",
            interviewSlotId: "",
        });
        setIsAddModalOpen(true);
    }

    function closeAddCandidateModal() {
        setIsAddModalOpen(false);
        setAddCandidateError(null);
    }

    async function createCandidate() {
        if (!addCandidateForm.candidateName.trim()) {
            setAddCandidateError("Candidate name is required");
            return;
        }

        if (!addCandidateForm.candidateEmail.trim()) {
            setAddCandidateError("Candidate email is required");
            return;
        }

        if (!addCandidateForm.assessmentSlotId || !addCandidateForm.interviewSlotId) {
            setAddCandidateError("Please select assessment and interview slots");
            return;
        }

        setIsCreatingCandidate(true);
        setAddCandidateError(null);
        setErrorMessage(null);

        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;

            if (!token) {
                setAddCandidateError("No active session. Please sign in again.");
                return;
            }

            const response = await fetch(`/api/organization/interviews/manage/${interviewId}/candidates-info/add-candidate`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    candidateName: addCandidateForm.candidateName.trim(),
                    candidateEmail: addCandidateForm.candidateEmail.trim(),
                    candidatePhone: addCandidateForm.candidatePhone.trim() || null,
                    assessmentSlotId: Number(addCandidateForm.assessmentSlotId),
                    interviewSlotId: Number(addCandidateForm.interviewSlotId),
                }),
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                setAddCandidateError(result.error ?? "Failed to add candidate");
                return;
            }

            closeAddCandidateModal();
            await fetchCandidates();
        } catch {
            setAddCandidateError("Failed to add candidate");
        } finally {
            setIsCreatingCandidate(false);
        }
    }

    async function saveCandidateEdit() {
        if (!editingCandidate || !editForm) return;

        if (!editForm.assessmentSlotId || !editForm.interviewSlotId) {
            setEditError("Select both assessment and interview slots for this interview.");
            return;
        }

        setIsSavingEdit(true);
        setEditError(null);
        setErrorMessage(null);

        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;

            if (!token) {
                setErrorMessage("No active session. Please sign in again.");
                return;
            }

            const response = await fetch(
                `/api/organization/interviews/manage/${interviewId}/candidates-info/${editingCandidate.applicationId}/assign-slots`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        assessmentSlotId: Number(editForm.assessmentSlotId),
                        interviewSlotId: Number(editForm.interviewSlotId),
                        assessmentSessionToken: editForm.assessmentSessionToken,
                        interviewSessionToken: editForm.interviewSessionToken,
                    }),
                },
            );

            const result = await response.json();

            if (!response.ok || !result.success) {
                setEditError(result.error ?? "Failed to update candidate assignment");
                return;
            }

            closeEditModal();
            await fetchCandidates();
        } catch {
            setEditError("Failed to update candidate assignment");
        } finally {
            setIsSavingEdit(false);
        }
    }

    async function resetCandidateProgress(candidate: CandidateRow) {
        const shouldReset = window.confirm(
            `Reset progress for ${candidate.candidateName}? This will clear assessment/interview progress and generated report data for this candidate.`,
        );

        if (!shouldReset) return;

        setIsResettingCandidateId(candidate.applicationId);
        setErrorMessage(null);

        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;

            if (!token) {
                setErrorMessage("No active session. Please sign in again.");
                return;
            }

            const response = await fetch(
                `/api/organization/interviews/manage/${interviewId}/candidates-info/${candidate.applicationId}/reset-progress`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                },
            );

            const result = await response.json();

            if (!response.ok || !result.success) {
                setErrorMessage(result.error ?? "Failed to reset candidate progress");
                return;
            }

            await fetchCandidates();
        } catch {
            setErrorMessage("Failed to reset candidate progress");
        } finally {
            setIsResettingCandidateId(null);
        }
    }

    const fetchCandidates = useCallback(async () => {
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
    }, [interviewId, router]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void fetchCandidates();
        }, 0);

        return () => {
            window.clearTimeout(timer);
        };
    }, [fetchCandidates]);

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
                                onClick={openAddCandidateModal}
                                className="inline-flex rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-800"
                            >
                                Add Candidate
                            </button>
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
                                            <button
                                                type="button"
                                                onClick={() => openEditModal(candidate)}
                                                className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700"
                                            >
                                                Edit Assignment
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void resetCandidateProgress(candidate)}
                                                disabled={isResettingCandidateId === candidate.applicationId}
                                                className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 disabled:opacity-70"
                                            >
                                                {isResettingCandidateId === candidate.applicationId ? "Resetting..." : "Reset Candidate"}
                                            </button>
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

            {editingCandidate && editForm ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4">
                    <div className="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-xs uppercase tracking-[0.16em] text-indigo-700">Edit Candidate Assignment</p>
                                <h2 className="mt-1 text-xl font-semibold text-slate-900">{editingCandidate.candidateName}</h2>
                                <p className="text-sm text-slate-600">Application ID: {editingCandidate.applicationId}</p>
                            </div>
                            <button
                                type="button"
                                onClick={closeEditModal}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                            >
                                Close
                            </button>
                        </div>

                        <div className="mt-5 grid gap-4 md:grid-cols-2">
                            <div>
                                <label className="mb-1 block text-xs font-semibold text-slate-700">Assessment Slot</label>
                                <select
                                    value={editForm.assessmentSlotId}
                                    onChange={(e) => setEditForm((prev) => (prev ? { ...prev, assessmentSlotId: e.target.value } : prev))}
                                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                                    title="Select assessment slot for this interview"
                                >
                                    <option value="">Select assessment slot</option>
                                    {(data?.assessmentSlots ?? []).map((slot) => (
                                        <option key={slot.id} value={slot.id}>
                                            {formatSlotOption(slot)}
                                        </option>
                                    ))}
                                </select>
                                <p className="mt-1 text-[11px] text-slate-500">Only slots generated for this interview are shown.</p>
                            </div>

                            <div>
                                <label className="mb-1 block text-xs font-semibold text-slate-700">Interview Slot</label>
                                <select
                                    value={editForm.interviewSlotId}
                                    onChange={(e) => setEditForm((prev) => (prev ? { ...prev, interviewSlotId: e.target.value } : prev))}
                                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                                    title="Select interview slot for this interview"
                                >
                                    <option value="">Select interview slot</option>
                                    {(data?.interviewSlots ?? []).map((slot) => (
                                        <option key={slot.id} value={slot.id}>
                                            {formatSlotOption(slot)}
                                        </option>
                                    ))}
                                </select>
                                <p className="mt-1 text-[11px] text-slate-500">Only slots generated for this interview are shown.</p>
                            </div>

                            <div>
                                <label className="mb-1 block text-xs font-semibold text-slate-700">Assessment Session ID (Token)</label>
                                <input
                                    type="text"
                                    value={editForm.assessmentSessionToken}
                                    onChange={(e) => setEditForm((prev) => (prev ? { ...prev, assessmentSessionToken: e.target.value } : prev))}
                                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                                    placeholder="Enter assessment session token"
                                />
                                <p className="mt-1 text-[11px] text-slate-500">Current DB Session ID: {editingCandidate.assessmentSessionId ?? "Not created"}</p>
                            </div>

                            <div>
                                <label className="mb-1 block text-xs font-semibold text-slate-700">Interview Session ID (Token)</label>
                                <input
                                    type="text"
                                    value={editForm.interviewSessionToken}
                                    onChange={(e) => setEditForm((prev) => (prev ? { ...prev, interviewSessionToken: e.target.value } : prev))}
                                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                                    placeholder="Enter interview session token"
                                />
                                <p className="mt-1 text-[11px] text-slate-500">Current DB Session ID: {editingCandidate.interviewSessionId ?? "Not created"}</p>
                            </div>


                        </div>

                        {editError ? <p className="mt-3 text-sm text-rose-700">{editError}</p> : null}

                        <div className="mt-5 flex flex-wrap justify-end gap-2">
                            <button
                                type="button"
                                onClick={closeEditModal}
                                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => void saveCandidateEdit()}
                                disabled={isSavingEdit}
                                className="rounded-xl border border-indigo-300 bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-70"
                            >
                                {isSavingEdit ? "Saving..." : "Save Assignment"}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {isAddModalOpen ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4">
                    <div className="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-xs uppercase tracking-[0.16em] text-cyan-700">Add Candidate</p>
                                <h2 className="mt-1 text-xl font-semibold text-slate-900">Create Candidate Application</h2>
                            </div>
                            <button
                                type="button"
                                onClick={closeAddCandidateModal}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                            >
                                Close
                            </button>
                        </div>

                        <div className="mt-5 grid gap-4 md:grid-cols-2">
                            <div>
                                <label className="mb-1 block text-xs font-semibold text-slate-700">Candidate Name</label>
                                <input
                                    type="text"
                                    value={addCandidateForm.candidateName}
                                    onChange={(e) => setAddCandidateForm((prev) => ({ ...prev, candidateName: e.target.value }))}
                                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                                    placeholder="Enter candidate full name"
                                />
                            </div>

                            <div>
                                <label className="mb-1 block text-xs font-semibold text-slate-700">Candidate Email</label>
                                <input
                                    type="email"
                                    value={addCandidateForm.candidateEmail}
                                    onChange={(e) => setAddCandidateForm((prev) => ({ ...prev, candidateEmail: e.target.value }))}
                                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                                    placeholder="name@example.com"
                                />
                            </div>

                            <div>
                                <label className="mb-1 block text-xs font-semibold text-slate-700">Candidate Phone (Optional)</label>
                                <input
                                    type="text"
                                    value={addCandidateForm.candidatePhone}
                                    onChange={(e) => setAddCandidateForm((prev) => ({ ...prev, candidatePhone: e.target.value }))}
                                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                                    placeholder="Phone number"
                                />
                            </div>

                            <div>
                                <label className="mb-1 block text-xs font-semibold text-slate-700">Assessment Slot</label>
                                <select
                                    value={addCandidateForm.assessmentSlotId}
                                    onChange={(e) => setAddCandidateForm((prev) => ({ ...prev, assessmentSlotId: e.target.value }))}
                                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                                    title="Select assessment slot"
                                >
                                    <option value="">Select assessment slot</option>
                                    {(data?.assessmentSlots ?? []).map((slot) => (
                                        <option key={slot.id} value={slot.id}>
                                            {formatSlotOption(slot)}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="md:col-span-2">
                                <label className="mb-1 block text-xs font-semibold text-slate-700">Interview Slot</label>
                                <select
                                    value={addCandidateForm.interviewSlotId}
                                    onChange={(e) => setAddCandidateForm((prev) => ({ ...prev, interviewSlotId: e.target.value }))}
                                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                                    title="Select interview slot"
                                >
                                    <option value="">Select interview slot</option>
                                    {(data?.interviewSlots ?? []).map((slot) => (
                                        <option key={slot.id} value={slot.id}>
                                            {formatSlotOption(slot)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {addCandidateError ? <p className="mt-3 text-sm text-rose-700">{addCandidateError}</p> : null}

                        <div className="mt-5 flex flex-wrap justify-end gap-2">
                            <button
                                type="button"
                                onClick={closeAddCandidateModal}
                                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => void createCandidate()}
                                disabled={isCreatingCandidate}
                                className="rounded-xl border border-cyan-300 bg-cyan-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-70"
                            >
                                {isCreatingCandidate ? "Creating..." : "Create Candidate"}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
