import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/apply/[id]/route";
import { supabaseAdmin } from "@/lib/supabase-admin";

jest.mock("@/lib/supabase-admin", () => ({
    supabaseAdmin: {
        from: jest.fn(),
        storage: {
            from: jest.fn(() => ({
                upload: jest.fn().mockResolvedValue({ error: null }),
            })),
        },
    },
}));

function buildRequest(form: FormData) {
    return new NextRequest("http://localhost/api/apply/token", {
        method: "POST",
        body: form,
    });
}

describe("apply route edge cases", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("GET returns 404 when application link is missing", async () => {
        const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: { message: "missing" } });
        const eq = jest.fn(() => ({ maybeSingle }));
        const select = jest.fn(() => ({ eq }));
        (supabaseAdmin.from as jest.Mock).mockImplementation(() => ({ select }));

        const response = await GET(new NextRequest("http://localhost/api/apply/token"), {
            params: Promise.resolve({ id: "token" }),
        });

        const body = await response.json();
        expect(response.status).toBe(404);
        expect(body.error).toBe("Application link not found");
    });

    it("POST returns 400 when required candidate name is missing", async () => {
        let callCount = 0;
        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table !== "application_links") {
                throw new Error(`Unexpected table ${table}`);
            }
            const maybeSingle = jest.fn().mockResolvedValue({
                data: {
                    id: 1,
                    interview_id: 2,
                    application_token: "token",
                    valid_until: "2099-01-01T00:00:00.000Z",
                    is_active: true,
                    application_form_config: {
                        requireName: true,
                        requireEmail: true,
                        requireResume: false,
                        requirePhoto: false,
                    },
                },
                error: null,
            });
            const eq = jest.fn(() => ({ maybeSingle }));
            const select = jest.fn(() => ({ eq }));
            callCount += 1;
            return { select };
        });

        const form = new FormData();
        form.set("email", "candidate@test.com");
        form.set("consentDataProcessing", "true");
        form.set("consentAudioRecording", "true");
        form.set("consentVideoRecording", "true");

        const response = await POST(buildRequest(form), { params: Promise.resolve({ id: "token" }) });
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toBe("Name is required");
        expect(callCount).toBeGreaterThan(0);
    });
});
