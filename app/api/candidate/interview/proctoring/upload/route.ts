import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { validateAssignedInterviewSlotWindow } from "@/lib/candidate-interview-access";

function asText(input: unknown) {
    return String(input || "").trim();
}

function addDays(date: Date, days: number) {
    const copy = new Date(date);
    copy.setUTCDate(copy.getUTCDate() + days);
    return copy;
}

export async function POST(request: NextRequest) {
    try {
        const form = await request.formData();
        const token = asText(form.get("token"));
        const recordingType = asText(form.get("recordingType")) || "PROCTORING";
        const durationSecondsRaw = asText(form.get("durationSeconds"));
        const durationSeconds = durationSecondsRaw ? Number(durationSecondsRaw) : null;
        const file = form.get("file");

        if (!token) {
            return NextResponse.json({ success: false, error: "Missing token" }, { status: 400 });
        }

        if (!(file instanceof File)) {
            return NextResponse.json({ success: false, error: "Missing file" }, { status: 400 });
        }

        const { data: session, error: sessionError } = await supabaseAdmin
            .from("interview_sessions")
            .select("id, application_id")
            .eq("session_token", token)
            .maybeSingle();

        if (sessionError || !session) {
            return NextResponse.json({ success: false, error: "Invalid interview token" }, { status: 404 });
        }

        const { data: application, error: applicationError } = await supabaseAdmin
            .from("applications")
            .select("id, interview_id")
            .eq("id", session.application_id)
            .maybeSingle();

        if (applicationError || !application) {
            return NextResponse.json({ success: false, error: "Application not found" }, { status: 404 });
        }

        const slotAccess = await validateAssignedInterviewSlotWindow(application.id);
        if (!slotAccess.allowed) {
            return NextResponse.json({ success: false, error: slotAccess.error || "Interview access denied" }, { status: 400 });
        }

        const { data: interview, error: interviewError } = await supabaseAdmin
            .from("interviews")
            .select("id, organization_id")
            .eq("id", application.interview_id)
            .maybeSingle();

        if (interviewError || !interview) {
            return NextResponse.json({ success: false, error: "Interview not found" }, { status: 404 });
        }

        const mimeType = file.type || "application/octet-stream";
        const extension = mimeType.includes("webm") ? "webm" : mimeType.includes("mp4") ? "mp4" : "bin";
        const timestamp = Date.now();

        const objectPath = `${interview.organization_id}/${interview.id}/${application.id}/${session.id}/${timestamp}.${extension}`;
        const bucketCandidates = [
            process.env.RECORDINGS_BUCKET,
            process.env.SUPABASE_RESUME_BUCKET,
            "recordings-private",
            "candidate-resumes",
        ]
            .map((v) => String(v || "").trim())
            .filter((v, idx, arr) => v.length > 0 && arr.indexOf(v) === idx);

        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        let selectedBucket = "";
        let uploadErrorMessage = "";

        for (const bucketName of bucketCandidates) {
            const { error: uploadError } = await supabaseAdmin.storage.from(bucketName).upload(objectPath, bytes, {
                contentType: mimeType,
                upsert: false,
            });

            if (!uploadError) {
                selectedBucket = bucketName;
                uploadErrorMessage = "";
                break;
            }

            uploadErrorMessage = uploadError.message || "Upload failed";
        }

        if (!selectedBucket) {
            return NextResponse.json(
                {
                    success: false,
                    error: `Failed to upload recording. Checked buckets: ${bucketCandidates.join(", ")}. Last error: ${uploadErrorMessage}`,
                },
                { status: 500 }
            );
        }

        const retentionUntil = addDays(new Date(), 180).toISOString();

        const { error: insertError } = await supabaseAdmin.from("recordings").insert({
            interview_session_id: session.id,
            recording_type: recordingType,
            file_path: objectPath,
            file_size: bytes.byteLength,
            mime_type: mimeType,
            is_encrypted: true,
            duration_seconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
            retention_until: retentionUntil,
        });

        if (insertError) {
            return NextResponse.json({ success: false, error: "Failed to save recording metadata" }, { status: 500 });
        }

        return NextResponse.json({ success: true, data: { objectPath, bucket: selectedBucket } });
    } catch (error) {
        console.error("Proctoring upload error:", error);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}
