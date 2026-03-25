import { Ollama } from "ollama";
import { supabaseAdmin } from "@/lib/supabase-admin";

type HireRecommendation = "STRONG_YES" | "YES" | "MAYBE" | "NO" | "STRONG_NO";

type AssessmentAttemptRow = {
    id: number;
    score: number | null;
    total_questions: number | null;
    correct_answers: number | null;
    submitted_at: string | null;
};

type AssessmentResponseRow = {
    selected_option_label: string | null;
    is_correct: boolean | null;
};

type InterviewSessionRow = {
    id: number;
    ended_at: string | null;
    total_questions_asked: number | null;
    duration_seconds: number | null;
    score: number | null;
};

type InterviewResponseRow = {
    question_text: string;
    candidate_answer: string;
};

type RecordingRow = {
    recording_type: string;
    duration_seconds: number | null;
    mime_type: string | null;
};

type ProctoringFlagRow = {
    flag_type: string;
    severity: "INFO" | "WARNING";
    description: string | null;
};

type CandidateCoreRow = {
    id: number;
    interview_id: number;
    candidate_name: string;
    candidate_email: string;
};

type InterviewMetaRow = {
    title: string;
    jobs: {
        position_title?: string;
        skills_required?: string[];
    } | null;
};

function getOllamaConfig() {
    return {
        baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
        model: process.env.OLLAMA_MODEL || "llama3.1:8b",
        apiKey: process.env.OLLAMA_API_KEY || "",
        enableFallback: (process.env.OLLAMA_ENABLE_FALLBACK || "true").toLowerCase() !== "false",
    };
}

function createOllamaClient(baseUrl: string, apiKey: string) {
    const headers: Record<string, string> = {};
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }
    return new Ollama({ host: baseUrl, headers });
}

function toFiniteNumber(value: number | null | undefined, fallback = 0) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return value;
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function wordsCount(input: string) {
    return input
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
}

function mapScoreToRecommendation(score: number): HireRecommendation {
    if (score >= 85) return "STRONG_YES";
    if (score >= 72) return "YES";
    if (score >= 55) return "MAYBE";
    if (score >= 40) return "NO";
    return "STRONG_NO";
}

function buildFallbackReport(input: {
    candidateName: string;
    positionTitle: string;
    interviewTitle: string;
    assessmentScore: number;
    assessmentAnswered: number;
    assessmentCorrect: number;
    interviewQuestions: number;
    avgAnswerWords: number;
    interviewDurationSeconds: number;
    warningFlags: number;
    infoFlags: number;
    hasInterviewVideo: boolean;
    totalRecordingSeconds: number;
}) {
    const scoreFromInterviewDepth = clamp(input.avgAnswerWords * 1.2, 0, 25);
    const scoreFromCoverage = clamp((input.interviewQuestions / 8) * 20, 0, 20);
    const scoreFromAssessment = clamp(input.assessmentScore * 0.55, 0, 55);
    const riskPenalty = clamp(input.warningFlags * 4 + input.infoFlags * 1.2, 0, 20);

    const finalScore = clamp(Math.round(scoreFromAssessment + scoreFromInterviewDepth + scoreFromCoverage - riskPenalty), 0, 100);
    const recommendation = mapScoreToRecommendation(finalScore);

    const strengths: string[] = [];
    const weaknesses: string[] = [];

    if (input.assessmentScore >= 70) {
        strengths.push("Strong assessment performance with solid objective correctness.");
    } else {
        weaknesses.push("Assessment score suggests technical fundamentals need strengthening.");
    }

    if (input.avgAnswerWords >= 25) {
        strengths.push("Interview responses show good elaboration and communication depth.");
    } else {
        weaknesses.push("Interview responses were concise; more structured detail is recommended.");
    }

    if (input.warningFlags <= 1) {
        strengths.push("Low proctoring risk profile during interview session.");
    } else {
        weaknesses.push(`Observed ${input.warningFlags} warning-level proctoring flags that require reviewer attention.`);
    }

    if (input.hasInterviewVideo) {
        strengths.push("Interview recording is available for manual panel validation.");
    } else {
        weaknesses.push("Interview recording metadata is missing; video-based validation is limited.");
    }

    const transcriptSummary = `${input.candidateName} completed assessment and interview for ${input.positionTitle}. Assessment score ${input.assessmentScore.toFixed(1)}%. Interview had ${input.interviewQuestions} questions with average ${Math.round(input.avgAnswerWords)} words per answer.`;

    const detailedAnalysis = [
        `Role: ${input.positionTitle} (${input.interviewTitle})`,
        `Assessment: ${input.assessmentCorrect}/${input.assessmentAnswered} correct, score ${input.assessmentScore.toFixed(1)}%`,
        `Interview: ${input.interviewQuestions} responses, average answer depth ${Math.round(input.avgAnswerWords)} words, duration ${input.interviewDurationSeconds}s`,
        `Video/Audio evidence: ${input.hasInterviewVideo ? "Available" : "Not available"}; total recording duration ${input.totalRecordingSeconds}s`,
        `Proctoring flags: ${input.warningFlags} warning, ${input.infoFlags} info`,
        `Overall recommendation: ${recommendation}`,
    ].join("\n");

    return {
        score: finalScore,
        recommendation,
        strengths,
        weaknesses,
        transcriptSummary,
        detailedAnalysis,
        generatedBy: "AI_FALLBACK",
    };
}

async function buildOllamaReport(input: {
    candidateName: string;
    candidateEmail: string;
    positionTitle: string;
    interviewTitle: string;
    skillsRequired: string[];
    assessmentScore: number;
    assessmentCorrect: number;
    assessmentAnswered: number;
    interviewResponses: Array<{ question: string; answer: string }>;
    interviewDurationSeconds: number;
    warningFlags: number;
    infoFlags: number;
    hasInterviewVideo: boolean;
    recordingSeconds: number;
}) {
    const config = getOllamaConfig();
    const client = createOllamaClient(config.baseUrl, config.apiKey);

    const responsePreview = input.interviewResponses
        .slice(0, 8)
        .map((item, idx) => `Q${idx + 1}: ${item.question}\nA${idx + 1}: ${item.answer}`)
        .join("\n\n");

    const prompt = [
        "Generate a concise hiring report in JSON only.",
        "Return exactly this JSON shape:",
        '{"score":0,"hireRecommendation":"MAYBE","strengths":["..."],"weaknesses":["..."],"transcriptSummary":"...","detailedAnalysis":"..."}',
        "hireRecommendation must be one of STRONG_YES, YES, MAYBE, NO, STRONG_NO.",
        "Use assessment + interview + proctoring/video signals.",
        "",
        `Candidate: ${input.candidateName} (${input.candidateEmail})`,
        `Role: ${input.positionTitle}`,
        `Interview Title: ${input.interviewTitle}`,
        `Skills: ${input.skillsRequired.join(", ") || "N/A"}`,
        `Assessment Score: ${input.assessmentScore.toFixed(1)}% (${input.assessmentCorrect}/${input.assessmentAnswered})`,
        `Interview Duration Seconds: ${input.interviewDurationSeconds}`,
        `Proctoring Flags: warning=${input.warningFlags}, info=${input.infoFlags}`,
        `Recording Available: ${input.hasInterviewVideo ? "yes" : "no"}, recording seconds=${input.recordingSeconds}`,
        "",
        "Interview transcript excerpts:",
        responsePreview || "No interview responses available",
    ].join("\n");

    const chat = await client.chat({
        model: config.model,
        stream: false,
        format: "json",
        options: { temperature: 0.25 },
        messages: [
            { role: "system", content: "You are a senior technical hiring panel. Return valid JSON only." },
            { role: "user", content: prompt },
        ],
    });

    const content = String(chat?.message?.content || "").trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        throw new Error("No JSON found in Ollama response");
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const score = clamp(Math.round(Number(parsed?.score ?? 0)), 0, 100);

    const recommendationRaw = String(parsed?.hireRecommendation || "MAYBE").toUpperCase();
    const recommendation = (["STRONG_YES", "YES", "MAYBE", "NO", "STRONG_NO"] as const).includes(recommendationRaw as HireRecommendation)
        ? (recommendationRaw as HireRecommendation)
        : "MAYBE";

    const strengths = Array.isArray(parsed?.strengths)
        ? parsed.strengths.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 6)
        : [];
    const weaknesses = Array.isArray(parsed?.weaknesses)
        ? parsed.weaknesses.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 6)
        : [];

    return {
        score,
        recommendation,
        strengths: strengths.length > 0 ? strengths : ["Communication quality observed in interview responses."],
        weaknesses: weaknesses.length > 0 ? weaknesses : ["Monitor performance through practical rounds."],
        transcriptSummary: String(parsed?.transcriptSummary || "Assessment and interview data reviewed.").trim(),
        detailedAnalysis: String(parsed?.detailedAnalysis || "AI analysis generated from objective and subjective candidate signals.").trim(),
        generatedBy: "AI_OLLAMA",
    };
}

export async function generateAndStoreInterviewAiReport(applicationId: number) {
    const { data: application, error: applicationError } = await supabaseAdmin
        .from("applications")
        .select("id, interview_id, candidate_name, candidate_email")
        .eq("id", applicationId)
        .maybeSingle();

    if (applicationError || !application) {
        throw new Error("Application not found for report generation");
    }

    const app = application as CandidateCoreRow;

    const { data: interviewMeta } = await supabaseAdmin
        .from("interviews")
        .select("title, jobs(position_title, skills_required)")
        .eq("id", app.interview_id)
        .maybeSingle();

    const meta = (interviewMeta ?? { title: "Interview", jobs: null }) as InterviewMetaRow;
    const positionTitle = meta.jobs?.position_title || "Candidate";
    const skillsRequired = Array.isArray(meta.jobs?.skills_required) ? meta.jobs?.skills_required : [];

    const { data: assessmentAttempt } = await supabaseAdmin
        .from("assessment_attempts")
        .select("id, score, total_questions, correct_answers, submitted_at")
        .eq("application_id", applicationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    const { data: interviewSession } = await supabaseAdmin
        .from("interview_sessions")
        .select("id, ended_at, total_questions_asked, duration_seconds, score")
        .eq("application_id", applicationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    const attempt = assessmentAttempt as AssessmentAttemptRow | null;
    const session = interviewSession as InterviewSessionRow | null;

    if (!attempt?.submitted_at || !session?.ended_at) {
        throw new Error("Assessment and interview must be completed before report generation");
    }

    const [assessmentResponsesRes, interviewResponsesRes, recordingRes, proctoringRes] = await Promise.all([
        supabaseAdmin
            .from("assessment_responses")
            .select("selected_option_label, is_correct")
            .eq("assessment_attempt_id", attempt.id),
        supabaseAdmin
            .from("interview_responses")
            .select("question_text, candidate_answer")
            .eq("interview_session_id", session.id)
            .order("asked_at", { ascending: true }),
        supabaseAdmin
            .from("recordings")
            .select("recording_type, duration_seconds, mime_type")
            .eq("interview_session_id", session.id),
        supabaseAdmin
            .from("proctoring_flags")
            .select("flag_type, severity, description")
            .eq("interview_session_id", session.id),
    ]);

    if (assessmentResponsesRes.error || interviewResponsesRes.error || recordingRes.error || proctoringRes.error) {
        throw new Error("Failed to collect report signals");
    }

    const assessmentResponses = (assessmentResponsesRes.data ?? []) as AssessmentResponseRow[];
    const interviewResponses = (interviewResponsesRes.data ?? []) as InterviewResponseRow[];
    const recordings = (recordingRes.data ?? []) as RecordingRow[];
    const flags = (proctoringRes.data ?? []) as ProctoringFlagRow[];

    const answeredCount = assessmentResponses.filter((row) => Boolean(row.selected_option_label)).length;
    const correctCount = assessmentResponses.filter((row) => row.is_correct === true).length;
    const assessmentScore = (() => {
        if (typeof attempt.score === "number" && Number.isFinite(attempt.score)) {
            return clamp(attempt.score, 0, 100);
        }
        if (answeredCount > 0) {
            return clamp((correctCount / answeredCount) * 100, 0, 100);
        }
        return 0;
    })();

    const totalInterviewQuestions = toFiniteNumber(session.total_questions_asked, interviewResponses.length);
    const avgAnswerWords = interviewResponses.length > 0
        ? interviewResponses.reduce((acc, row) => acc + wordsCount(String(row.candidate_answer || "")), 0) / interviewResponses.length
        : 0;

    const warningFlags = flags.filter((f) => String(f.severity).toUpperCase() === "WARNING").length;
    const infoFlags = flags.length - warningFlags;

    const totalRecordingSeconds = recordings.reduce((acc, row) => acc + toFiniteNumber(row.duration_seconds, 0), 0);
    const hasInterviewVideo = recordings.some((row) => {
        const kind = String(row.recording_type || "").toUpperCase();
        const mime = String(row.mime_type || "").toLowerCase();
        return kind === "INTERVIEW" || mime.startsWith("video/");
    });

    let report = null as null | {
        score: number;
        recommendation: HireRecommendation;
        strengths: string[];
        weaknesses: string[];
        transcriptSummary: string;
        detailedAnalysis: string;
        generatedBy: string;
    };

    const config = getOllamaConfig();
    if (config.enableFallback) {
        try {
            report = await buildOllamaReport({
                candidateName: app.candidate_name,
                candidateEmail: app.candidate_email,
                positionTitle,
                interviewTitle: meta.title,
                skillsRequired,
                assessmentScore,
                assessmentCorrect: correctCount,
                assessmentAnswered: answeredCount,
                interviewResponses: interviewResponses.map((row) => ({
                    question: row.question_text,
                    answer: row.candidate_answer,
                })),
                interviewDurationSeconds: toFiniteNumber(session.duration_seconds, 0),
                warningFlags,
                infoFlags,
                hasInterviewVideo,
                recordingSeconds: totalRecordingSeconds,
            });
        } catch {
            report = null;
        }
    }

    if (!report) {
        report = buildFallbackReport({
            candidateName: app.candidate_name,
            positionTitle,
            interviewTitle: meta.title,
            assessmentScore,
            assessmentAnswered: answeredCount,
            assessmentCorrect: correctCount,
            interviewQuestions: totalInterviewQuestions,
            avgAnswerWords,
            interviewDurationSeconds: toFiniteNumber(session.duration_seconds, 0),
            warningFlags,
            infoFlags,
            hasInterviewVideo,
            totalRecordingSeconds,
        });
    }

    await supabaseAdmin
        .from("ai_reports")
        .delete()
        .eq("application_id", applicationId)
        .eq("report_type", "INTERVIEW");

    const nowIso = new Date().toISOString();
    const { data: inserted, error: insertError } = await supabaseAdmin
        .from("ai_reports")
        .insert({
            application_id: applicationId,
            interview_session_id: session.id,
            report_type: "INTERVIEW",
            transcript_summary: report.transcriptSummary,
            score: report.score,
            strengths: report.strengths,
            weaknesses: report.weaknesses,
            hire_recommendation: report.recommendation,
            detailed_analysis: report.detailedAnalysis,
            generated_at: nowIso,
            generated_by: report.generatedBy,
        })
        .select("id, application_id, interview_session_id, report_type, transcript_summary, score, strengths, weaknesses, hire_recommendation, detailed_analysis, generated_at, generated_by")
        .maybeSingle();

    if (insertError || !inserted) {
        throw new Error("Failed to persist AI report");
    }

    return {
        report: inserted,
        summary: {
            assessmentScore,
            answeredCount,
            correctCount,
            interviewQuestions: totalInterviewQuestions,
            avgAnswerWords: Math.round(avgAnswerWords),
            warningFlags,
            infoFlags,
            hasInterviewVideo,
            totalRecordingSeconds,
        },
    };
}
