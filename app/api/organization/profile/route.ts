import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

interface OrganizationProfilePayload {
    name?: string;
    email?: string;
    phone?: string;
    website?: string;
}

async function requireOrganizationAdmin(request: Request) {
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
        .select("*")
        .eq("auth_id", authUserData.user.id)
        .maybeSingle();

    if (userError || !userProfile || userProfile.role !== "ORG_ADMIN" || userProfile.is_active === false) {
        return {
            error: NextResponse.json(
                { success: false, error: "Organization admin authorization required." },
                { status: 403 },
            ),
        };
    }

    if (!userProfile.organization_id) {
        return {
            error: NextResponse.json(
                { success: false, error: "No organization linked to this admin account yet." },
                { status: 409 },
            ),
        };
    }

    return { userProfile };
}

export async function GET(request: Request) {
    const auth = await requireOrganizationAdmin(request);

    if ("error" in auth) {
        return auth.error;
    }

    const { data: organization, error } = await supabaseAdmin
        .from("organizations")
        .select("*")
        .eq("id", auth.userProfile.organization_id)
        .maybeSingle();

    if (error || !organization) {
        return NextResponse.json({ success: false, error: "Organization profile not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: organization });
}

export async function PUT(request: Request) {
    const auth = await requireOrganizationAdmin(request);

    if ("error" in auth) {
        return auth.error;
    }

    const body = (await request.json().catch(() => ({}))) as OrganizationProfilePayload;

    const name = body.name?.trim();
    const email = body.email?.trim().toLowerCase();
    const phone = body.phone?.trim() || null;
    const website = body.website?.trim() || null;

    if (!name) {
        return NextResponse.json({ success: false, error: "Organization name is required." }, { status: 400 });
    }

    if (!email) {
        return NextResponse.json({ success: false, error: "Organization email is required." }, { status: 400 });
    }

    const { data: previous, error: previousError } = await supabaseAdmin
        .from("organizations")
        .select("*")
        .eq("id", auth.userProfile.organization_id)
        .maybeSingle();

    if (previousError || !previous) {
        return NextResponse.json({ success: false, error: "Organization profile not found." }, { status: 404 });
    }

    const { data: updated, error: updateError } = await supabaseAdmin
        .from("organizations")
        .update({
            name,
            email,
            phone,
            website,
            updated_at: new Date().toISOString(),
        })
        .eq("id", auth.userProfile.organization_id)
        .select("*")
        .single();

    if (updateError || !updated) {
        return NextResponse.json({ success: false, error: updateError?.message ?? "Unable to update organization profile." }, { status: 500 });
    }

    await supabaseAdmin.from("audit_logs").insert({
        actor_user_id: auth.userProfile.id,
        actor_role: "ORG_ADMIN",
        action_type: "ORGANIZATION_PROFILE_UPDATED",
        entity_type: "organizations",
        entity_id: auth.userProfile.organization_id,
        old_values: {
            name: previous.name,
            email: previous.email,
            phone: previous.phone,
            website: previous.website,
        },
        new_values: {
            name,
            email,
            phone,
            website,
        },
    });

    return NextResponse.json({
        success: true,
        message: "Organization profile updated successfully.",
        data: updated,
    });
}
