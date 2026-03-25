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
    employeesCount?: number | string;
    registrationId?: string;
    address?: string;
    description?: string;
}

type VerificationDetails = {
    registration_id: string | null;
    address: string | null;
    description: string | null;
};

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

async function fetchVerificationDetailsFromAudit(requestId: number | null): Promise<VerificationDetails> {
    if (!requestId) {
        return {
            registration_id: null,
            address: null,
            description: null,
        };
    }

    const { data: auditRow } = await supabaseAdmin
        .from("audit_logs")
        .select("new_values")
        .eq("entity_type", "organization_requests")
        .eq("action_type", "ORGANIZATION_VERIFICATION_SUBMITTED")
        .eq("entity_id", requestId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    const payload = auditRow?.new_values;

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return {
            registration_id: null,
            address: null,
            description: null,
        };
    }

    const values = payload as Record<string, unknown>;

    return {
        registration_id:
            typeof values.registration_id === "string" && values.registration_id.trim().length > 0
                ? values.registration_id.trim()
                : null,
        address:
            typeof values.address === "string" && values.address.trim().length > 0
                ? values.address.trim()
                : null,
        description:
            typeof values.description === "string" && values.description.trim().length > 0
                ? values.description.trim()
                : null,
    };
}

export async function GET(request: Request) {
    const auth = await requireOrganizationAdmin(request);

    if ("error" in auth) {
        return auth.error;
    }

    const latestRequest = await fetchLatestRequest(auth.userProfile, auth.userProfile.email);
    const verificationDetails = await fetchVerificationDetailsFromAudit(latestRequest?.id ?? null);

    return NextResponse.json({
        success: true,
        data: latestRequest
            ? {
                ...latestRequest,
                ...verificationDetails,
            }
            : null,
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
    const registrationId = body.registrationId?.trim() || null;
    const address = body.address?.trim() || null;
    const description = body.description?.trim() || null;
    const parsedEmployeesCount =
        typeof body.employeesCount === "number"
            ? body.employeesCount
            : typeof body.employeesCount === "string" && body.employeesCount.trim().length > 0
                ? Number.parseInt(body.employeesCount, 10)
                : null;
    const employeesCount = Number.isFinite(parsedEmployeesCount as number) ? parsedEmployeesCount : null;

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
        employees_count: employeesCount,
        status: "SUBMITTED",
        rejection_reason: null,
        reviewed_at: null,
        organization_id: auth.userProfile.organization_id,
    };

    let savedRequestId: number | null = latestRequest?.id ?? null;
    let writeError: { message: string } | null = null;

    if (latestRequest) {
        const { data: updatedRow, error } = await supabaseAdmin
            .from("organization_requests")
            .update(payload)
            .eq("id", latestRequest.id)
            .select("id")
            .single();

        savedRequestId = updatedRow?.id ?? savedRequestId;
        writeError = error;
    } else {
        const { data: insertedRow, error } = await supabaseAdmin
            .from("organization_requests")
            .insert(payload)
            .select("id")
            .single();

        savedRequestId = insertedRow?.id ?? null;
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
        entity_id: savedRequestId,
        new_values: {
            organization_name: organizationName,
            organization_email: officialEmail,
            website,
            phone,
            employees_count: employeesCount,
            registration_id: registrationId,
            address,
            description,
        },
    });

    const refreshedRequest = await fetchLatestRequest(auth.userProfile, officialEmail);
    const verificationDetails = await fetchVerificationDetailsFromAudit(refreshedRequest?.id ?? null);

    return NextResponse.json({
        success: true,
        message: "Verification request submitted successfully.",
        data: refreshedRequest
            ? {
                ...refreshedRequest,
                ...verificationDetails,
            }
            : null,
    });
}
