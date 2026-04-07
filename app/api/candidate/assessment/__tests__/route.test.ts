import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/candidate/assessment/route";
import { supabaseAdmin } from "@/lib/supabase-admin";

jest.mock("@/lib/supabase-admin", () => ({
    supabaseAdmin: {
        from: jest.fn(),
    },
}));

jest.mock("@/lib/ollama", () => ({
    generateAssessmentQuestionsFromOllama: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/candidate-assessment-access", () => ({
    validateAssignedAssessmentSlotWindow: jest.fn().mockResolvedValue({ allowed: true }),
}));

function mockAttemptLookup(result: { data: unknown; error: unknown }) {
    const maybeSingle = jest.fn().mockResolvedValue(result);
    const eq = jest.fn(() => ({ maybeSingle }));
    const select = jest.fn(() => ({ eq }));

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === "assessment_attempts") {
            return { select };
        }
        throw new Error(`Unexpected table in test: ${table}`);
    });
}

describe("candidate assessment route edge cases", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("GET returns 400 for missing token", async () => {
        const request = new NextRequest("http://localhost/api/candidate/assessment");
        const response = await GET(request);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toBe("Missing token");
    });

    it("GET returns 404 for invalid token", async () => {
        mockAttemptLookup({ data: null, error: { message: "missing" } });

        const request = new NextRequest("http://localhost/api/candidate/assessment?token=bad");
        const response = await GET(request);
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body.error).toBe("Invalid assessment token");
    });

    it("POST returns 400 when token is missing", async () => {
        const request = new NextRequest("http://localhost/api/candidate/assessment", {
            method: "POST",
            body: JSON.stringify({ answers: [] }),
            headers: { "content-type": "application/json" },
        });
        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toBe("Missing token");
    });
});
