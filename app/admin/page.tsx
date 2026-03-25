"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentAdmin, signOutAdmin } from "@/lib/admin-auth";
import { supabase, type TableRow } from "@/lib/supabase";

type RequestBucket = "ALL" | "PENDING" | "VERIFIED" | "REJECTED";

type RejectDialogState = {
    open: boolean;
    requestId: number | null;
    organizationName: string;
    reason: string;
};

type AdminOrganizationRequest = TableRow<"organization_requests"> & {
    registration_id?: string | null;
    address?: string | null;
    description?: string | null;
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

function getRequestStatusLabel(status: string | null | undefined) {
    const value = (status ?? "").toUpperCase();

    if (value === "SUBMITTED" || value === "UNDER_REVIEW") {
        return "Pending";
    }

    if (value === "ACCEPTED") {
        return "Verified";
    }

    if (value === "REJECTED") {
        return "Rejected";
    }

    return "Unknown";
}

function getRequestStatusBadge(status: string | null | undefined) {
    const value = (status ?? "").toUpperCase();

    if (value === "SUBMITTED" || value === "UNDER_REVIEW") {
        return "border-amber-400/40 bg-amber-50 text-amber-700";
    }

    if (value === "ACCEPTED") {
        return "border-emerald-400/40 bg-emerald-50 text-emerald-700";
    }

    if (value === "REJECTED") {
        return "border-rose-400/40 bg-rose-50 text-rose-700";
    }

    return "border-slate-300 bg-slate-50 text-slate-700";
}

export default function AdminPage() {
    const router = useRouter();
    const [admin, setAdmin] = useState<TableRow<"users"> | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isRequestsLoading, setIsRequestsLoading] = useState(true);
    const [actionRequestId, setActionRequestId] = useState<number | null>(null);
    const [actionType, setActionType] = useState<"VERIFY" | "REJECT" | null>(null);
    const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
    const [feedbackError, setFeedbackError] = useState<string | null>(null);
    const [organizationRequests, setOrganizationRequests] = useState<AdminOrganizationRequest[]>([]);
    const [activeBucket, setActiveBucket] = useState<RequestBucket>("PENDING");
    const [searchQuery, setSearchQuery] = useState("");
    const [rejectDialog, setRejectDialog] = useState<RejectDialogState>({
        open: false,
        requestId: null,
        organizationName: "",
        reason: "",
    });

    const pendingRequests = useMemo(
        () =>
            organizationRequests.filter(
                (request) => request.status === "SUBMITTED" || request.status === "UNDER_REVIEW",
            ),
        [organizationRequests],
    );

    const verifiedRequests = useMemo(
        () => organizationRequests.filter((request) => request.status === "ACCEPTED"),
        [organizationRequests],
    );

    const rejectedRequests = useMemo(
        () => organizationRequests.filter((request) => request.status === "REJECTED"),
        [organizationRequests],
    );

    const visibleRequests = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();

        const byBucket = organizationRequests.filter((request) => {
            if (activeBucket === "ALL") {
                return true;
            }

            if (activeBucket === "PENDING") {
                return request.status === "SUBMITTED" || request.status === "UNDER_REVIEW";
            }

            if (activeBucket === "VERIFIED") {
                return request.status === "ACCEPTED";
            }

            if (activeBucket === "REJECTED") {
                return request.status === "REJECTED";
            }

            return true;
        });

        if (!query) {
            return byBucket;
        }

        return byBucket.filter((request) => {
            const candidate = `${request.organization_name ?? ""} ${request.organization_email ?? ""} ${request.contact_person ?? ""}`.toLowerCase();
            return candidate.includes(query);
        });
    }, [activeBucket, organizationRequests, searchQuery]);

    const upsertRequestInQueue = useCallback((request: AdminOrganizationRequest) => {
        setOrganizationRequests((prev) => {
            const existingIndex = prev.findIndex((item) => item.id === request.id);

            if (
                request.status !== "SUBMITTED" &&
                request.status !== "UNDER_REVIEW" &&
                request.status !== "ACCEPTED" &&
                request.status !== "REJECTED"
            ) {
                return existingIndex === -1 ? prev : prev.filter((item) => item.id !== request.id);
            }

            if (existingIndex === -1) {
                return [...prev, request].sort((a, b) => {
                    const left = new Date(a.created_at ?? 0).getTime();
                    const right = new Date(b.created_at ?? 0).getTime();
                    return right - left;
                });
            }

            const updated = [...prev];
            updated[existingIndex] = request;
            return updated;
        });
    }, []);

    async function loadPendingOrganizationRequests() {
        setIsRequestsLoading(true);
        setFeedbackError(null);

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
            setFeedbackError("No active session token found. Please sign in again.");
            setIsRequestsLoading(false);
            return;
        }

        const response = await fetch("/api/admin/organization-requests", {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            setFeedbackError(result.error ?? "Unable to load organization requests.");
            setIsRequestsLoading(false);
            return;
        }

        setOrganizationRequests((result.data ?? []) as AdminOrganizationRequest[]);
        setIsRequestsLoading(false);
    }

    useEffect(() => {
        let mounted = true;

        async function loadAdmin() {
            const currentAdmin = await getCurrentAdmin();

            if (!mounted) {
                return;
            }

            if (!currentAdmin) {
                router.replace("/admin/admin_auth");
                return;
            }

            setAdmin(currentAdmin);
            await loadPendingOrganizationRequests();
            setIsLoading(false);
        }

        void loadAdmin();

        return () => {
            mounted = false;
        };
    }, [router]);

    useEffect(() => {
        if (!admin) {
            return;
        }

        const channel = supabase
            .channel(`admin-organization-requests-${admin.id}`)
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "organization_requests",
                },
                (payload) => {
                    const request = payload.new as AdminOrganizationRequest;
                    upsertRequestInQueue(request);
                },
            )
            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "organization_requests",
                },
                (payload) => {
                    const request = payload.new as AdminOrganizationRequest;
                    upsertRequestInQueue(request);
                },
            )
            .on(
                "postgres_changes",
                {
                    event: "DELETE",
                    schema: "public",
                    table: "organization_requests",
                },
                (payload) => {
                    const oldRequest = payload.old as { id?: number };

                    if (!oldRequest.id) {
                        return;
                    }

                    setOrganizationRequests((prev) => prev.filter((request) => request.id !== oldRequest.id));
                },
            )
            .subscribe();

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [admin, upsertRequestInQueue]);

    async function handleSignOut() {
        await signOutAdmin();
        router.replace("/admin/admin_auth");
    }

    function openRejectDialog(request: AdminOrganizationRequest) {
        setRejectDialog({
            open: true,
            requestId: request.id,
            organizationName: request.organization_name ?? "Organization",
            reason: "",
        });
    }

    function closeRejectDialog() {
        setRejectDialog({
            open: false,
            requestId: null,
            organizationName: "",
            reason: "",
        });
    }

    async function handleVerifyOrganizationRequest(requestId: number) {
        setFeedbackError(null);
        setFeedbackMessage(null);
        setActionRequestId(requestId);
        setActionType("VERIFY");

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
            setFeedbackError("No active session token found. Please sign in again.");
            setActionRequestId(null);
            setActionType(null);
            return;
        }

        const response = await fetch(`/api/admin/organization-requests/${requestId}/verify`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            setFeedbackError(result.error ?? "Unable to verify organization request.");
            setActionRequestId(null);
            setActionType(null);
            return;
        }

        setFeedbackMessage(result.message ?? "Organization verified successfully.");
        setOrganizationRequests((prev) =>
            prev.map((request) =>
                request.id === requestId
                    ? { ...request, status: "ACCEPTED", reviewed_at: new Date().toISOString() }
                    : request,
            ),
        );
        setActionRequestId(null);
        setActionType(null);
    }

    async function handleRejectOrganizationRequest(requestId: number, reason: string) {
        setFeedbackError(null);
        setFeedbackMessage(null);
        setActionRequestId(requestId);
        setActionType("REJECT");

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
            setFeedbackError("No active session token found. Please sign in again.");
            setActionRequestId(null);
            setActionType(null);
            return;
        }

        const response = await fetch(`/api/admin/organization-requests/${requestId}/reject`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ reason }),
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            setFeedbackError(result.error ?? "Unable to reject organization request.");
            setActionRequestId(null);
            setActionType(null);
            return;
        }

        setFeedbackMessage(result.message ?? "Organization rejected successfully.");
        setOrganizationRequests((prev) =>
            prev.map((request) =>
                request.id === requestId
                    ? { ...request, status: "REJECTED", reviewed_at: new Date().toISOString() }
                    : request,
            ),
        );
        closeRejectDialog();
        setActionRequestId(null);
        setActionType(null);
    }

    async function confirmRejectFromDialog() {
        if (!rejectDialog.requestId) {
            return;
        }

        const reason = rejectDialog.reason.trim();

        if (!reason) {
            setFeedbackError("Rejection reason is required.");
            return;
        }

        await handleRejectOrganizationRequest(rejectDialog.requestId, reason);
    }

    if (isLoading) {
        return (
            <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f4f7fb] text-slate-900">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(56,189,248,0.20),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(251,191,36,0.18),transparent_35%),radial-gradient(circle_at_50%_100%,rgba(20,184,166,0.14),transparent_40%)]" />
                <div className="relative rounded-2xl border border-slate-200 bg-white/80 px-6 py-4 shadow-lg backdrop-blur">
                    <p className="text-sm text-slate-600">Validating admin session...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#f4f7fb] px-4 py-8 text-slate-900 sm:px-6 lg:px-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(56,189,248,0.20),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(251,191,36,0.18),transparent_35%),radial-gradient(circle_at_50%_100%,rgba(20,184,166,0.14),transparent_40%)]" />

            <div className="relative mx-auto max-w-7xl space-y-6">
                <header className="rounded-3xl border border-slate-200 bg-white/85 p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.45)] backdrop-blur sm:p-8">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Platform Administration</p>
                            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                                Admin Control Center
                            </h1>
                            <p className="mt-2 text-sm text-slate-600">
                                Signed in as {admin?.email}. Review organization onboarding requests in real time.
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => void loadPendingOrganizationRequests()}
                                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-teal-300 hover:text-teal-700"
                            >
                                Refresh
                            </button>
                            <button
                                type="button"
                                onClick={handleSignOut}
                                className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
                            >
                                Sign out
                            </button>
                        </div>
                    </div>

                    <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <article className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                            <p className="text-xs uppercase tracking-wide text-amber-700">Pending</p>
                            <p className="mt-1 text-2xl font-semibold text-amber-900">{pendingRequests.length}</p>
                        </article>
                        <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                            <p className="text-xs uppercase tracking-wide text-emerald-700">Verified</p>
                            <p className="mt-1 text-2xl font-semibold text-emerald-900">{verifiedRequests.length}</p>
                        </article>
                        <article className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                            <p className="text-xs uppercase tracking-wide text-rose-700">Rejected</p>
                            <p className="mt-1 text-2xl font-semibold text-rose-900">{rejectedRequests.length}</p>
                        </article>
                        <article className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
                            <p className="text-xs uppercase tracking-wide text-sky-700">Total Requests</p>
                            <p className="mt-1 text-2xl font-semibold text-sky-900">{organizationRequests.length}</p>
                        </article>
                    </div>
                </header>

                <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.45)] backdrop-blur sm:p-8">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Verification Queue</p>
                            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Review and resolve onboarding requests</h2>
                            <p className="mt-2 text-sm text-slate-600">
                                Use status filters and search to quickly process incoming organizations.
                            </p>
                        </div>

                        <div className="w-full max-w-sm">
                            <label htmlFor="request-search" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Search
                            </label>
                            <input
                                id="request-search"
                                type="text"
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                placeholder="Search by name, email, or contact"
                                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none ring-teal-300/50 placeholder:text-slate-400 focus:ring-2"
                            />
                        </div>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                        {(["PENDING", "VERIFIED", "REJECTED", "ALL"] as RequestBucket[]).map((bucket) => {
                            const active = activeBucket === bucket;
                            return (
                                <button
                                    key={bucket}
                                    type="button"
                                    onClick={() => setActiveBucket(bucket)}
                                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${active
                                        ? "border-teal-300 bg-teal-50 text-teal-700"
                                        : "border-slate-300 bg-white text-slate-600 hover:border-teal-200 hover:text-teal-700"
                                        }`}
                                >
                                    {bucket}
                                </button>
                            );
                        })}
                    </div>

                    {feedbackMessage ? (
                        <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                            {feedbackMessage}
                        </p>
                    ) : null}

                    {feedbackError ? (
                        <p className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                            {feedbackError}
                        </p>
                    ) : null}

                    {isRequestsLoading ? (
                        <p className="mt-6 text-sm text-slate-600">Loading organization requests...</p>
                    ) : visibleRequests.length === 0 ? (
                        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
                            No requests found for current filters.
                        </div>
                    ) : (
                        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
                            {visibleRequests.map((request) => (
                                <article
                                    key={request.id}
                                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.55)]"
                                >
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <p className="text-lg font-semibold text-slate-900">{request.organization_name}</p>
                                            <p className="text-sm text-slate-600">{request.organization_email}</p>
                                        </div>
                                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getRequestStatusBadge(request.status)}`}>
                                            {getRequestStatusLabel(request.status)}
                                        </span>
                                    </div>

                                    <dl className="mt-4 space-y-2 text-sm">
                                        <div className="grid grid-cols-[110px_1fr] gap-2">
                                            <dt className="text-slate-500">Contact</dt>
                                            <dd className="text-slate-800">{request.contact_person || "-"}</dd>
                                        </div>
                                        <div className="grid grid-cols-[110px_1fr] gap-2">
                                            <dt className="text-slate-500">Phone</dt>
                                            <dd className="text-slate-800">{request.phone || "-"}</dd>
                                        </div>
                                        <div className="grid grid-cols-[110px_1fr] gap-2">
                                            <dt className="text-slate-500">Website</dt>
                                            <dd className="break-all text-slate-800">{request.website || "-"}</dd>
                                        </div>
                                        <div className="grid grid-cols-[110px_1fr] gap-2">
                                            <dt className="text-slate-500">Employees</dt>
                                            <dd className="text-slate-800">{request.employees_count ?? "-"}</dd>
                                        </div>
                                        <div className="grid grid-cols-[110px_1fr] gap-2">
                                            <dt className="text-slate-500">Reg ID</dt>
                                            <dd className="break-all text-slate-800">{request.registration_id || "-"}</dd>
                                        </div>
                                        <div className="grid grid-cols-[110px_1fr] gap-2">
                                            <dt className="text-slate-500">Address</dt>
                                            <dd className="text-slate-800">{request.address || "-"}</dd>
                                        </div>
                                        <div className="grid grid-cols-[110px_1fr] gap-2">
                                            <dt className="text-slate-500">Description</dt>
                                            <dd className="text-slate-800">{request.description || "-"}</dd>
                                        </div>
                                        <div className="grid grid-cols-[110px_1fr] gap-2">
                                            <dt className="text-slate-500">Requested At</dt>
                                            <dd className="text-slate-800">{formatDateTime(request.created_at)}</dd>
                                        </div>
                                        <div className="grid grid-cols-[110px_1fr] gap-2">
                                            <dt className="text-slate-500">Reviewed At</dt>
                                            <dd className="text-slate-800">{formatDateTime(request.reviewed_at)}</dd>
                                        </div>
                                        <div className="grid grid-cols-[110px_1fr] gap-2">
                                            <dt className="text-slate-500">Reason</dt>
                                            <dd className="text-slate-800">{request.rejection_reason || "-"}</dd>
                                        </div>
                                    </dl>

                                    {(request.status === "SUBMITTED" || request.status === "UNDER_REVIEW") ? (
                                        <div className="mt-5 flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                onClick={() => handleVerifyOrganizationRequest(request.id)}
                                                disabled={actionRequestId === request.id}
                                                className="rounded-xl bg-gradient-to-r from-teal-500 to-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                                            >
                                                {actionRequestId === request.id && actionType === "VERIFY"
                                                    ? "Verifying..."
                                                    : "Verify + Email"}
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => openRejectDialog(request)}
                                                disabled={actionRequestId === request.id}
                                                className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                                            >
                                                {actionRequestId === request.id && actionType === "REJECT"
                                                    ? "Rejecting..."
                                                    : "Reject + Email"}
                                            </button>
                                        </div>
                                    ) : null}
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            </div>

            {rejectDialog.open ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">Reject Request</p>
                        <h3 className="mt-2 text-xl font-semibold text-slate-900">{rejectDialog.organizationName}</h3>
                        <p className="mt-2 text-sm text-slate-600">
                            This reason will be sent in the rejection email. Keep it clear and actionable.
                        </p>

                        <div className="mt-4">
                            <label htmlFor="rejection-reason" className="mb-1.5 block text-sm font-medium text-slate-700">
                                Rejection reason
                            </label>
                            <textarea
                                id="rejection-reason"
                                value={rejectDialog.reason}
                                onChange={(event) =>
                                    setRejectDialog((prev) => ({
                                        ...prev,
                                        reason: event.target.value,
                                    }))
                                }
                                rows={4}
                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-rose-300/50 placeholder:text-slate-400 focus:ring-2"
                                placeholder="Example: Please provide your GST registration and an updated company domain email."
                            />
                        </div>

                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={closeRejectDialog}
                                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => void confirmRejectFromDialog()}
                                disabled={actionType === "REJECT"}
                                className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                            >
                                {actionType === "REJECT" ? "Rejecting..." : "Confirm Reject"}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
