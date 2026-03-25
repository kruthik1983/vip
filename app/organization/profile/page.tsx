"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getCurrentOrganizationAdmin } from "@/lib/organization-auth";
import { supabase, type TableRow } from "@/lib/supabase";

export default function OrganizationProfilePage() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [verificationStatus, setVerificationStatus] = useState<
        "PENDING_SUBMISSION" | "SUBMITTED" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED"
    >("PENDING_SUBMISSION");

    const [organizationName, setOrganizationName] = useState("");
    const [website, setWebsite] = useState("");
    const [phone, setPhone] = useState("");
    const [officialEmail, setOfficialEmail] = useState("");

    const isVerified = verificationStatus === "ACCEPTED";

    async function loadVerificationRequest() {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
            return;
        }

        const response = await fetch("/api/organization/verification-request", {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        const result = await response.json();

        if (!response.ok || !result.success || !result.data) {
            return;
        }

        const request = result.data as TableRow<"organization_requests">;

        setOrganizationName(request.organization_name ?? "");
        setOfficialEmail(request.organization_email ?? "");
        setPhone(request.phone ?? "");
        setWebsite(request.website ?? "");

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

    async function loadOrganizationProfile() {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
            return;
        }

        const response = await fetch("/api/organization/profile", {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        const result = await response.json();

        if (!response.ok || !result.success || !result.data) {
            return;
        }

        const organization = result.data as TableRow<"organizations">;

        setOrganizationName(organization.name ?? "");
        setOfficialEmail(organization.email ?? "");
        setPhone(organization.phone ?? "");
        setWebsite(organization.website ?? "");
    }

    useEffect(() => {
        let mounted = true;

        async function loadOrganizationAdmin() {
            const currentOrganizationAdmin = await getCurrentOrganizationAdmin();

            if (!mounted) {
                return;
            }

            if (!currentOrganizationAdmin) {
                router.replace("/organization/organization_auth");
                return;
            }

            setOfficialEmail(currentOrganizationAdmin.email ?? "");
            await loadVerificationRequest();
            await loadOrganizationProfile();
            setIsLoading(false);
        }

        void loadOrganizationAdmin();

        return () => {
            mounted = false;
        };
    }, [router]);

    async function handleSubmitVerification(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setErrorMessage(null);
        setSuccessMessage(null);

        if (!organizationName.trim()) {
            setErrorMessage("Organization name is required.");
            return;
        }

        if (!officialEmail.trim()) {
            setErrorMessage("Official email is required.");
            return;
        }

        setIsSubmitting(true);

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
            setErrorMessage("No active session found. Please sign in again.");
            setIsSubmitting(false);
            return;
        }

        const response = await fetch("/api/organization/verification-request", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                organizationName,
                website,
                phone,
                officialEmail,
            }),
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            setErrorMessage(result.error ?? "Unable to submit verification request.");
            setIsSubmitting(false);
            return;
        }

        setSuccessMessage(result.message ?? "Verification submitted successfully.");
        setVerificationStatus("SUBMITTED");
        setIsSubmitting(false);
    }

    async function handleSaveOrganizationProfile(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setErrorMessage(null);
        setSuccessMessage(null);

        if (!organizationName.trim()) {
            setErrorMessage("Organization name is required.");
            return;
        }

        if (!officialEmail.trim()) {
            setErrorMessage("Official email is required.");
            return;
        }

        setIsSubmitting(true);

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
            setErrorMessage("No active session found. Please sign in again.");
            setIsSubmitting(false);
            return;
        }

        const response = await fetch("/api/organization/profile", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                name: organizationName,
                website,
                phone,
                email: officialEmail,
            }),
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            setErrorMessage(result.error ?? "Unable to update organization profile.");
            setIsSubmitting(false);
            return;
        }

        setSuccessMessage(result.message ?? "Profile updated successfully.");
        setIsSubmitting(false);
    }

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#070b16] text-white">
                <p className="text-sm text-slate-300">Loading organization profile...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#070b16] px-6 py-10 text-white lg:px-10">
            <div className="mx-auto max-w-5xl space-y-6">
                <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
                    <p className="text-xs uppercase tracking-[0.18em] text-emerald-200">Organization Verification</p>
                    {isVerified ? (
                        <>
                            <h1 className="mt-2 text-3xl font-semibold">Organization Profile Management</h1>
                            <p className="mt-2 text-sm text-slate-300">
                                Your organization is verified. You can now edit and maintain organization profile details.
                            </p>
                        </>
                    ) : (
                        <>
                            <h1 className="mt-2 text-3xl font-semibold">Verify your organization here</h1>
                            <p className="mt-2 text-sm text-slate-300">
                                Fill this profile so our admin team can review and verify your organization account.
                            </p>
                        </>
                    )}
                </div>

                <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
                    <section className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
                        <form className="space-y-4" onSubmit={isVerified ? handleSaveOrganizationProfile : handleSubmitVerification}>
                            <div>
                                <label htmlFor="organization-name" className="mb-1.5 block text-sm font-medium text-slate-200">
                                    Organization Name
                                </label>
                                <input
                                    id="organization-name"
                                    type="text"
                                    placeholder="Acme Technologies Pvt Ltd"
                                    value={organizationName}
                                    onChange={(event) => setOrganizationName(event.target.value)}
                                    disabled={isSubmitting}
                                    className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2"
                                />
                            </div>

                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div>
                                    <label htmlFor="organization-website" className="mb-1.5 block text-sm font-medium text-slate-200">
                                        Website
                                    </label>
                                    <input
                                        id="organization-website"
                                        type="text"
                                        placeholder="https://acme.com"
                                        value={website}
                                        onChange={(event) => setWebsite(event.target.value)}
                                        disabled={isSubmitting}
                                        className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2"
                                    />
                                </div>

                                <div>
                                    <label htmlFor="organization-phone" className="mb-1.5 block text-sm font-medium text-slate-200">
                                        Contact Number
                                    </label>
                                    <input
                                        id="organization-phone"
                                        type="text"
                                        placeholder="+91 98765 43210"
                                        value={phone}
                                        onChange={(event) => setPhone(event.target.value)}
                                        disabled={isSubmitting}
                                        className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2"
                                    />
                                </div>
                            </div>

                            <div>
                                <label htmlFor="organization-email" className="mb-1.5 block text-sm font-medium text-slate-200">
                                    Official Email
                                </label>
                                <input
                                    id="organization-email"
                                    type="email"
                                    value={officialEmail}
                                    onChange={(event) => setOfficialEmail(event.target.value)}
                                    disabled={isSubmitting}
                                    className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-400 px-4 py-3 text-sm font-semibold text-[#041022] transition hover:brightness-110"
                            >
                                {isVerified
                                    ? isSubmitting
                                        ? "Saving..."
                                        : "Save Profile Changes"
                                    : isSubmitting
                                        ? "Submitting..."
                                        : "Submit For Verification"}
                            </button>

                            {errorMessage ? (
                                <p className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
                                    {errorMessage}
                                </p>
                            ) : null}

                            {successMessage ? (
                                <p className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">
                                    {successMessage}
                                </p>
                            ) : null}
                        </form>
                    </section>

                    <aside className="space-y-4">
                        {isVerified ? (
                            <div className="rounded-2xl border border-cyan-300/30 bg-cyan-400/10 p-5">
                                <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">Profile Editing Enabled</p>
                                <h2 className="mt-2 text-lg font-semibold text-white">Organization is verified</h2>
                                <p className="mt-2 text-sm text-cyan-100">
                                    You can now keep your organization profile details updated anytime from this page.
                                </p>
                            </div>
                        ) : (
                            <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-5">
                                <p className="text-xs uppercase tracking-[0.18em] text-emerald-200">Important</p>
                                <h2 className="mt-2 text-lg font-semibold text-white">Verification Email</h2>
                                <p className="mt-2 text-sm text-emerald-100">
                                    After submitting your profile, you will receive a verification update email from:
                                </p>
                                <ul className="mt-3 space-y-1 text-sm font-medium text-white">
                                    <li>verification@vip-platform.com</li>
                                    <li>admin@vip-platform.com</li>
                                </ul>
                            </div>
                        )}

                        <div className="rounded-2xl border border-white/15 bg-white/5 p-5">
                            <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">Status</p>
                            <p className="mt-2 text-sm text-slate-200">
                                Current verification status:{" "}
                                <span className="font-semibold text-amber-300">
                                    {verificationStatus === "PENDING_SUBMISSION"
                                        ? "Pending Submission"
                                        : verificationStatus === "SUBMITTED"
                                            ? "Submitted"
                                            : verificationStatus === "UNDER_REVIEW"
                                                ? "Under Review"
                                                : verificationStatus === "ACCEPTED"
                                                    ? "Verified"
                                                    : "Rejected"}
                                </span>
                            </p>
                            <p className="mt-2 text-xs text-slate-400">Review usually takes 12-24 hours after submission.</p>
                        </div>

                        <Link
                            href="/organization"
                            className="block rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-white/10"
                        >
                            Back to Organization Console
                        </Link>
                    </aside>
                </div>
            </div>
        </div>
    );
}
