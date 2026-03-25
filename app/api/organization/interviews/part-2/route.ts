import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyToken } from "@/lib/auth";
import { generateAssessmentQuestionsFromOllama } from "@/lib/ollama";

interface AssessmentQuestion {
    questionText: string;
    options: Array<{ label: string; text: string; isCorrect: boolean }>;
}

interface InterviewQuestion {
    questionText: string;
    difficulty: "EASY" | "MEDIUM" | "HARD";
}

interface PartTwoPayload {
    interviewId: number;
    assessmentSlotConfig: {
        enabled: boolean;
        firstSlotStartUtc: string;
        numberOfSlots: number;
        maxCandidatesPerSlot: number;
    };
    interviewSlotConfig: {
        enabled: boolean;
        firstSlotStartUtc: string;
        numberOfSlots: number;
        maxCandidatesPerSlot: number;
    };
    assessment: {
        isAiGenerated: boolean;
        questions?: AssessmentQuestion[];
    };
    interview: {
        fallbackQuestions: InterviewQuestion[];
    };
}

function getAssessmentGenerationErrorMessage(error: unknown) {
    if (error instanceof Error && error.message.toLowerCase().includes("ollama is unavailable")) {
        return error.message;
    }

    return "Failed to generate AI assessment questions. Please retry or switch to custom mode.";
}

export async function POST(request: NextRequest) {
    try {
        // ===== 1. VERIFY AUTH =====
        const token = request.headers.get("authorization")?.replace("Bearer ", "");
        if (!token) {
            return NextResponse.json(
                { success: false, error: "Missing authorization token" },
                { status: 401 }
            );
        }

        const verifiedUser = await verifyToken(token);
        if (!verifiedUser || verifiedUser.role !== "ORG_ADMIN") {
            return NextResponse.json(
                { success: false, error: "Unauthorized. Organization admin required." },
                { status: 403 }
            );
        }

        // ===== 2. PARSE & VALIDATE PAYLOAD =====
        const body: PartTwoPayload = await request.json();

        if (!body.interviewId || body.interviewId <= 0) {
            return NextResponse.json(
                { success: false, error: "Valid interview ID is required" },
                { status: 400 }
            );
        }

        if (!body.assessment || typeof body.assessment.isAiGenerated !== "boolean") {
            return NextResponse.json(
                { success: false, error: "Assessment configuration is required" },
                { status: 400 }
            );
        }

        if (!body.interview || !Array.isArray(body.interview.fallbackQuestions)) {
            return NextResponse.json(
                { success: false, error: "Interview fallback questions are required" },
                { status: 400 }
            );
        }

        // ===== 3. VERIFY INTERVIEW EXISTS & BELONGS TO ORG =====
        const { data: interviewData, error: interviewError } = await supabaseAdmin
            .from("interviews")
            .select("id, organization_id, job_id, title, campaign_start_utc, campaign_end_utc")
            .eq("id", body.interviewId)
            .single();

        if (interviewError || !interviewData) {
            return NextResponse.json(
                { success: false, error: "Interview not found" },
                { status: 404 }
            );
        }

        if (interviewData.organization_id !== verifiedUser.organization_id) {
            return NextResponse.json(
                { success: false, error: "Unauthorized to modify this interview" },
                { status: 403 }
            );
        }

        // ===== 4. GENERATE ASSESSMENT SLOTS (20 min each) =====
        const assessmentSlots: Array<{ start: Date; end: Date }> = [];
        if (body.assessmentSlotConfig.enabled) {
            const firstSlotStart = new Date(body.assessmentSlotConfig.firstSlotStartUtc);
            if (!Number.isFinite(firstSlotStart.getTime())) {
                return NextResponse.json(
                    { success: false, error: "Invalid assessment first slot start time" },
                    { status: 400 }
                );
            }

            const numSlots = body.assessmentSlotConfig.numberOfSlots;
            if (!Number.isInteger(numSlots) || numSlots <= 0) {
                return NextResponse.json(
                    { success: false, error: "Number of assessment slots must be at least 1" },
                    { status: 400 }
                );
            }

            // Generate assessment slots: 20 min each, starting at firstSlotStart, 1 hour apart
            for (let i = 0; i < numSlots; i++) {
                const slotStart = new Date(firstSlotStart.getTime() + i * 60 * 60 * 1000); // 1 hour apart
                const slotEnd = new Date(slotStart.getTime() + 20 * 60 * 1000); // 20 minutes
                assessmentSlots.push({ start: slotStart, end: slotEnd });
            }
        }

        // ===== 5. GENERATE INTERVIEW SLOTS (40 min each) =====
        // Constraint: interview_slot.start >= assessment_slot.end (no overlap)
        const interviewSlots: Array<{ start: Date; end: Date }> = [];
        if (body.interviewSlotConfig.enabled) {
            const firstSlotStart = new Date(body.interviewSlotConfig.firstSlotStartUtc);
            if (!Number.isFinite(firstSlotStart.getTime())) {
                return NextResponse.json(
                    { success: false, error: "Invalid interview first slot start time" },
                    { status: 400 }
                );
            }

            const numSlots = body.interviewSlotConfig.numberOfSlots;
            if (!Number.isInteger(numSlots) || numSlots <= 0) {
                return NextResponse.json(
                    { success: false, error: "Number of interview slots must be at least 1" },
                    { status: 400 }
                );
            }

            // Generate interview slots: 40 min each, starting at firstSlotStart, 1 hour apart
            for (let i = 0; i < numSlots; i++) {
                const slotStart = new Date(firstSlotStart.getTime() + i * 60 * 60 * 1000); // 1 hour apart
                const slotEnd = new Date(slotStart.getTime() + 40 * 60 * 1000); // 40 minutes
                interviewSlots.push({ start: slotStart, end: slotEnd });
            }

            // Verify no overlap: each interview slot must start after it's paired assessment slot ends
            if (assessmentSlots.length > 0 && interviewSlots.length > 0) {
                for (let i = 0; i < Math.min(assessmentSlots.length, interviewSlots.length); i++) {
                    const assessEnd = assessmentSlots[i].end;
                    const interviewStart = interviewSlots[i].start;

                    if (assessEnd > interviewStart) {
                        return NextResponse.json(
                            { success: false, error: `Slot ${i + 1}: Assessment ends at ${assessEnd.toISOString()} but interview starts at ${interviewStart.toISOString()}. Overlapping times detected.` },
                            { status: 400 }
                        );
                    }
                }
            }
        }

        // ===== 6. INSERT ASSESSMENT SLOTS =====
        if (assessmentSlots.length > 0) {
            const { error: clearError } = await supabaseAdmin
                .from("assessment_slots")
                .delete()
                .eq("interview_id", body.interviewId);

            if (clearError) {
                console.error("Clear assessment slots error:", clearError);
                return NextResponse.json(
                    { success: false, error: "Failed to refresh assessment slots" },
                    { status: 500 }
                );
            }

            for (const slot of assessmentSlots) {
                const { error: slotError } = await supabaseAdmin.from("assessment_slots").insert({
                    interview_id: body.interviewId,
                    slot_start_utc: slot.start.toISOString(),
                    slot_end_utc: slot.end.toISOString(),
                    max_candidates: body.assessmentSlotConfig.maxCandidatesPerSlot,
                });

                if (slotError) {
                    console.error("Assessment slot creation error:", slotError);
                    return NextResponse.json(
                        { success: false, error: "Failed to create assessment slots" },
                        { status: 500 }
                    );
                }
            }
        }

        // ===== 7. INSERT INTERVIEW SLOTS =====
        if (interviewSlots.length > 0) {
            const { error: clearError } = await supabaseAdmin
                .from("interview_slots")
                .delete()
                .eq("interview_id", body.interviewId);

            if (clearError) {
                console.error("Clear interview slots error:", clearError);
                return NextResponse.json(
                    { success: false, error: "Failed to refresh interview slots" },
                    { status: 500 }
                );
            }

            for (const slot of interviewSlots) {
                const { error: slotError } = await supabaseAdmin.from("interview_slots").insert({
                    interview_id: body.interviewId,
                    slot_start_utc: slot.start.toISOString(),
                    slot_end_utc: slot.end.toISOString(),
                    max_candidates: body.interviewSlotConfig.maxCandidatesPerSlot,
                });

                if (slotError) {
                    console.error("Interview slot creation error:", slotError);
                    return NextResponse.json(
                        { success: false, error: "Failed to create interview slots" },
                        { status: 500 }
                    );
                }
            }
        }

        // ===== 8. GET ASSESSMENT QUESTION SET =====
        const { data: assessmentSetData, error: assessmentSetError } = await supabaseAdmin
            .from("assessment_question_sets")
            .select("id")
            .eq("interview_id", body.interviewId)
            .single();

        if (assessmentSetError || !assessmentSetData) {
            return NextResponse.json(
                { success: false, error: "Assessment question set not found" },
                { status: 404 }
            );
        }

        const { data: jobData, error: jobError } = await supabaseAdmin
            .from("jobs")
            .select("position_title, job_description, skills_required")
            .eq("id", interviewData.job_id)
            .maybeSingle();

        if (jobError || !jobData) {
            return NextResponse.json(
                { success: false, error: "Job details not found for AI question generation" },
                { status: 404 }
            );
        }

        // ===== 9. UPDATE ASSESSMENT CONFIG & ADD CUSTOM QUESTIONS IF PROVIDED =====
        const { error: updateAssessmentError } = await supabaseAdmin
            .from("assessment_question_sets")
            .update({ is_ai_generated: body.assessment.isAiGenerated })
            .eq("id", assessmentSetData.id);

        if (updateAssessmentError) {
            return NextResponse.json(
                { success: false, error: "Failed to update assessment configuration" },
                { status: 500 }
            );
        }

        const { error: clearAssessmentQuestionsError } = await supabaseAdmin
            .from("assessment_questions")
            .delete()
            .eq("question_set_id", assessmentSetData.id);

        if (clearAssessmentQuestionsError) {
            return NextResponse.json(
                { success: false, error: "Failed to refresh assessment questions" },
                { status: 500 }
            );
        }

        let finalAssessmentQuestions: AssessmentQuestion[] = [];

        if (body.assessment.isAiGenerated) {
            try {
                const skillsRequiredRaw = Array.isArray(jobData.skills_required)
                    ? (jobData.skills_required as unknown[])
                    : [];

                const generated = await generateAssessmentQuestionsFromOllama({
                    interviewTitle: String(interviewData.title || "Interview"),
                    positionTitle: String(jobData.position_title || "Role"),
                    jobDescription: String(jobData.job_description || ""),
                    skillsRequired: skillsRequiredRaw.map((skill) => String(skill)).filter((skill) => skill.trim().length > 0),
                    questionCount: 8,
                    variationKey: String(interviewData.id),
                });

                finalAssessmentQuestions = generated;
            } catch (error) {
                console.error("Ollama assessment generation error:", error);
                return NextResponse.json(
                    { success: false, error: getAssessmentGenerationErrorMessage(error) },
                    { status: 502 }
                );
            }
        } else if (body.assessment.questions) {
            finalAssessmentQuestions = body.assessment.questions;
        }

        if (!body.assessment.isAiGenerated && finalAssessmentQuestions.length === 0) {
            return NextResponse.json(
                { success: false, error: "At least one custom assessment question is required" },
                { status: 400 }
            );
        }

        for (let i = 0; i < finalAssessmentQuestions.length; i++) {
            const q = finalAssessmentQuestions[i];
            const correctOption = q.options.find((opt) => opt.isCorrect);

            if (!correctOption) {
                return NextResponse.json(
                    { success: false, error: `Question ${i + 1}: No correct option selected` },
                    { status: 400 }
                );
            }

            const { error: qError } = await supabaseAdmin
                .from("assessment_questions")
                .insert({
                    question_set_id: assessmentSetData.id,
                    question_text: q.questionText,
                    question_order: i + 1,
                    options: q.options,
                    correct_option_label: correctOption.label,
                });

            if (qError) {
                console.error("Assessment question creation error:", qError);
                return NextResponse.json(
                    { success: false, error: `Failed to create question ${i + 1}` },
                    { status: 500 }
                );
            }
        }

        const { error: clearInterviewQuestionsError } = await supabaseAdmin
            .from("interview_fallback_questions")
            .delete()
            .eq("interview_id", body.interviewId);

        if (clearInterviewQuestionsError) {
            return NextResponse.json(
                { success: false, error: "Failed to refresh interview fallback questions" },
                { status: 500 }
            );
        }

        // ===== 10. ADD INTERVIEW FALLBACK QUESTIONS =====
        for (let i = 0; i < body.interview.fallbackQuestions.length; i++) {
            const q = body.interview.fallbackQuestions[i];

            const { error: ivError } = await supabaseAdmin
                .from("interview_fallback_questions")
                .insert({
                    interview_id: body.interviewId,
                    question_text: q.questionText,
                    difficulty_level: q.difficulty,
                    question_order: i + 1,
                });

            if (ivError) {
                console.error("Interview fallback question creation error:", ivError);
                return NextResponse.json(
                    { success: false, error: `Failed to create interview question ${i + 1}` },
                    { status: 500 }
                );
            }
        }

        // ===== 11. LOG ACTION TO AUDIT LOGS =====
        await supabaseAdmin.from("audit_logs").insert({
            actor_user_id: verifiedUser.id,
            actor_role: "ORG_ADMIN",
            action_type: "INTERVIEW_PART2_CREATED",
            entity_type: "INTERVIEW",
            entity_id: body.interviewId,
            new_values: {
                assessment_slots_count: assessmentSlots.length,
                interview_slots_count: interviewSlots.length,
                assessment_ai_generated: body.assessment.isAiGenerated,
                interview_fallback_questions_count: body.interview.fallbackQuestions.length,
            },
        });

        // ===== 12. RETURN SUCCESS =====
        return NextResponse.json({
            success: true,
            data: {
                interviewId: body.interviewId,
                assessmentSlotsCreated: assessmentSlots.length,
                interviewSlotsCreated: interviewSlots.length,
                assessmentQuestions: finalAssessmentQuestions.length,
                interviewFallbackQuestions: body.interview.fallbackQuestions.length,
            },
            message: "Part 2 saved successfully. Proceed to Part 3 to publish.",
        });
    } catch (error) {
        console.error("Part 2 API Error:", error);
        return NextResponse.json(
            { success: false, error: "Internal server error" },
            { status: 500 }
        );
    }
}
