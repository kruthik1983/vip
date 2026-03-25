import type { TableRow } from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function verifyToken(token: string): Promise<TableRow<"users"> | null> {
    const normalizedToken = token.trim();

    if (!normalizedToken) {
        return null;
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(normalizedToken);

    if (authError || !authData.user) {
        return null;
    }

    const { data: userProfile, error: userError } = await supabaseAdmin
        .from("users")
        .select("*")
        .eq("auth_id", authData.user.id)
        .maybeSingle();

    if (userError || !userProfile) {
        return null;
    }

    const orgAdminWithoutOrganization =
        userProfile.role === "ORG_ADMIN" &&
        (userProfile.organization_id === null || userProfile.organization_id === undefined);

    if (orgAdminWithoutOrganization) {
        const normalizedEmail = (userProfile.email ?? "").toLowerCase();

        if (normalizedEmail) {
            const { data: latestAcceptedRequest } = await supabaseAdmin
                .from("organization_requests")
                .select("organization_id")
                .eq("organization_email", normalizedEmail)
                .eq("status", "ACCEPTED")
                .not("organization_id", "is", null)
                .order("reviewed_at", { ascending: false })
                .limit(1)
                .maybeSingle();

            if (latestAcceptedRequest?.organization_id) {
                const { data: updatedUser } = await supabaseAdmin
                    .from("users")
                    .update({ organization_id: latestAcceptedRequest.organization_id })
                    .eq("id", userProfile.id)
                    .select("*")
                    .maybeSingle();

                if (updatedUser) {
                    return updatedUser as TableRow<"users">;
                }
            }
        }
    }

    return userProfile as TableRow<"users">;
}
