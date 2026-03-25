import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { validateAssignedInterviewSlotWindow } from "@/lib/candidate-interview-access";

function asText(input: unknown) {
    return String(input || "").trim();
}

type FlagSeverity = "INFO" | "WARNING";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const token = asText(body?.token);
        const flagType = asText(body?.flagType);
        const description = asText(body?.description);
        const severityRaw = asText(body?.severity).toUpperCase();
        const severity: FlagSeverity = severityRaw === "WARNING" ? "WARNING" : "INFO";

        if (!token) {
            return NextResponse.json({ success: false, error: "Missing token" }, { status: 400 });
        }

        if (!flagType) {
            return NextResponse.json({ success: false, error: "flagType is required" }, { status: 400 });
        }

        const { data: session, error: sessionError } = await supabaseAdmin
            .from("interview_sessions")
            .select("id, application_id")
            .eq("session_token", token)
            .maybeSingle();

        if (sessionError || !session) {
            return NextResponse.json({ success: false, error: "Invalid interview token" }, { status: 404 });
        }

        const slotAccess = await validateAssignedInterviewSlotWindow(session.application_id as number);
        if (!slotAccess.allowed) {
            return NextResponse.json({ success: false, error: slotAccess.error || "Interview access denied" }, { status: 400 });
        }

        const { error: insertError } = await supabaseAdmin.from("proctoring_flags").insert({
            interview_session_id: session.id,
            flag_type: flagType,
            severity,
            description: description || null,
        });

        if (insertError) {
            return NextResponse.json({ success: false, error: "Failed to store proctoring flag" }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Proctoring flag error:", error);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}
