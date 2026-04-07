import { NextRequest } from "next/server";
import { POST } from "@/app/api/candidate/interview/nextQuestion/route";
import { supabaseAdmin } from "@/lib/supabase-admin";

jest.mock("@/lib/supabase-admin", () => ({
    supabaseAdmin: {
        from: jest.fn(),
    },
}));

jest.mock("@/lib/resume-parser", () => ({
    extractResumeTextFromStorage: jest.fn().mockResolvedValue({ summary: "" }),
}));

jest.mock("ollama", () => ({
    Ollama: jest.fn().mockImplementation(() => ({
        chat: jest.fn(),
    })),
}));

jest.mock("@/lib/candidate-interview-access", () => ({
    validateAssignedInterviewSlotWindow: jest.fn().mockResolvedValue({ allowed: true }),
}));

function mockSessionLookup(result: { data: unknown; error: unknown }) {
    const maybeSingle = jest.fn().mockResolvedValue(result);
    const eq = jest.fn(() => ({ maybeSingle }));
    const select = jest.fn(() => ({ eq }));
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === "interview_sessions") {
            return { select };
        }
        throw new Error(`Unexpected table in test: ${table}`);
    });
}

describe("nextQuestion route edge cases", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns 400 when token is missing", async () => {
        const request = new NextRequest("http://localhost/api/candidate/interview/nextQuestion", {
            method: "POST",
            body: JSON.stringify({}),
            headers: { "content-type": "application/json" },
        });

        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body).toEqual({ success: false, error: "Missing token" });
    });

    it("returns 404 when token is invalid", async () => {
        mockSessionLookup({ data: null, error: { message: "bad token" } });

        const request = new NextRequest("http://localhost/api/candidate/interview/nextQuestion", {
            method: "POST",
            body: JSON.stringify({ token: "bad" }),
            headers: { "content-type": "application/json" },
        });

        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body.success).toBe(false);
        expect(body.error).toBe("Invalid interview token");
    });

    it("returns 400 when interview has already ended", async () => {
        mockSessionLookup({
            data: {
                id: 22,
                application_id: 7,
                started_at: "2026-04-03T09:00:00.000Z",
                ended_at: "2026-04-03T09:40:00.000Z",
                session_valid_from: "2026-04-03T08:00:00.000Z",
                session_valid_until: "2026-04-03T10:00:00.000Z",
                total_questions_asked: 5,
            },
            error: null,
        });

        const nowSpy = jest.spyOn(Date, "now").mockReturnValue(new Date("2026-04-03T09:30:00.000Z").getTime());

        const request = new NextRequest("http://localhost/api/candidate/interview/nextQuestion", {
            method: "POST",
            body: JSON.stringify({ token: "ok" }),
            headers: { "content-type": "application/json" },
        });

        const response = await POST(request);
        const body = await response.json();
        nowSpy.mockRestore();

        expect(response.status).toBe(400);
        expect(body.success).toBe(false);
        expect(body.error).toBe("Interview already completed");
    });
});
