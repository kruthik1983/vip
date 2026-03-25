import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type InterviewResponseInput = {
    fallbackQuestionId?: number;
    questionText?: string;
    candidateAnswer?: string;
};

function parseToken(request: NextRequest) {
    return request.nextUrl.searchParams.get("token")?.trim() || "";
}

function isSessionActive(validFrom: string | null, validUntil: string | null) {
    const now = Date.now();
    const fromTs = validFrom ? new Date(validFrom).getTime() : Number.NEGATIVE_INFINITY;
    const untilTs = validUntil ? new Date(validUntil).getTime() : Number.POSITIVE_INFINITY;
    return now >= fromTs && now <= untilTs;
}

export async function GET(request: NextRequest) {
    try {
        const token = parseToken(request);

        if (!token) {
            return NextResponse.json({ success: false, error: "Missing token" }, { status: 400 });
        }

        const { data: session, error: sessionError } = await supabaseAdmin
            .from("interview_sessions")
            .select(
                "id, application_id, started_at, ended_at, session_valid_from, session_valid_until, total_questions_asked, score, duration_seconds"
            )
            .eq("session_token", token)
            .maybeSingle();

        if (sessionError || !session) {
            return NextResponse.json({ success: false, error: "Invalid interview token" }, { status: 404 });
        }

        if (!isSessionActive(session.session_valid_from, session.session_valid_until)) {
            return NextResponse.json(
                { success: false, error: "This interview link is not active right now" },
                { status: 400 }
            );
        }

        const { data: application, error: applicationError } = await supabaseAdmin
            .from("applications")
            .select("id, interview_id, candidate_name")
            .eq("id", session.application_id)
            .maybeSingle();

        if (applicationError || !application) {
            return NextResponse.json({ success: false, error: "Application not found" }, { status: 404 });
        }

        const { data: interview, error: interviewError } = await supabaseAdmin
            .from("interviews")
            .select("id, title, interview_duration_minutes, jobs(position_title)")
            .eq("id", application.interview_id)
            .maybeSingle();

        if (interviewError || !interview) {
            return NextResponse.json({ success: false, error: "Interview not found" }, { status: 404 });
        }

        const { data: fallbackQuestions } = await supabaseAdmin
            .from("interview_fallback_questions")
            .select("id, question_text, difficulty_level, question_order")
            .eq("interview_id", application.interview_id)
            .order("question_order", { ascending: true });

        if (!session.started_at && !session.ended_at) {
            await supabaseAdmin
                .from("interview_sessions")
                .update({ started_at: new Date().toISOString(), status: "INTERVIEW_IN_PROGRESS" })
                .eq("id", session.id);

            await supabaseAdmin
                .from("applications")
                .update({ status: "INTERVIEW_IN_PROGRESS" })
                .eq("id", application.id);
        }

        return NextResponse.json({
            success: true,
            data: {
                sessionId: session.id,
                candidateName: application.candidate_name,
                interviewTitle: interview.title,
                positionTitle: (interview.jobs as { position_title?: string } | null)?.position_title ?? null,
                durationMinutes: interview.interview_duration_minutes,
                endedAt: session.ended_at,
                result: session.ended_at
                    ? {
                        totalQuestionsAsked: session.total_questions_asked,
                        score: session.score,
                        durationSeconds: session.duration_seconds,
                    }
                    : null,
                questions: (fallbackQuestions ?? []).map((q) => ({
                    id: q.id,
                    questionText: q.question_text,
                    difficultyLevel: q.difficulty_level,
                    questionOrder: q.question_order,
                })),
            },
        });
    } catch (error) {
        console.error("Candidate interview GET error:", error);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const token = String(body?.token || "").trim();
        const responses: InterviewResponseInput[] = Array.isArray(body?.responses) ? body.responses : [];

        if (!token) {
            return NextResponse.json({ success: false, error: "Missing token" }, { status: 400 });
        }

        const { data: session, error: sessionError } = await supabaseAdmin
            .from("interview_sessions")
            .select("id, application_id, started_at, ended_at, session_valid_from, session_valid_until")
            .eq("session_token", token)
            .maybeSingle();

        if (sessionError || !session) {
            return NextResponse.json({ success: false, error: "Invalid interview token" }, { status: 404 });
        }

        if (!isSessionActive(session.session_valid_from, session.session_valid_until)) {
            return NextResponse.json(
                { success: false, error: "This interview link is not active right now" },
                { status: 400 }
            );
        }

        if (session.ended_at) {
            return NextResponse.json({ success: false, error: "Interview already submitted" }, { status: 400 });
        }

        const { data: application, error: applicationError } = await supabaseAdmin
            .from("applications")
            .select("id")
            .eq("id", session.application_id)
            .maybeSingle();

        if (applicationError || !application) {
            return NextResponse.json({ success: false, error: "Application not found" }, { status: 404 });
        }

        if (responses.length === 0) {
            return NextResponse.json({ success: false, error: "At least one answer is required" }, { status: 400 });
        }

        const nowIso = new Date().toISOString();

        const normalizedRows = responses
            .map((item) => {
                const answer = String(item.candidateAnswer || "").trim();
                const questionText = String(item.questionText || "").trim();
                const fallbackQuestionId = item.fallbackQuestionId ? Number(item.fallbackQuestionId) : null;

                if (!answer) {
                    return null;
                }

                return {
                    interview_session_id: session.id,
                    question_text: questionText || "Interview question",
                    is_fallback_question: fallbackQuestionId !== null,
                    fallback_question_id: fallbackQuestionId,
                    candidate_answer: answer,
                    asked_at: nowIso,
                    answered_at: nowIso,
                };
            })
            .filter((row) => row !== null);

        if (normalizedRows.length === 0) {
            return NextResponse.json({ success: false, error: "At least one non-empty answer is required" }, { status: 400 });
        }

        await supabaseAdmin.from("interview_responses").delete().eq("interview_session_id", session.id);

        const { error: insertError } = await supabaseAdmin
            .from("interview_responses")
            .insert(normalizedRows);

        if (insertError) {
            return NextResponse.json({ success: false, error: "Failed to submit interview responses" }, { status: 500 });
        }

        const startedAtTs = session.started_at ? new Date(session.started_at).getTime() : Date.now();
        const durationSeconds = Math.max(0, Math.round((Date.now() - startedAtTs) / 1000));

        const { error: updateSessionError } = await supabaseAdmin
            .from("interview_sessions")
            .update({
                started_at: session.started_at ?? nowIso,
                ended_at: nowIso,
                status: "COMPLETED",
                total_questions_asked: normalizedRows.length,
                duration_seconds: durationSeconds,
            })
            .eq("id", session.id);

        if (updateSessionError) {
            return NextResponse.json({ success: false, error: "Failed to finalize interview" }, { status: 500 });
        }

        await supabaseAdmin
            .from("applications")
            .update({ status: "COMPLETED" })
            .eq("id", application.id);

        return NextResponse.json({
            success: true,
            message: "Interview submitted successfully",
            data: {
                totalQuestionsAsked: normalizedRows.length,
                durationSeconds,
            },
        });
    } catch (error) {
        console.error("Candidate interview POST error:", error);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}
