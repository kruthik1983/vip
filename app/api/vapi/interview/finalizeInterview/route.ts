import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadSessionByToken, parseVapiToolAuth } from "@/lib/vapi-interview";

export async function POST(request: NextRequest) {
    try {
        const auth = parseVapiToolAuth(request);
        if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
        }

        const body = await request.json();
        const sessionToken = String(body?.sessionToken || "").trim();
        const reason = String(body?.reason || "completed").trim();

        if (!sessionToken) {
            return NextResponse.json({ ok: false, error: "sessionToken is required" }, { status: 400 });
        }

        const session = await loadSessionByToken(sessionToken);
        if (!session) {
            return NextResponse.json({ ok: false, error: "Invalid interview session token" }, { status: 404 });
        }

        const { count: totalQuestionsAsked } = await supabaseAdmin
            .from("interview_responses")
            .select("id", { head: true, count: "exact" })
            .eq("interview_session_id", session.id);

        if (session.ended_at) {
            return NextResponse.json({
                ok: true,
                finalized: true,
                status: session.status || "COMPLETED",
                reason: "already-finalized",
                totalQuestionsAsked: totalQuestionsAsked ?? session.total_questions_asked ?? 0,
                durationSeconds: session.duration_seconds ?? 0,
            });
        }

        const endedAt = new Date().toISOString();
        const startedAt = session.started_at || endedAt;
        const durationSeconds = Math.max(
            0,
            Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000),
        );

        const finalStatus = (totalQuestionsAsked ?? 0) > 0 ? "COMPLETED" : "NO_SHOW";

        const { error: updateError } = await supabaseAdmin
            .from("interview_sessions")
            .update({
                started_at: startedAt,
                ended_at: endedAt,
                status: finalStatus,
                total_questions_asked: totalQuestionsAsked ?? 0,
                duration_seconds: durationSeconds,
            })
            .eq("id", session.id);

        if (updateError) {
            return NextResponse.json({ ok: false, error: "Failed to finalize interview" }, { status: 500 });
        }

        await supabaseAdmin
            .from("applications")
            .update({ status: finalStatus })
            .eq("id", session.application_id);

        return NextResponse.json({
            ok: true,
            finalized: true,
            status: finalStatus,
            reason,
            totalQuestionsAsked: totalQuestionsAsked ?? 0,
            durationSeconds,
        });
    } catch (error) {
        console.error("VAPI finalizeInterview error:", error);
        return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
    }
}
