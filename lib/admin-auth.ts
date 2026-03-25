import { fromTable, supabase, type TableRow } from "@/lib/supabase";

export type AdminAuthErrorCode =
    | "INVALID_CREDENTIALS"
    | "NOT_ADMIN"
    | "INACTIVE_ADMIN"
    | "PROFILE_NOT_FOUND"
    | "REGISTRATION_FAILED"
    | "EMAIL_IN_USE"
    | "UNKNOWN";

export interface AdminAuthResult {
    success: boolean;
    code?: AdminAuthErrorCode;
    message?: string;
    admin?: TableRow<"users">;
}

function buildError(code: AdminAuthErrorCode, message: string): AdminAuthResult {
    return {
        success: false,
        code,
        message,
    };
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

export async function signInAdmin(email: string, password: string): Promise<AdminAuthResult> {
    const normalizedEmail = email.trim().toLowerCase();

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
    });

    if (signInError || !signInData.user) {
        return buildError("INVALID_CREDENTIALS", "Invalid email or password.");
    }

    const authUserId = signInData.user.id;

    const { data: userProfile, error: userError } = await fromTable("users")
        .select("*")
        .eq("auth_id", authUserId)
        .maybeSingle();

    if (userError) {
        await supabase.auth.signOut();
        return buildError("UNKNOWN", "Unable to verify admin profile. Please try again.");
    }

    const admin = userProfile as TableRow<"users"> | null;

    if (!admin) {
        await supabase.auth.signOut();
        return buildError("PROFILE_NOT_FOUND", "No admin profile is linked to this account.");
    }

    if (admin.role !== "ADMIN") {
        await supabase.auth.signOut();
        return buildError("NOT_ADMIN", "You are authenticated, but not authorized as admin.");
    }

    if (admin.is_active === false) {
        await supabase.auth.signOut();
        return buildError("INACTIVE_ADMIN", "Your admin account is inactive.");
    }

    await fromTable("users").update({ last_login: new Date().toISOString() }).eq("id", admin.id);

    return {
        success: true,
        admin,
    };
}

export async function registerAdmin(
    email: string,
    password: string,
    firstName?: string,
    lastName?: string,
): Promise<AdminAuthResult> {
    const normalizedEmail = email.trim().toLowerCase();

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
            "Auth account created but no active session was returned. If email confirmation is enabled, verify the email first or disable confirmation for local MVP before creating admin profile.",
        );
    }

    const payload = {
        auth_id: authUser.id,
        email: normalizedEmail,
        first_name: firstName?.trim() || null,
        last_name: lastName?.trim() || null,
        role: "ADMIN" as const,
        is_active: true,
    };

    const { data: existingUser } = await fromTable("users").select("id").eq("email", normalizedEmail).maybeSingle();

    if (existingUser) {
        const { error: updateError } = await fromTable("users").update(payload).eq("email", normalizedEmail);

        if (updateError) {
            return buildError(
                "REGISTRATION_FAILED",
                formatSupabaseError("Auth created, but admin profile update failed.", updateError),
            );
        }
    } else {
        const { error: insertError } = await fromTable("users").insert(payload);

        if (insertError) {
            return buildError(
                "REGISTRATION_FAILED",
                formatSupabaseError("Auth created, but admin profile creation failed.", insertError),
            );
        }
    }

    const { data: adminProfile, error: profileError } = await fromTable("users")
        .select("*")
        .eq("auth_id", authUser.id)
        .maybeSingle();

    if (profileError || !adminProfile) {
        return buildError(
            "REGISTRATION_FAILED",
            formatSupabaseError("Registration created but profile verification failed.", profileError),
        );
    }

    return {
        success: true,
        admin: adminProfile as TableRow<"users">,
    };
}

export async function signOutAdmin(): Promise<void> {
    await supabase.auth.signOut();
}

export async function getCurrentAdmin(): Promise<TableRow<"users"> | null> {
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

    const admin = userProfile as TableRow<"users">;

    if (admin.role !== "ADMIN" || admin.is_active === false) {
        return null;
    }

    return admin;
}
