"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentAdmin, signOutAdmin } from "@/lib/admin-auth";
import { supabase, type TableRow } from "@/lib/supabase";

export default function AdminPage() {
    const router = useRouter();
    const [admin, setAdmin] = useState<TableRow<"users"> | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isRequestsLoading, setIsRequestsLoading] = useState(true);
    const [actionRequestId, setActionRequestId] = useState<number | null>(null);
    const [actionType, setActionType] = useState<"VERIFY" | "REJECT" | null>(null);
    const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
    const [feedbackError, setFeedbackError] = useState<string | null>(null);
    const [organizationRequests, setOrganizationRequests] = useState<TableRow<"organization_requests">[]>([]);

    const pendingRequests = organizationRequests.filter(
        (request) => request.status === "SUBMITTED" || request.status === "UNDER_REVIEW",
    );
    const verifiedRequests = organizationRequests.filter((request) => request.status === "ACCEPTED");
    const rejectedRequests = organizationRequests.filter((request) => request.status === "REJECTED");

    const upsertRequestInQueue = useCallback((request: TableRow<"organization_requests">) => {
        setOrganizationRequests((prev) => {
            const existingIndex = prev.findIndex((item) => item.id === request.id);

            if (request.status !== "SUBMITTED" && request.status !== "UNDER_REVIEW" && request.status !== "ACCEPTED" && request.status !== "REJECTED") {
                return existingIndex === -1 ? prev : prev.filter((item) => item.id !== request.id);
            }

            if (existingIndex === -1) {
                return [...prev, request].sort((a, b) => {
                    const left = new Date(a.created_at ?? 0).getTime();
                    const right = new Date(b.created_at ?? 0).getTime();
                    return left - right;
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

        setOrganizationRequests((result.data ?? []) as TableRow<"organization_requests">[]);
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
                    const request = payload.new as TableRow<"organization_requests">;
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
                    const request = payload.new as TableRow<"organization_requests">;
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

    async function handleRejectOrganizationRequest(requestId: number) {
        const reasonInput = window.prompt("Enter rejection reason for this organization request:");
        const reason = reasonInput?.trim();

        if (!reason) {
            return;
        }

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
        setActionRequestId(null);
        setActionType(null);
    }

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#070b16] text-white">
                <p className="text-sm text-slate-300">Validating admin session...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#070b16] px-6 py-10 text-white lg:px-10">
            <div className="mx-auto max-w-5xl space-y-6">
                <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">Admin Console</p>
                            <h1 className="mt-2 text-3xl font-semibold">Welcome, {admin?.email}</h1>
                            <p className="mt-2 text-sm text-slate-300">You are authorized as platform admin.</p>
                        </div>

                        <button
                            type="button"
                            onClick={handleSignOut}
                            className="rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                        >
                            Sign out
                        </button>
                    </div>
                </div>

                <section className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
                    <div className="mb-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">Organization Verification Queue</p>
                        <h2 className="mt-2 text-2xl font-semibold">Track requests by status in real time</h2>
                        <p className="mt-2 text-sm text-slate-300">
                            Pending requests can be approved or rejected. Verified and rejected sections update live.
                        </p>
                    </div>

                    {feedbackMessage ? (
                        <p className="mb-4 rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">
                            {feedbackMessage}
                        </p>
                    ) : null}

                    {feedbackError ? (
                        <p className="mb-4 rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
                            {feedbackError}
                        </p>
                    ) : null}

                    {isRequestsLoading ? (
                        <p className="text-sm text-slate-300">Loading organization requests...</p>
                    ) : (
                        <div className="space-y-6">
                            <div>
                                <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-amber-300">
                                    Pending ({pendingRequests.length})
                                </h3>
                                {pendingRequests.length === 0 ? (
                                    <p className="text-sm text-slate-300">No pending organization requests.</p>
                                ) : (
                                    <div className="space-y-3">
                                        {pendingRequests.map((request) => (
                                            <article
                                                key={request.id}
                                                className="rounded-xl border border-white/15 bg-white/5 p-4"
                                            >
                                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                    <div>
                                                        <p className="text-base font-semibold text-white">{request.organization_name}</p>
                                                        <p className="text-sm text-slate-300">{request.organization_email}</p>
                                                        <p className="text-xs text-slate-400">Contact: {request.contact_person}</p>
                                                    </div>

                                                    <div className="flex gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleVerifyOrganizationRequest(request.id)}
                                                            disabled={actionRequestId === request.id}
                                                            className="rounded-lg bg-gradient-to-r from-cyan-500 to-blue-400 px-4 py-2 text-sm font-semibold text-[#041022] transition hover:brightness-110 disabled:opacity-60"
                                                        >
                                                            {actionRequestId === request.id && actionType === "VERIFY"
                                                                ? "Verifying..."
                                                                : "Verify + Email"}
                                                        </button>

                                                        <button
                                                            type="button"
                                                            onClick={() => handleRejectOrganizationRequest(request.id)}
                                                            disabled={actionRequestId === request.id}
                                                            className="rounded-lg border border-rose-300/40 bg-rose-400/10 px-4 py-2 text-sm font-semibold text-rose-200 transition hover:bg-rose-400/20 disabled:opacity-60"
                                                        >
                                                            {actionRequestId === request.id && actionType === "REJECT"
                                                                ? "Rejecting..."
                                                                : "Reject + Email"}
                                                        </button>
                                                    </div>
                                                </div>
                                            </article>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div>
                                <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-emerald-300">
                                    Verified ({verifiedRequests.length})
                                </h3>
                                {verifiedRequests.length === 0 ? (
                                    <p className="text-sm text-slate-300">No verified organization requests yet.</p>
                                ) : (
                                    <div className="space-y-3">
                                        {verifiedRequests.map((request) => (
                                            <article
                                                key={request.id}
                                                className="rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-4"
                                            >
                                                <p className="text-base font-semibold text-white">{request.organization_name}</p>
                                                <p className="text-sm text-slate-200">{request.organization_email}</p>
                                            </article>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div>
                                <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-rose-300">
                                    Rejected ({rejectedRequests.length})
                                </h3>
                                {rejectedRequests.length === 0 ? (
                                    <p className="text-sm text-slate-300">No rejected organization requests yet.</p>
                                ) : (
                                    <div className="space-y-3">
                                        {rejectedRequests.map((request) => (
                                            <article
                                                key={request.id}
                                                className="rounded-xl border border-rose-300/25 bg-rose-400/10 p-4"
                                            >
                                                <p className="text-base font-semibold text-white">{request.organization_name}</p>
                                                <p className="text-sm text-slate-200">{request.organization_email}</p>
                                            </article>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
