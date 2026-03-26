import { supabaseAdmin } from "@/lib/supabase-admin";

function formatInIndia(iso: string) {
    return new Date(iso).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    });
}

export async function validateAssignedInterviewSlotWindow(applicationId: number): Promise<{
    allowed: boolean;
    error?: string;
}> {
    const { data: application, error: appError } = await supabaseAdmin
        .from("applications")
        .select("id, assigned_interview_slot_id")
        .eq("id", applicationId)
        .maybeSingle();

    if (appError || !application) {
        return { allowed: false, error: "Application not found" };
    }

    const slotId = application.assigned_interview_slot_id as number | null;

    if (!slotId) {
        return { allowed: false, error: "Interview slot is not assigned yet" };
    }

    const { data: slot, error: slotError } = await supabaseAdmin
        .from("interview_sessions")
        .select("id, session_valid_from, session_valid_until")
        .eq("application_id", applicationId)
        .maybeSingle();

    //console.log("validateAssignedInterviewSlotWindow", { applicationId, slot, slotError });

    if (slotError || !slot) {
        return { allowed: false, error: "Assigned interview slot not found" };
    }

    const nowTs = Date.now();
    const startTs = new Date(slot.session_valid_from).getTime();
    const endTs = new Date(slot.session_valid_until).getTime();

    const withinAssignedSlot = nowTs >= startTs && nowTs <= endTs;

    if (!withinAssignedSlot) {
        return {
            allowed: false,
            error: `Interview can only be accessed during assigned time: ${formatInIndia(slot.session_valid_from)} to ${formatInIndia(slot.session_valid_until)}`,
        };
    }

    return { allowed: true };
}
