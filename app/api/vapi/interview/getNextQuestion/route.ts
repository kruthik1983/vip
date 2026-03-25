import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
    getRemainingSeconds,
    isSessionActive,
    loadSessionByToken,
    parseSkills,
    parseVapiToolAuth,
} from "@/lib/vapi-interview";

function buildQuestionFromContext(params: {
    positionTitle: string;
    skills: string[];
    askedQuestions: Set<string>;
    askedCount: number;
    lastAnswer: string;
}) {
    const skill = params.skills.length > 0 ? params.skills[params.askedCount % params.skills.length] : "your core responsibilities";
    const answerSnippet = params.lastAnswer.trim().slice(0, 100);

    const candidates = [
        `Tell me about a time you used ${skill} in production. What was the hardest part?`,
        `How would you design a reliable approach for a ${params.positionTitle} problem involving ${skill}?`,
        `You mentioned \"${answerSnippet || "your earlier point"}\". Can you go deeper into your decision process?`,
        `What trade-offs do you usually evaluate before shipping changes in ${skill}?`,
    ];

    for (const q of candidates) {
        if (!params.askedQuestions.has(q.toLowerCase())) {
            return q;
        }
    }

    return `What is one improvement you would make today in a recent project relevant to ${params.positionTitle}?`;
}

export async function POST(request: NextRequest) {
    try {
        const auth = parseVapiToolAuth(request);
        if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
        }

        const body = await request.json();
        const sessionToken = String(body?.sessionToken || "").trim();
        const lastAnswer = String(body?.lastAnswer || "").trim();

        if (!sessionToken) {
            return NextResponse.json({ ok: false, error: "sessionToken is required" }, { status: 400 });
        }

        const session = await loadSessionByToken(sessionToken);
        if (!session) {
            return NextResponse.json({ ok: false, error: "Invalid interview session token" }, { status: 404 });
        }

        if (session.ended_at) {
            return NextResponse.json({ ok: true, shouldEnd: true, reason: "already-ended", nextQuestion: null });
        }

        const remainingSeconds = getRemainingSeconds(session.session_valid_until);
        if (!isSessionActive(session.session_valid_from, session.session_valid_until) || (remainingSeconds !== null && remainingSeconds <= 30)) {
            return NextResponse.json({ ok: true, shouldEnd: true, reason: "time-over", nextQuestion: null, remainingSeconds });
        }

        const { data: application, error: appError } = await supabaseAdmin
            .from("applications")
            .select("id, interview_id")
            .eq("id", session.application_id)
            .maybeSingle();

        if (appError || !application) {
            return NextResponse.json({ ok: false, error: "Application not found" }, { status: 404 });
        }

        const { data: interview, error: interviewError } = await supabaseAdmin
            .from("interviews")
            .select("jobs(position_title, skills_required)")
            .eq("id", application.interview_id)
            .maybeSingle();

        if (interviewError || !interview) {
            return NextResponse.json({ ok: false, error: "Interview not found" }, { status: 404 });
        }

        const { data: responses } = await supabaseAdmin
            .from("interview_responses")
            .select("question_text")
            .eq("interview_session_id", session.id);

        const askedQuestions = new Set(
            (responses ?? []).map((r) => String(r.question_text || "").trim().toLowerCase()).filter((t) => t.length > 0),
        );

        const askedCount = askedQuestions.size;
        if (askedCount >= 12) {
            return NextResponse.json({ ok: true, shouldEnd: true, reason: "max-questions", nextQuestion: null, remainingSeconds });
        }

        const { data: fallbackQuestions } = await supabaseAdmin
            .from("interview_fallback_questions")
            .select("question_text")
            .eq("interview_id", application.interview_id)
            .order("question_order", { ascending: true });

        const nextFallback = (fallbackQuestions ?? [])
            .map((q) => String(q.question_text || "").trim())
            .find((q) => q.length > 0 && !askedQuestions.has(q.toLowerCase()));

        const jobsRaw = interview.jobs as
            | { position_title?: string; skills_required?: unknown }
            | Array<{ position_title?: string; skills_required?: unknown }>
            | null;
        const job = Array.isArray(jobsRaw) ? jobsRaw[0] : jobsRaw;

        const nextQuestion =
            nextFallback ||
            buildQuestionFromContext({
                positionTitle: String(job?.position_title || "the role"),
                skills: parseSkills(job?.skills_required),
                askedQuestions,
                askedCount,
                lastAnswer,
            });

        return NextResponse.json({
            ok: true,
            shouldEnd: false,
            nextQuestion,
            remainingSeconds,
        });
    } catch (error) {
        console.error("VAPI getNextQuestion error:", error);
        return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
    }
}
