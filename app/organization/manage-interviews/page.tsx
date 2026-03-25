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
                .select(
                    "id, title, status, campaign_start_utc, campaign_end_utc, created_at, published_at, jobs(position_title)",
                )
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
            const campaignStart = interview.campaign_start_utc
                ? new Date(interview.campaign_start_utc)
                : null;

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
        if (status === "PUBLISHED") {
            return "border-emerald-400/40 bg-emerald-400/10 text-emerald-200";
        }

        if (status === "IN_PROGRESS") {
            return "border-cyan-400/40 bg-cyan-400/10 text-cyan-200";
        }

        if (status === "LOCKED") {
            return "border-amber-400/40 bg-amber-400/10 text-amber-200";
        }

        if (status === "CLOSED") {
            return "border-slate-300/30 bg-slate-400/10 text-slate-200";
        }

        return "border-violet-400/40 bg-violet-400/10 text-violet-200";
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
            <div className="flex min-h-screen items-center justify-center bg-[#070b16] text-white">
                <p className="text-sm text-slate-300">Loading interviews...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#070b16] px-6 py-10 text-white lg:px-10">
            <div className="mx-auto max-w-6xl space-y-6">
                <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
                    <p className="text-xs uppercase tracking-[0.18em] text-emerald-200">Manage Interview</p>
                    <h1 className="mt-2 text-3xl font-semibold">Manage Interviews</h1>
                    <p className="mt-2 text-sm text-slate-300">
                        Search and filter your created interviews by job title, status, and timeline.
                    </p>
                </div>

                {errorMessage ? (
                    <div className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                        {errorMessage}
                    </div>
                ) : null}

                <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
                    <div className="grid gap-4 md:grid-cols-3">
                        <div className="md:col-span-1">
                            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-300">
                                Search Job
                            </label>
                            <input
                                type="text"
                                value={searchText}
                                onChange={(event) => setSearchText(event.target.value)}
                                placeholder="Search by job title"
                                className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-slate-400 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30"
                            />
                        </div>

                        <div>
                            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-300">
                                Status Filter
                            </label>
                            <select
                                value={statusFilter}
                                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                                className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30"
                            >
                                <option value="ALL">All Statuses</option>
                                <option value="DRAFT">Draft</option>
                                <option value="PUBLISHED">Published</option>
                                <option value="LOCKED">Locked</option>
                                <option value="IN_PROGRESS">In Progress</option>
                                <option value="CLOSED">Closed</option>
                            </select>
                        </div>

                        <div>
                            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-300">
                                Time Filter
                            </label>
                            <select
                                value={timeFilter}
                                onChange={(event) => setTimeFilter(event.target.value as TimeFilter)}
                                className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30"
                            >
                                <option value="ALL">All</option>
                                <option value="UPCOMING">Upcoming</option>
                                <option value="PAST">Past</option>
                            </select>
                        </div>
                    </div>
                </div>

                {filteredInterviews.length === 0 ? (
                    <div className="rounded-2xl border border-white/15 bg-white/5 p-8 text-center backdrop-blur-xl">
                        <p className="text-base font-semibold text-white">No interviews found</p>
                        <p className="mt-1 text-sm text-slate-400">
                            Create a new interview or adjust your search and filters.
                        </p>
                        <Link
                            href="/organization/create-interview"
                            className="mt-4 inline-flex rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-400 px-4 py-2 text-sm font-semibold text-[#041022] transition hover:brightness-110"
                        >
                            Create Interview
                        </Link>
                    </div>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {filteredInterviews.map((interview) => (
                            <div
                                key={interview.id}
                                className="rounded-2xl border border-white/15 bg-white/5 p-5 backdrop-blur-xl transition hover:border-cyan-300/40 hover:bg-white/10"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <h2 className="line-clamp-2 text-lg font-semibold text-white">
                                        {interview.jobs?.position_title ?? interview.title}
                                    </h2>
                                    <span
                                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(
                                            interview.status,
                                        )}`}
                                    >
                                        {interview.status ?? "DRAFT"}
                                    </span>
                                </div>

                                <p className="mt-2 line-clamp-1 text-sm text-slate-400">{interview.title}</p>

                                <div className="mt-4 space-y-1.5 text-sm text-slate-300">
                                    <p>
                                        <span className="text-slate-400">Campaign Start:</span>{" "}
                                        {interview.campaign_start_utc ? formatDateTime(interview.campaign_start_utc) : "-"}
                                    </p>
                                    <p>
                                        <span className="text-slate-400">Campaign End:</span>{" "}
                                        {interview.campaign_end_utc ? formatDateTime(interview.campaign_end_utc) : "-"}
                                    </p>
                                    <p>
                                        <span className="text-slate-400">Created:</span>{" "}
                                        {interview.created_at ? formatDateTime(interview.created_at) : "-"}
                                    </p>
                                </div>

                                <div className="mt-5 flex items-center gap-2">
                                    <Link
                                        href={`/organization/manage-interviews/${interview.id}`}
                                        className="inline-flex rounded-lg border border-cyan-300/30 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-400/20"
                                    >
                                        View
                                    </Link>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <Link
                    href="/organization"
                    className="inline-flex rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                    Back to Dashboard
                </Link>
            </div>
        </div>
    );
}
