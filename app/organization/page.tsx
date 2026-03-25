"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getCurrentOrganizationAdmin, signOutOrganizationAdmin } from "@/lib/organization-auth";
import { supabase, type TableRow } from "@/lib/supabase";

type VerificationStatus = "PENDING_SUBMISSION" | "SUBMITTED" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED";

export default function OrganizationPage() {
    const router = useRouter();
    const [organizationAdmin, setOrganizationAdmin] = useState<TableRow<"users"> | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>("PENDING_SUBMISSION");

    const isVerified = verificationStatus === "ACCEPTED";

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
            <div className="flex min-h-screen items-center justify-center bg-[#070b16] text-white">
                <p className="text-sm text-slate-300">Loading organization dashboard...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#070b16] px-6 py-10 text-white lg:px-10">
            <div className="mx-auto max-w-5xl space-y-6">
                <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-emerald-200">Organization Console</p>
                            <h1 className="mt-2 text-3xl font-semibold">Welcome, {organizationAdmin?.email}</h1>
                            <p className="mt-2 text-sm text-slate-300">Manage your organization interview workflow.</p>
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

                {!isVerified ? (
                    <section className="rounded-2xl border border-amber-300/25 bg-amber-400/10 p-6 backdrop-blur-xl sm:p-8">
                        <h2 className="text-xl font-semibold text-white">Verification required to access dashboard</h2>
                        <p className="mt-2 text-sm text-amber-100">
                            Current status: {verificationStatus === "PENDING_SUBMISSION" ? "Pending Submission" : verificationStatus === "SUBMITTED" ? "Submitted" : verificationStatus === "UNDER_REVIEW" ? "Under Review" : "Rejected"}
                        </p>
                        <p className="mt-2 text-sm text-slate-200">
                            Complete or update your organization profile to continue.
                        </p>
                        <div className="mt-4">
                            <Link
                                href="/organization/profile"
                                className="inline-flex rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-400 px-4 py-2 text-sm font-semibold text-[#041022] transition hover:brightness-110"
                            >
                                Go to Organization Profile
                            </Link>
                        </div>
                    </section>
                ) : (
                    <section className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
                        <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">Verified Dashboard</p>
                        <h2 className="mt-2 text-2xl font-semibold">Choose a module</h2>
                        <div className="mt-5 grid gap-4 sm:grid-cols-3">
                            <Link
                                href="/organization/create-interview"
                                className="rounded-xl border border-white/15 bg-white/5 p-4 transition hover:bg-white/10"
                            >
                                <p className="text-base font-semibold text-white">Create Interview</p>
                                <p className="mt-1 text-sm text-slate-300">Create a new interview and publish details.</p>
                            </Link>

                            <Link
                                href="/organization/manage-interviews"
                                className="rounded-xl border border-white/15 bg-white/5 p-4 transition hover:bg-white/10"
                            >
                                <p className="text-base font-semibold text-white">Manage Interview</p>
                                <p className="mt-1 text-sm text-slate-300">View and update your existing interviews.</p>
                            </Link>

                            <Link
                                href="/organization/profile"
                                className="rounded-xl border border-white/15 bg-white/5 p-4 transition hover:bg-white/10"
                            >
                                <p className="text-base font-semibold text-white">Profile</p>
                                <p className="mt-1 text-sm text-slate-300">Edit organization profile information.</p>
                            </Link>
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}
