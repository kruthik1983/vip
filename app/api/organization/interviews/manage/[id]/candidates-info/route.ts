import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyToken } from "@/lib/auth";

type AppRow = {
    id: number;
    candidate_name: string;
    candidate_email: string;
    candidate_phone: string | null;
    status: string;
    created_at: string;
    assigned_assessment_slot_id: number | null;
    assigned_interview_slot_id: number | null;
};

type SlotRow = {
    id: number;
    slot_start_utc: string;
    slot_end_utc: string;
    max_candidates?: number | null;
    assigned_candidates?: number | null;
};

type SessionRow = {
    id: number;
    application_id: number;
    session_token: string;
    session_valid_from: string | null;
    session_valid_until: string | null;
};

type AssessmentAttemptRow = SessionRow & {
    submitted_at: string | null;
};

type InterviewSessionRow = SessionRow & {
    ended_at: string | null;
};

type AssessmentResponseRow = {
    assessment_attempt_id: number;
    question_id: number;
    selected_option_label: string | null;
    is_correct: boolean | null;
};

type AssessmentQuestionRow = {
    id: number;
    question_text: string;
    question_order: number;
};

type AiReportRow = {
    application_id: number;
    generated_at: string;
};

async function validateOrgAdmin(request: NextRequest) {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
        return {
            error: NextResponse.json(
                { success: false, error: "Missing authorization token" },
                { status: 401 }
            ),
        };
    }

    const verifiedUser = await verifyToken(token);
    if (!verifiedUser || verifiedUser.role !== "ORG_ADMIN") {
        return {
            error: NextResponse.json(
                { success: false, error: "Unauthorized. Organization admin required." },
                { status: 403 }
            ),
        };
    }

    return { verifiedUser };
}

function buildSlotLabel(slot: SlotRow | undefined) {
    if (!slot) {
        return "Not Assigned";
    }

    const start = new Date(slot.slot_start_utc).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    });

    const end = new Date(slot.slot_end_utc).toLocaleString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    });

    return `${start} - ${end}`;
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const auth = await validateOrgAdmin(request);
        if (auth.error) {
            return auth.error;
        }

        const { verifiedUser } = auth;
        const resolvedParams = await params;
        const interviewId = parseInt(resolvedParams.id, 10);

        if (!Number.isInteger(interviewId) || interviewId <= 0) {
            return NextResponse.json({ success: false, error: "Invalid interview id" }, { status: 400 });
        }

        const { data: interviewData, error: interviewError } = await supabaseAdmin
            .from("interviews")
            .select("id, organization_id, title")
            .eq("id", interviewId)
            .single();

        if (interviewError || !interviewData) {
            return NextResponse.json({ success: false, error: "Interview not found" }, { status: 404 });
        }

        if (interviewData.organization_id !== verifiedUser.organization_id) {
            return NextResponse.json(
                { success: false, error: "Unauthorized to access this interview" },
                { status: 403 }
            );
        }

        const [applicationsRes, assessmentSlotsRes, interviewSlotsRes] = await Promise.all([
            supabaseAdmin
                .from("applications")
                .select(
                    "id, candidate_name, candidate_email, candidate_phone, status, created_at, assigned_assessment_slot_id, assigned_interview_slot_id"
                )
                .eq("interview_id", interviewId)
                .order("created_at", { ascending: false }),
            supabaseAdmin
                .from("assessment_slots")
                .select("id, slot_start_utc, slot_end_utc, max_candidates, assigned_candidates")
                .eq("interview_id", interviewId),
            supabaseAdmin
                .from("interview_slots")
                .select("id, slot_start_utc, slot_end_utc, max_candidates, assigned_candidates")
                .eq("interview_id", interviewId),
        ]);

        if (applicationsRes.error || assessmentSlotsRes.error || interviewSlotsRes.error) {
            return NextResponse.json(
                { success: false, error: "Failed to load candidates information" },
                { status: 500 }
            );
        }

        const applications = (applicationsRes.data ?? []) as AppRow[];
        const assessmentSlots = (assessmentSlotsRes.data ?? []) as SlotRow[];
        const interviewSlots = (interviewSlotsRes.data ?? []) as SlotRow[];

        const applicationIds = applications.map((app) => app.id);

        let assessmentSessions: AssessmentAttemptRow[] = [];
        let interviewSessions: InterviewSessionRow[] = [];

        if (applicationIds.length > 0) {
            const [assessmentSessionRes, interviewSessionRes] = await Promise.all([
                supabaseAdmin
                    .from("assessment_attempts")
                    .select("id, application_id, session_token, session_valid_from, session_valid_until, submitted_at")
                    .in("application_id", applicationIds),
                supabaseAdmin
                    .from("interview_sessions")
                    .select("id, application_id, session_token, session_valid_from, session_valid_until, ended_at")
                    .in("application_id", applicationIds),
            ]);

            if (assessmentSessionRes.error || interviewSessionRes.error) {
                return NextResponse.json(
                    { success: false, error: "Failed to load candidate credentials" },
                    { status: 500 }
                );
            }

            assessmentSessions = (assessmentSessionRes.data ?? []) as AssessmentAttemptRow[];
            interviewSessions = (interviewSessionRes.data ?? []) as InterviewSessionRow[];
        }

        const assessmentSlotMap = new Map<number, SlotRow>();
        const interviewSlotMap = new Map<number, SlotRow>();
        const assessmentSessionMap = new Map<number, AssessmentAttemptRow>();
        const interviewSessionMap = new Map<number, InterviewSessionRow>();

        assessmentSlots.forEach((slot) => assessmentSlotMap.set(slot.id, slot));
        interviewSlots.forEach((slot) => interviewSlotMap.set(slot.id, slot));
        assessmentSessions.forEach((session) => assessmentSessionMap.set(session.application_id, session));
        interviewSessions.forEach((session) => interviewSessionMap.set(session.application_id, session));

        const attemptIds = assessmentSessions.map((session) => session.id);
        const responsesByAttempt = new Map<number, AssessmentResponseRow[]>();
        const questionMap = new Map<number, AssessmentQuestionRow>();
        const reportMap = new Map<number, AiReportRow>();

        if (attemptIds.length > 0) {
            const { data: responseRows, error: responseError } = await supabaseAdmin
                .from("assessment_responses")
                .select("assessment_attempt_id, question_id, selected_option_label, is_correct")
                .in("assessment_attempt_id", attemptIds);

            if (responseError) {
                return NextResponse.json(
                    { success: false, error: "Failed to load candidate assessment responses" },
                    { status: 500 }
                );
            }

            const typedResponses = (responseRows ?? []) as AssessmentResponseRow[];
            const questionIds = Array.from(new Set(typedResponses.map((row) => row.question_id)));

            if (questionIds.length > 0) {
                const { data: questionRows, error: questionError } = await supabaseAdmin
                    .from("assessment_questions")
                    .select("id, question_text, question_order")
                    .in("id", questionIds);

                if (questionError) {
                    return NextResponse.json(
                        { success: false, error: "Failed to load candidate assessment questions" },
                        { status: 500 }
                    );
                }

                ((questionRows ?? []) as AssessmentQuestionRow[]).forEach((row) => {
                    questionMap.set(row.id, row);
                });
            }

            typedResponses.forEach((row) => {
                const existing = responsesByAttempt.get(row.assessment_attempt_id) ?? [];
                existing.push(row);
                responsesByAttempt.set(row.assessment_attempt_id, existing);
            });
        }

        if (applicationIds.length > 0) {
            const { data: reportRows } = await supabaseAdmin
                .from("ai_reports")
                .select("application_id, generated_at")
                .eq("report_type", "INTERVIEW")
                .in("application_id", applicationIds)
                .order("generated_at", { ascending: false });

            ((reportRows ?? []) as AiReportRow[]).forEach((row) => {
                if (!reportMap.has(row.application_id)) {
                    reportMap.set(row.application_id, row);
                }
            });
        }

        const candidates = applications.map((app) => {
            const assignedAssessmentSlot = app.assigned_assessment_slot_id
                ? assessmentSlotMap.get(app.assigned_assessment_slot_id)
                : undefined;
            const assignedInterviewSlot = app.assigned_interview_slot_id
                ? interviewSlotMap.get(app.assigned_interview_slot_id)
                : undefined;
            const assessmentSession = assessmentSessionMap.get(app.id);
            const interviewSession = interviewSessionMap.get(app.id);
            const reportStatus = reportMap.has(app.id) ? "DECLARED" : "PENDING";
            const attemptResponses = assessmentSession
                ? responsesByAttempt.get(assessmentSession.id) ?? []
                : [];
            const answeredCount = attemptResponses.filter((row) => Boolean(row.selected_option_label)).length;
            const correctCount = attemptResponses.filter((row) => row.is_correct === true).length;
            const questionDetails = attemptResponses
                .map((row) => {
                    const question = questionMap.get(row.question_id);
                    return {
                        questionId: row.question_id,
                        questionOrder: question?.question_order ?? 9999,
                        questionText: question?.question_text ?? "Question unavailable",
                        selectedOptionLabel: row.selected_option_label,
                        isCorrect: row.is_correct,
                    };
                })
                .sort((a, b) => a.questionOrder - b.questionOrder);

            return {
                applicationId: app.id,
                candidateName: app.candidate_name,
                candidateEmail: app.candidate_email,
                candidatePhone: app.candidate_phone,
                applicationStatus: app.status,
                appliedAt: app.created_at,
                assignedAssessmentSlotId: app.assigned_assessment_slot_id,
                assignedInterviewSlotId: app.assigned_interview_slot_id,
                assessmentSlot: buildSlotLabel(assignedAssessmentSlot),
                interviewSlot: buildSlotLabel(assignedInterviewSlot),
                assessmentSessionId: assessmentSession?.id ?? null,
                assessmentCredentialStatus: assessmentSession?.session_token ? "GENERATED" : "PENDING",
                interviewCredentialStatus: interviewSession?.session_token ? "GENERATED" : "PENDING",
                assessmentToken: assessmentSession?.session_token ?? null,
                assessmentValidFrom: assessmentSession?.session_valid_from ?? null,
                assessmentValidUntil: assessmentSession?.session_valid_until ?? null,
                interviewSessionId: interviewSession?.id ?? null,
                interviewToken: interviewSession?.session_token ?? null,
                interviewValidFrom: interviewSession?.session_valid_from ?? null,
                interviewValidUntil: interviewSession?.session_valid_until ?? null,
                reportStatus,
                assessmentQuestionStats: {
                    totalQuestions: attemptResponses.length,
                    answeredQuestions: answeredCount,
                    correctAnswers: correctCount,
                },
                assessmentQuestionDetails: questionDetails,
            };
        });

        return NextResponse.json({
            success: true,
            data: {
                interviewId,
                interviewTitle: interviewData.title,
                totalCandidates: candidates.length,
                assessmentSlots: assessmentSlots.map((slot) => ({
                    id: slot.id,
                    slotStartUtc: slot.slot_start_utc,
                    slotEndUtc: slot.slot_end_utc,
                    maxCandidates: slot.max_candidates ?? 0,
                    assignedCandidates: slot.assigned_candidates ?? 0,
                    seatsLeft: Math.max(0, (slot.max_candidates ?? 0) - (slot.assigned_candidates ?? 0)),
                })),
                interviewSlots: interviewSlots.map((slot) => ({
                    id: slot.id,
                    slotStartUtc: slot.slot_start_utc,
                    slotEndUtc: slot.slot_end_utc,
                    maxCandidates: slot.max_candidates ?? 0,
                    assignedCandidates: slot.assigned_candidates ?? 0,
                    seatsLeft: Math.max(0, (slot.max_candidates ?? 0) - (slot.assigned_candidates ?? 0)),
                })),
                candidates,
            },
        });
    } catch (error) {
        console.error("Candidates info GET error:", error);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}
