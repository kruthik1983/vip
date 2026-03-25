import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyToken } from "@/lib/auth";

interface PartOnePayload {
    positionTitle: string;
    jobDescription: string;
    skillsRequired: string[];
    ctcMin: number;
    ctcMax: number;
    campaignStartUtc: string;
    campaignEndUtc: string;
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

        if (!verifiedUser.organization_id) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Your account is not linked to an organization. Please complete organization setup first.",
                },
                { status: 400 }
            );
        }

        // ===== 2. PARSE & VALIDATE PAYLOAD =====
        const body: PartOnePayload = await request.json();

        if (!body.positionTitle?.trim()) {
            return NextResponse.json(
                { success: false, error: "Position title is required" },
                { status: 400 }
            );
        }

        if (!body.jobDescription?.trim()) {
            return NextResponse.json(
                { success: false, error: "Job description is required" },
                { status: 400 }
            );
        }

        if (!Array.isArray(body.skillsRequired) || body.skillsRequired.length === 0) {
            return NextResponse.json(
                { success: false, error: "At least one skill is required" },
                { status: 400 }
            );
        }

        if (!body.ctcMin || !body.ctcMax || body.ctcMin <= 0 || body.ctcMax <= 0) {
            return NextResponse.json(
                { success: false, error: "Valid CTC range is required" },
                { status: 400 }
            );
        }

        // Validate campaign window dates
        const campaignStart = new Date(body.campaignStartUtc);
        const campaignEnd = new Date(body.campaignEndUtc);

        if (campaignStart >= campaignEnd) {
            return NextResponse.json(
                { success: false, error: "Campaign end time must be after start time" },
                { status: 400 }
            );
        }

        // ===== 3. CREATE JOB RECORD =====
        const { data: jobData, error: jobError } = await supabaseAdmin
            .from("jobs")
            .insert({
                organization_id: verifiedUser.organization_id,
                position_title: body.positionTitle,
                job_description: body.jobDescription,
                skills_required: body.skillsRequired,
                ctc_min: body.ctcMin,
                ctc_max: body.ctcMax,
            })
            .select()
            .single();

        if (jobError || !jobData) {
            console.error("Job creation error:", jobError);

            const databaseMessage = jobError?.message ?? "Unknown database error";
            const isOrgConstraintIssue =
                databaseMessage.toLowerCase().includes("organization_id") ||
                jobError?.code === "23502" ||
                jobError?.code === "23503";

            return NextResponse.json(
                {
                    success: false,
                    error: isOrgConstraintIssue
                        ? "Unable to create job because organization mapping is invalid. Please re-login or verify your organization profile."
                        : `Failed to create job record: ${databaseMessage}`,
                },
                { status: isOrgConstraintIssue ? 400 : 500 }
            );
        }

        // ===== 4. CREATE INTERVIEW RECORD (DRAFT STATUS) =====
        const { data: interviewData, error: interviewError } = await supabaseAdmin
            .from("interviews")
            .insert({
                organization_id: verifiedUser.organization_id,
                job_id: jobData.id,
                title: `${body.positionTitle} - Interview`,
                assessment_duration_minutes: 20,
                interview_duration_minutes: 40,
                campaign_start_utc: body.campaignStartUtc,
                campaign_end_utc: body.campaignEndUtc,
                status: "DRAFT",
            })
            .select()
            .single();

        if (interviewError || !interviewData) {
            console.error("Interview creation error:", interviewError);
            return NextResponse.json(
                { success: false, error: "Failed to create interview record" },
                { status: 500 }
            );
        }

        // ===== 5. CREATE DEFAULT ASSESSMENT QUESTION SET =====
        const { data: assessmentSetData, error: assessmentSetError } = await supabaseAdmin
            .from("assessment_question_sets")
            .insert({
                interview_id: interviewData.id,
                is_ai_generated: false,
            })
            .select()
            .single();

        if (assessmentSetError || !assessmentSetData) {
            console.error("Assessment set creation error:", assessmentSetError);
            return NextResponse.json(
                { success: false, error: "Failed to create assessment question set" },
                { status: 500 }
            );
        }

        // ===== 6. LOG ACTION TO AUDIT LOGS =====
        await supabaseAdmin.from("audit_logs").insert({
            actor_user_id: verifiedUser.id,
            actor_role: "ORG_ADMIN",
            action_type: "INTERVIEW_PART1_CREATED",
            entity_type: "INTERVIEW",
            entity_id: interviewData.id,
            new_values: {
                position_title: body.positionTitle,
                assessment_duration: 20,
                interview_duration: 40,
                campaign_start: body.campaignStartUtc,
                campaign_end: body.campaignEndUtc,
            },
        });

        // ===== 7. RETURN SUCCESS =====
        return NextResponse.json({
            success: true,
            data: {
                interviewId: interviewData.id,
                jobId: jobData.id,
                assessmentDurationMins: 20,
                interviewDurationMins: 40,
                campaignStartUtc: body.campaignStartUtc,
                campaignEndUtc: body.campaignEndUtc,
            },
            message: "Part 1 saved successfully. Proceed to Part 2 to generate slots.",
        });
    } catch (error) {
        console.error("Part 1 API Error:", error);
        return NextResponse.json(
            { success: false, error: "Internal server error" },
            { status: 500 }
        );
    }
}
