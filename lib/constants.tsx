export type AssessmentPromptInput = {
    interviewTitle: string;
    positionTitle: string;
    jobDescription: string;
    skillsRequired: string[];
    questionCount: number;
};

export const OLLAMA_PROMPT_TEMPLATES = {
    assessmentQuestionGenerationRules: [
        "Generate high-quality multiple-choice assessment questions for a hiring workflow.",
        "Return valid JSON only with no markdown and no extra text.",
        "Schema: { \"questions\": [{ \"questionText\": string, \"options\": [{\"label\":\"A\"|\"B\"|\"C\"|\"D\",\"text\": string,\"isCorrect\": boolean}] }] }.",
        "Each question must have exactly 4 options labeled A, B, C, D.",
        "Exactly one option must have isCorrect=true per question.",
        "Question stems must be complete interview-ready questions and must end with a question mark.",
        "Every question must be unique and must test a different competency.",
        "Avoid repeating the same stem with only skill names swapped.",
        "At least 60% of questions should be scenario-based decision questions.",
        "Do not use placeholders, incomplete fragments, or generic template text.",
        "Options must be plausible and distinct; avoid obviously wrong distractors.",
        "Keep questions practical, role-specific, and test real decision-making.",
        "Avoid ambiguous wording, avoid trick questions, and avoid repeated questions.",
    ],
};

export function buildAssessmentQuestionsPrompt(input: AssessmentPromptInput) {
    const skillsText = input.skillsRequired.length > 0 ? input.skillsRequired.join(", ") : "General role skills";

    return [
        ...OLLAMA_PROMPT_TEMPLATES.assessmentQuestionGenerationRules,
        "",
        `Interview title: ${input.interviewTitle}`,
        `Position title: ${input.positionTitle}`,
        `Job description: ${input.jobDescription}`,
        `Skills required: ${skillsText}`,
        `Generate ${input.questionCount} questions.`,
    ].join("\n");
}
