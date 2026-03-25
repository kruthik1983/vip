import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { supabaseAdmin } from "@/lib/supabase-admin";

function normalizeWhitespace(input: string) {
    return input
        .replace(/\r/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
}

function inferExtension(path: string) {
    const cleaned = path.toLowerCase().split("?")[0];
    const dot = cleaned.lastIndexOf(".");
    if (dot < 0) {
        return "";
    }

    return cleaned.slice(dot + 1);
}

function summarizeResumeText(text: string) {
    const normalized = normalizeWhitespace(text);
    if (!normalized) {
        return "";
    }

    const lines = normalized
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    const preferred = lines.filter((line) => /experience|summary|skills|projects|education|certification|achievement/i.test(line));
    const picked = preferred.slice(0, 8);

    const source = picked.length > 0 ? picked : lines.slice(0, 8);
    return source.join(" | ").slice(0, 1200);
}

export async function extractResumeTextFromStorage(resumePath: string | null) {
    if (!resumePath) {
        return { text: "", summary: "", parser: "none", error: "missing-resume-path" };
    }

    const bucket = process.env.SUPABASE_RESUME_BUCKET || "candidate-resumes";

    try {
        const { data, error } = await supabaseAdmin.storage.from(bucket).download(resumePath);
        if (error || !data) {
            return { text: "", summary: "", parser: "none", error: "download-failed" };
        }

        const arrayBuffer = await data.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const ext = inferExtension(resumePath);

        let extracted = "";
        let parser = "unknown";

        if (ext === "pdf") {
            const pdfParser = new PDFParse({ data: buffer });
            const parsed = await pdfParser.getText();
            await pdfParser.destroy();
            extracted = parsed.text || "";
            parser = "pdf-parse";
        } else if (ext === "docx") {
            const parsed = await mammoth.extractRawText({ buffer });
            extracted = parsed.value || "";
            parser = "mammoth-docx";
        } else if (ext === "txt" || ext === "md") {
            extracted = buffer.toString("utf8");
            parser = "plain-text";
        } else {
            // Best effort fallback for unknown types.
            extracted = buffer.toString("utf8");
            parser = "fallback-utf8";
        }

        const text = normalizeWhitespace(extracted).slice(0, 12000);
        const summary = summarizeResumeText(text);

        return { text, summary, parser, error: "" };
    } catch (error) {
        console.error("Resume parse error:", error);
        return { text: "", summary: "", parser: "none", error: "parse-failed" };
    }
}
