import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase-admin";

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

export async function GET(request: Request) {
    const auth = await requireAdmin(request);

    if ("error" in auth) {
        return auth.error;
    }

    const { data, error } = await supabaseAdmin
        .from("organization_requests")
        .select("*")
        .in("status", ["SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "REJECTED"])
        .order("created_at", { ascending: false });

    if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const requests = data ?? [];
    const requestIds = requests
        .map((request) => request.id)
        .filter((id): id is number => Number.isInteger(id) && id > 0);

    const detailsByRequestId = new Map<
        number,
        {
            registration_id: string | null;
            address: string | null;
            description: string | null;
        }
    >();

    if (requestIds.length > 0) {
        const { data: auditRows } = await supabaseAdmin
            .from("audit_logs")
            .select("entity_id, new_values, created_at")
            .eq("entity_type", "organization_requests")
            .eq("action_type", "ORGANIZATION_VERIFICATION_SUBMITTED")
            .in("entity_id", requestIds)
            .order("created_at", { ascending: false });

        for (const row of auditRows ?? []) {
            const entityId = row.entity_id;

            if (!entityId || detailsByRequestId.has(entityId)) {
                continue;
            }

            const payload = row.new_values;

            if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
                continue;
            }

            const values = payload as Record<string, unknown>;

            detailsByRequestId.set(entityId, {
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
            });
        }
    }

    const enrichedRequests = requests.map((request) => ({
        ...request,
        ...(detailsByRequestId.get(request.id) ?? {
            registration_id: null,
            address: null,
            description: null,
        }),
    }));

    return NextResponse.json({ success: true, data: enrichedRequests });
}
