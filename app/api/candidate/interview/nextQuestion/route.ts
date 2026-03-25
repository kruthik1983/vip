import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { extractResumeTextFromStorage } from "@/lib/resume-parser";
import { Ollama } from "ollama";
import { validateAssignedInterviewSlotWindow } from "@/lib/candidate-interview-access";

type NextQuestionRequest = {
    token: string;
    lastAnswer?: string;
};

type NextQuestionResponse = {
    success: boolean;
    error?: string;
    data?: {
        shouldEnd: boolean;
        nextQuestion?: string;
        remainingSeconds: number;
        totalQuestionsAsked: number;
    };
};

function getOllamaConfig() {
    return {
        baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
        model: process.env.OLLAMA_MODEL || "llama3.1:8b",
        apiKey: process.env.OLLAMA_API_KEY || "",
        enableFallback: (process.env.OLLAMA_ENABLE_FALLBACK || "false").toLowerCase() === "true",
    };
}

function createOllamaClient(baseUrl: string, apiKey: string) {
    const headers: Record<string, string> = {};
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }
    return new Ollama({ host: baseUrl, headers });
}

function buildInterviewQuestionPrompt(input: {
    interviewTitle: string;
    positionTitle: string;
    jobDescription: string;
    skillsRequired: string[];
    resumeSummary: string;
    pastResponses: Array<{ question: string; answer: string }>;
    questionNumber: number;
    totalQuestions: number;
}) {
    const pastContextLines = input.pastResponses
        .slice(-3)
        .map((r, idx) => `Q${input.questionNumber - input.pastResponses.length + idx}: ${r.question}\nA: ${r.answer}`)
        .join("\n\n");

    const skillsText = input.skillsRequired.length > 0 ? input.skillsRequired.join(", ") : "General role skills";

    const prompt = [
        "You are an expert technical interviewer. Generate ONE next interview question for the candidate.",
        "Return valid JSON only: {\"questionText\": \"...\"}",
        "",
        `Interview: ${input.interviewTitle}`,
        `Position: ${input.positionTitle}`,
        `Job Description: ${input.jobDescription}`,
        `Required Skills: ${skillsText}`,
        "",
        `Candidate Resume Summary: ${input.resumeSummary}`,
        "",
        `Progress: Question ${input.questionNumber} of ${input.totalQuestions}`,
        "",
        input.pastResponses.length > 0
            ? `Recent conversation:\n${pastContextLines}\n\nBased on responses above, ask a follow-up or progression question.`
            : "This is the first question. Start with a broad technical question.",
        "",
        "Requirements:",
        "- Question must be open-ended, role-specific, and practical",
        "- Question should progress naturally from previous answers if available",
        "- Question must end with a question mark",
        "- Question must be 10-30 words",
        "- Avoid repetition of previous questions",
        "- Test competencies relevant to " + input.positionTitle,
    ].join("\n");

    return prompt;
}

async function generateNextQuestion(input: {
    interviewTitle: string;
    positionTitle: string;
    jobDescription: string;
    skillsRequired: string[];
    resumeSummary: string;
    pastResponses: Array<{ question: string; answer: string }>;
    questionNumber: number;
    totalQuestions: number;
}): Promise<string> {
    const config = getOllamaConfig();
    const client = createOllamaClient(config.baseUrl, config.apiKey);
    const prompt = buildInterviewQuestionPrompt(input);

    try {
        const response = await client.chat({
            model: config.model,
            stream: false,
            format: "json",
            options: { temperature: 0.5 },
            messages: [
                {
                    role: "system",
                    content: "You are an expert technical interviewer. Return only valid JSON with no markdown.",
                },
                {
                    role: "user",
                    content: prompt,
                },
            ],
        });

        const content = String(response?.message?.content || "");
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("No JSON found in response");
        }

        const parsed = JSON.parse(jsonMatch[0]);
        const questionText = String(parsed?.questionText || "").trim();

        if (!questionText || questionText.length < 10) {
            throw new Error("Invalid question generated");
        }

        return questionText;
    } catch (error) {
        if (!config.enableFallback) {
            throw error;
        }

        // Fallback: generate question using pattern
        console.warn("[FALLBACK] Using fallback question generation", error);
        const skillSample = input.skillsRequired[0] || "technical knowledge";
        const templates = [
            `Can you walk us through your experience with ${skillSample} in production environments?`,
            `How would you approach debugging a critical issue in ${skillSample}?`,
            `What best practices do you follow when designing ${skillSample} solutions?`,
            `Tell us about a time you had to optimize ${skillSample} performance.`,
            `How do you stay current with new developments in ${skillSample}?`,
        ];
        return templates[input.questionNumber % templates.length];
    }
}

function isSessionActive(validFrom: string | null, validUntil: string | null) {
    const now = Date.now();
    const fromTs = validFrom ? new Date(validFrom).getTime() : Number.NEGATIVE_INFINITY;
    const untilTs = validUntil ? new Date(validUntil).getTime() : Number.POSITIVE_INFINITY;
    return now >= fromTs && now <= untilTs;
}

export async function POST(request: NextRequest): Promise<NextResponse<NextQuestionResponse>> {
    try {
        const body: NextQuestionRequest = await request.json();
        const token = String(body?.token || "").trim();

        if (!token) {
            return NextResponse.json(
                { success: false, error: "Missing token" },
                { status: 400 }
            );
        }

        // Load interview session
        const { data: session, error: sessionError } = await supabaseAdmin
            .from("interview_sessions")
            .select(
                "id, application_id, started_at, ended_at, session_valid_from, session_valid_until, total_questions_asked"
            )
            .eq("session_token", token)
            .maybeSingle();

        if (sessionError || !session) {
            return NextResponse.json(
                { success: false, error: "Invalid interview token" },
                { status: 404 }
            );
        }

        if (!isSessionActive(session.session_valid_from, session.session_valid_until)) {
            return NextResponse.json(
                { success: false, error: "This interview link is not active right now" },
                { status: 400 }
            );
        }

        if (session.ended_at) {
            return NextResponse.json(
                { success: false, error: "Interview already completed" },
                { status: 400 }
            );
        }

        // Load application and job info
        const { data: application, error: applicationError } = await supabaseAdmin
            .from("applications")
            .select("id, interview_id, candidate_name, resume_file_path")
            .eq("id", session.application_id)
            .maybeSingle();

        if (applicationError || !application) {
            return NextResponse.json(
                { success: false, error: "Application not found" },
                { status: 404 }
            );
        }

        const slotAccess = await validateAssignedInterviewSlotWindow(application.id);
        if (!slotAccess.allowed) {
            return NextResponse.json(
                { success: false, error: slotAccess.error || "Interview access denied" },
                { status: 400 }
            );
        }

        // Load interview and job details
        const { data: interview, error: interviewError } = await supabaseAdmin
            .from("interviews")
            .select("id, title, interview_duration_minutes, job_id, jobs(position_title, job_description, skills_required)")
            .eq("id", application.interview_id)
            .maybeSingle();

        if (interviewError || !interview) {
            return NextResponse.json(
                { success: false, error: "Interview not found" },
                { status: 404 }
            );
        }

        const job = interview.jobs as {
            position_title?: string;
            job_description?: string;
            skills_required?: string[];
        } | null;

        if (!job) {
            return NextResponse.json(
                { success: false, error: "Job details not found" },
                { status: 404 }
            );
        }

        // Load past responses for context
        const { data: pastResponses, error: pastError } = await supabaseAdmin
            .from("interview_responses")
            .select("question_text, candidate_answer")
            .eq("interview_session_id", session.id)
            .order("asked_at", { ascending: true });

        if (pastError) {
            return NextResponse.json(
                { success: false, error: "Failed to load interview history" },
                { status: 500 }
            );
        }

        // Extract resume content
        const { summary: resumeSummary } = await extractResumeTextFromStorage(application.resume_file_path);

        // Calculate progress
        const currentQuestionNumber = (pastResponses?.length ?? 0) + 1;
        const totalQuestions = interview.interview_duration_minutes || 40;
        const shouldEnd = currentQuestionNumber >= totalQuestions;

        if (shouldEnd) {
            // Calculate remaining time
            const startedAtTs = session.started_at ? new Date(session.started_at).getTime() : Date.now();
            const allowedDurationMs = (interview.interview_duration_minutes || 40) * 60 * 1000;
            const elapsedMs = Date.now() - startedAtTs;
            const remainingMs = Math.max(0, allowedDurationMs - elapsedMs);
            const remainingSeconds = Math.floor(remainingMs / 1000);

            return NextResponse.json({
                success: true,
                data: {
                    shouldEnd: true,
                    remainingSeconds,
                    totalQuestionsAsked: currentQuestionNumber - 1,
                },
            });
        }

        // Generate next question
        // First question is always "Introduce yourself"
        let nextQuestion: string;

        if (currentQuestionNumber === 1) {
            nextQuestion = "Please introduce yourself and share your professional background.";
        } else {
            nextQuestion = await generateNextQuestion({
                interviewTitle: interview.title,
                positionTitle: job.position_title || "Candidate",
                jobDescription: job.job_description || "",
                skillsRequired: Array.isArray(job.skills_required) ? job.skills_required : [],
                resumeSummary,
                pastResponses: (pastResponses ?? []).map((r) => ({
                    question: r.question_text || "Interview question",
                    answer: r.candidate_answer || "",
                })),
                questionNumber: currentQuestionNumber,
                totalQuestions,
            });
        }

        // Persist generated question to interview_responses (marked with placeholder answer until submitted)
        const nowIso = new Date().toISOString();
        const { error: insertError } = await supabaseAdmin
            .from("interview_responses")
            .insert({
                interview_session_id: session.id,
                question_text: nextQuestion,
                // Keep placeholders non-empty/non-null to stay compatible with stricter DB constraints.
                candidate_answer: "[PENDING_ANSWER_RECORDING]",
                asked_at: nowIso,
                answered_at: nowIso,
                is_fallback_question: false,
                fallback_question_id: null,
            });

        if (insertError) {
            return NextResponse.json(
                { success: false, error: "Failed to persist question" },
                { status: 500 }
            );
        }

        // Calculate remaining time
        const startedAtTs = session.started_at ? new Date(session.started_at).getTime() : Date.now();
        const allowedDurationMs = (interview.interview_duration_minutes || 40) * 60 * 1000;
        const elapsedMs = Date.now() - startedAtTs;
        const remainingMs = Math.max(0, allowedDurationMs - elapsedMs);
        const remainingSeconds = Math.floor(remainingMs / 1000);

        return NextResponse.json({
            success: true,
            data: {
                shouldEnd: false,
                nextQuestion,
                remainingSeconds,
                totalQuestionsAsked: currentQuestionNumber - 1,
            },
        });
    } catch (error) {
        console.error("Next question generation error:", error);
        return NextResponse.json(
            { success: false, error: "Failed to generate next question" },
            { status: 500 }
        );
    }
}
