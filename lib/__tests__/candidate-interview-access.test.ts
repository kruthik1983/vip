import { validateAssignedInterviewSlotWindow } from "@/lib/candidate-interview-access";
import { supabaseAdmin } from "@/lib/supabase-admin";

jest.mock("@/lib/supabase-admin", () => ({
    supabaseAdmin: {
        from: jest.fn(),
    },
}));

type MaybeSingleResult = {
    data: unknown;
    error: unknown;
};

function createBuilderQueue(results: MaybeSingleResult[]) {
    const maybeSingle = jest.fn();
    results.forEach((result) => {
        maybeSingle.mockResolvedValueOnce(result);
    });

    const eq = jest.fn(() => ({ maybeSingle }));
    const select = jest.fn(() => ({ eq }));
    const from = supabaseAdmin.from as jest.Mock;
    from.mockImplementation(() => ({ select }));
}

describe("validateAssignedInterviewSlotWindow", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns not found when application lookup fails", async () => {
        createBuilderQueue([{ data: null, error: { message: "not found" } }]);

        const result = await validateAssignedInterviewSlotWindow(1001);

        expect(result.allowed).toBe(false);
        expect(result.error).toBe("Application not found");
    });

    it("returns not assigned when interview slot is missing", async () => {
        createBuilderQueue([
            {
                data: { id: 1001, assigned_interview_slot_id: null },
                error: null,
            },
        ]);

        const result = await validateAssignedInterviewSlotWindow(1001);

        expect(result.allowed).toBe(false);
        expect(result.error).toBe("Interview slot is not assigned yet");
    });

    it("returns allowed when now is inside session validity window", async () => {
        createBuilderQueue([
            {
                data: { id: 1001, assigned_interview_slot_id: 55 },
                error: null,
            },
            {
                data: {
                    id: 9001,
                    session_valid_from: "2026-04-03T08:00:00.000Z",
                    session_valid_until: "2026-04-03T10:00:00.000Z",
                },
                error: null,
            },
        ]);

        const nowSpy = jest.spyOn(Date, "now").mockReturnValue(new Date("2026-04-03T09:00:00.000Z").getTime());

        const result = await validateAssignedInterviewSlotWindow(1001);

        expect(result).toEqual({ allowed: true });
        nowSpy.mockRestore();
    });

    it("returns denied when now is outside session validity window", async () => {
        createBuilderQueue([
            {
                data: { id: 1001, assigned_interview_slot_id: 55 },
                error: null,
            },
            {
                data: {
                    id: 9001,
                    session_valid_from: "2026-04-03T08:00:00.000Z",
                    session_valid_until: "2026-04-03T10:00:00.000Z",
                },
                error: null,
            },
        ]);

        const nowSpy = jest.spyOn(Date, "now").mockReturnValue(new Date("2026-04-03T11:00:00.000Z").getTime());

        const result = await validateAssignedInterviewSlotWindow(1001);

        expect(result.allowed).toBe(false);
        expect(result.error).toContain("Interview can only be accessed during assigned time");
        nowSpy.mockRestore();
    });

    it("returns slot not found when interview session lookup fails", async () => {
        createBuilderQueue([
            {
                data: { id: 1001, assigned_interview_slot_id: 55 },
                error: null,
            },
            {
                data: null,
                error: { message: "session missing" },
            },
        ]);

        const result = await validateAssignedInterviewSlotWindow(1001);

        expect(result.allowed).toBe(false);
        expect(result.error).toBe("Assigned interview slot not found");
    });

    it("allows access exactly at window boundaries", async () => {
        createBuilderQueue([
            {
                data: { id: 1001, assigned_interview_slot_id: 55 },
                error: null,
            },
            {
                data: {
                    id: 9001,
                    session_valid_from: "2026-04-03T08:00:00.000Z",
                    session_valid_until: "2026-04-03T10:00:00.000Z",
                },
                error: null,
            },
        ]);

        const startSpy = jest.spyOn(Date, "now").mockReturnValue(new Date("2026-04-03T08:00:00.000Z").getTime());
        const startResult = await validateAssignedInterviewSlotWindow(1001);
        expect(startResult).toEqual({ allowed: true });
        startSpy.mockRestore();

        createBuilderQueue([
            {
                data: { id: 1001, assigned_interview_slot_id: 55 },
                error: null,
            },
            {
                data: {
                    id: 9001,
                    session_valid_from: "2026-04-03T08:00:00.000Z",
                    session_valid_until: "2026-04-03T10:00:00.000Z",
                },
                error: null,
            },
        ]);

        const endSpy = jest.spyOn(Date, "now").mockReturnValue(new Date("2026-04-03T10:00:00.000Z").getTime());
        const endResult = await validateAssignedInterviewSlotWindow(1001);
        expect(endResult).toEqual({ allowed: true });
        endSpy.mockRestore();
    });
});
