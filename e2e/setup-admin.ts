import { createAdminClient } from "./test-data";

export async function ensureValidOrgAdmin() {
    const admin = createAdminClient();
    if (!admin) {
        return null;
    }

    const fallbackEmail = `e2e-org-${Date.now()}@test.com`;
    const fallbackPassword = `Playwright@${Date.now()}!`;

    let organizationId: number | null = null;
    const { data: organization } = await admin.from("organizations").select("id").order("id", { ascending: true }).limit(1).maybeSingle();
    if (organization?.id) {
        organizationId = organization.id;
    } else {
        const { data: newOrganization } = await admin
            .from("organizations")
            .insert({ name: `E2E Org ${Date.now()}`, email: `${fallbackEmail}`, is_active: true })
            .select("id")
            .single();
        organizationId = newOrganization?.id ?? null;
    }

    if (!organizationId) {
        return null;
    }

    const { data: createdUser } = await admin.auth.admin.createUser({
        email: fallbackEmail,
        password: fallbackPassword,
        email_confirm: true,
    });

    if (!createdUser.user) {
        return null;
    }

    await admin.from("users").insert({
        auth_id: createdUser.user.id,
        email: fallbackEmail,
        first_name: "E2E",
        last_name: "Admin",
        role: "ORG_ADMIN",
        organization_id: organizationId,
        is_active: true,
    });

    return { email: fallbackEmail, password: fallbackPassword };
}
