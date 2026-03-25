import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";

type FormConfig = {
    requireName: boolean;
    requireEmail: boolean;
    requirePhone: boolean;
    requireResume: boolean;
    requirePhoto: boolean;
    consentPolicyVersion: string;
    consentPolicyUrl: string | null;
};

type SlotOption = {
    id: number;
    slotStartUtc: string;
    slotEndUtc: string;
    maxCandidates: number;
    assignedCandidates: number;
    seatsLeft: number;
};

const RESUME_BUCKET = process.env.SUPABASE_RESUME_BUCKET || "candidate-resumes";
const CANDIDATE_PHOTO_BUCKET = process.env.SUPABASE_CANDIDATE_PHOTO_BUCKET || "candidate-photos";
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

function parseFormConfig(raw: unknown): FormConfig {
    const fallback: FormConfig = {
        requireName: true,
        requireEmail: true,
        requirePhone: false,
        requireResume: true,
        requirePhoto: true,
        consentPolicyVersion: process.env.CONSENT_POLICY_VERSION || "v1",
        consentPolicyUrl: process.env.CONSENT_POLICY_URL || null,
    };

    if (!raw || typeof raw !== "object") {
        return fallback;
    }

    const cfg = raw as Partial<FormConfig>;
    return {
        requireName: cfg.requireName ?? fallback.requireName,
        requireEmail: cfg.requireEmail ?? fallback.requireEmail,
        requirePhone: cfg.requirePhone ?? fallback.requirePhone,
        requireResume: cfg.requireResume ?? fallback.requireResume,
        requirePhoto: cfg.requirePhoto ?? fallback.requirePhoto,
        consentPolicyVersion:
            typeof cfg.consentPolicyVersion === "string" && cfg.consentPolicyVersion.trim()
                ? cfg.consentPolicyVersion.trim()
                : fallback.consentPolicyVersion,
        consentPolicyUrl:
            typeof cfg.consentPolicyUrl === "string" && cfg.consentPolicyUrl.trim()
                ? cfg.consentPolicyUrl.trim()
                : fallback.consentPolicyUrl,
    };
}

function isLikelyEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseBoolean(value: FormDataEntryValue | null): boolean {
    if (!value) {
        return false;
    }

    const normalized = String(value).trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

function parsePreferenceIds(value: FormDataEntryValue | null): number[] {
    if (!value) {
        return [];
    }

    const raw = String(value).trim();
    if (!raw) {
        return [];
    }

    let parsed: unknown = raw;
    if (raw.startsWith("[")) {
        try {
            parsed = JSON.parse(raw);
        } catch {
            return [];
        }
    } else if (raw.includes(",")) {
        parsed = raw.split(",").map((item) => item.trim());
    }

    const values = Array.isArray(parsed) ? parsed : [parsed];
    const uniqueIds = new Set<number>();

    for (const item of values) {
        const numeric = Number(item);
        if (Number.isInteger(numeric) && numeric > 0) {
            uniqueIds.add(numeric);
        }
    }

    return Array.from(uniqueIds).slice(0, 3);
}

function normalizeSlots(
    rows: Array<{
        id: number;
        slot_start_utc: string;
        slot_end_utc: string;
        max_candidates: number | null;
        assigned_candidates: number | null;
    }>
): SlotOption[] {
    const nowTs = Date.now();

    return rows
        .map((slot) => {
            const maxCandidates = slot.max_candidates ?? 0;
            const assignedCandidates = slot.assigned_candidates ?? 0;
            const seatsLeft = Math.max(0, maxCandidates - assignedCandidates);

            return {
                id: slot.id,
                slotStartUtc: slot.slot_start_utc,
                slotEndUtc: slot.slot_end_utc,
                maxCandidates,
                assignedCandidates,
                seatsLeft,
            };
        })
        .filter((slot) => new Date(slot.slotEndUtc).getTime() > nowTs && slot.seatsLeft > 0);
}

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        if (!id) {
            return NextResponse.json({ success: false, error: "Missing application id" }, { status: 400 });
        }

        const { data: linkData, error: linkError } = await supabaseAdmin
            .from("application_links")
            .select("id, interview_id, application_token, valid_until, is_active, application_form_config")
            .eq("application_token", id)
            .maybeSingle();

        if (linkError || !linkData) {
            return NextResponse.json({ success: false, error: "Application link not found" }, { status: 404 });
        }

        if (!linkData.is_active) {
            return NextResponse.json({ success: false, error: "This application link is no longer active" }, { status: 400 });
        }

        if (new Date(linkData.valid_until) <= new Date()) {
            return NextResponse.json({ success: false, error: "This application link has expired" }, { status: 400 });
        }

        const { data: interviewData, error: interviewError } = await supabaseAdmin
            .from("interviews")
            .select("id, title, campaign_start_utc, campaign_end_utc, jobs(position_title)")
            .eq("id", linkData.interview_id)
            .maybeSingle();

        if (interviewError || !interviewData) {
            return NextResponse.json({ success: false, error: "Interview not found" }, { status: 404 });
        }

        const [{ data: assessmentSlotsData, error: assessmentSlotsError }, { data: interviewSlotsData, error: interviewSlotsError }] = await Promise.all([
            supabaseAdmin
                .from("assessment_slots")
                .select("id, slot_start_utc, slot_end_utc, max_candidates, assigned_candidates")
                .eq("interview_id", linkData.interview_id)
                .order("slot_start_utc", { ascending: true }),
            supabaseAdmin
                .from("interview_slots")
                .select("id, slot_start_utc, slot_end_utc, max_candidates, assigned_candidates")
                .eq("interview_id", linkData.interview_id)
                .order("slot_start_utc", { ascending: true }),
        ]);

        if (assessmentSlotsError || interviewSlotsError) {
            return NextResponse.json({ success: false, error: "Failed to load interview slots" }, { status: 500 });
        }

        const assessmentSlots = normalizeSlots(assessmentSlotsData ?? []);
        const interviewSlots = normalizeSlots(interviewSlotsData ?? []);

        return NextResponse.json({
            success: true,
            data: {
                interviewId: linkData.interview_id,
                title: interviewData.title,
                positionTitle: (interviewData.jobs as { position_title?: string } | null)?.position_title ?? null,
                campaignStartUtc: interviewData.campaign_start_utc,
                campaignEndUtc: interviewData.campaign_end_utc,
                validUntil: linkData.valid_until,
                formConfig: parseFormConfig(linkData.application_form_config),
                assessmentSlots,
                interviewSlots,
            },
        });
    } catch (error) {
        console.error("Apply GET error:", error);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        if (!id) {
            return NextResponse.json({ success: false, error: "Missing application id" }, { status: 400 });
        }

        const { data: linkData, error: linkError } = await supabaseAdmin
            .from("application_links")
            .select("id, interview_id, application_token, valid_until, is_active, application_form_config")
            .eq("application_token", id)
            .maybeSingle();

        if (linkError || !linkData) {
            return NextResponse.json({ success: false, error: "Application link not found" }, { status: 404 });
        }

        if (!linkData.is_active) {
            return NextResponse.json({ success: false, error: "This application link is no longer active" }, { status: 400 });
        }

        if (new Date(linkData.valid_until) <= new Date()) {
            return NextResponse.json({ success: false, error: "This application link has expired" }, { status: 400 });
        }

        const formConfig = parseFormConfig(linkData.application_form_config);
        const formData = await request.formData();

        const candidateName = String(formData.get("name") || "").trim();
        const candidateEmail = String(formData.get("email") || "").trim().toLowerCase();
        const candidatePhone = String(formData.get("phone") || "").trim();
        const resumeFile = formData.get("resume") as File | null;
        const photoFile = formData.get("photo") as File | null;
        const assessmentPreferenceIds = parsePreferenceIds(formData.get("assessmentPreferenceIds"));
        const interviewPreferenceIds = parsePreferenceIds(formData.get("interviewPreferenceIds"));
        const consentDataProcessing = parseBoolean(formData.get("consentDataProcessing"));
        const consentAudioRecording = parseBoolean(formData.get("consentAudioRecording"));
        const consentVideoRecording = parseBoolean(formData.get("consentVideoRecording"));

        if (formConfig.requireName && !candidateName) {
            return NextResponse.json({ success: false, error: "Name is required" }, { status: 400 });
        }

        if (!candidateEmail) {
            return NextResponse.json({ success: false, error: "Email is required" }, { status: 400 });
        }

        if (candidateEmail && !isLikelyEmail(candidateEmail)) {
            return NextResponse.json({ success: false, error: "Please provide a valid email address" }, { status: 400 });
        }

        if (formConfig.requirePhone && !candidatePhone) {
            return NextResponse.json({ success: false, error: "Phone is required" }, { status: 400 });
        }

        if (formConfig.requireResume && (!resumeFile || resumeFile.size === 0)) {
            return NextResponse.json({ success: false, error: "Resume is required" }, { status: 400 });
        }

        if (formConfig.requirePhoto && (!photoFile || photoFile.size === 0)) {
            return NextResponse.json({ success: false, error: "Photo is required" }, { status: 400 });
        }

        if (photoFile && photoFile.size > 0) {
            if (!photoFile.type.startsWith("image/")) {
                return NextResponse.json({ success: false, error: "Photo must be an image file" }, { status: 400 });
            }

            if (photoFile.size > MAX_PHOTO_BYTES) {
                return NextResponse.json({ success: false, error: "Photo must be 5MB or smaller" }, { status: 400 });
            }
        }

        if (!consentDataProcessing || !consentAudioRecording || !consentVideoRecording) {
            return NextResponse.json(
                {
                    success: false,
                    error: "All consent checkboxes are required to proceed",
                },
                { status: 400 }
            );
        }

        if (candidateEmail) {
            const { data: existingApplication } = await supabaseAdmin
                .from("applications")
                .select("id")
                .eq("interview_id", linkData.interview_id)
                .eq("candidate_email", candidateEmail)
                .maybeSingle();

            if (existingApplication) {
                return NextResponse.json(
                    { success: false, error: "An application with this email already exists for this interview" },
                    { status: 409 }
                );
            }
        }

        const [{ data: assessmentSlotsData, error: assessmentSlotsError }, { data: interviewSlotsData, error: interviewSlotsError }] = await Promise.all([
            supabaseAdmin
                .from("assessment_slots")
                .select("id")
                .eq("interview_id", linkData.interview_id),
            supabaseAdmin
                .from("interview_slots")
                .select("id")
                .eq("interview_id", linkData.interview_id),
        ]);

        if (assessmentSlotsError || interviewSlotsError) {
            return NextResponse.json({ success: false, error: "Failed to validate slot preferences" }, { status: 500 });
        }

        const allowedAssessmentSlotIds = new Set((assessmentSlotsData ?? []).map((slot) => slot.id));
        const allowedInterviewSlotIds = new Set((interviewSlotsData ?? []).map((slot) => slot.id));

        if (allowedAssessmentSlotIds.size > 0 && assessmentPreferenceIds.length === 0) {
            return NextResponse.json(
                { success: false, error: "Select at least one assessment slot preference" },
                { status: 400 }
            );
        }

        if (allowedInterviewSlotIds.size > 0 && interviewPreferenceIds.length === 0) {
            return NextResponse.json(
                { success: false, error: "Select at least one interview slot preference" },
                { status: 400 }
            );
        }

        for (const assessmentSlotId of assessmentPreferenceIds) {
            if (!allowedAssessmentSlotIds.has(assessmentSlotId)) {
                return NextResponse.json(
                    { success: false, error: "One or more selected assessment slots are invalid" },
                    { status: 400 }
                );
            }
        }

        for (const interviewSlotId of interviewPreferenceIds) {
            if (!allowedInterviewSlotIds.has(interviewSlotId)) {
                return NextResponse.json(
                    { success: false, error: "One or more selected interview slots are invalid" },
                    { status: 400 }
                );
            }
        }

        let resumeFilePath: string | null = null;
        let resumeFileSize: number | null = null;
        let candidatePhotoPath: string | null = null;

        if (resumeFile && resumeFile.size > 0) {
            const extension = resumeFile.name.includes(".")
                ? resumeFile.name.split(".").pop()?.toLowerCase() || "pdf"
                : "pdf";

            const storagePath = `interviews/${linkData.interview_id}/${randomUUID()}.${extension}`;
            const buffer = new Uint8Array(await resumeFile.arrayBuffer());

            const { error: uploadError } = await supabaseAdmin.storage
                .from(RESUME_BUCKET)
                .upload(storagePath, buffer, {
                    contentType: resumeFile.type || "application/octet-stream",
                    upsert: false,
                });

            if (uploadError) {
                return NextResponse.json(
                    {
                        success: false,
                        error: `Failed to upload resume. Ensure storage bucket '${RESUME_BUCKET}' exists and is writable.`,
                    },
                    { status: 500 }
                );
            }

            resumeFilePath = storagePath;
            resumeFileSize = resumeFile.size;
        }

        if (photoFile && photoFile.size > 0) {
            const extension = photoFile.name.includes(".")
                ? photoFile.name.split(".").pop()?.toLowerCase() || "jpg"
                : "jpg";

            const storagePath = `interviews/${linkData.interview_id}/photos/${randomUUID()}.${extension}`;
            const buffer = new Uint8Array(await photoFile.arrayBuffer());

            const { error: uploadError } = await supabaseAdmin.storage
                .from(CANDIDATE_PHOTO_BUCKET)
                .upload(storagePath, buffer, {
                    contentType: photoFile.type || "image/jpeg",
                    upsert: false,
                });

            if (uploadError) {
                return NextResponse.json(
                    {
                        success: false,
                        error: `Failed to upload photo. Ensure storage bucket '${CANDIDATE_PHOTO_BUCKET}' exists and is writable.`,
                    },
                    { status: 500 }
                );
            }

            candidatePhotoPath = storagePath;
        }

        const { data: applicationData, error: applicationError } = await supabaseAdmin
            .from("applications")
            .insert({
                interview_id: linkData.interview_id,
                candidate_name: candidateName || "Candidate",
                candidate_email: candidateEmail,
                candidate_phone: candidatePhone || null,
                resume_file_path: resumeFilePath,
                resume_file_size: resumeFileSize,
                candidate_photo_path: candidatePhotoPath,
                status: "APPLIED",
            })
            .select("id, created_at")
            .single();

        if (applicationError || !applicationData) {
            if (applicationError?.code === "23505") {
                return NextResponse.json(
                    { success: false, error: "An application with this email already exists for this interview" },
                    { status: 409 }
                );
            }

            return NextResponse.json({ success: false, error: "Failed to register application" }, { status: 500 });
        }

        const preferenceRows: Array<{
            application_id: number;
            slot_type: "assessment" | "interview";
            preference_rank: number;
            preferred_assessment_slot_id: number | null;
            preferred_interview_slot_id: number | null;
        }> = [];

        assessmentPreferenceIds.forEach((slotId, index) => {
            preferenceRows.push({
                application_id: applicationData.id,
                slot_type: "assessment",
                preference_rank: index + 1,
                preferred_assessment_slot_id: slotId,
                preferred_interview_slot_id: null,
            });
        });

        interviewPreferenceIds.forEach((slotId, index) => {
            preferenceRows.push({
                application_id: applicationData.id,
                slot_type: "interview",
                preference_rank: index + 1,
                preferred_assessment_slot_id: null,
                preferred_interview_slot_id: slotId,
            });
        });

        if (preferenceRows.length > 0) {
            const { error: preferenceError } = await supabaseAdmin
                .from("application_slot_preferences")
                .insert(preferenceRows);

            if (preferenceError) {
                console.error("Preference insert error:", preferenceError);

                await supabaseAdmin.from("applications").delete().eq("id", applicationData.id);

                return NextResponse.json(
                    { success: false, error: "Failed to save slot preferences" },
                    { status: 500 }
                );
            }
        }

        const forwardedFor = request.headers.get("x-forwarded-for") || "";
        const inferredIp = forwardedFor.split(",")[0]?.trim() || null;
        const consentedAtIso = new Date().toISOString();

        const consentRows = [
            {
                application_id: applicationData.id,
                consent_type: "DATA_PROCESSING",
                consent_given: consentDataProcessing,
                policy_version: formConfig.consentPolicyVersion,
                consented_at: consentedAtIso,
                ip_address: inferredIp,
            },
            {
                application_id: applicationData.id,
                consent_type: "AUDIO_RECORDING",
                consent_given: consentAudioRecording,
                policy_version: formConfig.consentPolicyVersion,
                consented_at: consentedAtIso,
                ip_address: inferredIp,
            },
            {
                application_id: applicationData.id,
                consent_type: "VIDEO_RECORDING",
                consent_given: consentVideoRecording,
                policy_version: formConfig.consentPolicyVersion,
                consented_at: consentedAtIso,
                ip_address: inferredIp,
            },
        ];

        const { error: consentError } = await supabaseAdmin.from("consents").insert(consentRows);

        if (consentError) {
            console.error("Consent insert error:", consentError);
            await supabaseAdmin.from("application_slot_preferences").delete().eq("application_id", applicationData.id);
            await supabaseAdmin.from("applications").delete().eq("id", applicationData.id);

            return NextResponse.json(
                { success: false, error: "Failed to save candidate consent" },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            data: {
                applicationId: applicationData.id,
                interviewId: linkData.interview_id,
                createdAt: applicationData.created_at,
                preferencesSaved: preferenceRows.length,
            },
            message: "Application submitted successfully",
        });
    } catch (error) {
        console.error("Apply POST error:", error);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}
