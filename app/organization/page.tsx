"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getCurrentOrganizationAdmin, signOutOrganizationAdmin } from "@/lib/organization-auth";
import { fromTable, supabase, type TableRow } from "@/lib/supabase";

type VerificationStatus = "PENDING_SUBMISSION" | "SUBMITTED" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED";

type DashboardInterview = Pick<
    TableRow<"interviews">,
    "id" | "title" | "status" | "campaign_start_utc" | "campaign_end_utc" | "created_at" | "published_at" | "locked_at"
> & {
    jobs: Array<Pick<TableRow<"jobs">, "position_title">> | null;
};

type DashboardApplication = Pick<
    TableRow<"applications">,
    "id" | "interview_id" | "candidate_name" | "status" | "created_at" | "updated_at"
>;

type DashboardStat = {
    label: string;
    value: string;
    hint: string;
    tone: "emerald" | "cyan" | "amber" | "rose" | "slate";
};

type ActivityItem = {
    title: string;
    detail: string;
    timeLabel: string;
    tone: "emerald" | "cyan" | "amber" | "rose" | "slate";
};

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
    const [interviews, setInterviews] = useState<DashboardInterview[]>([]);
    const [applications, setApplications] = useState<DashboardApplication[]>([]);
    const [dashboardError, setDashboardError] = useState<string | null>(null);

    const isVerified = verificationStatus === "ACCEPTED";
    const badge = useMemo(() => statusMeta(verificationStatus), [verificationStatus]);

    const interviewMap = useMemo(() => {
        return new Map(interviews.map((interview) => [interview.id, interview]));
    }, [interviews]);

    const stats = useMemo<DashboardStat[]>(() => {
        const totalInterviews = interviews.length;
        const publishedInterviews = interviews.filter((interview) => interview.status === "PUBLISHED").length;
        const inProgressInterviews = interviews.filter((interview) => interview.status === "IN_PROGRESS").length;
        const draftInterviews = interviews.filter((interview) => interview.status === "DRAFT").length;
        const totalApplications = applications.length;
        const completedApplications = applications.filter((application) => application.status === "COMPLETED").length;

        return [
            { label: "Interviews", value: String(totalInterviews), hint: "Total interview setups", tone: "emerald" },
            { label: "Published", value: String(publishedInterviews), hint: "Ready for candidates", tone: "cyan" },
            { label: "In Progress", value: String(inProgressInterviews), hint: "Active campaign windows", tone: "amber" },
            { label: "Drafts", value: String(draftInterviews), hint: "Not yet published", tone: "slate" },
            { label: "Candidates", value: String(totalApplications), hint: "Applications in pipeline", tone: "emerald" },
            { label: "Completed", value: String(completedApplications), hint: "Pipeline closed", tone: "rose" },
        ];
    }, [applications, interviews]);

    const recentActivity = useMemo<ActivityItem[]>(() => {
        const items: ActivityItem[] = [];

        interviews.slice(0, 3).forEach((interview) => {
            const title = interview.jobs?.[0]?.position_title ?? interview.title;
            const stateLabel = interview.status ?? "DRAFT";
            items.push({
                title: stateLabel === "PUBLISHED" ? "Interview published" : stateLabel === "IN_PROGRESS" ? "Interview live" : "Interview updated",
                detail: title,
                timeLabel: interview.published_at ?? interview.created_at ?? "",
                tone: stateLabel === "PUBLISHED" ? "emerald" : stateLabel === "IN_PROGRESS" ? "cyan" : "slate",
            });
        });

        applications.slice(0, 3).forEach((application) => {
            const interview = interviewMap.get(application.interview_id);
            items.push({
                title: `${application.candidate_name} applied`,
                detail: interview?.jobs?.[0]?.position_title ?? interview?.title ?? "Interview",
                timeLabel: application.created_at ?? application.updated_at ?? "",
                tone: application.status === "COMPLETED" ? "emerald" : application.status === "INTERVIEW_IN_PROGRESS" ? "amber" : "cyan",
            });
        });

        return items
            .filter((item) => item.timeLabel.length > 0)
            .sort((first, second) => new Date(second.timeLabel).getTime() - new Date(first.timeLabel).getTime())
            .slice(0, 6);
    }, [applications, interviewMap, interviews]);

    const candidateQueue = useMemo(() => {
        return applications.slice(0, 4).map((application) => {
            const interview = interviewMap.get(application.interview_id);
            return {
                id: application.id,
                candidateName: application.candidate_name,
                interviewTitle: interview?.jobs?.[0]?.position_title ?? interview?.title ?? "Interview",
                status: application.status ?? "APPLIED",
                timeLabel: application.updated_at ?? application.created_at ?? "",
            };
        });
    }, [applications, interviewMap]);

    const nextSteps = useMemo(() => {
        const steps = [
            {
                title: isVerified ? "Create a new interview" : "Complete verification",
                description: isVerified ? "Define a role, add slots, and publish." : "Finish your organization profile to unlock publishing.",
                href: isVerified ? "/organization/create-interview" : "/organization/profile",
            },
            {
                title: "Review interview pipeline",
                description: "Open the interview manager to see live candidates, statuses, and timelines.",
                href: "/organization/manage-interviews",
            },
            {
                title: "Update organization profile",
                description: "Keep your company info and verification details current.",
                href: "/organization/profile",
            },
        ];

        return steps;
    }, [isVerified]);

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
            setDashboardError(null);

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
            } else if (!response.ok) {
                setDashboardError(result.error ?? "Unable to load organization verification status.");
            }

            const organizationId = currentOrganizationAdmin.organization_id;

            if (organizationId) {
                const { data: interviewRows, error: interviewError } = await fromTable("interviews")
                    .select("id, title, status, campaign_start_utc, campaign_end_utc, created_at, published_at, locked_at, jobs(position_title)")
                    .eq("organization_id", organizationId)
                    .order("created_at", { ascending: false });

                if (!mounted) {
                    return;
                }

                if (!interviewError) {
                    const normalizedInterviews = (interviewRows ?? []) as DashboardInterview[];
                    setInterviews(normalizedInterviews);

                    const interviewIds = normalizedInterviews.map((interview) => interview.id);
                    if (interviewIds.length > 0) {
                        const { data: applicationRows, error: applicationError } = await fromTable("applications")
                            .select("id, interview_id, candidate_name, status, created_at, updated_at")
                            .in("interview_id", interviewIds)
                            .order("created_at", { ascending: false });

                        if (!mounted) {
                            return;
                        }

                        if (!applicationError) {
                            setApplications((applicationRows ?? []) as DashboardApplication[]);
                        }
                    } else {
                        setApplications([]);
                    }
                } else {
                    setDashboardError("Unable to load the interview dashboard right now.");
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

    function toneClasses(tone: DashboardStat["tone"]) {
        if (tone === "emerald") return "border-emerald-200 bg-emerald-50 text-emerald-700";
        if (tone === "cyan") return "border-cyan-200 bg-cyan-50 text-cyan-700";
        if (tone === "amber") return "border-amber-200 bg-amber-50 text-amber-700";
        if (tone === "rose") return "border-rose-200 bg-rose-50 text-rose-700";
        return "border-slate-200 bg-slate-50 text-slate-700";
    }

    function formatDateTime(value: string) {
        return new Date(value).toLocaleString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
        });
    }

    const heroSubtitle = isVerified
        ? "Monitor live interviews, manage candidate flow, and keep your pipeline moving."
        : "Complete verification to unlock publishing, candidate management, and interview tracking.";

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#f3f9f7] px-6 py-10 text-slate-900 lg:px-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(16,185,129,0.18),transparent_35%),radial-gradient(circle_at_84%_16%,rgba(56,189,248,0.18),transparent_35%),radial-gradient(circle_at_50%_100%,rgba(20,184,166,0.10),transparent_44%)]" />

            <div className="relative mx-auto max-w-6xl space-y-6">
                <div className="rounded-[2rem] border border-slate-200 bg-white/90 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.45)] backdrop-blur sm:p-8">
                    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                        <div className="max-w-3xl">
                            <p className="text-xs uppercase tracking-[0.18em] text-emerald-700">Organization Dashboard</p>
                            <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Welcome, {organizationAdmin?.email}</h1>
                            <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">{heroSubtitle}</p>
                            <div className={`mt-5 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${badge.className}`}>{badge.label}</div>
                        </div>

                        <div className="flex flex-wrap gap-3">
                            <Link href="/organization/create-interview" className="inline-flex rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110">
                                Create interview
                            </Link>
                            <Link href="/organization/manage-interviews" className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50">
                                View pipeline
                            </Link>
                            <button type="button" onClick={handleSignOut} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100">
                                Sign out
                            </button>
                        </div>
                    </div>

                    {dashboardError ? (
                        <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                            {dashboardError}
                        </div>
                    ) : null}
                </div>

                {!isVerified ? (
                    <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
                        <div className="rounded-[2rem] border border-amber-200 bg-amber-50 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.25)] sm:p-8">
                            <p className="text-xs uppercase tracking-[0.18em] text-amber-700">Verification required</p>
                            <h2 className="mt-2 text-2xl font-semibold text-amber-950">Unlock the dashboard by completing profile verification</h2>
                            <p className="mt-3 max-w-2xl text-sm leading-6 text-amber-900/80">Current status: {badge.label}. Once verified, you can publish interviews, monitor candidates, and manage the pipeline from one place.</p>
                            <div className="mt-5 flex flex-wrap gap-3">
                                <Link href="/organization/profile" className="inline-flex rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110">
                                    Complete profile
                                </Link>
                                <Link href="/organization/manage-interviews" className="inline-flex rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100">
                                    Review pipeline
                                </Link>
                            </div>
                        </div>

                        <div className="rounded-[2rem] border border-slate-200 bg-white/92 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.25)] sm:p-8">
                            <h3 className="text-lg font-semibold text-slate-900">Quick next steps</h3>
                            <div className="mt-4 space-y-3 text-sm text-slate-700">
                                {nextSteps.map((step) => (
                                    <Link key={step.title} href={step.href} className="block rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-emerald-200 hover:bg-white">
                                        <p className="font-semibold text-slate-900">{step.title}</p>
                                        <p className="mt-1 leading-6 text-slate-600">{step.description}</p>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    </section>
                ) : (
                    <>
                        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {stats.map((stat) => (
                                <div key={stat.label} className={`rounded-[1.75rem] border p-5 shadow-[0_16px_45px_-34px_rgba(15,23,42,0.45)] ${toneClasses(stat.tone)}`}>
                                    <p className="text-xs uppercase tracking-[0.18em] opacity-70">{stat.label}</p>
                                    <p className="mt-3 text-3xl font-semibold text-slate-950">{stat.value}</p>
                                    <p className="mt-2 text-sm opacity-80">{stat.hint}</p>
                                </div>
                            ))}
                        </section>

                        <section className="grid gap-6 lg:grid-cols-[1.35fr_0.95fr]">
                            <div className="rounded-[2rem] border border-slate-200 bg-white/92 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.25)] sm:p-8">
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <p className="text-xs uppercase tracking-[0.18em] text-emerald-700">Recent activity</p>
                                        <h2 className="mt-2 text-2xl font-semibold text-slate-900">Pipeline movement</h2>
                                    </div>
                                    <Link href="/organization/manage-interviews" className="text-sm font-semibold text-emerald-700 hover:text-emerald-800">
                                        View all
                                    </Link>
                                </div>

                                <div className="mt-5 space-y-3">
                                    {recentActivity.length > 0 ? recentActivity.map((item) => (
                                        <div key={`${item.title}-${item.timeLabel}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <p className="text-sm font-semibold text-slate-950">{item.title}</p>
                                                    <p className="mt-1 text-sm text-slate-600">{item.detail}</p>
                                                </div>
                                                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${toneClasses(item.tone)}`}>
                                                    {formatDateTime(item.timeLabel)}
                                                </span>
                                            </div>
                                        </div>
                                    )) : (
                                        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
                                            Recent activity will appear here once interviews and applications start moving.
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="rounded-[2rem] border border-slate-200 bg-white/92 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.25)] sm:p-8">
                                    <p className="text-xs uppercase tracking-[0.18em] text-cyan-700">Candidate queue</p>
                                    <h2 className="mt-2 text-2xl font-semibold text-slate-900">Latest candidates</h2>

                                    <div className="mt-4 space-y-3">
                                        {candidateQueue.length > 0 ? candidateQueue.map((candidate) => (
                                            <div key={candidate.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <p className="text-sm font-semibold text-slate-950">{candidate.candidateName}</p>
                                                        <p className="mt-1 text-sm text-slate-600">{candidate.interviewTitle}</p>
                                                    </div>
                                                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${toneClasses(candidate.status === "COMPLETED" ? "emerald" : candidate.status === "INTERVIEW_IN_PROGRESS" ? "amber" : "cyan")}`}>
                                                        {candidate.status ?? "APPLIED"}
                                                    </span>
                                                </div>
                                            </div>
                                        )) : (
                                            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
                                                Candidate activity will show here once people start applying.
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="rounded-[2rem] border border-slate-200 bg-white/92 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.25)] sm:p-8">
                                    <p className="text-xs uppercase tracking-[0.18em] text-amber-700">Quick actions</p>
                                    <h2 className="mt-2 text-2xl font-semibold text-slate-900">Jump right in</h2>

                                    <div className="mt-4 grid gap-3">
                                        <Link href="/organization/create-interview" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-emerald-200 hover:bg-white">
                                            <p className="font-semibold text-slate-950">Create interview</p>
                                            <p className="mt-1 text-sm text-slate-600">Set up the next role and publish it.</p>
                                        </Link>
                                        <Link href="/organization/manage-interviews" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-cyan-200 hover:bg-white">
                                            <p className="font-semibold text-slate-950">Manage pipeline</p>
                                            <p className="mt-1 text-sm text-slate-600">Review interviews, candidates, and timelines.</p>
                                        </Link>
                                        <Link href="/organization/profile" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-teal-200 hover:bg-white">
                                            <p className="font-semibold text-slate-950">Profile & verification</p>
                                            <p className="mt-1 text-sm text-slate-600">Keep your org details and approval status current.</p>
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                            <div className="rounded-[2rem] border border-slate-200 bg-white/92 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.25)] sm:p-8">
                                <p className="text-xs uppercase tracking-[0.18em] text-emerald-700">Interviews</p>
                                <h2 className="mt-2 text-2xl font-semibold text-slate-900">Latest interview setups</h2>

                                <div className="mt-4 grid gap-4 md:grid-cols-2">
                                    {interviews.length > 0 ? interviews.slice(0, 4).map((interview) => (
                                        <div key={interview.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <p className="text-base font-semibold text-slate-950">{interview.jobs?.[0]?.position_title ?? interview.title}</p>
                                                    <p className="mt-1 text-sm text-slate-600">{interview.title}</p>
                                                </div>
                                                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${toneClasses(interview.status === "PUBLISHED" ? "emerald" : interview.status === "IN_PROGRESS" ? "cyan" : interview.status === "LOCKED" ? "amber" : "slate")}`}>
                                                    {interview.status ?? "DRAFT"}
                                                </span>
                                            </div>
                                            <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                                                <p>Start: {interview.campaign_start_utc ? formatDateTime(interview.campaign_start_utc) : "-"}</p>
                                                <p>End: {interview.campaign_end_utc ? formatDateTime(interview.campaign_end_utc) : "-"}</p>
                                            </div>
                                            <div className="mt-4 flex flex-wrap gap-2">
                                                <Link href={`/organization/manage-interviews/${interview.id}`} className="inline-flex rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100">
                                                    Open
                                                </Link>
                                            </div>
                                        </div>
                                    )) : (
                                        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600 md:col-span-2">
                                            No interviews yet. Create one to start seeing pipeline metrics here.
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="rounded-[2rem] border border-slate-200 bg-white/92 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.25)] sm:p-8">
                                <p className="text-xs uppercase tracking-[0.18em] text-amber-700">Plan</p>
                                <h2 className="mt-2 text-2xl font-semibold text-slate-900">Suggested next steps</h2>
                                <div className="mt-4 space-y-3">
                                    {nextSteps.map((step) => (
                                        <Link key={step.title} href={step.href} className="block rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-emerald-200 hover:bg-white">
                                            <p className="font-semibold text-slate-950">{step.title}</p>
                                            <p className="mt-1 text-sm leading-6 text-slate-600">{step.description}</p>
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        </section>

                        <div className="grid gap-4 sm:grid-cols-3">
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
                    </>
                )}
            </div>
        </div>
    );
}
