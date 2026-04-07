/*
  Load test helper for real environments.
  Usage:
    APP_BASE_URL=https://vip-lake.vercel.app \
    ASSESSMENT_TOKEN=... INTERVIEW_TOKEN=... APPLY_LINK_ID=... \
    node scripts/load-concurrency-check.js
*/

const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
const assessmentToken = process.env.ASSESSMENT_TOKEN || "";
const interviewToken = process.env.INTERVIEW_TOKEN || "";
const applyLinkId = process.env.APPLY_LINK_ID || "";
const parallelUsers = Number(process.env.PARALLEL_USERS || 200);

async function safeJson(response) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        return { parseError: true, raw: text.slice(0, 200) };
    }
}

async function runAssessmentInterviewBurst() {
    if (!assessmentToken || !interviewToken) {
        console.log("[SKIP] assessment/interview burst: set ASSESSMENT_TOKEN and INTERVIEW_TOKEN");
        return;
    }

    const start = Date.now();
    const assessmentRequests = Array.from({ length: parallelUsers }, () =>
        fetch(`${baseUrl}/api/candidate/assessment?token=${encodeURIComponent(assessmentToken)}`)
    );
    const interviewRequests = Array.from({ length: parallelUsers }, () =>
        fetch(`${baseUrl}/api/candidate/interview?token=${encodeURIComponent(interviewToken)}`)
    );

    const responses = await Promise.all([...assessmentRequests, ...interviewRequests]);
    const payloads = await Promise.all(responses.map((r) => safeJson(r)));

    const ok = responses.filter((r) => r.ok).length;
    const badJson = payloads.filter((p) => p.parseError).length;

    console.log("\n=== Assessment+Interview Concurrency ===");
    console.log(`Total requests: ${responses.length}`);
    console.log(`HTTP success: ${ok}`);
    console.log(`Non-JSON responses: ${badJson}`);
    console.log(`Duration ms: ${Date.now() - start}`);
}

async function runApplyBurst() {
    if (!applyLinkId) {
        console.log("[SKIP] apply burst: set APPLY_LINK_ID");
        return;
    }

    const start = Date.now();
    const requests = Array.from({ length: parallelUsers }, (_, idx) => {
        const form = new FormData();
        form.set("name", `Load Candidate ${idx + 1}`);
        form.set("email", `load-candidate-${Date.now()}-${idx}@test.com`);
        form.set("consentDataProcessing", "true");
        form.set("consentAudioRecording", "true");
        form.set("consentVideoRecording", "true");

        return fetch(`${baseUrl}/api/apply/${applyLinkId}`, {
            method: "POST",
            body: form,
        });
    });

    const responses = await Promise.all(requests);
    const payloads = await Promise.all(responses.map((r) => safeJson(r)));

    const ok = responses.filter((r) => r.ok).length;
    const conflict = responses.filter((r) => r.status === 409).length;
    const badJson = payloads.filter((p) => p.parseError).length;

    console.log("\n=== Apply Concurrency ===");
    console.log(`Total requests: ${responses.length}`);
    console.log(`HTTP success: ${ok}`);
    console.log(`HTTP 409 (duplicates): ${conflict}`);
    console.log(`Non-JSON responses: ${badJson}`);
    console.log(`Duration ms: ${Date.now() - start}`);
}

(async () => {
    console.log(`Running load checks on ${baseUrl} with PARALLEL_USERS=${parallelUsers}`);
    await runAssessmentInterviewBurst();
    await runApplyBurst();
})();
