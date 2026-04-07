import { createAdminClient } from "./test-data";

export async function findOrCreatePublishedInterview() {
    const admin = createAdminClient();
    if (!admin) {
        return null;
    }

    try {
        // 1. Try to find an existing PUBLISHED interview with candidates
        const { data: interviews } = await admin
            .from("interviews")
            .select(
                `
                id,
                organization_id,
                job_id,
                title,
                status,
                applications (
                    id,
                    candidate_name,
                    candidate_email,
                    status
                )
            `
            )
            .eq("status", "PUBLISHED")
            .gt("applications.length", 0)
            .limit(1)
            .maybeSingle();

        if (interviews?.id) {
            return interviews.id;
        }

        // 2. If no PUBLISHED interview exists, create one
        // First, find or create an organization
        const { data: organizations } = await admin
            .from("organizations")
            .select("id")
            .limit(1)
            .maybeSingle();

        let organizationId: number;
        if (organizations?.id) {
            organizationId = organizations.id;
        } else {
            const { data: newOrg } = await admin
                .from("organizations")
                .insert({ name: `E2E Candidate Org ${Date.now()}`, email: `candidate-org-${Date.now()}@test.com`, is_active: true })
                .select("id")
                .single();
            organizationId = newOrg?.id;
            if (!organizationId) throw new Error("Failed to create organization");
        }

        // 3. Find or create job
        const { data: jobs } = await admin
            .from("jobs")
            .select("id")
            .eq("organization_id", organizationId)
            .limit(1)
            .maybeSingle();

        let jobId: number;
        if (jobs?.id) {
            jobId = jobs.id;
        } else {
            const { data: newJob } = await admin
                .from("jobs")
                .insert({
                    organization_id: organizationId,
                    position_title: "E2E Candidate Test Role",
                    job_description: "Auto-generated for candidate status test",
                    skills_required: ["JavaScript"],
                    ctc_min: 100000,
                    ctc_max: 150000,
                })
                .select("id")
                .single();
            jobId = newJob?.id;
            if (!jobId) throw new Error("Failed to create job");
        }

        // 4. Create a PUBLISHED interview
        const now = new Date();
        const campaignStart = new Date(now.getTime() - 60 * 60 * 1000);
        const campaignEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const { data: newInterview } = await admin
            .from("interviews")
            .insert({
                organization_id: organizationId,
                job_id: jobId,
                title: `E2E Candidate Interview ${Date.now()}`,
                status: "PUBLISHED",
                campaign_start_utc: campaignStart.toISOString(),
                campaign_end_utc: campaignEnd.toISOString(),
            })
            .select("id")
            .single();

        const newInterviewId = newInterview?.id;
        if (!newInterviewId) throw new Error("Failed to create interview");

        // 5. Create interview slots
        const interviewStart = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const interviewEnd = new Date(interviewStart.getTime() + 2 * 60 * 60 * 1000);

        const { data: interviewSlots } = await admin
            .from("interview_slots")
            .insert({
                interview_id: newInterviewId,
                slot_start_utc: interviewStart.toISOString(),
                slot_end_utc: interviewEnd.toISOString(),
                max_candidates: 50,
            })
            .select("id")
            .single();

        const interviewSlotId = interviewSlots?.id;
        if (!interviewSlotId) throw new Error("Failed to create interview slot");

        // 6. Create a test application/candidate (without slot assignment for now)
        const { data: application, error: appError } = await admin
            .from("applications")
            .insert({
                interview_id: newInterviewId,
                candidate_name: "E2E Candidate Status Test",
                candidate_email: `candidate-${Date.now()}@test.com`,
                candidate_phone: "9999999999",
                status: "APPLIED",
            })
            .select("id")
            .single();

        if (!application?.id) {
            const errorMsg = appError?.message || "No error details";
            throw new Error(`Failed to create application: ${errorMsg}`);
        }

        return newInterviewId;
    } catch (err) {
        console.error("Failed to find or create published interview:", err);
        return null;
    }
}
