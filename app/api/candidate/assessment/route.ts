import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { generateAssessmentQuestionsFromOllama } from "@/lib/ollama";
import { validateAssignedAssessmentSlotWindow } from "@/lib/candidate-assessment-access";

type AssessmentQuestionRow = {
    id: number;
    question_text: string;
    question_order: number;
    options: Array<{ label?: string; text?: string }> | null;
    correct_option_label: string;
};

type AssessmentResponseRow = {
    question_id: number;
    selected_option_label: string | null;
};

type AttemptQuestionRow = {
    id: number;
    question_text: string;
    question_order: number;
    options: Array<{ label?: string; text?: string }> | null;
    correct_option_label: string;
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

function normalizeAssessmentDuration(durationMinutes: number | null | undefined) {
    if (typeof durationMinutes !== "number" || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        return 20;
    }

    return Math.floor(durationMinutes);
}

function computeSessionValidUntil(startedAtIso: string, durationMinutes: number) {
    return new Date(new Date(startedAtIso).getTime() + durationMinutes * 60 * 1000).toISOString();
}

async function ensureAttemptSessionWindow(
    attempt: {
        id: number;
        started_at: string | null;
        submitted_at: string | null;
        session_valid_from: string | null;
        session_valid_until: string | null;
    },
    durationMinutes: number,
) {
    if (!attempt.started_at && !attempt.submitted_at) {
        if (!isSessionActive(attempt.session_valid_from, attempt.session_valid_until)) {
            return { ok: false as const, status: 400, error: "This assessment link is not active right now" };
        }

        const startedAtIso = new Date().toISOString();
        const extendedValidUntil = computeSessionValidUntil(startedAtIso, durationMinutes);

        const { error } = await supabaseAdmin
            .from("assessment_attempts")
            .update({
                started_at: startedAtIso,
                session_valid_until: extendedValidUntil,
                status: "ASSESSMENT_IN_PROGRESS",
            })
            .eq("id", attempt.id);

        if (error) {
            return { ok: false as const, status: 500, error: "Failed to start assessment session" };
        }

        attempt.started_at = startedAtIso;
        attempt.session_valid_until = extendedValidUntil;
        return { ok: true as const };
    }

    if (!isSessionActive(attempt.session_valid_from, attempt.session_valid_until)) {
        return { ok: false as const, status: 400, error: "This assessment link is not active right now" };
    }

    return { ok: true as const };
}

async function ensureAttemptSessionWindowForSubmission(
    attempt: {
        id: number;
        started_at: string | null;
        submitted_at: string | null;
        session_valid_from: string | null;
        session_valid_until: string | null;
    },
    durationMinutes: number,
) {
    if (!attempt.started_at && !attempt.submitted_at) {
        return ensureAttemptSessionWindow(attempt, durationMinutes);
    }

    if (attempt.session_valid_from && new Date(attempt.session_valid_from).getTime() > Date.now()) {
        return { ok: false as const, status: 400, error: "This assessment link is not active right now" };
    }

    return { ok: true as const };
}

function parseSkillsRequired(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    return raw
        .map((item) => String(item || "").trim())
        .filter((skill) => skill.length > 0);
}

function getAssessmentGenerationErrorMessage(error: unknown) {
    if (error instanceof Error && error.message.toLowerCase().includes("ollama is unavailable")) {
        return error.message;
    }

    return "Failed to generate assessment questions for this session";
}

async function dedupeAttemptResponseRows(attemptId: number) {
    const { data: existingRows, error } = await supabaseAdmin
        .from("assessment_responses")
        .select("id, question_id")
        .eq("assessment_attempt_id", attemptId)
        .order("id", { ascending: true });

    if (error || !existingRows) {
        return [] as number[];
    }

    const seenQuestionIds = new Set<number>();
    const duplicateResponseIds: number[] = [];

    for (const row of existingRows as Array<{ id: number; question_id: number }>) {
        if (seenQuestionIds.has(row.question_id)) {
            duplicateResponseIds.push(row.id);
            continue;
        }

        seenQuestionIds.add(row.question_id);
    }

    if (duplicateResponseIds.length > 0) {
        await supabaseAdmin
            .from("assessment_responses")
            .delete()
            .in("id", duplicateResponseIds);
    }

    return Array.from(seenQuestionIds);
}

async function normalizeAttemptQuestionIds(attemptId: number, questionIds: number[], targetCount: number) {
    if (questionIds.length <= targetCount) {
        return questionIds;
    }

    const { data: questionRows, error } = await supabaseAdmin
        .from("assessment_questions")
        .select("id, question_order")
        .in("id", questionIds);

    if (error || !questionRows) {
        return questionIds.slice(0, targetCount);
    }

    const sorted = [...questionRows as Array<{ id: number; question_order: number }>]
        .sort((a, b) => a.question_order - b.question_order || a.id - b.id);

    const keepIds = sorted.slice(0, targetCount).map((row) => row.id);
    const keepSet = new Set(keepIds);
    const extraIds = questionIds.filter((id) => !keepSet.has(id));

    if (extraIds.length > 0) {
        await supabaseAdmin
            .from("assessment_responses")
            .delete()
            .eq("assessment_attempt_id", attemptId)
            .in("question_id", extraIds);
    }

    return keepIds;
}

async function persistAttemptResponses(params: {
    attemptId: number;
    questionIds: number[];
    answerMap: Map<number, string>;
    nowIso: string;
    correctOptionByQuestionId?: Map<number, string>;
}) {
    const existingQuestionIds = await dedupeAttemptResponseRows(params.attemptId);
    const existingSet = new Set(existingQuestionIds);

    const rowsToInsert: Array<{
        assessment_attempt_id: number;
        question_id: number;
        selected_option_label: string | null;
        is_correct: boolean | null;
        answered_at: string;
    }> = [];

    for (const questionId of params.questionIds) {
        const selectedOptionLabel = params.answerMap.get(questionId) ?? null;
        const correctOption = params.correctOptionByQuestionId?.get(questionId);
        const isCorrect =
            params.correctOptionByQuestionId
                ? (selectedOptionLabel ? selectedOptionLabel === correctOption : null)
                : null;

        if (existingSet.has(questionId)) {
            await supabaseAdmin
                .from("assessment_responses")
                .update({
                    selected_option_label: selectedOptionLabel,
                    is_correct: isCorrect,
                    answered_at: params.nowIso,
                })
                .eq("assessment_attempt_id", params.attemptId)
                .eq("question_id", questionId);
            continue;
        }

        rowsToInsert.push({
            assessment_attempt_id: params.attemptId,
            question_id: questionId,
            selected_option_label: selectedOptionLabel,
            is_correct: isCorrect,
            answered_at: params.nowIso,
        });
    }

    if (rowsToInsert.length > 0) {
        const { error: insertError } = await supabaseAdmin
            .from("assessment_responses")
            .insert(rowsToInsert);

        if (insertError) {
            throw new Error("Failed to persist assessment responses");
        }
    }
}

async function ensureAttemptQuestionsStored(params: {
    attemptId: number;
    interviewId: number;
    interviewTitle: string;
    positionTitle: string;
    jobDescription: string;
    skillsRequired: string[];
    questionCount: number;
}) {
    const existingQuestionIdsRaw = await dedupeAttemptResponseRows(params.attemptId);
    const existingQuestionIds = await normalizeAttemptQuestionIds(
        params.attemptId,
        existingQuestionIdsRaw,
        params.questionCount,
    );

    if (existingQuestionIds.length > 0) {
        return existingQuestionIds;
    }

    const generatedQuestions = await generateAssessmentQuestionsFromOllama({
        interviewTitle: params.interviewTitle,
        positionTitle: params.positionTitle,
        jobDescription: params.jobDescription,
        skillsRequired: params.skillsRequired,
        questionCount: params.questionCount,
        variationKey: String(params.attemptId),
    });

    const { data: setData, error: setError } = await supabaseAdmin
        .from("assessment_question_sets")
        .insert({
            interview_id: params.interviewId,
            is_ai_generated: true,
        })
        .select("id")
        .single();

    if (setError || !setData) {
        throw new Error("Failed to create assessment question set for attempt");
    }

    const { data: insertedQuestions, error: insertQuestionError } = await supabaseAdmin
        .from("assessment_questions")
        .insert(
            generatedQuestions.map((question, index) => {
                const correctOption = question.options.find((opt) => opt.isCorrect);
                return {
                    question_set_id: setData.id,
                    question_text: question.questionText,
                    question_order: index + 1,
                    options: question.options,
                    correct_option_label: correctOption?.label ?? "A",
                };
            }),
        )
        .select("id");

    if (insertQuestionError || !insertedQuestions || insertedQuestions.length === 0) {
        throw new Error("Failed to save generated assessment questions");
    }

    const generatedQuestionIds = insertedQuestions.map((q) => q.id);

    const { error: insertResponseError } = await supabaseAdmin
        .from("assessment_responses")
        .insert(
            generatedQuestionIds.map((questionId) => ({
                assessment_attempt_id: params.attemptId,
                question_id: questionId,
                selected_option_label: null,
                is_correct: null,
            })),
        );

    if (insertResponseError) {
        throw new Error("Failed to initialize assessment responses for generated questions");
    }

    return generatedQuestionIds;
}

export async function GET(request: NextRequest) {
    try {
        const token = parseToken(request);

        if (!token) {
            return NextResponse.json({ success: false, error: "Missing token" }, { status: 400 });
        }

        const { data: attempt, error: attemptError } = await supabaseAdmin
            .from("assessment_attempts")
            .select(
                "id, application_id, started_at, submitted_at, session_valid_from, session_valid_until, total_questions, correct_answers, score, duration_seconds"
            )
            .eq("session_token", token)
            .maybeSingle();

        if (attemptError || !attempt) {
            return NextResponse.json({ success: false, error: "Invalid assessment token" }, { status: 404 });
        }

        const { data: application, error: applicationError } = await supabaseAdmin
            .from("applications")
            .select("id, interview_id, candidate_name")
            .eq("id", attempt.application_id)
            .maybeSingle();

        if (applicationError || !application) {
            return NextResponse.json({ success: false, error: "Application not found" }, { status: 404 });
        }

        const sessionValidFromMs = attempt.session_valid_from
            ? new Date(attempt.session_valid_from).getTime()
            : null;

        const preOpenData =
            sessionValidFromMs !== null && sessionValidFromMs > Date.now()
                ? {
                    opensAt: attempt.session_valid_from,
                    serverNow: new Date().toISOString(),
                }
                : undefined;

        const slotAccess = await validateAssignedAssessmentSlotWindow(application.id);
        if (!slotAccess.allowed) {
            return NextResponse.json(
                {
                    success: false,
                    error: slotAccess.error || "Assessment access denied",
                    ...(preOpenData ? { data: preOpenData } : {}),
                },
                { status: 400 },
            );
        }

        const { data: interview, error: interviewError } = await supabaseAdmin
            .from("interviews")
            .select("id, job_id, title, assessment_duration_minutes")
            .eq("id", application.interview_id)
            .maybeSingle();

        if (interviewError || !interview) {
            return NextResponse.json({ success: false, error: "Interview not found" }, { status: 404 });
        }

        const ensuredWindow = await ensureAttemptSessionWindowForSubmission(
            attempt,
            normalizeAssessmentDuration(interview.assessment_duration_minutes),
        );

        if (!ensuredWindow.ok) {
            return NextResponse.json(
                {
                    success: false,
                    error: ensuredWindow.error,
                    ...(preOpenData ? { data: preOpenData } : {}),
                },
                { status: ensuredWindow.status },
            );
        }

        const { data: jobData, error: jobError } = await supabaseAdmin
            .from("jobs")
            .select("position_title, job_description, skills_required")
            .eq("id", interview.job_id)
            .maybeSingle();

        if (jobError || !jobData) {
            return NextResponse.json({ success: false, error: "Job details not found" }, { status: 404 });
        }

        try {
            await ensureAttemptQuestionsStored({
                attemptId: attempt.id,
                interviewId: interview.id,
                interviewTitle: interview.title,
                positionTitle: jobData.position_title,
                jobDescription: jobData.job_description,
                skillsRequired: parseSkillsRequired(jobData.skills_required),
                questionCount: 20,
            });
        } catch (error) {
            console.error("Assessment question generation error:", error);
            return NextResponse.json(
                { success: false, error: getAssessmentGenerationErrorMessage(error) },
                { status: 502 },
            );
        }

        const { data: responseRows, error: responseRowsError } = await supabaseAdmin
            .from("assessment_responses")
            .select("question_id, selected_option_label")
            .eq("assessment_attempt_id", attempt.id);

        if (responseRowsError) {
            return NextResponse.json({ success: false, error: "Failed to load assessment responses" }, { status: 500 });
        }

        const questionIds = Array.from(
            new Set(((responseRows ?? []) as AssessmentResponseRow[]).map((row) => row.question_id)),
        );

        const { data: attemptQuestions, error: attemptQuestionsError } = await supabaseAdmin
            .from("assessment_questions")
            .select("id, question_text, question_order, options, correct_option_label")
            .in("id", questionIds)
            .order("question_order", { ascending: true });

        if (attemptQuestionsError) {
            return NextResponse.json({ success: false, error: "Failed to load assessment questions" }, { status: 500 });
        }

        const questions = (attemptQuestions ?? []) as AttemptQuestionRow[];

        const selectedAnswers = new Map<number, string>();
        ((responseRows ?? []) as AssessmentResponseRow[]).forEach((row) => {
            if (row.selected_option_label) {
                selectedAnswers.set(row.question_id, row.selected_option_label);
            }
        });

        return NextResponse.json({
            success: true,
            data: {
                attemptId: attempt.id,
                candidateName: application.candidate_name,
                interviewTitle: interview.title,
                positionTitle: jobData.position_title ?? null,
                durationMinutes: interview.assessment_duration_minutes,
                sessionValidUntil: attempt.session_valid_until,
                submittedAt: attempt.submitted_at,
                result: attempt.submitted_at
                    ? {
                        totalQuestions: attempt.total_questions,
                        correctAnswers: attempt.correct_answers,
                        score: attempt.score,
                        durationSeconds: attempt.duration_seconds,
                    }
                    : null,
                selectedAnswers: Object.fromEntries(selectedAnswers.entries()),
                questions: questions.map((q) => ({
                    id: q.id,
                    questionText: q.question_text,
                    questionOrder: q.question_order,
                    options: Array.isArray(q.options)
                        ? q.options.map((opt, index) => ({
                            label: opt.label || String.fromCharCode(65 + index),
                            text: opt.text || "",
                        }))
                        : [],
                })),
            },
        });
    } catch (error) {
        console.error("Candidate assessment GET error:", error);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json();
        const token = String(body?.token || "").trim();
        const responses = Array.isArray(body?.responses) ? body.responses : [];

        if (!token) {
            return NextResponse.json({ success: false, error: "Missing token" }, { status: 400 });
        }

        const { data: attempt, error: attemptError } = await supabaseAdmin
            .from("assessment_attempts")
            .select("id, application_id, started_at, submitted_at, session_valid_from, session_valid_until")
            .eq("session_token", token)
            .maybeSingle();

        if (attemptError || !attempt) {
            return NextResponse.json({ success: false, error: "Invalid assessment token" }, { status: 404 });
        }

        if (attempt.submitted_at) {
            return NextResponse.json({ success: false, error: "Assessment already submitted" }, { status: 400 });
        }

        const { data: application, error: applicationError } = await supabaseAdmin
            .from("applications")
            .select("id, interview_id")
            .eq("id", attempt.application_id)
            .maybeSingle();

        if (applicationError || !application) {
            return NextResponse.json({ success: false, error: "Application not found" }, { status: 404 });
        }

        const slotAccess = await validateAssignedAssessmentSlotWindow(application.id);
        if (!slotAccess.allowed) {
            return NextResponse.json({ success: false, error: slotAccess.error || "Assessment access denied" }, { status: 400 });
        }

        const { data: interview, error: interviewError } = await supabaseAdmin
            .from("interviews")
            .select("id, job_id, title, assessment_duration_minutes")
            .eq("id", application.interview_id)
            .maybeSingle();

        if (interviewError || !interview) {
            return NextResponse.json({ success: false, error: "Interview not found" }, { status: 404 });
        }

        const ensuredWindow = await ensureAttemptSessionWindow(
            attempt,
            normalizeAssessmentDuration(interview.assessment_duration_minutes),
        );

        if (!ensuredWindow.ok) {
            return NextResponse.json({ success: false, error: ensuredWindow.error }, { status: ensuredWindow.status });
        }

        const { data: jobData, error: jobError } = await supabaseAdmin
            .from("jobs")
            .select("position_title, job_description, skills_required")
            .eq("id", interview.job_id)
            .maybeSingle();

        if (jobError || !jobData) {
            return NextResponse.json({ success: false, error: "Job details not found" }, { status: 404 });
        }

        let attemptQuestionIds: number[] = [];
        try {
            attemptQuestionIds = await ensureAttemptQuestionsStored({
                attemptId: attempt.id,
                interviewId: interview.id,
                interviewTitle: interview.title,
                positionTitle: jobData.position_title,
                jobDescription: jobData.job_description,
                skillsRequired: parseSkillsRequired(jobData.skills_required),
                questionCount: 20,
            });
        } catch (error) {
            console.error("Assessment question generation error:", error);
            return NextResponse.json(
                { success: false, error: "Failed to generate assessment questions for this session" },
                { status: 502 },
            );
        }

        const validQuestionIds = new Set(attemptQuestionIds);
        const answerMap = new Map<number, string>();

        responses.forEach((item: { questionId?: number; selectedOptionLabel?: string }) => {
            const qid = Number(item?.questionId);
            const selected = String(item?.selectedOptionLabel || "").trim().toUpperCase();
            if (Number.isInteger(qid) && qid > 0 && validQuestionIds.has(qid) && selected) {
                answerMap.set(qid, selected);
            }
        });

        const nowIso = new Date().toISOString();

        try {
            await persistAttemptResponses({
                attemptId: attempt.id,
                questionIds: attemptQuestionIds,
                answerMap,
                nowIso,
            });
        } catch {
            return NextResponse.json({ success: false, error: "Failed to autosave responses" }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            message: "Draft saved",
            data: {
                savedCount: attemptQuestionIds.length,
                savedAt: nowIso,
            },
        });
    } catch (error) {
        console.error("Candidate assessment PATCH error:", error);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const token = String(body?.token || "").trim();
        const responses = Array.isArray(body?.responses) ? body.responses : [];

        if (!token) {
            return NextResponse.json({ success: false, error: "Missing token" }, { status: 400 });
        }

        const { data: attempt, error: attemptError } = await supabaseAdmin
            .from("assessment_attempts")
            .select("id, application_id, started_at, submitted_at, session_valid_from, session_valid_until")
            .eq("session_token", token)
            .maybeSingle();

        if (attemptError || !attempt) {
            return NextResponse.json({ success: false, error: "Invalid assessment token" }, { status: 404 });
        }

        if (attempt.submitted_at) {
            return NextResponse.json({ success: false, error: "Assessment already submitted" }, { status: 400 });
        }

        const { data: application, error: applicationError } = await supabaseAdmin
            .from("applications")
            .select("id, interview_id")
            .eq("id", attempt.application_id)
            .maybeSingle();

        if (applicationError || !application) {
            return NextResponse.json({ success: false, error: "Application not found" }, { status: 404 });
        }

        const slotAccess = await validateAssignedAssessmentSlotWindow(application.id);
        if (!slotAccess.allowed) {
            return NextResponse.json({ success: false, error: slotAccess.error || "Assessment access denied" }, { status: 400 });
        }

        const { data: interview, error: interviewError } = await supabaseAdmin
            .from("interviews")
            .select("id, job_id, title, assessment_duration_minutes")
            .eq("id", application.interview_id)
            .maybeSingle();

        if (interviewError || !interview) {
            return NextResponse.json({ success: false, error: "Interview not found" }, { status: 404 });
        }

        const ensuredWindow = await ensureAttemptSessionWindow(
            attempt,
            normalizeAssessmentDuration(interview.assessment_duration_minutes),
        );

        if (!ensuredWindow.ok) {
            return NextResponse.json({ success: false, error: ensuredWindow.error }, { status: ensuredWindow.status });
        }

        const { data: jobData, error: jobError } = await supabaseAdmin
            .from("jobs")
            .select("position_title, job_description, skills_required")
            .eq("id", interview.job_id)
            .maybeSingle();

        if (jobError || !jobData) {
            return NextResponse.json({ success: false, error: "Job details not found" }, { status: 404 });
        }

        let attemptQuestionIds: number[] = [];
        try {
            attemptQuestionIds = await ensureAttemptQuestionsStored({
                attemptId: attempt.id,
                interviewId: interview.id,
                interviewTitle: interview.title,
                positionTitle: jobData.position_title,
                jobDescription: jobData.job_description,
                skillsRequired: parseSkillsRequired(jobData.skills_required),
                questionCount: 20,
            });
        } catch (error) {
            console.error("Assessment question generation error:", error);
            return NextResponse.json(
                { success: false, error: "Failed to generate assessment questions for this session" },
                { status: 502 },
            );
        }

        const { data: questionRows, error: questionError } = await supabaseAdmin
            .from("assessment_questions")
            .select("id, correct_option_label")
            .in("id", attemptQuestionIds);

        if (questionError || !questionRows) {
            return NextResponse.json({ success: false, error: "Failed to load assessment questions" }, { status: 500 });
        }

        const questions = questionRows as Array<{ id: number; correct_option_label: string }>;
        const answerMap = new Map<number, string>();

        responses.forEach((item: { questionId?: number; selectedOptionLabel?: string }) => {
            const qid = Number(item?.questionId);
            const selected = String(item?.selectedOptionLabel || "").trim().toUpperCase();
            if (Number.isInteger(qid) && qid > 0) {
                answerMap.set(qid, selected);
            }
        });

        const nowIso = new Date().toISOString();

        const correctOptionByQuestionId = new Map<number, string>();
        questions.forEach((q) => {
            correctOptionByQuestionId.set(q.id, q.correct_option_label);
        });

        try {
            await persistAttemptResponses({
                attemptId: attempt.id,
                questionIds: questions.map((q) => q.id),
                answerMap,
                nowIso,
                correctOptionByQuestionId,
            });
        } catch {
            return NextResponse.json({ success: false, error: "Failed to save responses" }, { status: 500 });
        }

        const finalizedResponseRows = questions.map((q) => {
            const selected = answerMap.get(q.id) || null;
            return {
                is_correct: selected ? selected === q.correct_option_label : null,
            };
        });

        const totalQuestions = questions.length;
        const correctAnswers = finalizedResponseRows.filter((r) => r.is_correct === true).length;
        const score = totalQuestions > 0 ? Number(((correctAnswers / totalQuestions) * 100).toFixed(2)) : 0;
        const startedAtTs = attempt.started_at ? new Date(attempt.started_at).getTime() : Date.now();
        const durationSeconds = Math.max(0, Math.round((Date.now() - startedAtTs) / 1000));

        const { error: updateAttemptError } = await supabaseAdmin
            .from("assessment_attempts")
            .update({
                started_at: attempt.started_at ?? nowIso,
                submitted_at: nowIso,
                session_valid_until: nowIso,
                status: "COMPLETED",
                total_questions: totalQuestions,
                correct_answers: correctAnswers,
                score,
                duration_seconds: durationSeconds,
            })
            .eq("id", attempt.id);

        if (updateAttemptError) {
            return NextResponse.json({ success: false, error: "Failed to submit assessment" }, { status: 500 });
        }

        await supabaseAdmin
            .from("applications")
            .update({ status: "INTERVIEW_IN_PROGRESS" })
            .eq("id", application.id);

        return NextResponse.json({
            success: true,
            message: "Assessment submitted successfully",
            data: {
                totalQuestions,
                correctAnswers,
                score,
                durationSeconds,
            },
        });
    } catch (error) {
        console.error("Candidate assessment POST error:", error);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}
