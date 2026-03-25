import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendOrganizationRejectedEmail } from "@/lib/server-email";

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

    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const reason = body.reason?.trim();

    if (!reason) {
        return NextResponse.json({ success: false, error: "Rejection reason is required." }, { status: 400 });
    }

    const { data: orgRequest, error: requestError } = await supabaseAdmin
        .from("organization_requests")
        .select("*")
        .eq("id", requestId)
        .maybeSingle();

    if (requestError || !orgRequest) {
        return NextResponse.json({ success: false, error: "Organization request not found." }, { status: 404 });
    }

    const now = new Date().toISOString();

    const { error: updateRequestError } = await supabaseAdmin
        .from("organization_requests")
        .update({
            status: "REJECTED",
            reviewed_at: now,
            rejection_reason: reason,
        })
        .eq("id", requestId);

    if (updateRequestError) {
        return NextResponse.json({ success: false, error: updateRequestError.message }, { status: 500 });
    }

    await supabaseAdmin.from("notification_events").insert({
        notification_type: "ORG_REQUEST_REJECTED",
        organization_id: orgRequest.organization_id,
        organization_request_id: requestId,
        recipient_email: orgRequest.organization_email,
        recipient_name: orgRequest.contact_person,
        scheduled_send_at: now,
        status: "PENDING",
        idempotency_key: `org-reject-${requestId}-${randomUUID()}`,
    });

    const emailResult = await sendOrganizationRejectedEmail({
        to: orgRequest.organization_email,
        organizationName: orgRequest.organization_name,
        reason,
    });

    await supabaseAdmin.from("audit_logs").insert({
        actor_user_id: auth.adminId,
        actor_role: "ADMIN",
        action_type: "ORGANIZATION_REJECTED",
        entity_type: "organization_requests",
        entity_id: requestId,
        old_values: { status: orgRequest.status },
        new_values: { status: "REJECTED", rejection_reason: reason, email_sent: emailResult.sent },
    });

    return NextResponse.json({
        success: true,
        message: emailResult.sent
            ? "Organization rejected and rejection email sent successfully."
            : `Organization rejected. Email fallback: ${emailResult.reason ?? "logged only"}`,
        emailSent: emailResult.sent,
    });
}
