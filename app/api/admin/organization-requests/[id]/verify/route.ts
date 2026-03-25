import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendOrganizationVerifiedEmail } from "@/lib/server-email";

export const runtime = "nodejs";

async function requireAdmin(request: Request) {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
        return { error: NextResponse.json({ success: false, error: "Missing access token." }, { status: 401 }) };
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
        return { error: NextResponse.json({ success: false, error: "Missing Supabase env config." }, { status: 500 }) };
    }

    const supabaseAuth = createClient(url, anonKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });

    const { data: authUserData, error: authError } = await supabaseAuth.auth.getUser(token);

    if (authError || !authUserData.user) {
        return { error: NextResponse.json({ success: false, error: "Invalid access token." }, { status: 401 }) };
    }

    const { data: userProfile, error: userError } = await supabaseAdmin
        .from("users")
        .select("id, role, is_active")
        .eq("auth_id", authUserData.user.id)
        .maybeSingle();

    if (userError || !userProfile || userProfile.role !== "ADMIN" || userProfile.is_active === false) {
        return { error: NextResponse.json({ success: false, error: "Admin authorization required." }, { status: 403 }) };
    }

    return { adminId: userProfile.id };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    const auth = await requireAdmin(request);

    if ("error" in auth) {
        return auth.error;
    }

    const { id } = await context.params;
    const requestId = Number(id);

    if (!Number.isInteger(requestId) || requestId <= 0) {
        return NextResponse.json({ success: false, error: "Invalid organization request id." }, { status: 400 });
    }

    const { data: orgRequest, error: requestError } = await supabaseAdmin
        .from("organization_requests")
        .select("*")
        .eq("id", requestId)
        .maybeSingle();

    if (requestError || !orgRequest) {
        return NextResponse.json({ success: false, error: "Organization request not found." }, { status: 404 });
    }

    if (orgRequest.status === "ACCEPTED") {
        return NextResponse.json({ success: true, message: "Organization already verified.", emailSent: false });
    }

    let organizationId: number | null = orgRequest.organization_id;

    if (!organizationId) {
        const { data: existingOrg } = await supabaseAdmin
            .from("organizations")
            .select("id")
            .eq("email", orgRequest.organization_email)
            .maybeSingle();

        if (existingOrg?.id) {
            organizationId = existingOrg.id;
        } else {
            const { data: newOrg, error: createOrgError } = await supabaseAdmin
                .from("organizations")
                .insert({
                    name: orgRequest.organization_name,
                    email: orgRequest.organization_email,
                    phone: orgRequest.phone,
                    website: orgRequest.website,
                    is_active: true,
                })
                .select("id")
                .single();

            if (createOrgError || !newOrg) {
                return NextResponse.json(
                    { success: false, error: createOrgError?.message ?? "Failed to create organization record." },
                    { status: 500 },
                );
            }

            organizationId = newOrg.id;
        }
    }

    const now = new Date().toISOString();

    const { error: updateRequestError } = await supabaseAdmin
        .from("organization_requests")
        .update({
            status: "ACCEPTED",
            reviewed_at: now,
            rejection_reason: null,
            organization_id: organizationId,
        })
        .eq("id", requestId);

    if (updateRequestError) {
        return NextResponse.json({ success: false, error: updateRequestError.message }, { status: 500 });
    }

    // Link organization admins using the official organization email so they can access org-scoped features.
    await supabaseAdmin
        .from("users")
        .update({ organization_id: organizationId })
        .eq("role", "ORG_ADMIN")
        .eq("email", orgRequest.organization_email.toLowerCase());

    await supabaseAdmin.from("notification_events").insert({
        notification_type: "ORG_REQUEST_ACCEPTED",
        organization_id: organizationId,
        organization_request_id: requestId,
        recipient_email: orgRequest.organization_email,
        recipient_name: orgRequest.contact_person,
        scheduled_send_at: now,
        status: "PENDING",
        idempotency_key: `org-verify-${requestId}-${randomUUID()}`,
    });

    const emailResult = await sendOrganizationVerifiedEmail({
        to: orgRequest.organization_email,
        organizationName: orgRequest.organization_name,
    });

    await supabaseAdmin.from("audit_logs").insert({
        actor_user_id: auth.adminId,
        actor_role: "ADMIN",
        action_type: "ORGANIZATION_VERIFIED",
        entity_type: "organization_requests",
        entity_id: requestId,
        old_values: { status: orgRequest.status },
        new_values: { status: "ACCEPTED", organization_id: organizationId, email_sent: emailResult.sent },
    });

    return NextResponse.json({
        success: true,
        message: emailResult.sent
            ? "Organization verified and email sent successfully."
            : `Organization verified. Email fallback: ${emailResult.reason ?? "logged only"}`,
        emailSent: emailResult.sent,
    });
}
