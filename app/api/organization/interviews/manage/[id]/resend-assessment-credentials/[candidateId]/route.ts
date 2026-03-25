import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { sendAssessmentCredentialsEmail } from "@/lib/candidate-emails";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyToken } from "@/lib/auth";

function generateToken() {
    return crypto.randomBytes(24).toString("hex");
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; candidateId: string }> },
) {
    try {
        const resolvedParams = await params;
        const interviewId = Number(resolvedParams.id);
        const candidateId = Number(resolvedParams.candidateId);

        // Validate inputs
        if (!Number.isInteger(interviewId) || interviewId <= 0) {
            return NextResponse.json(
                { success: false, error: "Invalid interview ID" },
                { status: 400 },
            );
        }

        if (!Number.isInteger(candidateId) || candidateId <= 0) {
            return NextResponse.json(
                { success: false, error: "Invalid candidate ID" },
                { status: 400 },
            );
        }

        // Verify organization admin authorization
        const token = request.headers.get("authorization")?.replace("Bearer ", "");
        if (!token) {
            return NextResponse.json(
                { success: false, error: "Missing authorization token" },
                { status: 401 },
            );
        }

        const verifiedUser = await verifyToken(token);

        if (!verifiedUser || verifiedUser.role !== "ORG_ADMIN") {
            return NextResponse.json(
                { success: false, error: "Unauthorized. Organization admin required." },
                { status: 403 },
            );
        }

        // Verify organization admin owns this interview
        const { data: interviewData, error: interviewError } = await supabaseAdmin
            .from("interviews")
            .select("id, organization_id")
            .eq("id", interviewId)
            .single();

        if (interviewError || !interviewData) {
            return NextResponse.json(
                { success: false, error: "Interview not found" },
                { status: 404 },
            );
        }

        // Verify org admin owns this interview's organization
        if (verifiedUser.organization_id !== interviewData.organization_id) {
            return NextResponse.json(
                { success: false, error: "Unauthorized to access this interview" },
                { status: 403 },
            );
        }

        // Get candidate application and interview slot
        const { data: appData, error: appError } = await supabaseAdmin
            .from("applications")
            .select(
                `
                id,
                candidate_id,
                interview_id,
                assigned_assessment_slot_id,
                status
            `,
            )
            .eq("id", candidateId)
            .eq("interview_id", interviewId)
            .single();

        if (appError || !appData) {
            return NextResponse.json(
                { success: false, error: "Application not found" },
                { status: 404 },
            );
        }

        // Get assessment slot details
        const { data: slotData, error: slotError } = await supabaseAdmin
            .from("assessment_slots")
            .select("id, slot_start_utc, slot_end_utc")
            .eq("id", appData.assigned_assessment_slot_id)
            .single();

        if (slotError || !slotData) {
            return NextResponse.json(
                { success: false, error: "Assessment slot not found" },
                { status: 404 },
            );
        }

        // Get candidate details
        const { data: candidateData, error: candidateError } = await supabaseAdmin
            .from("candidates")
            .select("id, email, name")
            .eq("id", appData.candidate_id)
            .single();

        if (candidateError || !candidateData) {
            return NextResponse.json(
                { success: false, error: "Candidate not found" },
                { status: 404 },
            );
        }

        // Get interview title
        const { data: interviewTitle, error: interviewTitleError } = await supabaseAdmin
            .from("interviews")
            .select("title")
            .eq("id", interviewId)
            .single();

        if (interviewTitleError || !interviewTitle) {
            return NextResponse.json(
                { success: false, error: "Interview not found" },
                { status: 404 },
            );
        }

        // Generate new token
        const newToken = generateToken();
        const slotStart = new Date(slotData.slot_start_utc);
        const slotEnd = new Date(slotData.slot_end_utc);
        const twoHoursBefore = new Date(slotStart.getTime() - 2 * 60 * 60 * 1000);
        const validFrom = twoHoursBefore > new Date() ? twoHoursBefore : new Date();
        const validUntil = slotEnd;

        // Update or create assessment_attempts record with new token
        const { data: existingAttempt } = await supabaseAdmin
            .from("assessment_attempts")
            .select("id")
            .eq("application_id", appData.id)
            .single();

        if (existingAttempt) {
            // Update existing record
            const { error: updateError } = await supabaseAdmin
                .from("assessment_attempts")
                .update({
                    session_token: newToken,
                    session_valid_from: validFrom.toISOString(),
                    session_valid_until: validUntil.toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .eq("id", existingAttempt.id);

            if (updateError) {
                console.error("Error updating assessment attempt:", updateError);
                return NextResponse.json(
                    { success: false, error: "Failed to update assessment token" },
                    { status: 500 },
                );
            }
        } else {
            // Create new record
            const { error: createError } = await supabaseAdmin.from("assessment_attempts").insert({
                application_id: appData.id,
                session_token: newToken,
                session_valid_from: validFrom.toISOString(),
                session_valid_until: validUntil.toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            });

            if (createError) {
                console.error("Error creating assessment attempt:", createError);
                return NextResponse.json(
                    { success: false, error: "Failed to create assessment token" },
                    { status: 500 },
                );
            }
        }

        // Send assessment credentials email
        try {
            await sendAssessmentCredentialsEmail({
                to: candidateData.email,
                candidateName: candidateData.name,
                assessmentStartTime: new Date(slotData.slot_start_utc).toLocaleString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true,
                }),
                assessmentToken: newToken,
                interviewTitle: interviewTitle.title,
            });
        } catch (emailError) {
            console.error("Error sending assessment credentials email:", emailError);
            return NextResponse.json(
                { success: false, error: "Failed to send assessment credentials email" },
                { status: 500 },
            );
        }

        return NextResponse.json(
            {
                success: true,
                message: "Assessment credentials renewed and email sent successfully",
                data: {
                    token: newToken,
                    validFrom: validFrom.toISOString(),
                    validUntil: validUntil.toISOString(),
                },
            },
            { status: 200 },
        );
    } catch (error) {
        console.error("Error in resend-assessment-credentials:", error);
        return NextResponse.json(
            { success: false, error: "Internal server error" },
            { status: 500 },
        );
    }
}
