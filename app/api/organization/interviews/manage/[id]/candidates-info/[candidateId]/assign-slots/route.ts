import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyToken } from "@/lib/auth";

type AssignSlotsPayload = {
    assessmentSlotId?: number;
    interviewSlotId?: number;
    assessmentSessionToken?: string;
    interviewSessionToken?: string;
};

function generateToken() {
    return crypto.randomBytes(24).toString("hex");
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
    { params }: { params: Promise<{ id: string; candidateId: string }> },
) {
    try {
        const auth = await validateOrgAdmin(request);
        if (auth.error) {
            return auth.error;
        }

        const { verifiedUser } = auth;
        const { id, candidateId } = await params;

        const interviewId = Number(id);
        const applicationId = Number(candidateId);

        if (!Number.isInteger(interviewId) || interviewId <= 0 || !Number.isInteger(applicationId) || applicationId <= 0) {
            return NextResponse.json({ success: false, error: "Invalid interview or candidate id" }, { status: 400 });
        }

        const body = (await request.json()) as Partial<AssignSlotsPayload>;
        const requestedAssessmentSlotId = Number(body.assessmentSlotId);
        const requestedInterviewSlotId = Number(body.interviewSlotId);

        // Validate interview exists
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

        // Fetch application with actual schema columns
        const { data: applicationData, error: applicationError } = await supabaseAdmin
            .from("applications")
            .select("id, interview_id, candidate_name, candidate_email, assigned_assessment_slot_id, assigned_interview_slot_id")
            .eq("id", applicationId)
            .eq("interview_id", interviewId)
            .single();

        if (applicationError || !applicationData) {
            console.error("Application fetch error:", {
                applicationId,
                interviewId,
                error: applicationError?.message,
            });
            return NextResponse.json({ success: false, error: `Candidate application not found (ID: ${applicationId})` }, { status: 404 });
        }

        // Get current slot assignments from application record
        const currentAssessmentSlotId: number | null = applicationData.assigned_assessment_slot_id ?? null;
        const currentInterviewSlotId: number | null = applicationData.assigned_interview_slot_id ?? null;

        // Resolve to requested or current slot IDs
        const resolvedAssessmentSlotId: number | null =
            Number.isInteger(requestedAssessmentSlotId) && requestedAssessmentSlotId > 0
                ? requestedAssessmentSlotId
                : currentAssessmentSlotId;

        const resolvedInterviewSlotId: number | null =
            Number.isInteger(requestedInterviewSlotId) && requestedInterviewSlotId > 0
                ? requestedInterviewSlotId
                : currentInterviewSlotId;

        if (resolvedAssessmentSlotId == null || resolvedAssessmentSlotId <= 0) {
            return NextResponse.json({ success: false, error: "No assessment slot assigned for this candidate" }, { status: 400 });
        }

        if (resolvedInterviewSlotId == null || resolvedInterviewSlotId <= 0) {
            return NextResponse.json({ success: false, error: "No interview slot assigned for this candidate" }, { status: 400 });
        }

        const assessmentSlotId: number = resolvedAssessmentSlotId;
        const interviewSlotId: number = resolvedInterviewSlotId;

        // Fetch both slots
        const [{ data: assessmentSlot, error: assessmentSlotError }, { data: interviewSlot, error: interviewSlotError }] =
            await Promise.all([
                supabaseAdmin
                    .from("assessment_slots")
                    .select("id, interview_id, slot_start_utc, slot_end_utc, max_candidates, assigned_candidates")
                    .eq("id", assessmentSlotId)
                    .eq("interview_id", interviewId)
                    .single(),
                supabaseAdmin
                    .from("interview_slots")
                    .select("id, interview_id, slot_start_utc, slot_end_utc, max_candidates, assigned_candidates")
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

        const nowIso = new Date().toISOString();

        // Update applications table with both assessment and interview slot assignments
        const { error: updateApplicationError } = await supabaseAdmin
            .from("applications")
            .update({
                assigned_assessment_slot_id: assessmentSlotId,
                assigned_interview_slot_id: interviewSlotId,
                assessment_slot_assigned_at: nowIso,
                interview_slot_assigned_at: nowIso,
                status: "SLOT_ASSIGNED",
                updated_at: nowIso,
            })
            .eq("id", applicationId)
            .eq("interview_id", interviewId);

        if (updateApplicationError) {
            console.error("Update applications error:", updateApplicationError);
            return NextResponse.json(
                { success: false, error: `Failed to update application: ${updateApplicationError.message}` },
                { status: 500 },
            );
        }

        // Update slot counters if slots changed
        if (currentAssessmentSlotId !== assessmentSlotId) {
            if (currentAssessmentSlotId && currentAssessmentSlotId > 0) {
                const { data: oldAssessment } = await supabaseAdmin
                    .from("assessment_slots")
                    .select("assigned_candidates")
                    .eq("id", currentAssessmentSlotId)
                    .single();

                const oldCount = Math.max(0, Number(oldAssessment?.assigned_candidates ?? 0) - 1);
                await supabaseAdmin
                    .from("assessment_slots")
                    .update({ assigned_candidates: oldCount })
                    .eq("id", currentAssessmentSlotId);
            }

            const newAssessmentCount = Math.max(1, Number(assessmentSlot.assigned_candidates ?? 0) + 1);
            await supabaseAdmin
                .from("assessment_slots")
                .update({ assigned_candidates: newAssessmentCount })
                .eq("id", assessmentSlotId);
        }

        if (currentInterviewSlotId !== interviewSlotId) {
            if (currentInterviewSlotId && currentInterviewSlotId > 0) {
                const { data: oldInterview } = await supabaseAdmin
                    .from("interview_slots")
                    .select("assigned_candidates")
                    .eq("id", currentInterviewSlotId)
                    .single();

                const oldCount = Math.max(0, Number(oldInterview?.assigned_candidates ?? 0) - 1);
                await supabaseAdmin
                    .from("interview_slots")
                    .update({ assigned_candidates: oldCount })
                    .eq("id", currentInterviewSlotId);
            }

            const newInterviewCount = Math.max(1, Number(interviewSlot.assigned_candidates ?? 0) + 1);
            await supabaseAdmin
                .from("interview_slots")
                .update({ assigned_candidates: newInterviewCount })
                .eq("id", interviewSlotId);
        }

        // Update session validity windows based on slot times
        const assessmentStart = new Date(assessmentSlot.slot_start_utc);
        const assessmentEnd = new Date(assessmentSlot.slot_end_utc);
        const interviewStart = new Date(interviewSlot.slot_start_utc);
        const interviewEnd = new Date(interviewSlot.slot_end_utc);

        const defaultAssessmentFrom = new Date(assessmentStart.getTime() - 2 * 60 * 60 * 1000);
        const defaultInterviewFrom = new Date(interviewStart.getTime() - 2 * 60 * 60 * 1000);

        const assessmentValidFrom = defaultAssessmentFrom.toISOString();
        const assessmentValidUntil = assessmentEnd.toISOString();
        const interviewValidFrom = defaultInterviewFrom.toISOString();
        const interviewValidUntil = interviewEnd.toISOString();

        // Fetch or create assessment attempt
        const { data: existingAssessmentAttempt } = await supabaseAdmin
            .from("assessment_attempts")
            .select("id, session_token")
            .eq("application_id", applicationId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        const assessmentSessionToken =
            String(body.assessmentSessionToken || "").trim() || existingAssessmentAttempt?.session_token || generateToken();

        let assessmentAttemptId = existingAssessmentAttempt?.id;

        if (existingAssessmentAttempt?.id) {
            const { error: updateAssessmentError } = await supabaseAdmin
                .from("assessment_attempts")
                .update({
                    session_token: assessmentSessionToken,
                    session_valid_from: assessmentValidFrom,
                    session_valid_until: assessmentValidUntil,
                })
                .eq("id", existingAssessmentAttempt.id);

            if (updateAssessmentError) {
                if (updateAssessmentError.code === "23505") {
                    return NextResponse.json(
                        { success: false, error: "Assessment session token already exists" },
                        { status: 409 },
                    );
                }
                return NextResponse.json({ success: false, error: "Failed to update assessment session" }, { status: 500 });
            }
        } else {
            const { data: insertedAssessment, error: createAssessmentError } = await supabaseAdmin
                .from("assessment_attempts")
                .insert({
                    application_id: applicationId,
                    status: "SLOT_ASSIGNED",
                    session_token: assessmentSessionToken,
                    session_valid_from: assessmentValidFrom,
                    session_valid_until: assessmentValidUntil,
                })
                .select("id")
                .single();

            if (createAssessmentError || !insertedAssessment) {
                if (createAssessmentError?.code === "23505") {
                    return NextResponse.json(
                        { success: false, error: "Assessment session token already exists" },
                        { status: 409 },
                    );
                }
                return NextResponse.json({ success: false, error: "Failed to create assessment session" }, { status: 500 });
            }

            assessmentAttemptId = insertedAssessment.id;
        }

        // Fetch or create interview session
        const { data: existingInterviewSession } = await supabaseAdmin
            .from("interview_sessions")
            .select("id, session_token")
            .eq("application_id", applicationId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        const interviewSessionToken =
            String(body.interviewSessionToken || "").trim() || existingInterviewSession?.session_token || generateToken();

        if (existingInterviewSession?.id) {
            const { error: updateInterviewSessionError } = await supabaseAdmin
                .from("interview_sessions")
                .update({
                    session_token: interviewSessionToken,
                    session_valid_from: interviewValidFrom,
                    session_valid_until: interviewValidUntil,
                })
                .eq("id", existingInterviewSession.id);

            if (updateInterviewSessionError) {
                if (updateInterviewSessionError.code === "23505") {
                    return NextResponse.json(
                        { success: false, error: "Interview session token already exists" },
                        { status: 409 },
                    );
                }
                return NextResponse.json({ success: false, error: "Failed to update interview session" }, { status: 500 });
            }
        } else {
            if (!assessmentAttemptId) {
                return NextResponse.json(
                    { success: false, error: "Assessment session is required before creating interview session" },
                    { status: 400 },
                );
            }

            const { error: createInterviewSessionError } = await supabaseAdmin.from("interview_sessions").insert({
                application_id: applicationId,
                assessment_attempt_id: assessmentAttemptId,
                status: "SLOT_ASSIGNED",
                session_token: interviewSessionToken,
                session_valid_from: interviewValidFrom,
                session_valid_until: interviewValidUntil,
            });

            if (createInterviewSessionError) {
                if (createInterviewSessionError.code === "23505") {
                    return NextResponse.json(
                        { success: false, error: "Interview session token already exists" },
                        { status: 409 },
                    );
                }
                return NextResponse.json({ success: false, error: "Failed to create interview session" }, { status: 500 });
            }
        }

        // Audit log
        await supabaseAdmin.from("audit_logs").insert({
            actor_user_id: verifiedUser.id,
            actor_role: "ORG_ADMIN",
            action_type: "CANDIDATE_SLOTS_ASSIGNED",
            entity_type: "APPLICATION",
            entity_id: applicationId,
            new_values: {
                interview_id: interviewId,
                candidate_name: applicationData.candidate_name,
                candidate_email: applicationData.candidate_email,
                assigned_assessment_slot_id: assessmentSlotId,
                assigned_interview_slot_id: interviewSlotId,
                assessment_session_valid_from: assessmentValidFrom,
                assessment_session_valid_until: assessmentValidUntil,
                interview_session_valid_from: interviewValidFrom,
                interview_session_valid_until: interviewValidUntil,
            },
        });

        return NextResponse.json({
            success: true,
            message: "Candidate assignment updated successfully",
        });
    } catch (error) {
        console.error("Assign slots POST error:", error);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}
