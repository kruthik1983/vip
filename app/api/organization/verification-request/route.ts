import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { TableRow } from "@/lib/supabase";

export const runtime = "nodejs";

interface VerificationPayload {
    organizationName?: string;
    website?: string;
    phone?: string;
    officialEmail?: string;
    registrationId?: string;
    address?: string;
    description?: string;
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

    return { userProfile };
}

async function fetchLatestRequest(userProfile: TableRow<"users">, fallbackEmail: string) {
    if (userProfile.organization_id) {
        const { data } = await supabaseAdmin
            .from("organization_requests")
            .select("*")
            .eq("organization_id", userProfile.organization_id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (data) {
            return data;
        }
    }

    const { data } = await supabaseAdmin
        .from("organization_requests")
        .select("*")
        .eq("organization_email", fallbackEmail)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    return data;
}

export async function GET(request: Request) {
    const auth = await requireOrganizationAdmin(request);

    if ("error" in auth) {
        return auth.error;
    }

    const latestRequest = await fetchLatestRequest(auth.userProfile, auth.userProfile.email);

    return NextResponse.json({
        success: true,
        data: latestRequest ?? null,
    });
}

export async function POST(request: Request) {
    const auth = await requireOrganizationAdmin(request);

    if ("error" in auth) {
        return auth.error;
    }

    const body = (await request.json().catch(() => ({}))) as VerificationPayload;

    const organizationName = body.organizationName?.trim();
    const officialEmail = body.officialEmail?.trim().toLowerCase() || auth.userProfile.email;
    const phone = body.phone?.trim() || null;
    const website = body.website?.trim() || null;

    if (!organizationName) {
        return NextResponse.json({ success: false, error: "Organization name is required." }, { status: 400 });
    }

    if (!officialEmail) {
        return NextResponse.json({ success: false, error: "Official email is required." }, { status: 400 });
    }

    const contactPerson = [auth.userProfile.first_name, auth.userProfile.last_name]
        .filter(Boolean)
        .join(" ")
        .trim() || auth.userProfile.email;

    const latestRequest = await fetchLatestRequest(auth.userProfile, officialEmail);

    if (latestRequest?.status === "ACCEPTED") {
        return NextResponse.json(
            { success: false, error: "Your organization is already verified." },
            { status: 409 },
        );
    }

    const payload = {
        organization_name: organizationName,
        organization_email: officialEmail,
        contact_person: contactPerson,
        phone,
        website,
        status: "SUBMITTED",
        rejection_reason: null,
        reviewed_at: null,
        organization_id: auth.userProfile.organization_id,
    };

    let writeError: { message: string } | null = null;

    if (latestRequest) {
        const { error } = await supabaseAdmin
            .from("organization_requests")
            .update(payload)
            .eq("id", latestRequest.id);

        writeError = error;
    } else {
        const { error } = await supabaseAdmin.from("organization_requests").insert(payload);
        writeError = error;
    }

    if (writeError) {
        return NextResponse.json({ success: false, error: writeError.message }, { status: 500 });
    }

    await supabaseAdmin.from("audit_logs").insert({
        actor_user_id: auth.userProfile.id,
        actor_role: "ORG_ADMIN",
        action_type: "ORGANIZATION_VERIFICATION_SUBMITTED",
        entity_type: "organization_requests",
        entity_id: latestRequest?.id ?? null,
        new_values: {
            organization_name: organizationName,
            organization_email: officialEmail,
            registration_id: body.registrationId ?? null,
            address: body.address ?? null,
            description: body.description ?? null,
        },
    });

    const refreshedRequest = await fetchLatestRequest(auth.userProfile, officialEmail);

    return NextResponse.json({
        success: true,
        message: "Verification request submitted successfully.",
        data: refreshedRequest ?? null,
    });
}
