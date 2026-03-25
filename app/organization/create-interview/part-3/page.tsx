"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentOrganizationAdmin } from "@/lib/organization-auth";
import { supabase } from "@/lib/supabase";

function Part3Content() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const interviewId = searchParams.get("interviewId");

    const [isLoading, setIsLoading] = useState(true);
    const [isPublishing, setIsPublishing] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    const [applicationForm, setApplicationForm] = useState({
        requireName: true,
        requireEmail: true,
        requirePhone: false,
        requireResume: true,
        consentPolicyVersion: "v1",
        consentPolicyUrl: "",
    });

    const [applicationLink, setApplicationLink] = useState<string | null>(null);
    const [validUntil, setValidUntil] = useState<string | null>(null);
    const [isPublished, setIsPublished] = useState(false);

    useEffect(() => {
        let mounted = true;

        async function loadOrganizationAdmin() {
            const currentAdmin = await getCurrentOrganizationAdmin();

            if (!mounted) {
                return;
            }

            if (!currentAdmin) {
                router.replace("/organization/organization_auth");
                return;
            }

            if (!interviewId || parseInt(interviewId) <= 0) {
                setErrorMessage("Invalid interview ID");
                setIsLoading(false);
                return;
            }

            setIsLoading(false);
        }

        void loadOrganizationAdmin();

        return () => {
            mounted = false;
        };
    }, [router, interviewId]);

    async function handlePublishInterview() {
        setErrorMessage(null);
        setSuccessMessage(null);

        if (!applicationForm.requireName && !applicationForm.requireEmail) {
            setErrorMessage("At least name or email must be required");
            return;
        }

        setIsPublishing(true);

        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;

            if (!token) {
                setErrorMessage("No active session. Please sign in again.");
                setIsPublishing(false);
                return;
            }

            const response = await fetch("/api/organization/interviews/part-3", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    interviewId: parseInt(interviewId || "0"),
                    applicationForm,
                }),
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                setErrorMessage(result.error ?? "Failed to publish interview");
                setIsPublishing(false);
                return;
            }

            setApplicationLink(result.data.applicationLink);
            setValidUntil(result.data.validUntilDisplay);
            setIsPublished(true);
            setSuccessMessage("Interview published successfully.");
            setIsPublishing(false);
        } catch (error) {
            setErrorMessage("Error publishing interview. Please try again.");
            console.error(error);
            setIsPublishing(false);
        }
    }

    function handleCopyLink() {
        if (applicationLink) {
            void navigator.clipboard.writeText(applicationLink);
            setSuccessMessage("Application link copied to clipboard.");
            setTimeout(() => setSuccessMessage(null), 3000);
        }
    }

    if (isLoading) {
        return (
            <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f3f9f7] text-slate-900">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(16,185,129,0.18),transparent_35%),radial-gradient(circle_at_84%_16%,rgba(56,189,248,0.18),transparent_35%),radial-gradient(circle_at_50%_100%,rgba(20,184,166,0.10),transparent_44%)]" />
                <div className="relative rounded-2xl border border-slate-200 bg-white/85 px-6 py-4 shadow-lg backdrop-blur"><p className="text-sm text-slate-600">Loading...</p></div>
            </div>
        );
    }

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#f3f9f7] px-6 py-10 text-slate-900 lg:px-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(16,185,129,0.18),transparent_35%),radial-gradient(circle_at_84%_16%,rgba(56,189,248,0.18),transparent_35%),radial-gradient(circle_at_50%_100%,rgba(20,184,166,0.10),transparent_44%)]" />
            <div className="relative mx-auto max-w-4xl space-y-6">
                <div className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.35)] sm:p-8">
                    <p className="text-xs uppercase tracking-[0.18em] text-emerald-700">Step 3 of 3</p>
                    <h1 className="mt-2 text-3xl font-semibold">Application and Publish</h1>
                    <p className="mt-2 text-sm text-slate-600">Choose required fields for candidates and publish the interview campaign.</p>
                </div>

                {errorMessage ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</div> : null}
                {successMessage ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</div> : null}

                {!isPublished ? (
                    <>
                        <section className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.25)] space-y-4">
                            <h2 className="text-lg font-semibold">Candidate Application Form</h2>
                            <p className="text-sm text-slate-600">Pick which fields are mandatory for candidates.</p>

                            <div className="space-y-3">
                                <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
                                    <input type="checkbox" checked={applicationForm.requireName} onChange={(e) => setApplicationForm({ ...applicationForm, requireName: e.target.checked })} />
                                    <span className="text-sm text-slate-700">Candidate Name</span>
                                </label>
                                <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
                                    <input type="checkbox" checked={applicationForm.requireEmail} onChange={(e) => setApplicationForm({ ...applicationForm, requireEmail: e.target.checked })} />
                                    <span className="text-sm text-slate-700">Email Address</span>
                                </label>
                                <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
                                    <input type="checkbox" checked={applicationForm.requirePhone} onChange={(e) => setApplicationForm({ ...applicationForm, requirePhone: e.target.checked })} />
                                    <span className="text-sm text-slate-700">Phone Number</span>
                                </label>
                                <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
                                    <input type="checkbox" checked={applicationForm.requireResume} onChange={(e) => setApplicationForm({ ...applicationForm, requireResume: e.target.checked })} />
                                    <span className="text-sm text-slate-700">Resume Upload</span>
                                </label>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                    <label htmlFor="consent-policy-version" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Policy Version</label>
                                    <input id="consent-policy-version" type="text" value={applicationForm.consentPolicyVersion} onChange={(e) => setApplicationForm({ ...applicationForm, consentPolicyVersion: e.target.value })} placeholder="v1" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
                                </div>
                                <div>
                                    <label htmlFor="consent-policy-url" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Policy URL (Optional)</label>
                                    <input id="consent-policy-url" type="url" value={applicationForm.consentPolicyUrl} onChange={(e) => setApplicationForm({ ...applicationForm, consentPolicyUrl: e.target.value })} placeholder="https://yourcompany.com/privacy" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
                                </div>
                            </div>
                        </section>

                        <div className="flex gap-3">
                            <Link href={`/organization/create-interview/part-2?interviewId=${interviewId}`} className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800">Back to Part 2</Link>
                            <button onClick={handlePublishInterview} disabled={isPublishing} className="ml-auto inline-flex rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 px-6 py-2 text-sm font-semibold text-white disabled:opacity-70">{isPublishing ? "Publishing..." : "Publish Interview"}</button>
                        </div>
                    </>
                ) : (
                    <>
                        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.2)] space-y-4">
                            <h2 className="text-lg font-semibold text-emerald-900">Interview Published</h2>
                            <div>
                                <p className="mb-2 text-sm font-semibold text-slate-700">Candidate Application Link</p>
                                <div className="flex gap-2">
                                    <input type="text" readOnly value={applicationLink || ""} className="flex-1 rounded-xl border border-emerald-200 bg-white px-4 py-2.5 text-sm text-slate-900" />
                                    <button onClick={handleCopyLink} className="rounded-xl border border-emerald-200 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-700">Copy</button>
                                </div>
                            </div>
                            <p className="text-sm text-slate-700">Application valid until: <span className="font-semibold">{validUntil}</span></p>
                        </section>

                        <div className="flex gap-3">
                            <Link href="/organization" className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800">Back to Dashboard</Link>
                            <Link href="/organization/manage-interviews" className="ml-auto inline-flex rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 px-6 py-2 text-sm font-semibold text-white">View All Interviews</Link>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default function Part3Page() {
    return (
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#f3f9f7] text-slate-700">Loading...</div>}>
            <Part3Content />
        </Suspense>
    );
}
