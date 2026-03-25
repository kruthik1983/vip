import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyToken } from "@/lib/auth";
import { randomUUID } from "crypto";

interface PartThreePayload {
    interviewId: number;
    applicationForm: {
        requireName: boolean;
        requireEmail: boolean;
        requirePhone: boolean;
        requireResume: boolean;
        consentPolicyVersion?: string;
        consentPolicyUrl?: string;
    };
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
        const body: PartThreePayload = await request.json();

        if (!body.interviewId || body.interviewId <= 0) {
            return NextResponse.json(
                { success: false, error: "Valid interview ID is required" },
                { status: 400 }
            );
        }

        if (!body.applicationForm) {
            return NextResponse.json(
                { success: false, error: "Application form configuration is required" },
                { status: 400 }
            );
        }

        const consentPolicyVersion = String(body.applicationForm.consentPolicyVersion || "").trim() || "v1";
        const consentPolicyUrl = String(body.applicationForm.consentPolicyUrl || "").trim();

        if (consentPolicyUrl && !/^https?:\/\//i.test(consentPolicyUrl)) {
            return NextResponse.json(
                { success: false, error: "Consent policy URL must start with http:// or https://" },
                { status: 400 }
            );
        }

        // At least name or email must be required
        if (!body.applicationForm.requireName && !body.applicationForm.requireEmail) {
            return NextResponse.json(
                { success: false, error: "Either name or email must be required" },
                { status: 400 }
            );
        }

        // ===== 3. VERIFY INTERVIEW EXISTS & BELONGS TO ORG =====
        const { data: interviewData, error: interviewError } = await supabaseAdmin
            .from("interviews")
            .select(
                "id, organization_id, status, campaign_start_utc, campaign_end_utc, created_at"
            )
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

        if (interviewData.status !== "DRAFT") {
            return NextResponse.json(
                { success: false, error: "Cannot modify published or locked interviews" },
                { status: 400 }
            );
        }

        // ===== 4. VERIFY INTERVIEW HAS SLOTS & QUESTIONS =====
        const { data: assessmentSlotsData, error: assessmentSlotsError } = await supabaseAdmin
            .from("assessment_slots")
            .select("id, slot_start_utc")
            .eq("interview_id", body.interviewId)
            .order("slot_start_utc", { ascending: true });

        if (assessmentSlotsError || !assessmentSlotsData || assessmentSlotsData.length === 0) {
            return NextResponse.json(
                { success: false, error: "Interview must have at least one assessment slot configured" },
                { status: 400 }
            );
        }

        const { data: interviewSlotsData, error: interviewSlotsError } = await supabaseAdmin
            .from("interview_slots")
            .select("id")
            .eq("interview_id", body.interviewId);

        if (interviewSlotsError || !interviewSlotsData || interviewSlotsData.length === 0) {
            return NextResponse.json(
                { success: false, error: "Interview must have at least one interview slot configured" },
                { status: 400 }
            );
        }

        const { data: assessmentQuestionsData, error: assessmentError } = await supabaseAdmin
            .from("assessment_question_sets")
            .select("id")
            .eq("interview_id", body.interviewId)
            .single();

        if (assessmentError || !assessmentQuestionsData) {
            return NextResponse.json(
                { success: false, error: "Interview must have assessment questions configured" },
                { status: 400 }
            );
        }

        const { data: interviewQuestionsData, error: interviewQError } = await supabaseAdmin
            .from("interview_fallback_questions")
            .select("id")
            .eq("interview_id", body.interviewId);

        if (interviewQError || !interviewQuestionsData || interviewQuestionsData.length === 0) {
            return NextResponse.json(
                { success: false, error: "Interview must have fallback questions configured" },
                { status: 400 }
            );
        }

        // ===== 5. GENERATE APPLICATION TOKEN & VALIDITY DATES =====
        const applicationToken = randomUUID();
        const assessmentStart = new Date(assessmentSlotsData[0].slot_start_utc);
        // Validity: 1 day before assessment start
        const validUntil = new Date(assessmentStart.getTime() - 24 * 60 * 60 * 1000);
        const applicationLink = `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/apply/${applicationToken}`;

        if (validUntil <= new Date()) {
            return NextResponse.json(
                { success: false, error: "Assessment start time must be more than 1 day away" },
                { status: 400 }
            );
        }

        // Deactivate previously active links for this interview, then insert the new link.
        const { error: deactivateLinksError } = await supabaseAdmin
            .from("application_links")
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq("interview_id", body.interviewId)
            .eq("is_active", true);

        if (deactivateLinksError) {
            return NextResponse.json(
                { success: false, error: "Failed to rotate existing application links" },
                { status: 500 }
            );
        }

        const { error: createLinkError } = await supabaseAdmin
            .from("application_links")
            .insert({
                interview_id: body.interviewId,
                application_token: applicationToken,
                application_link: applicationLink,
                application_form_config: {
                    ...body.applicationForm,
                    consentPolicyVersion,
                    consentPolicyUrl: consentPolicyUrl || null,
                },
                valid_from: new Date().toISOString(),
                valid_until: validUntil.toISOString(),
                is_active: true,
                created_by: verifiedUser.id,
            });

        if (createLinkError) {
            return NextResponse.json(
                { success: false, error: "Failed to create application link" },
                { status: 500 }
            );
        }

        // ===== 6. UPDATE INTERVIEW: PUBLISH & SET PUBLISHED_AT =====
        const { error: publishError } = await supabaseAdmin
            .from("interviews")
            .update({
                status: "PUBLISHED",
                published_at: new Date().toISOString(),
            })
            .eq("id", body.interviewId);

        if (publishError) {
            return NextResponse.json(
                { success: false, error: "Failed to publish interview" },
                { status: 500 }
            );
        }

        // ===== 7. LOG ACTION TO AUDIT LOGS =====
        await supabaseAdmin.from("audit_logs").insert({
            actor_user_id: verifiedUser.id,
            actor_role: "ORG_ADMIN",
            action_type: "INTERVIEW_PART3_PUBLISHED",
            entity_type: "INTERVIEW",
            entity_id: body.interviewId,
            new_values: {
                status: "PUBLISHED",
                application_form_config: {
                    ...body.applicationForm,
                    consentPolicyVersion,
                    consentPolicyUrl: consentPolicyUrl || null,
                },
                application_token: applicationToken,
                application_valid_until: validUntil.toISOString(),
            },
        });

        // ===== 8. RETURN SUCCESS WITH APPLICATION LINK =====

        return NextResponse.json({
            success: true,
            data: {
                interviewId: body.interviewId,
                applicationToken,
                applicationLink,
                validUntil: validUntil.toISOString(),
                validUntilDisplay: validUntil.toLocaleDateString("en-IN", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                }),
            },
            message: "Interview published successfully. Application link generated.",
        });
    } catch (error) {
        console.error("Part 3 API Error:", error);
        return NextResponse.json(
            { success: false, error: "Internal server error" },
            { status: 500 }
        );
    }
}
