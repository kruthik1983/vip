import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyToken } from "@/lib/auth";

type SlotEditPayload = {
    slotType: "assessment" | "interview";
    slots: Array<{
        id: number;
        slotStartUtc: string;
        slotEndUtc: string;
        maxCandidates: number;
    }>;
};

async function validateOrgAdmin(request: NextRequest) {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
        return {
            error: NextResponse.json({ success: false, error: "Missing authorization token" }, { status: 401 }),
        };
    }

    const verifiedUser = await verifyToken(token);
    if (!verifiedUser || verifiedUser.role !== "ORG_ADMIN") {
        return {
            error: NextResponse.json(
                { success: false, error: "Unauthorized. Organization admin required." },
                { status: 403 },
            ),
        };
    }

    return { verifiedUser };
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const auth = await validateOrgAdmin(request);
        if (auth.error) {
            return auth.error;
        }

        const { verifiedUser } = auth;
        const { id } = await params;
        const interviewId = Number(id);

        if (!Number.isInteger(interviewId) || interviewId <= 0) {
            return NextResponse.json({ success: false, error: "Invalid interview id" }, { status: 400 });
        }

        const { data: interviewData, error: interviewError } = await supabaseAdmin
            .from("interviews")
            .select("id, organization_id")
            .eq("id", interviewId)
            .single();

        if (interviewError || !interviewData) {
            return NextResponse.json({ success: false, error: "Interview not found" }, { status: 404 });
        }

        if (interviewData.organization_id !== verifiedUser.organization_id) {
            return NextResponse.json({ success: false, error: "Unauthorized to update this interview" }, { status: 403 });
        }

        const body = (await request.json()) as Partial<SlotEditPayload>;

        if (body.slotType !== "assessment" && body.slotType !== "interview") {
            return NextResponse.json({ success: false, error: "Invalid slot type" }, { status: 400 });
        }

        if (!Array.isArray(body.slots) || body.slots.length === 0) {
            return NextResponse.json({ success: false, error: "At least one slot is required" }, { status: 400 });
        }

        const tableName = body.slotType === "assessment" ? "assessment_slots" : "interview_slots";
        const slotIds = body.slots.map((slot) => Number(slot.id));

        if (slotIds.some((slotId) => !Number.isInteger(slotId) || slotId <= 0)) {
            return NextResponse.json({ success: false, error: "Invalid slot id in request" }, { status: 400 });
        }

        const { data: existingSlots, error: existingSlotsError } = await supabaseAdmin
            .from(tableName)
            .select("id, interview_id, assigned_candidates")
            .in("id", slotIds)
            .eq("interview_id", interviewId);

        if (existingSlotsError) {
            return NextResponse.json({ success: false, error: "Failed to load existing slots" }, { status: 500 });
        }

        if (!existingSlots || existingSlots.length !== slotIds.length) {
            return NextResponse.json({ success: false, error: "Some slots were not found for this interview" }, { status: 404 });
        }

        const existingSlotMap = new Map(existingSlots.map((slot) => [slot.id, slot]));

        for (const slot of body.slots) {
            const slotStart = new Date(slot.slotStartUtc);
            const slotEnd = new Date(slot.slotEndUtc);
            const maxCandidates = Number(slot.maxCandidates);

            if (Number.isNaN(slotStart.getTime()) || Number.isNaN(slotEnd.getTime())) {
                return NextResponse.json({ success: false, error: "Invalid slot date/time" }, { status: 400 });
            }

            if (slotStart >= slotEnd) {
                return NextResponse.json({ success: false, error: "Slot start time must be before end time" }, { status: 400 });
            }

            if (!Number.isInteger(maxCandidates) || maxCandidates <= 0) {
                return NextResponse.json({ success: false, error: "Max candidates must be a positive integer" }, { status: 400 });
            }

            const existingSlot = existingSlotMap.get(slot.id);
            if (!existingSlot) {
                return NextResponse.json({ success: false, error: "Slot does not belong to this interview" }, { status: 400 });
            }

            const assignedCandidates = Number(existingSlot.assigned_candidates ?? 0);
            if (maxCandidates < assignedCandidates) {
                return NextResponse.json(
                    {
                        success: false,
                        error: `Max candidates for slot #${slot.id} cannot be less than currently assigned (${assignedCandidates})`,
                    },
                    { status: 400 },
                );
            }
        }

        const updates = body.slots.map((slot) =>
            supabaseAdmin
                .from(tableName)
                .update({
                    slot_start_utc: new Date(slot.slotStartUtc).toISOString(),
                    slot_end_utc: new Date(slot.slotEndUtc).toISOString(),
                    max_candidates: Number(slot.maxCandidates),
                })
                .eq("id", slot.id)
                .eq("interview_id", interviewId),
        );

        const updateResults = await Promise.all(updates);
        if (updateResults.some((result) => result.error)) {
            return NextResponse.json({ success: false, error: "Failed to update one or more slots" }, { status: 500 });
        }

        const { data: refreshedSlots, error: refreshedSlotsError } = await supabaseAdmin
            .from(tableName)
            .select("id, slot_start_utc, slot_end_utc, max_candidates, assigned_candidates")
            .eq("interview_id", interviewId)
            .order("slot_start_utc", { ascending: true });

        if (refreshedSlotsError) {
            return NextResponse.json({ success: false, error: "Slots updated, but failed to reload slots" }, { status: 500 });
        }

        await supabaseAdmin.from("audit_logs").insert({
            actor_user_id: verifiedUser.id,
            actor_role: "ORG_ADMIN",
            action_type: body.slotType === "assessment" ? "ASSESSMENT_SLOTS_UPDATED" : "INTERVIEW_SLOTS_UPDATED",
            entity_type: "INTERVIEW",
            entity_id: interviewId,
            new_values: {
                slot_type: body.slotType,
                slot_count: body.slots.length,
            },
        });

        return NextResponse.json({
            success: true,
            data: {
                slotType: body.slotType,
                slots: refreshedSlots ?? [],
            },
            message: `${body.slotType === "assessment" ? "Assessment" : "Interview"} slots updated successfully`,
        });
    } catch (error) {
        console.error("Manage interview slots PATCH error:", error);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}
