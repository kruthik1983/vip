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

export async function validateAssignedAssessmentSlotWindow(applicationId: number): Promise<{
    allowed: boolean;
    error?: string;
}> {
    const { data: application, error: appError } = await supabaseAdmin
        .from("applications")
        .select("id, assigned_assessment_slot_id")
        .eq("id", applicationId)
        .maybeSingle();

    if (appError || !application) {
        return { allowed: false, error: "Application not found" };
    }

    const slotId = application.assigned_assessment_slot_id as number | null;

    if (!slotId) {
        return { allowed: false, error: "Assessment slot is not assigned yet" };
    }

    const { data: slot, error: slotError } = await supabaseAdmin
        .from("assessment_attempts")
        .select("id, session_valid_from, session_valid_until")
        .eq("id", applicationId)
        .maybeSingle();

    if (slotError || !slot) {
        return { allowed: false, error: "Assigned assessment slot not found" };
    }

    const nowTs = Date.now();
    const startTs = new Date(slot.session_valid_from).getTime();
    const endTs = new Date(slot.session_valid_until).getTime();

    if (nowTs < startTs || nowTs > endTs) {
        return {
            allowed: false,
            error: `Assessment can only be accessed during assigned time: ${formatInIndia(slot.session_valid_from)} to ${formatInIndia(slot.session_valid_until)}`,
        };
    }

    return { allowed: true };
}
