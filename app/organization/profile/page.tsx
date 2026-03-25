"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getCurrentOrganizationAdmin } from "@/lib/organization-auth";
import { supabase, type TableRow } from "@/lib/supabase";

type VerificationStatus = "PENDING_SUBMISSION" | "SUBMITTED" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED";

type VerificationRequestData = TableRow<"organization_requests"> & {
    registration_id?: string | null;
    address?: string | null;
    description?: string | null;
};

function statusLabel(status: VerificationStatus) {
    if (status === "SUBMITTED") return "Submitted";
    if (status === "UNDER_REVIEW") return "Under Review";
    if (status === "ACCEPTED") return "Verified";
    if (status === "REJECTED") return "Rejected";
    return "Pending Submission";
}

export default function OrganizationProfilePage() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>("PENDING_SUBMISSION");

    const [organizationName, setOrganizationName] = useState("");
    const [website, setWebsite] = useState("");
    const [phone, setPhone] = useState("");
    const [officialEmail, setOfficialEmail] = useState("");
    const [employeesCount, setEmployeesCount] = useState("");
    const [registrationId, setRegistrationId] = useState("");
    const [address, setAddress] = useState("");
    const [description, setDescription] = useState("");

    const isVerified = verificationStatus === "ACCEPTED";
    const statusText = useMemo(() => statusLabel(verificationStatus), [verificationStatus]);

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

        const request = result.data as VerificationRequestData;

        setOrganizationName(request.organization_name ?? "");
        setOfficialEmail(request.organization_email ?? "");
        setPhone(request.phone ?? "");
        setWebsite(request.website ?? "");
        setEmployeesCount(request.employees_count?.toString() ?? "");
        setRegistrationId(request.registration_id ?? "");
        setAddress(request.address ?? "");
        setDescription(request.description ?? "");

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
                employeesCount,
                registrationId,
                address,
                description,
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
            body: JSON.stringify({ name: organizationName, website, phone, email: officialEmail }),
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
            <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f3f9f7] text-slate-900">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(16,185,129,0.18),transparent_35%),radial-gradient(circle_at_84%_16%,rgba(56,189,248,0.18),transparent_35%),radial-gradient(circle_at_50%_100%,rgba(20,184,166,0.10),transparent_44%)]" />
                <div className="relative rounded-2xl border border-slate-200 bg-white/85 px-6 py-4 shadow-lg backdrop-blur">
                    <p className="text-sm text-slate-600">Loading organization profile...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#f3f9f7] px-6 py-10 text-slate-900 lg:px-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(16,185,129,0.18),transparent_35%),radial-gradient(circle_at_84%_16%,rgba(56,189,248,0.18),transparent_35%),radial-gradient(circle_at_50%_100%,rgba(20,184,166,0.10),transparent_44%)]" />
            <div className="relative mx-auto max-w-6xl space-y-6">
                <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.45)] backdrop-blur sm:p-8">
                    <p className="text-xs uppercase tracking-[0.18em] text-emerald-700">Organization Profile</p>
                    <h1 className="mt-2 text-3xl font-semibold">{isVerified ? "Organization Profile Management" : "Verify Your Organization"}</h1>
                    <p className="mt-2 text-sm text-slate-600">
                        {isVerified
                            ? "Your organization is verified. Keep profile information updated."
                            : "Submit details for admin review and organization verification."}
                    </p>
                </div>

                <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
                    <section className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.3)] sm:p-8">
                        <form className="space-y-4" onSubmit={isVerified ? handleSaveOrganizationProfile : handleSubmitVerification}>
                            <div>
                                <label htmlFor="organization-name" className="mb-1.5 block text-sm font-medium text-slate-700">Organization Name</label>
                                <input id="organization-name" type="text" placeholder="Acme Technologies Pvt Ltd" value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} disabled={isSubmitting} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2" />
                            </div>

                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div>
                                    <label htmlFor="organization-website" className="mb-1.5 block text-sm font-medium text-slate-700">Website</label>
                                    <input id="organization-website" type="text" placeholder="https://acme.com" value={website} onChange={(event) => setWebsite(event.target.value)} disabled={isSubmitting} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2" />
                                </div>
                                <div>
                                    <label htmlFor="organization-phone" className="mb-1.5 block text-sm font-medium text-slate-700">Contact Number</label>
                                    <input id="organization-phone" type="text" placeholder="+91 98765 43210" value={phone} onChange={(event) => setPhone(event.target.value)} disabled={isSubmitting} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2" />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div>
                                    <label htmlFor="organization-employees" className="mb-1.5 block text-sm font-medium text-slate-700">Employees Count</label>
                                    <input id="organization-employees" type="number" min="1" placeholder="e.g. 120" value={employeesCount} onChange={(event) => setEmployeesCount(event.target.value)} disabled={isSubmitting} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2" />
                                </div>
                                <div>
                                    <label htmlFor="organization-registration" className="mb-1.5 block text-sm font-medium text-slate-700">Registration ID</label>
                                    <input id="organization-registration" type="text" placeholder="GST/CIN/Registration number" value={registrationId} onChange={(event) => setRegistrationId(event.target.value)} disabled={isSubmitting} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2" />
                                </div>
                            </div>

                            <div>
                                <label htmlFor="organization-address" className="mb-1.5 block text-sm font-medium text-slate-700">Address</label>
                                <textarea id="organization-address" rows={3} placeholder="Registered office address" value={address} onChange={(event) => setAddress(event.target.value)} disabled={isSubmitting} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2" />
                            </div>

                            <div>
                                <label htmlFor="organization-description" className="mb-1.5 block text-sm font-medium text-slate-700">Company Description</label>
                                <textarea id="organization-description" rows={4} placeholder="Briefly describe your company and hiring context" value={description} onChange={(event) => setDescription(event.target.value)} disabled={isSubmitting} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2" />
                            </div>

                            <div>
                                <label htmlFor="organization-email" className="mb-1.5 block text-sm font-medium text-slate-700">Official Email</label>
                                <input id="organization-email" type="email" value={officialEmail} onChange={(event) => setOfficialEmail(event.target.value)} disabled={isSubmitting} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2" />
                            </div>

                            <button type="submit" disabled={isSubmitting} className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110">
                                {isVerified ? (isSubmitting ? "Saving..." : "Save Profile Changes") : (isSubmitting ? "Submitting..." : "Submit For Verification")}
                            </button>

                            {errorMessage ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorMessage}</p> : null}
                            {successMessage ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}
                        </form>
                    </section>

                    <aside className="space-y-4">
                        <div className="rounded-2xl border border-slate-200 bg-white/92 p-5 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.25)]">
                            <p className="text-xs uppercase tracking-[0.18em] text-emerald-700">Status</p>
                            <p className="mt-2 text-sm text-slate-700">Current verification status: <span className="font-semibold">{statusText}</span></p>
                            <p className="mt-2 text-xs text-slate-500">Review usually takes 12-24 hours after submission.</p>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-white/92 p-5 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.25)]">
                            <p className="text-xs uppercase tracking-[0.18em] text-cyan-700">Notification Emails</p>
                            <ul className="mt-3 space-y-1 text-sm text-slate-700">
                                <li>verification@vip-platform.com</li>
                                <li>admin@vip-platform.com</li>
                            </ul>
                        </div>

                        <Link href="/organization" className="block rounded-xl border border-slate-300 bg-white px-4 py-3 text-center text-sm font-semibold text-slate-800 transition hover:bg-slate-50">Back to Organization Console</Link>
                    </aside>
                </div>
            </div>
        </div>
    );
}
