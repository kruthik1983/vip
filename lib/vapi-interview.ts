import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type InterviewSessionRow = {
    id: number;
    application_id: number;
    started_at: string | null;
    ended_at: string | null;
    session_valid_from: string | null;
    session_valid_until: string | null;
    total_questions_asked: number | null;
    duration_seconds: number | null;
    status: string | null;
};

export function isSessionActive(validFrom: string | null, validUntil: string | null) {
    const now = Date.now();
    const fromTs = validFrom ? new Date(validFrom).getTime() : Number.NEGATIVE_INFINITY;
    const untilTs = validUntil ? new Date(validUntil).getTime() : Number.POSITIVE_INFINITY;
    return now >= fromTs && now <= untilTs;
}

export function getRemainingSeconds(validUntil: string | null) {
    if (!validUntil) {
        return null;
    }

    const remainingMs = new Date(validUntil).getTime() - Date.now();
    return Math.max(0, Math.floor(remainingMs / 1000));
}

export function parseSkills(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    return raw
        .map((item) => String(item || "").trim())
        .filter((skill) => skill.length > 0);
}

export function parseVapiToolAuth(request: NextRequest) {
    const expected = (process.env.VAPI_TOOL_SECRET || "").trim();
    if (!expected) {
        return {
            ok: false as const,
            status: 500,
            error: "VAPI_TOOL_SECRET is not configured",
        };
    }

    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

    if (!token || token !== expected) {
        return {
            ok: false as const,
            status: 401,
            error: "Unauthorized",
        };
    }

    return { ok: true as const };
}

export async function loadSessionByToken(sessionToken: string) {
    const { data, error } = await supabaseAdmin
        .from("interview_sessions")
        .select("id, application_id, started_at, ended_at, session_valid_from, session_valid_until, total_questions_asked, duration_seconds, status")
        .eq("session_token", sessionToken)
        .maybeSingle();

    if (error || !data) {
        return null;
    }

    return data as InterviewSessionRow;
}

export async function markInterviewInProgress(session: InterviewSessionRow, nowIso: string) {
    if (session.started_at || session.ended_at) {
        return;
    }

    await supabaseAdmin
        .from("interview_sessions")
        .update({ started_at: nowIso, status: "INTERVIEW_IN_PROGRESS" })
        .eq("id", session.id);

    await supabaseAdmin
        .from("applications")
        .update({ status: "INTERVIEW_IN_PROGRESS" })
        .eq("id", session.application_id);

    session.started_at = nowIso;
    session.status = "INTERVIEW_IN_PROGRESS";
}
