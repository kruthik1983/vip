"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getCurrentOrganizationAdmin } from "@/lib/organization-auth";
import { fromTable, type TableRow } from "@/lib/supabase";
import type { InterviewStatus } from "@/utils/database.interfaces";

type InterviewWithJob = Pick<
    TableRow<"interviews">,
    "id" | "title" | "status" | "campaign_start_utc" | "campaign_end_utc" | "created_at" | "published_at"
> & {
    jobs: Pick<TableRow<"jobs">, "position_title"> | null;
};

type StatusFilter = "ALL" | NonNullable<InterviewStatus>;
type TimeFilter = "ALL" | "UPCOMING" | "PAST";

export default function ManageInterviewsPage() {
    const [isLoading, setIsLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [interviews, setInterviews] = useState<InterviewWithJob[]>([]);
    const [searchText, setSearchText] = useState("");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
    const [timeFilter, setTimeFilter] = useState<TimeFilter>("ALL");

    useEffect(() => {
        let mounted = true;

        async function loadInterviews() {
            setIsLoading(true);
            setErrorMessage(null);

            const currentAdmin = await getCurrentOrganizationAdmin();

            if (!mounted) {
                return;
            }

            if (!currentAdmin || !currentAdmin.organization_id) {
                setErrorMessage("Please sign in as an organization admin to view interviews.");
                setIsLoading(false);
                return;
            }

            const { data, error } = await fromTable("interviews")
                .select("id, title, status, campaign_start_utc, campaign_end_utc, created_at, published_at, jobs(position_title)")
                .eq("organization_id", currentAdmin.organization_id)
                .order("created_at", { ascending: false });

            if (!mounted) {
                return;
            }

            if (error) {
                setErrorMessage("Unable to load interviews right now. Please try again.");
                setIsLoading(false);
                return;
            }

            setInterviews((data ?? []) as unknown as InterviewWithJob[]);
            setIsLoading(false);
        }

        void loadInterviews();

        return () => {
            mounted = false;
        };
    }, []);

    const filteredInterviews = useMemo(() => {
        const now = new Date();
        const normalizedSearch = searchText.trim().toLowerCase();

        return interviews.filter((interview) => {
            const positionTitle = interview.jobs?.position_title ?? "";
            const title = interview.title ?? "";
            const status = interview.status ?? "DRAFT";
            const campaignStart = interview.campaign_start_utc ? new Date(interview.campaign_start_utc) : null;

            const matchesSearch =
                normalizedSearch.length === 0 ||
                positionTitle.toLowerCase().includes(normalizedSearch) ||
                title.toLowerCase().includes(normalizedSearch);

            const matchesStatus = statusFilter === "ALL" || status === statusFilter;

            const matchesTime =
                timeFilter === "ALL" ||
                (timeFilter === "UPCOMING" && campaignStart !== null && campaignStart >= now) ||
                (timeFilter === "PAST" && campaignStart !== null && campaignStart < now);

            return matchesSearch && matchesStatus && matchesTime;
        });
    }, [interviews, searchText, statusFilter, timeFilter]);

    function statusBadgeClass(status: NonNullable<InterviewStatus> | null) {
        if (status === "PUBLISHED") return "border-emerald-200 bg-emerald-50 text-emerald-700";
        if (status === "IN_PROGRESS") return "border-cyan-200 bg-cyan-50 text-cyan-700";
        if (status === "LOCKED") return "border-amber-200 bg-amber-50 text-amber-700";
        if (status === "CLOSED") return "border-slate-200 bg-slate-100 text-slate-700";
        return "border-violet-200 bg-violet-50 text-violet-700";
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

    if (isLoading) {
        return (
            <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f3f9f7] text-slate-900">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(16,185,129,0.18),transparent_35%),radial-gradient(circle_at_84%_16%,rgba(56,189,248,0.18),transparent_35%),radial-gradient(circle_at_50%_100%,rgba(20,184,166,0.10),transparent_44%)]" />
                <div className="relative rounded-2xl border border-slate-200 bg-white/85 px-6 py-4 shadow-lg backdrop-blur"><p className="text-sm text-slate-600">Loading interviews...</p></div>
            </div>
        );
    }

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#f3f9f7] px-6 py-10 text-slate-900 lg:px-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(16,185,129,0.18),transparent_35%),radial-gradient(circle_at_84%_16%,rgba(56,189,248,0.18),transparent_35%),radial-gradient(circle_at_50%_100%,rgba(20,184,166,0.10),transparent_44%)]" />
            <div className="relative mx-auto max-w-6xl space-y-6">
                <div className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.35)] sm:p-8">
                    <p className="text-xs uppercase tracking-[0.18em] text-emerald-700">Manage Interviews</p>
                    <h1 className="mt-2 text-3xl font-semibold">Interview Operations</h1>
                    <p className="mt-2 text-sm text-slate-600">Search and filter interviews by role, status, and timeline.</p>
                </div>

                {errorMessage ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</div> : null}

                <div className="rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.25)] sm:p-8">
                    <div className="grid gap-4 md:grid-cols-3">
                        <div className="md:col-span-1">
                            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Search Job</label>
                            <input type="text" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search by job title" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/30" />
                        </div>
                        <div>
                            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Status Filter</label>
                            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/30">
                                <option value="ALL">All Statuses</option>
                                <option value="DRAFT">Draft</option>
                                <option value="PUBLISHED">Published</option>
                                <option value="LOCKED">Locked</option>
                                <option value="IN_PROGRESS">In Progress</option>
                                <option value="CLOSED">Closed</option>
                            </select>
                        </div>
                        <div>
                            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Time Filter</label>
                            <select value={timeFilter} onChange={(event) => setTimeFilter(event.target.value as TimeFilter)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/30">
                                <option value="ALL">All</option>
                                <option value="UPCOMING">Upcoming</option>
                                <option value="PAST">Past</option>
                            </select>
                        </div>
                    </div>
                </div>

                {filteredInterviews.length === 0 ? (
                    <div className="rounded-3xl border border-slate-200 bg-white/92 p-8 text-center shadow-[0_20px_70px_-34px_rgba(15,23,42,0.25)]">
                        <p className="text-base font-semibold text-slate-900">No interviews found</p>
                        <p className="mt-1 text-sm text-slate-500">Create a new interview or adjust your filters.</p>
                        <Link href="/organization/create-interview" className="mt-4 inline-flex rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110">Create Interview</Link>
                    </div>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {filteredInterviews.map((interview) => (
                            <div key={interview.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_16px_45px_-34px_rgba(15,23,42,0.5)] transition hover:border-emerald-200 hover:shadow-md">
                                <div className="flex items-start justify-between gap-3">
                                    <h2 className="line-clamp-2 text-lg font-semibold text-slate-900">{interview.jobs?.position_title ?? interview.title}</h2>
                                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(interview.status)}`}>{interview.status ?? "DRAFT"}</span>
                                </div>
                                <p className="mt-2 line-clamp-1 text-sm text-slate-500">{interview.title}</p>
                                <div className="mt-4 space-y-1.5 text-sm text-slate-700">
                                    <p><span className="text-slate-500">Campaign Start:</span> {interview.campaign_start_utc ? formatDateTime(interview.campaign_start_utc) : "-"}</p>
                                    <p><span className="text-slate-500">Campaign End:</span> {interview.campaign_end_utc ? formatDateTime(interview.campaign_end_utc) : "-"}</p>
                                    <p><span className="text-slate-500">Created:</span> {interview.created_at ? formatDateTime(interview.created_at) : "-"}</p>
                                </div>
                                <div className="mt-5 flex items-center gap-2"><Link href={`/organization/manage-interviews/${interview.id}`} className="inline-flex rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100">View</Link></div>
                            </div>
                        ))}
                    </div>
                )}

                <Link href="/organization" className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50">Back to Dashboard</Link>
            </div>
        </div>
    );
}
