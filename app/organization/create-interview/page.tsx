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

            router.push(`/organization/create-interview/part-2?interviewId=${result.data?.interviewId}`);
        } catch (error) {
            setErrorMessage("An error occurred while saving Part 1. Please try again.");
            console.error(error);
            setIsSaving(false);
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
                    <p className="text-xs uppercase tracking-[0.18em] text-emerald-700">Step 1 of 3</p>
                    <h1 className="mt-2 text-3xl font-semibold">Job Details and Interview Window</h1>
                    <p className="mt-2 text-sm text-slate-600">Configure role details and campaign timeline for slot generation.</p>
                </div>

                {errorMessage ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</div> : null}

                <div className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.25)] sm:p-8 space-y-5">
                    <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-800">Job Position Title</label>
                        <input type="text" placeholder="e.g., Senior Software Engineer" value={jobDetails.positionTitle} onChange={(e) => setJobDetails({ ...jobDetails, positionTitle: e.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder-slate-400 transition focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/30" />
                    </div>

                    <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-800">Job Description</label>
                        <textarea placeholder="Describe role, responsibilities, and requirements" value={jobDetails.jobDescription} onChange={(e) => setJobDetails({ ...jobDetails, jobDescription: e.target.value })} rows={4} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder-slate-400 transition focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/30 resize-none" />
                    </div>

                    <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-800">Skills Required</label>
                        <input type="text" placeholder="React, Node.js, PostgreSQL" value={jobDetails.skillsRequired} onChange={(e) => setJobDetails({ ...jobDetails, skillsRequired: e.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder-slate-400 transition focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/30" />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="mb-2 block text-sm font-semibold text-slate-800">CTC Min (Rs)</label>
                            <input type="number" placeholder="500000" value={jobDetails.ctcMin} onChange={(e) => setJobDetails({ ...jobDetails, ctcMin: e.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder-slate-400 transition focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/30" />
                        </div>
                        <div>
                            <label className="mb-2 block text-sm font-semibold text-slate-800">CTC Max (Rs)</label>
                            <input type="number" placeholder="1000000" value={jobDetails.ctcMax} onChange={(e) => setJobDetails({ ...jobDetails, ctcMax: e.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder-slate-400 transition focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/30" />
                        </div>
                    </div>

                    <div className="border-t border-slate-200 pt-5">
                        <h3 className="mb-4 text-sm font-semibold text-slate-900">Interview Window</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="mb-2 block text-xs font-medium text-slate-600">Start Date</label>
                                <input type="date" value={jobDetails.campaignStartDate} onChange={(e) => setJobDetails({ ...jobDetails, campaignStartDate: e.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 transition focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/30" />
                            </div>
                            <div>
                                <label className="mb-2 block text-xs font-medium text-slate-600">Start Time (24h, UTC)</label>
                                <input type="time" value={jobDetails.campaignStartTime} onChange={(e) => setJobDetails({ ...jobDetails, campaignStartTime: e.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 transition focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/30" />
                            </div>
                            <div>
                                <label className="mb-2 block text-xs font-medium text-slate-600">End Date</label>
                                <input type="date" value={jobDetails.campaignEndDate} onChange={(e) => setJobDetails({ ...jobDetails, campaignEndDate: e.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 transition focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/30" />
                            </div>
                            <div>
                                <label className="mb-2 block text-xs font-medium text-slate-600">End Time (24h, UTC)</label>
                                <input type="time" value={jobDetails.campaignEndTime} onChange={(e) => setJobDetails({ ...jobDetails, campaignEndTime: e.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 transition focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/30" />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex gap-3">
                    <Link href="/organization" className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50">Cancel</Link>
                    <button onClick={handleSavePart1} disabled={isSaving} className="ml-auto inline-flex rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 px-6 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-70">{isSaving ? "Saving..." : "Next: Part 2"}</button>
                </div>
            </div>
        </div>
    );
}
