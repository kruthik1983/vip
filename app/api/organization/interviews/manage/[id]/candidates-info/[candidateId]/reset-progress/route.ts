import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyToken } from "@/lib/auth";

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

        const { data: applicationData, error: applicationError } = await supabaseAdmin
            .from("applications")
            .select("id, interview_id, candidate_name, candidate_email, assigned_assessment_slot_id, assigned_interview_slot_id, resume_file_path, candidate_photo_path")
            .eq("id", applicationId)
            .eq("interview_id", interviewId)
            .single();

        if (applicationError || !applicationData) {
            return NextResponse.json({ success: false, error: "Candidate application not found" }, { status: 404 });
        }

        const nowIso = new Date().toISOString();

        if (applicationData.assigned_assessment_slot_id) {
            const { data: oldAssessmentSlot, error: oldAssessmentSlotError } = await supabaseAdmin
                .from("assessment_slots")
                .select("assigned_candidates")
                .eq("id", applicationData.assigned_assessment_slot_id)
                .maybeSingle();

            if (oldAssessmentSlotError) {
                return NextResponse.json({ success: false, error: "Failed to update assessment slot counters" }, { status: 500 });
            }

            if (oldAssessmentSlot) {
                const nextCount = Math.max(0, Number(oldAssessmentSlot.assigned_candidates ?? 0) - 1);
                const { error: updateAssessmentSlotError } = await supabaseAdmin
                    .from("assessment_slots")
                    .update({ assigned_candidates: nextCount })
                    .eq("id", applicationData.assigned_assessment_slot_id);

                if (updateAssessmentSlotError) {
                    return NextResponse.json({ success: false, error: "Failed to update assessment slot counters" }, { status: 500 });
                }
            }
        }

        if (applicationData.assigned_interview_slot_id) {
            const { data: oldInterviewSlot, error: oldInterviewSlotError } = await supabaseAdmin
                .from("interview_slots")
                .select("assigned_candidates")
                .eq("id", applicationData.assigned_interview_slot_id)
                .maybeSingle();

            if (oldInterviewSlotError) {
                return NextResponse.json({ success: false, error: "Failed to update interview slot counters" }, { status: 500 });
            }

            if (oldInterviewSlot) {
                const nextCount = Math.max(0, Number(oldInterviewSlot.assigned_candidates ?? 0) - 1);
                const { error: updateInterviewSlotError } = await supabaseAdmin
                    .from("interview_slots")
                    .update({ assigned_candidates: nextCount })
                    .eq("id", applicationData.assigned_interview_slot_id);

                if (updateInterviewSlotError) {
                    return NextResponse.json({ success: false, error: "Failed to update interview slot counters" }, { status: 500 });
                }
            }
        }

        const resumePath = String(applicationData.resume_file_path || "").trim();
        const photoPath = String(applicationData.candidate_photo_path || "").trim();
        const resumeBucket = String(process.env.SUPABASE_RESUME_BUCKET || "candidate-resumes").trim() || "candidate-resumes";
        const photoBucket = String(process.env.SUPABASE_CANDIDATE_PHOTO_BUCKET || "candidate-photos").trim() || "candidate-photos";

        // Best-effort storage cleanup for candidate-uploaded artifacts.
        if (resumePath) {
            await supabaseAdmin.storage.from(resumeBucket).remove([resumePath]);
        }
        if (photoPath) {
            await supabaseAdmin.storage.from(photoBucket).remove([photoPath]);
        }

        // Hard delete application. Cascading FKs remove attempts, sessions, answers,
        // recordings, reports, consents, notifications, and other dependent rows.
        const { error: deleteApplicationError } = await supabaseAdmin
            .from("applications")
            .delete()
            .eq("id", applicationId)
            .eq("interview_id", interviewId);

        if (deleteApplicationError) {
            return NextResponse.json({ success: false, error: "Failed to delete candidate application" }, { status: 500 });
        }

        await supabaseAdmin.from("audit_logs").insert({
            actor_user_id: verifiedUser.id,
            actor_role: "ORG_ADMIN",
            action_type: "CANDIDATE_PROGRESS_RESET",
            entity_type: "APPLICATION",
            entity_id: applicationId,
            new_values: {
                interview_id: interviewId,
                candidate_name: applicationData.candidate_name,
                candidate_email: applicationData.candidate_email,
                reset_scope: "full_candidate_reset",
                application_deleted: true,
                deleted_at: nowIso,
            },
        });

        return NextResponse.json({
            success: true,
            message: "Candidate progress reset successfully",
        });
    } catch (error) {
        console.error("Reset candidate progress POST error:", error);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}
