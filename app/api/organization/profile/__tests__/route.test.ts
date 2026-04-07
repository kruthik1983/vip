import { GET, PUT } from "@/app/api/organization/profile/route";

jest.mock("@/lib/supabase-admin", () => ({
    supabaseAdmin: {
        from: jest.fn(),
    },
}));

describe("organization profile route dashboard-facing guards", () => {
    it("GET returns 401 when access token is missing", async () => {
        const request = new Request("http://localhost/api/organization/profile", {
            method: "GET",
        });

        const response = await GET(request);
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.error).toBe("Missing access token.");
    });

    it("PUT returns 401 when access token is missing", async () => {
        const request = new Request("http://localhost/api/organization/profile", {
            method: "PUT",
            body: JSON.stringify({ name: "Org", email: "org@test.com" }),
            headers: { "content-type": "application/json" },
        });

        const response = await PUT(request);
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.error).toBe("Missing access token.");
    });
});
