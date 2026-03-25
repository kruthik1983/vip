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

    // Application form config
    const [applicationForm, setApplicationForm] = useState({
        requireName: true,
        requireEmail: true,
        requirePhone: false,
        requireResume: true,
        consentPolicyVersion: "v1",
        consentPolicyUrl: "",
    });

    // Generated values
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

            // Display success
            setApplicationLink(result.data.applicationLink);
            setValidUntil(result.data.validUntilDisplay);
            setIsPublished(true);
            setSuccessMessage("Interview published successfully!");
        } catch (error) {
            setErrorMessage("Error publishing interview. Please try again.");
            console.error(error);
            setIsPublishing(false);
        }
    }

    function handleCopyLink() {
        if (applicationLink) {
            navigator.clipboard.writeText(applicationLink);
            setSuccessMessage("Application link copied to clipboard!");
            setTimeout(() => setSuccessMessage(null), 3000);
        }
    }

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#070b16] text-white">
                <p className="text-sm text-slate-300">Loading...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#070b16] px-6 py-10 text-white lg:px-10">
            <div className="mx-auto max-w-3xl space-y-6">
                {/* Header */}
                <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
                    <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">Step 3 of 3</p>
                    <h1 className="mt-2 text-3xl font-semibold">Candidate Application & Publish</h1>
                    <p className="mt-2 text-sm text-slate-400">
                        Configure candidate application form, generate link, and publish interview.
                    </p>
                </div>

                {/* Error Message */}
                {errorMessage && (
                    <div className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                        {errorMessage}
                    </div>
                )}

                {/* Success Message */}
                {successMessage && (
                    <div className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
                        {successMessage}
                    </div>
                )}

                {!isPublished ? (
                    <>
                        {/* ===== APPLICATION FORM CONFIGURATION ===== */}
                        <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8 space-y-4">
                            <h2 className="text-lg font-semibold text-white">Candidate Application Form</h2>
                            <p className="text-sm text-slate-400">
                                Select which fields candidates must provide when applying for this interview.
                            </p>

                            <div className="space-y-3 border-t border-white/10 pt-4">
                                {/* Name */}
                                <label className="flex items-start gap-3 cursor-pointer hover:bg-white/5 p-3 rounded-lg transition">
                                    <input
                                        type="checkbox"
                                        checked={applicationForm.requireName}
                                        onChange={(e) =>
                                            setApplicationForm({
                                                ...applicationForm,
                                                requireName: e.target.checked,
                                            })
                                        }
                                        className="h-4 w-4 mt-1 cursor-pointer rounded border-white/20"
                                    />
                                    <div className="flex-1">
                                        <p className="text-sm font-medium text-white">Candidate Name</p>
                                        <p className="text-xs text-slate-400 mt-0.5">First and last name of the candidate</p>
                                    </div>
                                </label>

                                {/* Email */}
                                <label className="flex items-start gap-3 cursor-pointer hover:bg-white/5 p-3 rounded-lg transition">
                                    <input
                                        type="checkbox"
                                        checked={applicationForm.requireEmail}
                                        onChange={(e) =>
                                            setApplicationForm({
                                                ...applicationForm,
                                                requireEmail: e.target.checked,
                                            })
                                        }
                                        className="h-4 w-4 mt-1 cursor-pointer rounded border-white/20"
                                    />
                                    <div className="flex-1">
                                        <p className="text-sm font-medium text-white">Email Address</p>
                                        <p className="text-xs text-slate-400 mt-0.5">
                                            Used for notifications and interview details
                                        </p>
                                    </div>
                                </label>

                                {/* Phone */}
                                <label className="flex items-start gap-3 cursor-pointer hover:bg-white/5 p-3 rounded-lg transition">
                                    <input
                                        type="checkbox"
                                        checked={applicationForm.requirePhone}
                                        onChange={(e) =>
                                            setApplicationForm({
                                                ...applicationForm,
                                                requirePhone: e.target.checked,
                                            })
                                        }
                                        className="h-4 w-4 mt-1 cursor-pointer rounded border-white/20"
                                    />
                                    <div className="flex-1">
                                        <p className="text-sm font-medium text-white">Phone Number</p>
                                        <p className="text-xs text-slate-400 mt-0.5">For emergency contact (optional)</p>
                                    </div>
                                </label>

                                {/* Resume */}
                                <label className="flex items-start gap-3 cursor-pointer hover:bg-white/5 p-3 rounded-lg transition">
                                    <input
                                        type="checkbox"
                                        checked={applicationForm.requireResume}
                                        onChange={(e) =>
                                            setApplicationForm({
                                                ...applicationForm,
                                                requireResume: e.target.checked,
                                            })
                                        }
                                        className="h-4 w-4 mt-1 cursor-pointer rounded border-white/20"
                                    />
                                    <div className="flex-1">
                                        <p className="text-sm font-medium text-white">Resume/CV Upload</p>
                                        <p className="text-xs text-slate-400 mt-0.5">
                                            PDF file - must be uploaded before assessment starts
                                        </p>
                                    </div>
                                </label>

                                <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                    <p className="text-sm font-medium text-white">Consent Policy Metadata</p>
                                    <p className="mt-1 text-xs text-slate-400">
                                        This version and URL are shown to candidates and saved with consent records.
                                    </p>

                                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                        <div>
                                            <label htmlFor="consent-policy-version" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300">
                                                Policy Version
                                            </label>
                                            <input
                                                id="consent-policy-version"
                                                type="text"
                                                value={applicationForm.consentPolicyVersion}
                                                onChange={(e) =>
                                                    setApplicationForm({
                                                        ...applicationForm,
                                                        consentPolicyVersion: e.target.value,
                                                    })
                                                }
                                                placeholder="v1"
                                                className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-400 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30"
                                            />
                                        </div>

                                        <div>
                                            <label htmlFor="consent-policy-url" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300">
                                                Policy URL (Optional)
                                            </label>
                                            <input
                                                id="consent-policy-url"
                                                type="url"
                                                value={applicationForm.consentPolicyUrl}
                                                onChange={(e) =>
                                                    setApplicationForm({
                                                        ...applicationForm,
                                                        consentPolicyUrl: e.target.value,
                                                    })
                                                }
                                                placeholder="https://yourcompany.com/privacy"
                                                className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-400 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-lg border border-cyan-300/20 bg-cyan-400/10 p-4 text-sm text-cyan-200 mt-4">
                                <p className="font-semibold mb-2">📧 Candidate Notifications</p>
                                <ul className="space-y-1 text-xs">
                                    <li>✓ Application confirmation email immediately</li>
                                    <li>✓ Assessment details 2 hours before start</li>
                                    <li>✓ Slot assignment confirmation</li>
                                </ul>
                            </div>
                        </div>

                        {/* ===== PUBLISH BUTTON ===== */}
                        <div className="flex gap-3">
                            <Link
                                href={`/organization/create-interview/part-2?interviewId=${interviewId}`}
                                className="inline-flex rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                            >
                                ← Back to Part 2
                            </Link>
                            <button
                                onClick={handlePublishInterview}
                                disabled={isPublishing}
                                className="ml-auto inline-flex rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-400 px-6 py-2 text-sm font-semibold text-[#041022] transition hover:shadow-lg hover:shadow-cyan-500/30 disabled:opacity-70"
                            >
                                {isPublishing ? "Publishing..." : "🚀 Publish Interview"}
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        {/* ===== SUCCESS STATE: APPLICATION LINK & DETAILS ===== */}
                        <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-6 backdrop-blur-xl sm:p-8 space-y-4">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20">
                                    <span className="text-lg">✓</span>
                                </div>
                                <div>
                                    <p className="font-semibold text-white">Interview Published!</p>
                                    <p className="text-xs text-emerald-300">Your interview is now live for candidates</p>
                                </div>
                            </div>

                            <div className="border-t border-emerald-300/20 pt-4 space-y-4">
                                {/* Application Link */}
                                <div>
                                    <p className="text-sm font-semibold text-white mb-2">Candidate Application Link</p>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            readOnly
                                            value={applicationLink || ""}
                                            className="flex-1 rounded-lg border border-emerald-300/30 bg-white/5 px-4 py-2.5 text-sm text-white"
                                        />
                                        <button
                                            onClick={handleCopyLink}
                                            className="rounded-lg border border-emerald-300/30 bg-emerald-500/20 px-4 py-2.5 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/30 transition"
                                        >
                                            Copy
                                        </button>
                                    </div>
                                </div>

                                {/* Validity Info */}
                                <div className="rounded-lg border border-emerald-300/20 bg-white/5 p-3">
                                    <p className="text-xs font-semibold text-slate-300 mb-1">📅 Application Valid Until</p>
                                    <p className="text-sm text-white font-medium">{validUntil}</p>
                                    <p className="text-xs text-emerald-300 mt-1">
                                        (24 hours before assessment starts)
                                    </p>
                                </div>

                                {/* Form Config Summary */}
                                <div className="rounded-lg border border-emerald-300/20 bg-white/5 p-3">
                                    <p className="text-xs font-semibold text-slate-300 mb-2">📋 Required Fields</p>
                                    <div className="space-y-1 text-xs text-slate-300">
                                        <p>{applicationForm.requireName ? "✓" : "○"} Candidate Name</p>
                                        <p>{applicationForm.requireEmail ? "✓" : "○"} Email Address</p>
                                        <p>{applicationForm.requirePhone ? "✓" : "○"} Phone Number</p>
                                        <p>{applicationForm.requireResume ? "✓" : "○"} Resume Upload</p>
                                        <p>✓ Consent Policy Version: {applicationForm.consentPolicyVersion || "v1"}</p>
                                        <p>
                                            {applicationForm.consentPolicyUrl ? "✓" : "○"} Consent Policy URL{applicationForm.consentPolicyUrl ? `: ${applicationForm.consentPolicyUrl}` : ""}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* ===== WHAT&apos;S NEXT ===== */}
                        <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
                            <h2 className="text-lg font-semibold text-white mb-4">What&apos;s Next?</h2>
                            <div className="space-y-3">
                                <div className="flex gap-3">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-500/20 text-xs font-bold text-cyan-300">
                                        1
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-white">Share the application link</p>
                                        <p className="text-xs text-slate-400">
                                            Send it to candidates via email or post on your careers page
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-500/20 text-xs font-bold text-cyan-300">
                                        2
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-white">Candidates apply & choose slots</p>
                                        <p className="text-xs text-slate-400">
                                            They fill the form and select up to 3 preferred time slots
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-500/20 text-xs font-bold text-cyan-300">
                                        3
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-white">Auto slot assignment</p>
                                        <p className="text-xs text-slate-400">
                                            System assigns candidates to slots 25 hours before assessment
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-500/20 text-xs font-bold text-cyan-300">
                                        4
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-white">Assessment & Interview</p>
                                        <p className="text-xs text-slate-400">
                                            Candidates take assessment (20 mins) followed by interview (40 mins)
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* ===== NAVIGATION ===== */}
                        <div className="flex gap-3">
                            <Link
                                href="/organization"
                                className="inline-flex rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                            >
                                ← Back to Dashboard
                            </Link>
                            <Link
                                href="/organization/manage-interviews"
                                className="ml-auto inline-flex rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-400 px-6 py-2 text-sm font-semibold text-[#041022] transition hover:shadow-lg hover:shadow-cyan-500/30"
                            >
                                View All Interviews →
                            </Link>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default function Part3Page() {
    return (
        <Suspense
            fallback={<div className="flex min-h-screen items-center justify-center bg-[#070b16] text-white">Loading...</div>}
        >
            <Part3Content />
        </Suspense>
    );
}
