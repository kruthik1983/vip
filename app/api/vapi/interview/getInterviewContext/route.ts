import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { extractResumeTextFromStorage } from "@/lib/resume-parser";
import {
    getRemainingSeconds,
    isSessionActive,
    loadSessionByToken,
    markInterviewInProgress,
    parseSkills,
    parseVapiToolAuth,
} from "@/lib/vapi-interview";

export async function POST(request: NextRequest) {
    try {
        const auth = parseVapiToolAuth(request);
        if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
        }

        const body = await request.json();
        const sessionToken = String(body?.sessionToken || "").trim();

        if (!sessionToken) {
            return NextResponse.json({ ok: false, error: "sessionToken is required" }, { status: 400 });
        }

        const session = await loadSessionByToken(sessionToken);
        if (!session) {
            return NextResponse.json({ ok: false, error: "Invalid interview session token" }, { status: 404 });
        }

        if (session.ended_at) {
            return NextResponse.json({ ok: false, error: "Interview already ended" }, { status: 400 });
        }

        if (!isSessionActive(session.session_valid_from, session.session_valid_until)) {
            return NextResponse.json({ ok: false, error: "Interview link is not active right now" }, { status: 400 });
        }

        const nowIso = new Date().toISOString();
        await markInterviewInProgress(session, nowIso);

        const { data: application, error: appError } = await supabaseAdmin
            .from("applications")
            .select("id, interview_id, candidate_name, candidate_email, resume_file_path")
            .eq("id", session.application_id)
            .maybeSingle();

        if (appError || !application) {
            return NextResponse.json({ ok: false, error: "Application not found" }, { status: 404 });
        }

        const { data: interview, error: interviewError } = await supabaseAdmin
            .from("interviews")
            .select("id, title, interview_duration_minutes, jobs(position_title, job_description, skills_required)")
            .eq("id", application.interview_id)
            .maybeSingle();

        if (interviewError || !interview) {
            return NextResponse.json({ ok: false, error: "Interview not found" }, { status: 404 });
        }

        const jobsRaw = interview.jobs as
            | { position_title?: string; job_description?: string; skills_required?: unknown }
            | Array<{ position_title?: string; job_description?: string; skills_required?: unknown }>
            | null;
        const job = Array.isArray(jobsRaw) ? jobsRaw[0] : jobsRaw;

        const { data: latestAssessment } = await supabaseAdmin
            .from("assessment_attempts")
            .select("score")
            .eq("application_id", application.id)
            .not("submitted_at", "is", null)
            .order("submitted_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        const parsedResume = await extractResumeTextFromStorage(application.resume_file_path);

        return NextResponse.json({
            ok: true,
            sessionId: session.id,
            candidateName: application.candidate_name,
            candidateEmail: application.candidate_email,
            resumeFilePath: application.resume_file_path,
            resumeSummary: parsedResume.summary,
            resumeTextPreview: parsedResume.text.slice(0, 2500),
            resumeParser: parsedResume.parser,
            resumeParseError: parsedResume.error || null,
            interviewTitle: interview.title,
            positionTitle: String(job?.position_title || ""),
            jobDescription: String(job?.job_description || ""),
            skillsRequired: parseSkills(job?.skills_required),
            assessmentScore: latestAssessment?.score ?? null,
            durationMinutes: interview.interview_duration_minutes ?? 40,
            remainingSeconds: getRemainingSeconds(session.session_valid_until),
            firstQuestion: "Introduce yourself?",
        });
    } catch (error) {
        console.error("VAPI getInterviewContext error:", error);
        return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
    }
}
