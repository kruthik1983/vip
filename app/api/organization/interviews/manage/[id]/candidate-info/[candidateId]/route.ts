import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyToken } from "@/lib/auth";
import { generateAndStoreInterviewAiReport } from "@/lib/interview-ai-report";

function getRecordingBucketCandidates() {
    return [
        process.env.RECORDINGS_BUCKET,
        process.env.SUPABASE_RESUME_BUCKET,
        "recordings-private",
        "candidate-resumes",
    ]
        .map((value) => String(value || "").trim())
        .filter((value, index, arr) => value.length > 0 && arr.indexOf(value) === index);
}

function getCandidatePhotoBucketCandidates() {
    return [
        process.env.SUPABASE_CANDIDATE_PHOTO_BUCKET,
        "candidate-photos",
    ]
        .map((value) => String(value || "").trim())
        .filter((value, index, arr) => value.length > 0 && arr.indexOf(value) === index);
}

async function createSignedUrlFromBuckets(objectPath: string, buckets: string[], expiresIn = 3600) {
    for (const bucket of buckets) {
        const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(objectPath, expiresIn);
        if (!error && data?.signedUrl) {
            return { signedUrl: data.signedUrl, bucket };
        }
    }

    return { signedUrl: null, bucket: null };
}

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

async function resolveCandidateContext(interviewId: number, candidateId: number, organizationId: number) {
    const { data: interviewData, error: interviewError } = await supabaseAdmin
        .from("interviews")
        .select("id, organization_id, title, jobs(position_title)")
        .eq("id", interviewId)
        .maybeSingle();

    if (interviewError || !interviewData) {
        return { error: "Interview not found", status: 404 };
    }

    if (interviewData.organization_id !== organizationId) {
        return { error: "Unauthorized to access this interview", status: 403 };
    }

    const { data: applicationData, error: applicationError } = await supabaseAdmin
        .from("applications")
        .select("id, interview_id, candidate_name, candidate_email, candidate_phone, resume_file_path, candidate_photo_path, status, created_at")
        .eq("id", candidateId)
        .eq("interview_id", interviewId)
        .maybeSingle();

    if (applicationError || !applicationData) {
        return { error: "Candidate not found in this interview", status: 404 };
    }

    const [{ data: assessmentAttempt }, { data: interviewSession }, { data: report }, { data: decision }] = await Promise.all([
        supabaseAdmin
            .from("assessment_attempts")
            .select("id, submitted_at, score, total_questions, correct_answers, duration_seconds")
            .eq("application_id", applicationData.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        supabaseAdmin
            .from("interview_sessions")
            .select("id, ended_at, total_questions_asked, duration_seconds, score")
            .eq("application_id", applicationData.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        supabaseAdmin
            .from("ai_reports")
            .select("id, application_id, interview_session_id, report_type, transcript_summary, score, strengths, weaknesses, hire_recommendation, detailed_analysis, generated_at, generated_by")
            .eq("application_id", applicationData.id)
            .eq("report_type", "INTERVIEW")
            .order("generated_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        supabaseAdmin
            .from("hr_decisions")
            .select("id, decision, notes, decided_at")
            .eq("application_id", applicationData.id)
            .maybeSingle(),
    ]);

    const assessmentAttemptId = assessmentAttempt?.id ?? null;
    const interviewSessionId = interviewSession?.id ?? null;

    const [{ data: assessmentResponses }, { data: interviewResponses }, { data: recordings }] = await Promise.all([
        assessmentAttemptId
            ? supabaseAdmin
                .from("assessment_responses")
                .select("question_id, selected_option_label, is_correct")
                .eq("assessment_attempt_id", assessmentAttemptId)
            : Promise.resolve({ data: [], error: null }),
        interviewSessionId
            ? supabaseAdmin
                .from("interview_responses")
                .select("question_text, candidate_answer, asked_at, answered_at, question_duration_seconds")
                .eq("interview_session_id", interviewSessionId)
                .order("asked_at", { ascending: true })
            : Promise.resolve({ data: [], error: null }),
        interviewSessionId
            ? supabaseAdmin
                .from("recordings")
                .select("id, recording_type, file_path, mime_type, duration_seconds, created_at")
                .eq("interview_session_id", interviewSessionId)
                .order("created_at", { ascending: false })
            : Promise.resolve({ data: [], error: null }),
    ]);

    const assessmentQuestionIds = Array.from(new Set((assessmentResponses ?? []).map((row) => row.question_id)));
    const { data: assessmentQuestions } = assessmentQuestionIds.length > 0
        ? await supabaseAdmin
            .from("assessment_questions")
            .select("id, question_text, question_order")
            .in("id", assessmentQuestionIds)
        : { data: [] as Array<{ id: number; question_text: string; question_order: number }> };

    const questionMap = new Map<number, { question_text: string; question_order: number }>();
    (assessmentQuestions ?? []).forEach((q) => {
        questionMap.set(q.id, { question_text: q.question_text, question_order: q.question_order });
    });

    const assessmentDetails = (assessmentResponses ?? [])
        .map((row) => ({
            questionId: row.question_id,
            questionOrder: questionMap.get(row.question_id)?.question_order ?? 9999,
            questionText: questionMap.get(row.question_id)?.question_text ?? "Question unavailable",
            selectedOptionLabel: row.selected_option_label,
            isCorrect: row.is_correct,
        }))
        .sort((a, b) => a.questionOrder - b.questionOrder);

    const transcript = (interviewResponses ?? []).map((row, index) => ({
        index: index + 1,
        questionText: row.question_text,
        candidateAnswer: row.candidate_answer,
        askedAt: row.asked_at,
        answeredAt: row.answered_at,
        durationSeconds: row.question_duration_seconds,
    }));

    const preferredRecording = (recordings ?? []).find((r) => String(r.recording_type || "").toUpperCase() === "INTERVIEW")
        || (recordings ?? []).find((r) => String(r.mime_type || "").toLowerCase().startsWith("video/"))
        || null;

    const recordingBuckets = getRecordingBucketCandidates();
    const interviewVideo = preferredRecording?.file_path
        ? await createSignedUrlFromBuckets(preferredRecording.file_path, recordingBuckets)
        : { signedUrl: null, bucket: null };

    const resumePath = String(applicationData.resume_file_path || "").trim();
    const resumeBucket = String(process.env.SUPABASE_RESUME_BUCKET || "candidate-resumes").trim() || "candidate-resumes";
    const resumeSigned = resumePath
        ? await createSignedUrlFromBuckets(resumePath, [resumeBucket, ...recordingBuckets])
        : { signedUrl: null, bucket: null };

    const photoPath = String(applicationData.candidate_photo_path || "").trim();
    const photoSigned = photoPath
        ? await createSignedUrlFromBuckets(photoPath, getCandidatePhotoBucketCandidates())
        : { signedUrl: null, bucket: null };

    const completedAssessment = Boolean(assessmentAttempt?.submitted_at);
    const completedInterview = Boolean(interviewSession?.ended_at);

    return {
        data: {
            interview: {
                id: interviewData.id,
                title: interviewData.title,
                positionTitle: (interviewData.jobs as { position_title?: string } | null)?.position_title ?? null,
            },
            candidate: {
                applicationId: applicationData.id,
                candidateName: applicationData.candidate_name,
                candidateEmail: applicationData.candidate_email,
                candidatePhone: applicationData.candidate_phone,
                resumePath: resumePath || null,
                resumeUrl: resumeSigned.signedUrl,
                photoPath: photoPath || null,
                photoUrl: photoSigned.signedUrl,
                status: applicationData.status,
                appliedAt: applicationData.created_at,
            },
            completion: {
                completedAssessment,
                completedInterview,
                canGenerate: completedAssessment && completedInterview,
            },
            assessment: assessmentAttempt
                ? {
                    score: assessmentAttempt.score,
                    totalQuestions: assessmentAttempt.total_questions,
                    correctAnswers: assessmentAttempt.correct_answers,
                    durationSeconds: assessmentAttempt.duration_seconds,
                    submittedAt: assessmentAttempt.submitted_at,
                }
                : null,
            interviewSession: interviewSession
                ? {
                    id: interviewSession.id,
                    score: interviewSession.score,
                    totalQuestionsAsked: interviewSession.total_questions_asked,
                    durationSeconds: interviewSession.duration_seconds,
                    endedAt: interviewSession.ended_at,
                }
                : null,
            interviewVideo: preferredRecording
                ? {
                    filePath: preferredRecording.file_path,
                    mimeType: preferredRecording.mime_type,
                    durationSeconds: preferredRecording.duration_seconds,
                    signedUrl: interviewVideo.signedUrl,
                    signedFromBucket: interviewVideo.bucket,
                }
                : null,
            transcript,
            assessmentDetails,
            decision: decision
                ? {
                    id: decision.id,
                    decision: decision.decision,
                    notes: decision.notes,
                    decidedAt: decision.decided_at,
                }
                : null,
            report: report || null,
        },
    };
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; candidateId: string }> }
) {
    try {
        const auth = await validateOrgAdmin(request);
        if (auth.error) {
            return auth.error;
        }

        const { verifiedUser } = auth;
        const resolvedParams = await params;

        const interviewId = parseInt(resolvedParams.id, 10);
        const candidateId = parseInt(resolvedParams.candidateId, 10);

        if (!Number.isInteger(interviewId) || interviewId <= 0 || !Number.isInteger(candidateId) || candidateId <= 0) {
            return NextResponse.json({ success: false, error: "Invalid interview or candidate id" }, { status: 400 });
        }

        if (!verifiedUser.organization_id) {
            return NextResponse.json({ success: false, error: "Organization is not linked to this admin" }, { status: 403 });
        }

        const context = await resolveCandidateContext(interviewId, candidateId, verifiedUser.organization_id);
        if ((context as { error?: string }).error) {
            const typed = context as { error: string; status: number };
            return NextResponse.json({ success: false, error: typed.error }, { status: typed.status });
        }

        return NextResponse.json({ success: true, data: (context as { data: unknown }).data });
    } catch (error) {
        console.error("Candidate info report GET error:", error);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; candidateId: string }> }
) {
    try {
        const auth = await validateOrgAdmin(request);
        if (auth.error) {
            return auth.error;
        }

        const { verifiedUser } = auth;
        const resolvedParams = await params;

        const interviewId = parseInt(resolvedParams.id, 10);
        const candidateId = parseInt(resolvedParams.candidateId, 10);

        if (!Number.isInteger(interviewId) || interviewId <= 0 || !Number.isInteger(candidateId) || candidateId <= 0) {
            return NextResponse.json({ success: false, error: "Invalid interview or candidate id" }, { status: 400 });
        }

        if (!verifiedUser.organization_id) {
            return NextResponse.json({ success: false, error: "Organization is not linked to this admin" }, { status: 403 });
        }

        const context = await resolveCandidateContext(interviewId, candidateId, verifiedUser.organization_id);
        if ((context as { error?: string }).error) {
            const typed = context as { error: string; status: number };
            return NextResponse.json({ success: false, error: typed.error }, { status: typed.status });
        }

        const body = await request.json().catch(() => ({}));
        const action = String((body as { action?: string })?.action || "GENERATE").toUpperCase();

        const typedContext = (context as {
            data: {
                completion: { completedInterview: boolean; canGenerate: boolean };
                candidate: { applicationId: number };
                report: { id: number } | null;
            };
        }).data;

        if (action === "ACCEPT" || action === "REJECT") {
            if (!typedContext.report) {
                return NextResponse.json(
                    { success: false, error: "Generate AI report before taking final decision" },
                    { status: 400 }
                );
            }

            const decisionValue = action === "ACCEPT" ? "ACCEPT" : "REJECT";
            const nowIso = new Date().toISOString();

            const { error: decisionError } = await supabaseAdmin
                .from("hr_decisions")
                .upsert(
                    {
                        application_id: typedContext.candidate.applicationId,
                        decision: decisionValue,
                        decided_by: verifiedUser.id,
                        decided_at: nowIso,
                        updated_at: nowIso,
                        notes: null,
                    },
                    { onConflict: "application_id" }
                );

            if (decisionError) {
                return NextResponse.json({ success: false, error: "Failed to save candidate decision" }, { status: 500 });
            }

            await supabaseAdmin
                .from("applications")
                .update({ status: action === "ACCEPT" ? "ACCEPTED" : "REJECTED" })
                .eq("id", typedContext.candidate.applicationId);

            return NextResponse.json({
                success: true,
                message: action === "ACCEPT" ? "Candidate accepted" : "Candidate rejected",
            });
        }

        if (!typedContext.completion.completedInterview || !typedContext.completion.canGenerate) {
            return NextResponse.json(
                { success: false, error: "Report can only be generated after interview and assessment are completed" },
                { status: 400 }
            );
        }

        const generated = await generateAndStoreInterviewAiReport(typedContext.candidate.applicationId);

        return NextResponse.json({
            success: true,
            message: "AI report generated",
            data: {
                report: generated.report,
                summary: generated.summary,
            },
        });
    } catch (error) {
        console.error("Candidate info report POST error:", error);
        return NextResponse.json({ success: false, error: "Failed to generate AI report" }, { status: 500 });
    }
}
