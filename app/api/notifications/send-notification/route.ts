import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
    sendAssessmentCredentialsEmail,
    sendInterviewCredentialsEmail,
    sendSlotAssignmentEmail,
    sendAssessmentReminderEmail,
} from "@/lib/candidate-emails";

export const runtime = "nodejs";

interface NotificationPayload {
    eventId: number;
    notificationType:
    | "ASSESSMENT_CREDENTIALS"
    | "INTERVIEW_CREDENTIALS"
    | "SLOT_ASSIGNED"
    | "ASSESSMENT_REMINDER_24H";
    applicationId: number;
    organizationId: number;
    recipientEmail: string;
    recipientName: string;
    idempotencyKey: string;
}

/**
 * Webhook handler for sending candidate notifications
 * Called by PostgreSQL cron job dispatcher
 * 
 * Expected Bearer token from environment:
 * process.env.NOTIFICATION_WEBHOOK_TOKEN
 */
export async function POST(request: Request) {
    try {
        // Verify Bearer token
        const authHeader = request.headers.get("authorization");
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        const expectedToken = process.env.NOTIFICATION_WEBHOOK_TOKEN;

        if (!expectedToken || !token || token !== expectedToken) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        const payload: NotificationPayload = await request.json();

        // Validate payload
        if (!payload.eventId || !payload.notificationType || !payload.recipientEmail) {
            return NextResponse.json(
                { success: false, error: "Invalid payload" },
                { status: 400 }
            );
        }

        console.log(
            `[NOTIFICATION] Processing ${payload.notificationType} for ${payload.recipientEmail} (event: ${payload.eventId})`
        );

        let emailResult;
        let slotDetails;

        // Get application and slot details
        if (payload.applicationId) {
            const { data: app, error: appError } = await supabaseAdmin
                .from("applications")
                .select(
                    `
          id,
          candidate_name,
          assigned_assessment_slot_id,
          assigned_interview_slot_id,
          interviews!inner(
            id,
            title,
            jobs!inner(position_title)
          )
        `
                )
                .eq("id", payload.applicationId)
                .maybeSingle();

            if (appError || !app) {
                console.error(`[NOTIFICATION_ERROR] Failed to fetch application ${payload.applicationId}`, appError);
                return NextResponse.json(
                    { success: false, error: "Application not found" },
                    { status: 404 }
                );
            }

            const interviewTitle = app.interviews?.length > 0
                ? `${app.interviews[0].title} (${app.interviews[0].jobs?.[0]?.position_title || "Position"})`
                : "Interview";

            // Fetch slot details based on notification type
            if (payload.notificationType === "ASSESSMENT_CREDENTIALS" && app.assigned_assessment_slot_id) {
                const { data: slot } = await supabaseAdmin
                    .from("assessment_slots")
                    .select("slot_start_utc, slot_end_utc")
                    .eq("id", app.assigned_assessment_slot_id)
                    .maybeSingle();

                slotDetails = { assessmentSlot: slot };

                // Get assessment token from assessment_attempts
                const { data: attempt } = await supabaseAdmin
                    .from("assessment_attempts")
                    .select("session_token")
                    .eq("application_id", payload.applicationId)
                    .maybeSingle();

                emailResult = await sendAssessmentCredentialsEmail({
                    to: payload.recipientEmail,
                    candidateName: payload.recipientName || app.candidate_name,
                    assessmentStartTime: slot?.slot_start_utc
                        ? new Date(slot.slot_start_utc).toUTCString()
                        : "TBA",
                    assessmentToken: attempt?.session_token || "TOKEN_NOT_FOUND",
                    interviewTitle,
                });
            } else if (payload.notificationType === "INTERVIEW_CREDENTIALS" && app.assigned_interview_slot_id) {
                const { data: slot } = await supabaseAdmin
                    .from("interview_slots")
                    .select("slot_start_utc, slot_end_utc")
                    .eq("id", app.assigned_interview_slot_id)
                    .maybeSingle();

                slotDetails = { interviewSlot: slot };

                // Get interview token from interview_sessions
                const { data: session } = await supabaseAdmin
                    .from("interview_sessions")
                    .select("session_token")
                    .eq("application_id", payload.applicationId)
                    .maybeSingle();

                emailResult = await sendInterviewCredentialsEmail({
                    to: payload.recipientEmail,
                    candidateName: payload.recipientName || app.candidate_name,
                    interviewStartTime: slot?.slot_start_utc
                        ? new Date(slot.slot_start_utc).toUTCString()
                        : "TBA",
                    interviewToken: session?.session_token || "TOKEN_NOT_FOUND",
                    interviewTitle,
                });
            } else if (payload.notificationType === "SLOT_ASSIGNED") {
                // Get both slot details
                let assessmentSlot, interviewSlot;

                if (app.assigned_assessment_slot_id) {
                    const { data: slot } = await supabaseAdmin
                        .from("assessment_slots")
                        .select("slot_start_utc")
                        .eq("id", app.assigned_assessment_slot_id)
                        .maybeSingle();
                    assessmentSlot = slot;
                }

                if (app.assigned_interview_slot_id) {
                    const { data: slot } = await supabaseAdmin
                        .from("interview_slots")
                        .select("slot_start_utc")
                        .eq("id", app.assigned_interview_slot_id)
                        .maybeSingle();
                    interviewSlot = slot;
                }

                emailResult = await sendSlotAssignmentEmail({
                    to: payload.recipientEmail,
                    candidateName: payload.recipientName || app.candidate_name,
                    assessmentStartTime: assessmentSlot?.slot_start_utc
                        ? new Date(assessmentSlot.slot_start_utc).toUTCString()
                        : "TBA",
                    interviewStartTime: interviewSlot?.slot_start_utc
                        ? new Date(interviewSlot.slot_start_utc).toUTCString()
                        : "TBA",
                    interviewTitle,
                });
            } else if (payload.notificationType === "ASSESSMENT_REMINDER_24H" && app.assigned_assessment_slot_id) {
                const { data: slot } = await supabaseAdmin
                    .from("assessment_slots")
                    .select("slot_start_utc")
                    .eq("id", app.assigned_assessment_slot_id)
                    .maybeSingle();

                // Get assessment token
                const { data: attempt } = await supabaseAdmin
                    .from("assessment_attempts")
                    .select("session_token")
                    .eq("application_id", payload.applicationId)
                    .maybeSingle();

                emailResult = await sendAssessmentReminderEmail({
                    to: payload.recipientEmail,
                    candidateName: payload.recipientName || app.candidate_name,
                    assessmentStartTime: slot?.slot_start_utc
                        ? new Date(slot.slot_start_utc).toUTCString()
                        : "TBA",
                    assessmentToken: attempt?.session_token || "TOKEN_NOT_FOUND",
                    interviewTitle,
                });
            }
        }

        if (!emailResult) {
            emailResult = {
                sent: false,
                reason: "No email handler for notification type",
            };
        }

        // Log the result
        console.log(
            `[NOTIFICATION_RESULT] Event ${payload.eventId}: ${emailResult.sent ? "SENT" : "FAILED"} - ${emailResult.reason || emailResult.info || "Unknown"}`
        );

        return NextResponse.json({
            success: emailResult.sent,
            eventId: payload.eventId,
            notificationType: payload.notificationType,
            recipient: payload.recipientEmail,
            sent: emailResult.sent,
            reason: emailResult.reason,
            messageId: emailResult.info,
        });
    } catch (error) {
        console.error("[NOTIFICATION_ERROR]", error);
        return NextResponse.json(
            { success: false, error: "Internal server error" },
            { status: 500 }
        );
    }
}
