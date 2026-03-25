"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getCurrentOrganizationAdmin, signOutOrganizationAdmin } from "@/lib/organization-auth";
import { supabase, type TableRow } from "@/lib/supabase";

type VerificationStatus = "PENDING_SUBMISSION" | "SUBMITTED" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED";

function statusMeta(status: VerificationStatus) {
    if (status === "ACCEPTED") return { label: "Verified", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
    if (status === "REJECTED") return { label: "Rejected", className: "border-rose-200 bg-rose-50 text-rose-700" };
    if (status === "UNDER_REVIEW") return { label: "Under Review", className: "border-cyan-200 bg-cyan-50 text-cyan-700" };
    if (status === "SUBMITTED") return { label: "Submitted", className: "border-amber-200 bg-amber-50 text-amber-700" };
    return { label: "Pending Submission", className: "border-slate-200 bg-slate-50 text-slate-700" };
}

export default function OrganizationPage() {
    const router = useRouter();
    const [organizationAdmin, setOrganizationAdmin] = useState<TableRow<"users"> | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>("PENDING_SUBMISSION");

    const isVerified = verificationStatus === "ACCEPTED";
    const badge = useMemo(() => statusMeta(verificationStatus), [verificationStatus]);

    useEffect(() => {
        let mounted = true;

        async function loadOrganizationAdminAndStatus() {
            const currentOrganizationAdmin = await getCurrentOrganizationAdmin();

            if (!mounted) {
                return;
            }

            if (!currentOrganizationAdmin) {
                router.replace("/organization/organization_auth");
                return;
            }

            setOrganizationAdmin(currentOrganizationAdmin);

            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;

            if (!token) {
                setIsLoading(false);
                return;
            }

            const response = await fetch("/api/organization/verification-request", {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            const result = await response.json();

            if (response.ok && result.success && result.data) {
                const request = result.data as TableRow<"organization_requests">;

                if (request.status === "SUBMITTED") {
                    setVerificationStatus("SUBMITTED");
                } else if (request.status === "UNDER_REVIEW") {
                    setVerificationStatus("UNDER_REVIEW");
                } else if (request.status === "ACCEPTED") {
                    setVerificationStatus("ACCEPTED");
                } else if (request.status === "REJECTED") {
                    setVerificationStatus("REJECTED");
                }
            }

            setIsLoading(false);
        }

        void loadOrganizationAdminAndStatus();

        return () => {
            mounted = false;
        };
    }, [router]);

    async function handleSignOut() {
        await signOutOrganizationAdmin();
        router.replace("/organization/organization_auth");
    }

    if (isLoading) {
        return (
            <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f3f9f7] text-slate-900">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(16,185,129,0.18),transparent_35%),radial-gradient(circle_at_84%_16%,rgba(56,189,248,0.18),transparent_35%),radial-gradient(circle_at_50%_100%,rgba(20,184,166,0.10),transparent_44%)]" />
                <div className="relative rounded-2xl border border-slate-200 bg-white/85 px-6 py-4 shadow-lg backdrop-blur">
                    <p className="text-sm text-slate-600">Loading organization dashboard...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#f3f9f7] px-6 py-10 text-slate-900 lg:px-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(16,185,129,0.18),transparent_35%),radial-gradient(circle_at_84%_16%,rgba(56,189,248,0.18),transparent_35%),radial-gradient(circle_at_50%_100%,rgba(20,184,166,0.10),transparent_44%)]" />

            <div className="relative mx-auto max-w-6xl space-y-6">
                <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.45)] backdrop-blur sm:p-8">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-emerald-700">Organization Console</p>
                            <h1 className="mt-2 text-3xl font-semibold">Welcome, {organizationAdmin?.email}</h1>
                            <p className="mt-2 text-sm text-slate-600">Manage your interview pipeline and candidate operations.</p>
                        </div>

                        <button type="button" onClick={handleSignOut} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100">
                            Sign out
                        </button>
                    </div>

                    <div className={`mt-5 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${badge.className}`}>{badge.label}</div>
                </div>

                {!isVerified ? (
                    <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.25)] sm:p-8">
                        <h2 className="text-xl font-semibold text-amber-900">Verification required to access all modules</h2>
                        <p className="mt-2 text-sm text-amber-800">Current status: {badge.label}. Complete or update your organization profile to continue.</p>
                        <div className="mt-4">
                            <Link href="/organization/profile" className="inline-flex rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110">
                                Go to Organization Profile
                            </Link>
                        </div>
                    </section>
                ) : (
                    <section className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.25)] sm:p-8">
                        <p className="text-xs uppercase tracking-[0.18em] text-emerald-700">Verified Dashboard</p>
                        <h2 className="mt-2 text-2xl font-semibold">Choose a module</h2>
                        <div className="mt-5 grid gap-4 sm:grid-cols-3">
                            <Link href="/organization/create-interview" className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-emerald-200 hover:shadow-md">
                                <p className="text-base font-semibold text-slate-900">Create Interview</p>
                                <p className="mt-1 text-sm text-slate-600">Set up role, slots, and publish flow.</p>
                            </Link>
                            <Link href="/organization/manage-interviews" className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-cyan-200 hover:shadow-md">
                                <p className="text-base font-semibold text-slate-900">Manage Interviews</p>
                                <p className="mt-1 text-sm text-slate-600">Track active interviews and candidates.</p>
                            </Link>
                            <Link href="/organization/profile" className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-teal-200 hover:shadow-md">
                                <p className="text-base font-semibold text-slate-900">Profile</p>
                                <p className="mt-1 text-sm text-slate-600">Update company details and verification data.</p>
                            </Link>
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}
