import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyToken } from "@/lib/auth";

type AddCandidatePayload = {
    candidateName: string;
    candidateEmail: string;
    candidatePhone: string | null;
    assessmentSlotId: number;
    interviewSlotId: number;
};

function generateToken() {
    return crypto.randomBytes(24).toString("hex");
}

function isLikelyEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function validateOrgAdmin(request: NextRequest) {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
        return {
            error: NextResponse.json({ success: false, error: "Missing authorization token" }, { status: 401 }),
        };
    }

    const verifiedUser = await verifyToken(token);
    if (!verifiedUser || verifiedUser.role !== "ORG_ADMIN") {
        return {
            error: NextResponse.json(
                { success: false, error: "Unauthorized. Organization admin required." },
                { status: 403 },
            ),
        };
    }

    return { verifiedUser };
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const auth = await validateOrgAdmin(request);
        if (auth.error) {
            return auth.error;
        }

        const { verifiedUser } = auth;
        const { id } = await params;
        const interviewId = Number(id);

        if (!Number.isInteger(interviewId) || interviewId <= 0) {
            return NextResponse.json({ success: false, error: "Invalid interview id" }, { status: 400 });
        }

        const body = (await request.json()) as Partial<AddCandidatePayload>;

        const candidateName = String(body.candidateName || "").trim();
        const candidateEmail = String(body.candidateEmail || "").trim().toLowerCase();
        const candidatePhone = String(body.candidatePhone || "").trim() || null;
        const assessmentSlotId = Number(body.assessmentSlotId);
        const interviewSlotId = Number(body.interviewSlotId);

        if (!candidateName) {
            return NextResponse.json({ success: false, error: "Candidate name is required" }, { status: 400 });
        }

        if (!candidateEmail || !isLikelyEmail(candidateEmail)) {
            return NextResponse.json({ success: false, error: "Valid candidate email is required" }, { status: 400 });
        }

        if (!Number.isInteger(assessmentSlotId) || assessmentSlotId <= 0) {
            return NextResponse.json({ success: false, error: "Select a valid assessment slot" }, { status: 400 });
        }

        if (!Number.isInteger(interviewSlotId) || interviewSlotId <= 0) {
            return NextResponse.json({ success: false, error: "Select a valid interview slot" }, { status: 400 });
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
            return NextResponse.json({ success: false, error: "Unauthorized to update this interview" }, { status: 403 });
        }

        const [{ data: assessmentSlot, error: assessmentSlotError }, { data: interviewSlot, error: interviewSlotError }] = await Promise.all([
            supabaseAdmin
                .from("assessment_slots")
                .select("id, interview_id, slot_start_utc, slot_end_utc, assigned_candidates")
                .eq("id", assessmentSlotId)
                .eq("interview_id", interviewId)
                .single(),
            supabaseAdmin
                .from("interview_slots")
                .select("id, interview_id, slot_start_utc, slot_end_utc, assigned_candidates")
                .eq("id", interviewSlotId)
                .eq("interview_id", interviewId)
                .single(),
        ]);

        if (assessmentSlotError || !assessmentSlot) {
            return NextResponse.json({ success: false, error: "Assessment slot not found" }, { status: 404 });
        }

        if (interviewSlotError || !interviewSlot) {
            return NextResponse.json({ success: false, error: "Interview slot not found" }, { status: 404 });
        }

        const { data: insertedApplication, error: insertApplicationError } = await supabaseAdmin
            .from("applications")
            .insert({
                interview_id: interviewId,
                candidate_name: candidateName,
                candidate_email: candidateEmail,
                candidate_phone: candidatePhone,
                status: "APPLIED",
            })
            .select("id")
            .single();

        if (insertApplicationError || !insertedApplication) {
            if (insertApplicationError?.code === "23505") {
                return NextResponse.json(
                    { success: false, error: "An application with this email already exists for this interview" },
                    { status: 409 },
                );
            }

            console.error("Add candidate application insert error:", insertApplicationError);
            return NextResponse.json({
                success: false,
                error: insertApplicationError?.message ?? "Failed to create candidate application",
            }, { status: 500 });
        }

        const applicationId = insertedApplication.id;

        const assessmentValidUntil = new Date(assessmentSlot.slot_end_utc);
        const assessmentValidFrom = new Date(new Date(assessmentSlot.slot_start_utc).getTime() - 2 * 60 * 60 * 1000);
        const interviewValidUntil = new Date(interviewSlot.slot_end_utc);
        const interviewValidFrom = new Date(new Date(interviewSlot.slot_start_utc).getTime() - 2 * 60 * 60 * 1000);

        const assessmentToken = generateToken();
        const interviewToken = generateToken();

        const { data: insertedAssessmentAttempt, error: insertAssessmentAttemptError } = await supabaseAdmin
            .from("assessment_attempts")
            .insert({
                application_id: applicationId,
                status: "SLOT_ASSIGNED",
                session_token: assessmentToken,
                session_valid_from: assessmentValidFrom.toISOString(),
                session_valid_until: assessmentValidUntil.toISOString(),
            })
            .select("id")
            .single();

        if (insertAssessmentAttemptError || !insertedAssessmentAttempt) {
            await supabaseAdmin.from("applications").delete().eq("id", applicationId);
            return NextResponse.json({ success: false, error: "Failed to create assessment session" }, { status: 500 });
        }

        const { error: insertInterviewSessionError } = await supabaseAdmin
            .from("interview_sessions")
            .insert({
                application_id: applicationId,
                assessment_attempt_id: insertedAssessmentAttempt.id,
                status: "SLOT_ASSIGNED",
                session_token: interviewToken,
                session_valid_from: interviewValidFrom.toISOString(),
                session_valid_until: interviewValidUntil.toISOString(),
            });

        if (insertInterviewSessionError) {
            await supabaseAdmin.from("applications").delete().eq("id", applicationId);
            return NextResponse.json({ success: false, error: "Failed to create interview session" }, { status: 500 });
        }

        const { error: insertPreferencesError } = await supabaseAdmin
            .from("application_slot_preferences")
            .insert([
                {
                    application_id: applicationId,
                    slot_type: "assessment",
                    preference_rank: 1,
                    preferred_assessment_slot_id: assessmentSlotId,
                    preferred_interview_slot_id: null,
                },
                {
                    application_id: applicationId,
                    slot_type: "interview",
                    preference_rank: 1,
                    preferred_assessment_slot_id: null,
                    preferred_interview_slot_id: interviewSlotId,
                },
            ]);

        if (insertPreferencesError) {
            await supabaseAdmin.from("applications").delete().eq("id", applicationId);
            return NextResponse.json({ success: false, error: "Failed to create slot preferences" }, { status: 500 });
        }

        const nextAssessmentCount = Number(assessmentSlot.assigned_candidates ?? 0) + 1;
        const nextInterviewCount = Number(interviewSlot.assigned_candidates ?? 0) + 1;

        await Promise.all([
            supabaseAdmin
                .from("assessment_slots")
                .update({ assigned_candidates: nextAssessmentCount })
                .eq("id", assessmentSlotId),
            supabaseAdmin
                .from("interview_slots")
                .update({ assigned_candidates: nextInterviewCount })
                .eq("id", interviewSlotId),
        ]);

        await supabaseAdmin.from("audit_logs").insert({
            actor_user_id: verifiedUser.id,
            actor_role: "ORG_ADMIN",
            action_type: "CANDIDATE_MANUALLY_ADDED",
            entity_type: "APPLICATION",
            entity_id: applicationId,
            new_values: {
                interview_id: interviewId,
                candidate_name: candidateName,
                candidate_email: candidateEmail,
                assigned_assessment_slot_id: assessmentSlotId,
                assigned_interview_slot_id: interviewSlotId,
            },
        });

        return NextResponse.json({
            success: true,
            message: "Candidate added successfully",
            data: {
                applicationId,
            },
        });
    } catch (error) {
        console.error("Add candidate POST error:", error);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}
