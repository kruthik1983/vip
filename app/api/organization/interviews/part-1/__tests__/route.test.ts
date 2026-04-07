import { NextRequest } from "next/server";
import { POST } from "@/app/api/organization/interviews/part-1/route";
import { verifyToken } from "@/lib/auth";

jest.mock("@/lib/supabase-admin", () => ({
    supabaseAdmin: {
        from: jest.fn(),
    },
}));

jest.mock("@/lib/auth", () => ({
    verifyToken: jest.fn(),
}));

describe("create interview part-1 route", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns 401 when auth token is missing", async () => {
        const request = new NextRequest("http://localhost/api/organization/interviews/part-1", {
            method: "POST",
            body: JSON.stringify({}),
            headers: { "content-type": "application/json" },
        });

        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.error).toBe("Missing authorization token");
    });

    it("returns 400 when campaign end is before start", async () => {
        (verifyToken as jest.Mock).mockResolvedValue({ id: 1, role: "ORG_ADMIN", organization_id: 10 });

        const request = new NextRequest("http://localhost/api/organization/interviews/part-1", {
            method: "POST",
            body: JSON.stringify({
                positionTitle: "Engineer",
                jobDescription: "Build systems",
                skillsRequired: ["TypeScript"],
                ctcMin: 10,
                ctcMax: 20,
                campaignStartUtc: "2026-04-03T12:00:00.000Z",
                campaignEndUtc: "2026-04-03T10:00:00.000Z",
            }),
            headers: {
                "content-type": "application/json",
                authorization: "Bearer good-token",
            },
        });

        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toBe("Campaign end time must be after start time");
    });
});
