import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const applyLinkId = process.env.APPLY_LINK_ID || "";
const parallelCandidates = Number(process.env.PARALLEL_USERS || 5);

const fixturesDir = path.join(process.cwd(), "e2e", "fixtures");
const resumePath = path.join(fixturesDir, "test-resume.pdf");
const photoPath = path.join(fixturesDir, "test-photo.jpg");

function ensureFixtureFiles() {
    if (!fs.existsSync(fixturesDir)) {
        fs.mkdirSync(fixturesDir, { recursive: true });
    }

    if (!fs.existsSync(resumePath)) {
        fs.writeFileSync(resumePath, "%PDF-1.4\n% Playwright test resume\n", "utf8");
    }

    if (!fs.existsSync(photoPath)) {
        fs.writeFileSync(photoPath, "fake-jpg-content", "utf8");
    }
}

async function getFirstEnabledOptionValues(selectLocator: any) {
    const options = await selectLocator.locator("option").evaluateAll((els: HTMLOptionElement[]) =>
        els
            .map((el) => ({
                value: el.value,
                disabled: el.disabled,
            }))
            .filter((item) => item.value && item.value !== "" && !item.disabled),
    );

    return options.map((option: { value: string }) => option.value);
}

test.describe("Apply Flow Parallel Candidates", () => {
    test.skip(!applyLinkId, "Set APPLY_LINK_ID to run apply-parallel tests");

    test("single browser submit works end-to-end", async ({ page, baseURL }) => {
        ensureFixtureFiles();
        const response = await page.goto(`${baseURL}/apply/${applyLinkId}`);
        expect(response?.ok()).toBeTruthy();
        await page.waitForLoadState("networkidle");

        const errorBanner = page.getByText(/application link not found|expired|invalid or expired application link/i);
        if (await errorBanner.isVisible().catch(() => false)) {
            throw new Error(`Apply link ${applyLinkId} is not usable in this environment.`);
        }

        await expect(page.getByText(/candidate application/i)).toBeVisible();

        await page.getByPlaceholder(/enter your full name/i).fill("Playwright Candidate");
        await page.getByPlaceholder(/enter your email/i).fill(`playwright-single-${Date.now()}@test.com`);
        await page.getByPlaceholder(/enter your phone number/i).fill("9999999999");

        await page.locator('input[type="file"]').nth(0).setInputFiles(resumePath);
        await page.locator('input[type="file"]').nth(1).setInputFiles(photoPath);

        const selects = page.locator("select");
        const selectCount = await selects.count();
        expect(selectCount).toBeGreaterThan(0);

        for (let i = 0; i < selectCount; i += 1) {
            const select = selects.nth(i);
            const enabledOptionValues = await getFirstEnabledOptionValues(select);
            if (enabledOptionValues.length === 0) {
                continue;
            }
            const nextValue = enabledOptionValues[i % enabledOptionValues.length];
            await select.selectOption(nextValue);
        }

        const checkboxes = page.locator('input[type="checkbox"]');
        const checks = await checkboxes.count();
        for (let i = 0; i < checks; i += 1) {
            const cb = checkboxes.nth(i);
            if (!(await cb.isChecked())) {
                await cb.check();
            }
        }

        await expect(page.getByRole("button", { name: /submit application/i })).toBeEnabled();
        await page.getByRole("button", { name: /submit application/i }).click();

        await expect(page.getByText(/application submitted successfully/i)).toBeVisible({ timeout: 20000 });
    });

    test("multiple candidates can apply in parallel", async ({ browser, baseURL }) => {
        ensureFixtureFiles();

        const metaResponse = await fetch(`${baseURL}/api/apply/${applyLinkId}`);
        const metaJson = await metaResponse.json().catch(() => null);

        if (!metaResponse.ok || !metaJson?.success) {
            throw new Error(`Apply meta endpoint is not usable for ${applyLinkId}: ${JSON.stringify(metaJson)}`);
        }

        const assessmentSlotIds: number[] = Array.isArray(metaJson.data?.assessmentSlots)
            ? metaJson.data.assessmentSlots.map((slot: { id: number }) => slot.id)
            : [];
        const interviewSlotIds: number[] = Array.isArray(metaJson.data?.interviewSlots)
            ? metaJson.data.interviewSlots.map((slot: { id: number }) => slot.id)
            : [];

        const jobs = Array.from({ length: parallelCandidates }, async (_, idx) => {
            const context = await browser.newContext({ baseURL });
            const page = await context.newPage();

            try {
                await page.goto(`/apply/${applyLinkId}`);
                await page.waitForLoadState("networkidle");
                await page.getByPlaceholder(/enter your full name/i).fill(`Parallel Candidate ${idx + 1}`);
                await page.getByPlaceholder(/enter your email/i).fill(`parallel-${Date.now()}-${idx}@test.com`);
                await page.getByPlaceholder(/enter your phone number/i).fill(`9999999${String(idx).padStart(3, "0")}`);
                await page.locator('input[type="file"]').nth(0).setInputFiles(resumePath);
                await page.locator('input[type="file"]').nth(1).setInputFiles(photoPath);

                const selects = page.locator("select");
                const selectCount = await selects.count();
                for (let i = 0; i < selectCount; i += 1) {
                    const select = selects.nth(i);
                    const options = await getFirstEnabledOptionValues(select);
                    const values = i < 3 ? assessmentSlotIds : interviewSlotIds;
                    if (values.length > 0 && options.length > 0) {
                        const optionIndex = i % Math.min(values.length, options.length);
                        const nextValue = String(values[optionIndex]);
                        await select.selectOption(nextValue);
                    }
                }

                const checkboxes = page.locator('input[type="checkbox"]');
                for (let i = 0; i < (await checkboxes.count()); i += 1) {
                    const cb = checkboxes.nth(i);
                    if (!(await cb.isChecked())) {
                        await cb.check();
                    }
                }

                await expect(page.getByRole("button", { name: /submit application/i })).toBeEnabled();
                await page.getByRole("button", { name: /submit application/i }).click();
                await expect(page.getByText(/application submitted successfully/i)).toBeVisible({ timeout: 20000 });
                return true;
            } finally {
                await context.close();
            }
        });

        const results = await Promise.all(jobs);
        expect(results.every(Boolean)).toBeTruthy();
    });
});
