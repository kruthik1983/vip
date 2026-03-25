"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getCurrentOrganizationAdmin } from "@/lib/organization-auth";
import { supabase } from "@/lib/supabase";

interface JobDetailsForm {
    positionTitle: string;
    jobDescription: string;
    skillsRequired: string;
    ctcMin: string;
    ctcMax: string;
    campaignStartDate: string;
    campaignStartTime: string;
    campaignEndDate: string;
    campaignEndTime: string;
}

export default function CreateInterviewPage() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const [jobDetails, setJobDetails] = useState<JobDetailsForm>({
        positionTitle: "",
        jobDescription: "",
        skillsRequired: "",
        ctcMin: "",
        ctcMax: "",
        campaignStartDate: "",
        campaignStartTime: "09:00",
        campaignEndDate: "",
        campaignEndTime: "17:00",
    });

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

            setIsLoading(false);
        }

        void loadOrganizationAdmin();

        return () => {
            mounted = false;
        };
    }, [router]);

    async function handleSavePart1() {
        setErrorMessage(null);

        // ===== CLIENT-SIDE VALIDATION =====
        if (!jobDetails.positionTitle.trim()) {
            setErrorMessage("Job position title is required.");
            return;
        }
        if (!jobDetails.jobDescription.trim()) {
            setErrorMessage("Job description is required.");
            return;
        }
        if (!jobDetails.skillsRequired.trim()) {
            setErrorMessage("Skills required is required.");
            return;
        }
        if (!jobDetails.ctcMin || !jobDetails.ctcMax) {
            setErrorMessage("CTC range is required.");
            return;
        }
        if (parseFloat(jobDetails.ctcMin) >= parseFloat(jobDetails.ctcMax)) {
            setErrorMessage("CTC Min must be less than CTC Max.");
            return;
        }
        if (!jobDetails.campaignStartDate || !jobDetails.campaignEndDate) {
            setErrorMessage("Interview window start and end dates are required.");
            return;
        }

        setIsSaving(true);

        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;

            if (!token) {
                setErrorMessage("No active session. Please sign in again.");
                setIsSaving(false);
                return;
            }

            // Build UTC datetime strings for campaign window
            const campaignStartDateTime = new Date(`${jobDetails.campaignStartDate}T${jobDetails.campaignStartTime}:00Z`);
            const campaignEndDateTime = new Date(`${jobDetails.campaignEndDate}T${jobDetails.campaignEndTime}:00Z`);

            const response = await fetch("/api/organization/interviews/part-1", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    positionTitle: jobDetails.positionTitle,
                    jobDescription: jobDetails.jobDescription,
                    skillsRequired: jobDetails.skillsRequired.split(",").map((s) => s.trim()),
                    ctcMin: parseFloat(jobDetails.ctcMin),
                    ctcMax: parseFloat(jobDetails.ctcMax),
                    campaignStartUtc: campaignStartDateTime.toISOString(),
                    campaignEndUtc: campaignEndDateTime.toISOString(),
                }),
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                setErrorMessage(result.error ?? "Unable to save Part 1. Please try again.");
                setIsSaving(false);
                return;
            }

            // Redirect to Part 2
            router.push(`/organization/create-interview/part-2?interviewId=${result.data?.interviewId}`);
        } catch (error) {
            setErrorMessage("An error occurred while saving Part 1. Please try again.");
            console.error(error);
            setIsSaving(false);
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
                    <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">Step 1 of 3</p>
                    <h1 className="mt-2 text-3xl font-semibold">Job Details & Interview Window</h1>
                    <p className="mt-2 text-sm text-slate-400">
                        Configure the job position and the time window for generating assessment/interview slots.
                    </p>
                </div>

                {/* Error Message */}
                {errorMessage ? (
                    <div className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                        {errorMessage}
                    </div>
                ) : null}

                {/* Form */}
                <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8 space-y-5">
                    {/* Position Title */}
                    <div>
                        <label className="block text-sm font-semibold text-white mb-2">
                            Job Position Title <span className="text-rose-400">*</span>
                        </label>
                        <input
                            type="text"
                            placeholder="e.g., Senior Software Engineer"
                            value={jobDetails.positionTitle}
                            onChange={(e) =>
                                setJobDetails({ ...jobDetails, positionTitle: e.target.value })
                            }
                            className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-white placeholder-slate-400 transition focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/30"
                        />
                    </div>

                    {/* Job Description */}
                    <div>
                        <label className="block text-sm font-semibold text-white mb-2">
                            Job Description <span className="text-rose-400">*</span>
                        </label>
                        <textarea
                            placeholder="Describe the job role, responsibilities, and requirements..."
                            value={jobDetails.jobDescription}
                            onChange={(e) =>
                                setJobDetails({ ...jobDetails, jobDescription: e.target.value })
                            }
                            rows={4}
                            className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-white placeholder-slate-400 transition focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 resize-none"
                        />
                    </div>

                    {/* Skills Required */}
                    <div>
                        <label className="block text-sm font-semibold text-white mb-2">
                            Skills Required <span className="text-rose-400">*</span>
                        </label>
                        <input
                            type="text"
                            placeholder="e.g., React, Node.js, PostgreSQL (comma-separated)"
                            value={jobDetails.skillsRequired}
                            onChange={(e) =>
                                setJobDetails({ ...jobDetails, skillsRequired: e.target.value })
                            }
                            className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-white placeholder-slate-400 transition focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/30"
                        />
                    </div>

                    {/* CTC Range */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-white mb-2">
                                CTC Min (₹) <span className="text-rose-400">*</span>
                            </label>
                            <input
                                type="number"
                                placeholder="e.g., 500000"
                                value={jobDetails.ctcMin}
                                onChange={(e) =>
                                    setJobDetails({ ...jobDetails, ctcMin: e.target.value })
                                }
                                className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-white placeholder-slate-400 transition focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/30"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-white mb-2">
                                CTC Max (₹) <span className="text-rose-400">*</span>
                            </label>
                            <input
                                type="number"
                                placeholder="e.g., 1000000"
                                value={jobDetails.ctcMax}
                                onChange={(e) =>
                                    setJobDetails({ ...jobDetails, ctcMax: e.target.value })
                                }
                                className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-white placeholder-slate-400 transition focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/30"
                            />
                        </div>
                    </div>

                    {/* Interview Window (Campaign Timeframe) */}
                    <div className="border-t border-white/10 pt-5">
                        <h3 className="text-sm font-semibold text-white mb-4">
                            Interview Window <span className="text-rose-400">*</span>
                        </h3>
                        <p className="text-xs text-slate-400 mb-4">
                            The date/time range for creating assessment and interview slots. Slots will be generated within this window.
                        </p>
                        <div className="grid grid-cols-2 gap-4 mb-4">
                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-2">
                                    Start Date
                                </label>
                                <input
                                    type="date"
                                    value={jobDetails.campaignStartDate}
                                    onChange={(e) =>
                                        setJobDetails({ ...jobDetails, campaignStartDate: e.target.value })
                                    }
                                    className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-white transition focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/30"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-2">
                                    Start Time (24h, UTC)
                                </label>
                                <input
                                    type="time"
                                    value={jobDetails.campaignStartTime}
                                    onChange={(e) =>
                                        setJobDetails({ ...jobDetails, campaignStartTime: e.target.value })
                                    }
                                    className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-white transition focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/30"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-2">
                                    End Date
                                </label>
                                <input
                                    type="date"
                                    value={jobDetails.campaignEndDate}
                                    onChange={(e) =>
                                        setJobDetails({ ...jobDetails, campaignEndDate: e.target.value })
                                    }
                                    className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-white transition focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/30"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-2">
                                    End Time (24h, UTC)
                                </label>
                                <input
                                    type="time"
                                    value={jobDetails.campaignEndTime}
                                    onChange={(e) =>
                                        setJobDetails({ ...jobDetails, campaignEndTime: e.target.value })
                                    }
                                    className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-white transition focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/30"
                                />
                            </div>
                        </div>
                        <p className="text-xs text-slate-400">
                            Assessment slots (20 min) and interview slots (40 min) will both be generated within this window in Part 2.
                        </p>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3">
                    <Link
                        href="/organization"
                        className="inline-flex rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                    >
                        Cancel
                    </Link>
                    <button
                        onClick={handleSavePart1}
                        disabled={isSaving}
                        className="ml-auto inline-flex rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-400 px-6 py-2 text-sm font-semibold text-[#041022] transition hover:shadow-lg hover:shadow-cyan-500/30 disabled:opacity-70"
                    >
                        {isSaving ? "Saving..." : "Next: Part 2"}
                    </button>
                </div>
            </div>
        </div>
    );
}
