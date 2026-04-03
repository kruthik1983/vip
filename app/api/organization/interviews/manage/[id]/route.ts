import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyToken } from "@/lib/auth";

interface ManagePayload {
    assessmentQuestions: Array<{
        id?: number;
        questionText: string;
        questionOrder: number;
        options: Array<{ label: string; text: string; isCorrect: boolean }>;
        correctOptionLabel: string;
    }>;
    interviewFallbackQuestions: Array<{
        id?: number;
        questionText: string;
        difficultyLevel: string;
        questionOrder: number;
    }>;
}

async function validateOrgAdmin(request: NextRequest) {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
        return { error: NextResponse.json({ success: false, error: "Missing authorization token" }, { status: 401 }) };
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

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const auth = await validateOrgAdmin(request);
        if (auth.error) {
            return auth.error;
        }

        const { verifiedUser } = auth;
        const resolvedParams = await params;
        const interviewId = parseInt(resolvedParams.id);

        if (!Number.isInteger(interviewId) || interviewId <= 0) {
            return NextResponse.json({ success: false, error: "Invalid interview id" }, { status: 400 });
        }

        const { data: interviewData, error: interviewError } = await supabaseAdmin
            .from("interviews")
            .select(
                "id, title, status, organization_id, job_id, campaign_start_utc, campaign_end_utc, assessment_duration_minutes, interview_duration_minutes, created_at, published_at"
            )
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

        const { data: jobData } = await supabaseAdmin
            .from("jobs")
            .select("id, position_title, job_description, skills_required, ctc_min, ctc_max")
            .eq("id", interviewData.job_id)
            .single();

        const { data: assessmentSlots } = await supabaseAdmin
            .from("assessment_slots")
            .select("id, slot_start_utc, slot_end_utc, max_candidates, assigned_candidates")
            .eq("interview_id", interviewId)
            .order("slot_start_utc", { ascending: true });

        const { data: interviewSlots } = await supabaseAdmin
            .from("interview_slots")
            .select("id, slot_start_utc, slot_end_utc, max_candidates, assigned_candidates")
            .eq("interview_id", interviewId)
            .order("slot_start_utc", { ascending: true });

        const { data: questionSetData } = await supabaseAdmin
            .from("assessment_question_sets")
            .select("id, is_ai_generated")
            .eq("interview_id", interviewId)
            .single();

        let assessmentQuestions: Array<{
            id: number;
            question_text: string;
            question_order: number;
            options: Array<{ label: string; text: string; isCorrect: boolean }>;
            correct_option_label: string;
        }> = [];

        if (questionSetData?.id) {
            const { data } = await supabaseAdmin
                .from("assessment_questions")
                .select("id, question_text, question_order, options, correct_option_label")
                .eq("question_set_id", questionSetData.id)
                .order("question_order", { ascending: true });

            assessmentQuestions = (data ?? []).map((q) => ({
                ...q,
                options: Array.isArray(q.options)
                    ? q.options
                    : [
                        { label: "A", text: "", isCorrect: false },
                        { label: "B", text: "", isCorrect: false },
                        { label: "C", text: "", isCorrect: false },
                        { label: "D", text: "", isCorrect: false },
                    ],
            }));
        }

        const { data: fallbackQuestions } = await supabaseAdmin
            .from("interview_fallback_questions")
            .select("id, question_text, difficulty_level, question_order")
            .eq("interview_id", interviewId)
            .order("question_order", { ascending: true });

        // Show the most recently generated application link, even if it is expired/inactive.
        // This avoids a confusing "No active link" state when the interview previously had one.
        const { data: applicationLink } = await supabaseAdmin
            .from("application_links")
            .select("application_link, application_token, valid_from, valid_until, is_active, created_at")
            .eq("interview_id", interviewId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        return NextResponse.json({
            success: true,
            data: {
                interview: interviewData,
                job: jobData,
                assessmentSlots: assessmentSlots ?? [],
                interviewSlots: interviewSlots ?? [],
                assessmentQuestionSet: questionSetData ?? null,
                assessmentQuestions,
                interviewFallbackQuestions: fallbackQuestions ?? [],
                applicationLink: applicationLink ?? null,
            },
        });
    } catch (error) {
        console.error("Manage interview GET error:", error);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}

export async function PATCH(
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
        const interviewId = parseInt(resolvedParams.id);

        if (!Number.isInteger(interviewId) || interviewId <= 0) {
            return NextResponse.json({ success: false, error: "Invalid interview id" }, { status: 400 });
        }

        const { data: interviewData, error: interviewError } = await supabaseAdmin
            .from("interviews")
            .select("id, organization_id")
            .eq("id", interviewId)
            .single();

        if (interviewError || !interviewData) {
            return NextResponse.json({ success: false, error: "Interview not found" }, { status: 404 });
        }

        if (interviewData.organization_id !== verifiedUser.organization_id) {
            return NextResponse.json(
                { success: false, error: "Unauthorized to update this interview" },
                { status: 403 }
            );
        }

        const body: ManagePayload = await request.json();

        if (!Array.isArray(body.assessmentQuestions) || !Array.isArray(body.interviewFallbackQuestions)) {
            return NextResponse.json({ success: false, error: "Invalid payload" }, { status: 400 });
        }

        const { data: existingQuestionSetData, error: questionSetError } = await supabaseAdmin
            .from("assessment_question_sets")
            .select("id")
            .eq("interview_id", interviewId)
            .single();

        let questionSetId = existingQuestionSetData?.id;

        if (questionSetError || !questionSetId) {
            const { data: createdSet, error: createSetError } = await supabaseAdmin
                .from("assessment_question_sets")
                .insert({
                    interview_id: interviewId,
                    is_ai_generated: false,
                })
                .select("id")
                .single();

            if (createSetError || !createdSet) {
                return NextResponse.json(
                    { success: false, error: "Failed to initialize assessment question set" },
                    { status: 500 }
                );
            }

            questionSetId = createdSet.id;
        }

        // Replace-all strategy: allows add, delete, and update in one save.
        const { error: deleteAssessmentError } = await supabaseAdmin
            .from("assessment_questions")
            .delete()
            .eq("question_set_id", questionSetId);

        if (deleteAssessmentError) {
            return NextResponse.json(
                { success: false, error: "Failed to update assessment questions" },
                { status: 500 }
            );
        }

        const normalizedAssessmentQuestions = body.assessmentQuestions
            .filter((question) => question.questionText?.trim())
            .map((question, index) => ({
                question_set_id: questionSetId,
                question_text: question.questionText.trim(),
                question_order: index + 1,
                options: question.options,
                correct_option_label: question.correctOptionLabel,
            }));

        if (normalizedAssessmentQuestions.length > 0) {
            const { error: insertAssessmentError } = await supabaseAdmin
                .from("assessment_questions")
                .insert(normalizedAssessmentQuestions);

            if (insertAssessmentError) {
                return NextResponse.json(
                    { success: false, error: "Failed to save assessment questions" },
                    { status: 500 }
                );
            }
        }

        const { error: deleteFallbackError } = await supabaseAdmin
            .from("interview_fallback_questions")
            .delete()
            .eq("interview_id", interviewId);

        if (deleteFallbackError) {
            return NextResponse.json(
                { success: false, error: "Failed to update interview fallback questions" },
                { status: 500 }
            );
        }

        const normalizedFallbackQuestions = body.interviewFallbackQuestions
            .filter((question) => question.questionText?.trim())
            .map((question, index) => ({
                interview_id: interviewId,
                question_text: question.questionText.trim(),
                difficulty_level: question.difficultyLevel,
                question_order: index + 1,
            }));

        if (normalizedFallbackQuestions.length > 0) {
            const { error: insertFallbackError } = await supabaseAdmin
                .from("interview_fallback_questions")
                .insert(normalizedFallbackQuestions);

            if (insertFallbackError) {
                return NextResponse.json(
                    { success: false, error: "Failed to save interview fallback questions" },
                    { status: 500 }
                );
            }
        }

        await supabaseAdmin.from("audit_logs").insert({
            actor_user_id: verifiedUser.id,
            actor_role: "ORG_ADMIN",
            action_type: "INTERVIEW_DETAILS_UPDATED",
            entity_type: "INTERVIEW",
            entity_id: interviewId,
            new_values: {
                updated_assessment_question_count: body.assessmentQuestions.length,
                updated_fallback_question_count: body.interviewFallbackQuestions.length,
            },
        });

        return NextResponse.json({ success: true, message: "Interview questions updated successfully" });
    } catch (error) {
        console.error("Manage interview PATCH error:", error);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}
