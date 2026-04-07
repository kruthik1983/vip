import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/candidate/interview/route";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { validateAssignedInterviewSlotWindow } from "@/lib/candidate-interview-access";

jest.mock("@/lib/supabase-admin", () => ({
    supabaseAdmin: {
        from: jest.fn(),
    },
}));

jest.mock("@/lib/interview-ai-report", () => ({
    generateAndStoreInterviewAiReport: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/candidate-interview-access", () => ({
    validateAssignedInterviewSlotWindow: jest.fn().mockResolvedValue({ allowed: true }),
}));

function mockInterviewSessionLookup(result: { data: unknown; error: unknown }) {
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

describe("candidate interview route edge cases", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("GET returns 400 when token is missing", async () => {
        const request = new NextRequest("http://localhost/api/candidate/interview");
        const response = await GET(request);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body).toEqual({ success: false, error: "Missing token" });
        expect(supabaseAdmin.from).not.toHaveBeenCalled();
    });

    it("GET returns 404 when interview token is invalid", async () => {
        mockInterviewSessionLookup({ data: null, error: { message: "not found" } });

        const request = new NextRequest("http://localhost/api/candidate/interview?token=bad-token");
        const response = await GET(request);
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body.success).toBe(false);
        expect(body.error).toBe("Invalid interview token");
    });

    it("GET returns 400 when session is outside valid window", async () => {
        mockInterviewSessionLookup({
            data: {
                id: 5,
                application_id: 9,
                started_at: null,
                ended_at: null,
                session_valid_from: "2026-04-03T12:00:00.000Z",
                session_valid_until: "2026-04-03T13:00:00.000Z",
                total_questions_asked: null,
                score: null,
                duration_seconds: null,
            },
            error: null,
        });

        const nowSpy = jest.spyOn(Date, "now").mockReturnValue(new Date("2026-04-03T11:00:00.000Z").getTime());
        const request = new NextRequest("http://localhost/api/candidate/interview?token=t1");
        const response = await GET(request);
        const body = await response.json();
        nowSpy.mockRestore();

        expect(response.status).toBe(400);
        expect(body.success).toBe(false);
        expect(body.error).toBe("This interview link is not active right now");
    });

    it("POST returns 400 when token is missing", async () => {
        const request = new NextRequest("http://localhost/api/candidate/interview", {
            method: "POST",
            body: JSON.stringify({ responses: [] }),
            headers: { "content-type": "application/json" },
        });

        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body).toEqual({ success: false, error: "Missing token" });
    });

    it("POST returns 400 when interview already submitted", async () => {
        mockInterviewSessionLookup({
            data: {
                id: 12,
                application_id: 40,
                started_at: "2026-04-03T09:00:00.000Z",
                ended_at: "2026-04-03T09:20:00.000Z",
                session_valid_from: "2026-04-03T08:00:00.000Z",
                session_valid_until: "2026-04-03T10:00:00.000Z",
            },
            error: null,
        });

        const nowSpy = jest.spyOn(Date, "now").mockReturnValue(new Date("2026-04-03T09:30:00.000Z").getTime());
        const request = new NextRequest("http://localhost/api/candidate/interview", {
            method: "POST",
            body: JSON.stringify({ token: "ok", responses: [{ questionText: "Q", candidateAnswer: "A" }] }),
            headers: { "content-type": "application/json" },
        });

        const response = await POST(request);
        const body = await response.json();
        nowSpy.mockRestore();

        expect(response.status).toBe(400);
        expect(body.success).toBe(false);
        expect(body.error).toBe("Interview already submitted");
        expect(validateAssignedInterviewSlotWindow).not.toHaveBeenCalled();
    });
});
