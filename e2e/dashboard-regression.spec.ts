import { test, expect } from "@playwright/test";
import { ensureValidOrgAdmin } from "./setup-admin";
import { findOrCreatePublishedInterview } from "./setup-interview";

async function signInOrganization(page: any, baseURL: string) {
    const creds = await ensureValidOrgAdmin();

    if (!creds) {
        throw new Error("Unable to create a valid organization admin for E2E testing.");
    }

    await page.goto(`${baseURL}/organization/organization_auth`);
    await page.getByLabel(/email address/i).fill(creds.email);
    await page.getByLabel(/^password$/i).fill(creds.password);
    await page.getByRole("button", { name: /sign in to organization panel/i }).click();

    try {
        await page.waitForURL(/\/organization($|\?)/, { timeout: 30_000 });
    } catch {
        const errorText = await page.locator("body").innerText();
        throw new Error(`Organization login did not redirect. Current URL: ${page.url()}\nPage content: ${errorText.slice(0, 500)}`);
    }
}

test.describe("Dashboard Regression Flow", () => {
    test("org login -> dashboard -> create interview part 1", async ({ page, baseURL }) => {
        await signInOrganization(page, baseURL);

        await page.goto(`${baseURL}/organization/create-interview`);

        await page.getByPlaceholder(/senior software engineer/i).fill(`E2E Role ${Date.now()}`);
        await page.getByPlaceholder(/describe role, responsibilities/i).fill("E2E generated description for regression flow");
        await page.getByPlaceholder(/react, node\.js, postgresql/i).fill("TypeScript, Next.js, Supabase");
        await page.getByPlaceholder("500000").fill("1000000");
        await page.getByPlaceholder("1000000").fill("2000000");

        const now = new Date();
        const yyyy = now.getUTCFullYear();
        const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(now.getUTCDate() + 1).padStart(2, "0");
        const endDd = String(now.getUTCDate() + 2).padStart(2, "0");

        await page.locator('input[type="date"]').nth(0).fill(`${yyyy}-${mm}-${dd}`);
        await page.locator('input[type="time"]').nth(0).fill("09:00");
        await page.locator('input[type="date"]').nth(1).fill(`${yyyy}-${mm}-${endDd}`);
        await page.locator('input[type="time"]').nth(1).fill("17:00");

        await page.getByRole("button", { name: /next: part 2/i }).click();

        await expect(page).toHaveURL(/\/organization\/create-interview\/part-2\?interviewId=/);
    });

    test("manage interviews shows status widgets and filters", async ({ page, baseURL }) => {
        await signInOrganization(page, baseURL);

        await page.goto(`${baseURL}/organization/manage-interviews`);

        await expect(page.getByText(/manage interviews/i)).toBeVisible();
        await expect(page.locator("select").nth(0)).toBeVisible();
        await expect(page.locator("select").nth(1)).toBeVisible();

        await page.locator("select").nth(0).selectOption("PUBLISHED");
        await page.locator("select").nth(1).selectOption("ALL");
    });

    test("candidate status page reachable for a known interview id", async ({ page, baseURL }) => {
        // Auto-derive a published interview with candidates
        const interviewId = await findOrCreatePublishedInterview();

        if (!interviewId) {
            test.skip(true, "Unable to find or create a published interview for candidate status test");
        }

        await signInOrganization(page, baseURL);
        await page.goto(`${baseURL}/organization/manage-interviews/${interviewId}/candidates-info`);
        await expect(page.getByText(/candidates/i)).toBeVisible();
    });
});
