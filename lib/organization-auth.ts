import { fromTable, supabase, type TableRow } from "@/lib/supabase";

export type OrganizationAuthErrorCode =
    | "INVALID_CREDENTIALS"
    | "NOT_ORG_ADMIN"
    | "INACTIVE_ORG_ADMIN"
    | "PROFILE_NOT_FOUND"
    | "INVALID_ORGANIZATION_ID"
    | "REGISTRATION_FAILED"
    | "EMAIL_IN_USE"
    | "UNKNOWN";

export interface OrganizationAuthResult {
    success: boolean;
    code?: OrganizationAuthErrorCode;
    message?: string;
    organizationAdmin?: TableRow<"users">;
}

function buildError(code: OrganizationAuthErrorCode, message: string): OrganizationAuthResult {
    return { success: false, code, message };
}

function formatSupabaseError(prefix: string, error: { code?: string; message?: string; details?: string | null } | null) {
    if (!error) {
        return prefix;
    }

    const segments = [prefix];

    if (error.code) {
        segments.push(`Code: ${error.code}.`);
    }

    if (error.message) {
        segments.push(error.message);
    }

    if (error.details) {
        segments.push(`Details: ${error.details}`);
    }

    return segments.join(" ");
}

export async function signInOrganizationAdmin(
    email: string,
    password: string,
): Promise<OrganizationAuthResult> {
    const normalizedEmail = email.trim().toLowerCase();

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
    });

    if (signInError || !signInData.user) {
        return buildError("INVALID_CREDENTIALS", "Invalid email or password.");
    }

    const { data: userProfile, error: userError } = await fromTable("users")
        .select("*")
        .eq("auth_id", signInData.user.id)
        .maybeSingle();

    if (userError) {
        await supabase.auth.signOut();
        return buildError("UNKNOWN", "Unable to verify organization admin profile. Please try again.");
    }

    const organizationAdmin = userProfile as TableRow<"users"> | null;

    if (!organizationAdmin) {
        await supabase.auth.signOut();
        return buildError("PROFILE_NOT_FOUND", "No organization profile is linked to this account.");
    }

    if (organizationAdmin.role !== "ORG_ADMIN") {
        await supabase.auth.signOut();
        return buildError("NOT_ORG_ADMIN", "You are authenticated, but not authorized as organization admin.");
    }

    if (organizationAdmin.is_active === false) {
        await supabase.auth.signOut();
        return buildError("INACTIVE_ORG_ADMIN", "Your organization admin account is inactive.");
    }

    await fromTable("users").update({ last_login: new Date().toISOString() }).eq("id", organizationAdmin.id);

    return {
        success: true,
        organizationAdmin,
    };
}

export async function registerOrganizationAdmin(
    email: string,
    password: string,
    firstName?: string,
    lastName?: string,
    organizationId?: number,
): Promise<OrganizationAuthResult> {
    const normalizedEmail = email.trim().toLowerCase();

    if (organizationId !== undefined && organizationId !== null) {
        const { data: organization, error: organizationError } = await fromTable("organizations")
            .select("id")
            .eq("id", organizationId)
            .maybeSingle();

        if (organizationError) {
            return buildError(
                "UNKNOWN",
                formatSupabaseError("Unable to validate organization ID.", organizationError),
            );
        }

        if (!organization) {
            return buildError(
                "INVALID_ORGANIZATION_ID",
                `Organization ID ${organizationId} does not exist. Create/select a valid organization first.`,
            );
        }
    }

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
    });

    if (signUpError) {
        const message = signUpError.message.toLowerCase();

        if (message.includes("already") || message.includes("exists")) {
            return buildError("EMAIL_IN_USE", "This email is already registered.");
        }

        return buildError("REGISTRATION_FAILED", signUpError.message);
    }

    const authUser = signUpData.user;

    if (!authUser) {
        return buildError("REGISTRATION_FAILED", "Registration failed. Please try again.");
    }

    if (!signUpData.session) {
        return buildError(
            "REGISTRATION_FAILED",
            "Auth account created but no active session was returned. If email confirmation is enabled, verify the email first or disable confirmation for local MVP before creating organization profile.",
        );
    }

    const payload = {
        auth_id: authUser.id,
        email: normalizedEmail,
        first_name: firstName?.trim() || null,
        last_name: lastName?.trim() || null,
        role: "ORG_ADMIN" as const,
        organization_id: organizationId ?? null,
        is_active: true,
    };

    const { data: existingUser } = await fromTable("users").select("id").eq("email", normalizedEmail).maybeSingle();

    if (existingUser) {
        const { error: updateError } = await fromTable("users").update(payload).eq("email", normalizedEmail);

        if (updateError) {
            if (updateError.code === "23503") {
                return buildError(
                    "INVALID_ORGANIZATION_ID",
                    "Organization profile update failed because organization_id does not exist. Use a valid organization ID.",
                );
            }

            return buildError(
                "REGISTRATION_FAILED",
                formatSupabaseError("Auth created, but organization profile update failed.", updateError),
            );
        }
    } else {
        const { error: insertError } = await fromTable("users").insert(payload);

        if (insertError) {
            if (insertError.code === "23503") {
                return buildError(
                    "INVALID_ORGANIZATION_ID",
                    "Organization profile creation failed because organization_id does not exist. Use a valid organization ID.",
                );
            }

            return buildError(
                "REGISTRATION_FAILED",
                formatSupabaseError("Auth created, but organization profile creation failed.", insertError),
            );
        }
    }

    const { data: orgAdminProfile, error: profileError } = await fromTable("users")
        .select("*")
        .eq("auth_id", authUser.id)
        .maybeSingle();

    if (profileError || !orgAdminProfile) {
        return buildError(
            "REGISTRATION_FAILED",
            formatSupabaseError("Registration created but profile verification failed.", profileError),
        );
    }

    return {
        success: true,
        organizationAdmin: orgAdminProfile as TableRow<"users">,
    };
}

export async function getCurrentOrganizationAdmin(): Promise<TableRow<"users"> | null> {
    const { data: sessionData, error: sessionError } = await supabase.auth.getUser();

    if (sessionError || !sessionData.user) {
        return null;
    }

    const { data: userProfile, error: userError } = await fromTable("users")
        .select("*")
        .eq("auth_id", sessionData.user.id)
        .maybeSingle();

    if (userError || !userProfile) {
        return null;
    }

    const organizationAdmin = userProfile as TableRow<"users">;

    if (organizationAdmin.role !== "ORG_ADMIN" || organizationAdmin.is_active === false) {
        return null;
    }

    return organizationAdmin;
}

export async function signOutOrganizationAdmin(): Promise<void> {
    await supabase.auth.signOut();
}
