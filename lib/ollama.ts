import { buildAssessmentQuestionsPrompt } from "@/lib/constants";
import { Ollama } from "ollama";

export type AssessmentOption = {
    label: "A" | "B" | "C" | "D";
    text: string;
    isCorrect: boolean;
};

export type GeneratedAssessmentQuestion = {
    questionText: string;
    options: AssessmentOption[];
};

function getOllamaConfig() {
    const retryAttempts = Number(process.env.OLLAMA_RETRY_ATTEMPTS || "3");
    const retryDelayMs = Number(process.env.OLLAMA_RETRY_DELAY_MS || "700");
    const fallbackValue = (process.env.OLLAMA_ENABLE_FALLBACK || "false").toLowerCase();
    const enableFallback = fallbackValue === "true" || fallbackValue === "1" || fallbackValue === "yes";

    return {
        baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
        model: process.env.OLLAMA_MODEL || "llama3.1:8b",
        apiKey: process.env.OLLAMA_API_KEY || "",
        retryAttempts: Number.isFinite(retryAttempts) && retryAttempts > 0 ? Math.floor(retryAttempts) : 3,
        retryDelayMs: Number.isFinite(retryDelayMs) && retryDelayMs > 0 ? Math.floor(retryDelayMs) : 700,
        enableFallback,
    };
}

function formatOllamaFailureMessage(error: unknown, config: ReturnType<typeof getOllamaConfig>) {
    const reason = error instanceof Error ? error.message : "Unknown Ollama error";
    return `Ollama is unavailable at ${config.baseUrl} using model ${config.model}. Reason: ${reason}. Configure OLLAMA_BASE_URL and OLLAMA_MODEL correctly, or set OLLAMA_ENABLE_FALLBACK=true to allow fallback question generation.`;
}

function createOllamaClient(config: ReturnType<typeof getOllamaConfig>) {
    const headers: Record<string, string> = {};
    if (config.apiKey) {
        headers.Authorization = `Bearer ${config.apiKey}`;
    }

    return new Ollama({
        host: config.baseUrl,
        headers,
    });
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractJsonPayload(raw: string) {
    const trimmed = raw.trim();

    if (!trimmed) {
        return "";
    }

    if (trimmed.startsWith("```")) {
        const withoutFences = trimmed
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, "")
            .trim();
        if (withoutFences) {
            return withoutFences;
        }
    }

    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        return trimmed.slice(firstBrace, lastBrace + 1);
    }

    return trimmed;
}

function hashToInt(input: string) {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        hash = (hash << 5) - hash + input.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

function rotateArray<T>(arr: T[], offset: number) {
    if (arr.length === 0) {
        return arr;
    }

    const normalized = ((offset % arr.length) + arr.length) % arr.length;
    return [...arr.slice(normalized), ...arr.slice(0, normalized)];
}

function buildFallbackAssessmentQuestions(input: {
    positionTitle: string;
    skillsRequired: string[];
    questionCount: number;
    variationKey?: string;
    existingQuestionTexts?: string[];
}) {
    const seed = hashToInt(`${input.positionTitle}|${input.skillsRequired.join(",")}|${input.variationKey || "default"}`);

    const labels: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"];
    const baseSkillsRaw = input.skillsRequired.length > 0
        ? input.skillsRequired
        : ["React", "Node.js", "TypeScript", "Testing", "API design"];
    const baseSkills = rotateArray(baseSkillsRaw, seed % Math.max(baseSkillsRaw.length, 1));

    const subtopicsRaw = [
        "performance optimization",
        "error handling",
        "state management",
        "API contract design",
        "security hardening",
        "testing strategy",
        "code review quality",
        "deployment reliability",
        "observability",
        "scalability",
    ];
    const subtopics = rotateArray(subtopicsRaw, (seed >> 2) % subtopicsRaw.length);

    const stemTemplatesRaw = [
        "A production issue appears in {skill} related to {subtopic}. What is the best first engineering action?",
        "You are reviewing a pull request for {skill} and notice risk around {subtopic}. Which decision is strongest?",
        "For a new feature in {skill}, the team must improve {subtopic}. Which approach should be chosen?",
        "During an interview simulation for {role}, a candidate proposes a solution in {skill}. Which option reflects senior-level judgment for {subtopic}?",
        "A team building {skill} is planning for {subtopic}. Which implementation plan is most robust?",
    ];
    const stemTemplates = rotateArray(stemTemplatesRaw, (seed >> 4) % stemTemplatesRaw.length);

    const correctOptionTemplatesRaw = [
        "Define measurable acceptance criteria, implement incremental changes, and validate with targeted automated tests before release.",
        "Identify root cause using logs/metrics, add a focused fix, and protect with regression tests and monitoring.",
        "Choose a maintainable design with clear interfaces, predictable behavior, and rollback-safe deployment steps.",
        "Prioritize correctness and reliability, then optimize with profiling data instead of assumptions.",
    ];
    const correctOptionTemplates = rotateArray(correctOptionTemplatesRaw, (seed >> 6) % correctOptionTemplatesRaw.length);

    const wrongOptionTemplatesRaw = [
        "Ship a quick patch directly to production and monitor user complaints to guide further fixes.",
        "Skip tests to reduce delivery time and rely on manual validation after deployment.",
        "Add a complex refactor touching multiple modules without defining constraints or rollback strategy.",
        "Focus only on code style improvements and defer behavior/risk validation to a later sprint.",
        "Implement multiple unrelated changes together so reviewers can evaluate everything at once.",
        "Depend on intuition for performance and avoid collecting metrics to keep implementation simple.",
    ];
    const wrongOptionTemplates = rotateArray(wrongOptionTemplatesRaw, (seed >> 8) % wrongOptionTemplatesRaw.length);

    const usedStems = new Set<string>((input.existingQuestionTexts ?? []).map((q) => q.trim().toLowerCase()));
    const questions: GeneratedAssessmentQuestion[] = [];

    for (let i = 0; i < input.questionCount; i++) {
        const skill = baseSkills[i % baseSkills.length];
        const subtopic = subtopics[i % subtopics.length];
        const stemTemplate = stemTemplates[i % stemTemplates.length];

        const questionText = stemTemplate
            .replace("{skill}", skill)
            .replace("{subtopic}", subtopic)
            .replace("{role}", input.positionTitle)
            .trim();

        if (usedStems.has(questionText)) {
            continue;
        }

        usedStems.add(questionText);

        const correctLabel = labels[(i + (seed % labels.length)) % labels.length];
        const wrongPool = [...wrongOptionTemplates]
            .sort((a, b) => (a + i).localeCompare(b + i))
            .slice(0, 3);

        const optionTextByLabel = new Map<"A" | "B" | "C" | "D", string>();
        let wrongIndex = 0;
        labels.forEach((label) => {
            if (label === correctLabel) {
                optionTextByLabel.set(label, correctOptionTemplates[i % correctOptionTemplates.length]);
                return;
            }

            optionTextByLabel.set(label, wrongPool[wrongIndex]);
            wrongIndex += 1;
        });

        const options: AssessmentOption[] = labels.map((label) => ({
            label,
            text: optionTextByLabel.get(label) || "",
            isCorrect: label === correctLabel,
        }));

        questions.push({ questionText, options });

        if (questions.length >= input.questionCount) {
            return questions.slice(0, input.questionCount);
        }
    }

    if (questions.length >= input.questionCount) {
        return questions.slice(0, input.questionCount);
    }

    // Fill any shortfall with deterministic unique variants.
    const shortfall = input.questionCount - questions.length;
    for (let j = 0; j < shortfall; j++) {
        const idx = questions.length + j + 1;
        const fallbackStem = `In ${input.positionTitle}, when balancing delivery speed and quality for backend/frontend integration, which option is the best engineering decision #${idx}?`;
        if (usedStems.has(fallbackStem.toLowerCase())) {
            continue;
        }

        usedStems.add(fallbackStem.toLowerCase());
        questions.push({
            questionText: fallbackStem,
            options: [
                {
                    label: "A",
                    text: "Define testable milestones, add CI checks, and release incrementally with rollback readiness.",
                    isCorrect: true,
                },
                {
                    label: "B",
                    text: "Merge all pending changes together to reduce review overhead and deploy once.",
                    isCorrect: false,
                },
                {
                    label: "C",
                    text: "Rely on manual QA only and postpone instrumentation until after launch.",
                    isCorrect: false,
                },
                {
                    label: "D",
                    text: "Skip interface contracts and resolve integration mismatches directly in production.",
                    isCorrect: false,
                },
            ],
        });
    }

    return questions.slice(0, input.questionCount);
}

async function requestOllamaGenerate(
    payload: {
        model: string;
        prompt: string;
        options: { temperature: number };
    },
    config: ReturnType<typeof getOllamaConfig>,
) {
    const client = createOllamaClient(config);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= config.retryAttempts; attempt++) {
        try {
            const response = await client.chat({
                model: payload.model,
                stream: false,
                format: "json",
                options: payload.options,
                messages: [
                    {
                        role: "system",
                        content: "You are an expert interview question generator. Return only valid JSON.",
                    },
                    {
                        role: "user",
                        content: payload.prompt,
                    },
                ],
            });

            const rawJson = extractJsonPayload(String(response?.message?.content || ""));

            if (!rawJson) {
                throw new Error("Ollama returned an empty response");
            }

            let parsed: unknown;
            try {
                parsed = JSON.parse(rawJson);
            } catch {
                throw new Error("Ollama returned non-JSON output");
            }

            return parsed;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error("Unknown Ollama request error");

            if (attempt < config.retryAttempts) {
                await sleep(config.retryDelayMs * attempt);
            }
        }
    }

    throw lastError ?? new Error("Ollama request failed");
}

function normalizeQuestions(raw: unknown, fallbackCount: number) {
    const questions = Array.isArray((raw as { questions?: unknown[] })?.questions)
        ? ((raw as { questions: unknown[] }).questions ?? [])
        : [];

    const normalized: GeneratedAssessmentQuestion[] = [];

    const seenQuestions = new Set<string>();

    for (const item of questions) {
        const questionText = String((item as { questionText?: string })?.questionText || "").trim();
        const optionsRaw = (item as { options?: unknown[] })?.options;

        if (!questionText || !Array.isArray(optionsRaw) || optionsRaw.length !== 4) {
            continue;
        }

        if (questionText.length < 25 || !questionText.endsWith("?")) {
            continue;
        }

        const questionKey = questionText.toLowerCase();
        if (seenQuestions.has(questionKey)) {
            continue;
        }

        const labels: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"];
        const options: AssessmentOption[] = optionsRaw.map((option, idx) => {
            const labelRaw = String((option as { label?: string })?.label || labels[idx]).toUpperCase();
            const label = labels.includes(labelRaw as "A" | "B" | "C" | "D")
                ? (labelRaw as "A" | "B" | "C" | "D")
                : labels[idx];

            return {
                label,
                text: String((option as { text?: string })?.text || "").trim(),
                isCorrect: Boolean((option as { isCorrect?: boolean })?.isCorrect),
            };
        });

        const correctCount = options.filter((opt) => opt.isCorrect).length;
        const hasAllOptionText = options.every((opt) => opt.text.length > 0);
        const distinctOptions = new Set(options.map((opt) => opt.text.toLowerCase())).size === 4;

        if (correctCount !== 1 || !hasAllOptionText || !distinctOptions) {
            continue;
        }

        seenQuestions.add(questionKey);
        normalized.push({ questionText, options });
        if (normalized.length >= fallbackCount) {
            break;
        }
    }

    return normalized;
}

export async function generateAssessmentQuestionsFromOllama(input: {
    interviewTitle: string;
    positionTitle: string;
    jobDescription: string;
    skillsRequired: string[];
    questionCount: number;
    variationKey?: string;
}) {
    const config = getOllamaConfig();
    const prompt = buildAssessmentQuestionsPrompt(input);

    try {
        const parsed = await requestOllamaGenerate(
            {
                model: config.model,
                prompt,
                options: {
                    temperature: 0.2,
                },
            },
            config,
        );

        const normalized = normalizeQuestions(parsed, input.questionCount);

        if (normalized.length === 0) {
            throw new Error("Ollama returned no valid questions");
        }

        if (normalized.length < input.questionCount) {
            if (!config.enableFallback) {
                throw new Error(
                    `Ollama returned only ${normalized.length}/${input.questionCount} valid questions while fallback is disabled.`,
                );
            }

            const fallback = buildFallbackAssessmentQuestions({
                positionTitle: input.positionTitle,
                skillsRequired: input.skillsRequired,
                questionCount: input.questionCount - normalized.length,
                variationKey: input.variationKey,
                existingQuestionTexts: normalized.map((q) => q.questionText),
            });
            return [...normalized, ...fallback];
        }

        return normalized;
    } catch (error) {
        if (!config.enableFallback) {
            throw new Error(formatOllamaFailureMessage(error, config));
        }

        console.warn("[OLLAMA_FALLBACK] Using fallback assessment question generator.", error);
        return buildFallbackAssessmentQuestions({
            positionTitle: input.positionTitle,
            skillsRequired: input.skillsRequired,
            questionCount: input.questionCount,
            variationKey: input.variationKey,
        });
    }
}
