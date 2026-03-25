import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
    getRemainingSeconds,
    isSessionActive,
    loadSessionByToken,
    markInterviewInProgress,
    parseVapiToolAuth,
} from "@/lib/vapi-interview";

export async function POST(request: NextRequest) {
    try {
        const auth = parseVapiToolAuth(request);
        if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
        }

        const body = await request.json();
        const sessionToken = String(body?.sessionToken || "").trim();
        const questionText = String(body?.questionText || "").trim();
        const candidateAnswer = String(body?.candidateAnswer || "").trim();

        if (!sessionToken || !questionText || !candidateAnswer) {
            return NextResponse.json(
                { ok: false, error: "sessionToken, questionText and candidateAnswer are required" },
                { status: 400 },
            );
        }

        const session = await loadSessionByToken(sessionToken);
        if (!session) {
            return NextResponse.json({ ok: false, error: "Invalid interview session token" }, { status: 404 });
        }

        if (session.ended_at) {
            return NextResponse.json({ ok: false, error: "Interview already finalized" }, { status: 400 });
        }

        if (!isSessionActive(session.session_valid_from, session.session_valid_until)) {
            return NextResponse.json({ ok: false, error: "Interview time is over" }, { status: 400 });
        }

        const nowIso = new Date().toISOString();
        await markInterviewInProgress(session, nowIso);

        const { data: existing } = await supabaseAdmin
            .from("interview_responses")
            .select("id, question_text, candidate_answer")
            .eq("interview_session_id", session.id)
            .eq("question_text", questionText)
            .eq("candidate_answer", candidateAnswer)
            .limit(1)
            .maybeSingle();

        if (!existing) {
            const { error: insertError } = await supabaseAdmin
                .from("interview_responses")
                .insert({
                    interview_session_id: session.id,
                    question_text: questionText,
                    is_fallback_question: false,
                    fallback_question_id: null,
                    candidate_answer: candidateAnswer,
                    asked_at: nowIso,
                    answered_at: nowIso,
                });

            if (insertError) {
                return NextResponse.json({ ok: false, error: "Failed to save question/response" }, { status: 500 });
            }
        }

        const { count: totalTurns } = await supabaseAdmin
            .from("interview_responses")
            .select("id", { head: true, count: "exact" })
            .eq("interview_session_id", session.id);

        return NextResponse.json({
            ok: true,
            stored: true,
            totalTurns: totalTurns ?? 0,
            remainingSeconds: getRemainingSeconds(session.session_valid_until),
        });
    } catch (error) {
        console.error("VAPI storeQuestionAndResponse error:", error);
        return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
    }
}
