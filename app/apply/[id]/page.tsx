"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

type FormConfig = {
    requireName: boolean;
    requireEmail: boolean;
    requirePhone: boolean;
    requireResume: boolean;
    consentPolicyVersion: string;
    consentPolicyUrl: string | null;
};

type SlotOption = {
    id: number;
    slotStartUtc: string;
    slotEndUtc: string;
    maxCandidates: number;
    assignedCandidates: number;
    seatsLeft: number;
};

type ApplyMeta = {
    interviewId: number;
    title: string;
    positionTitle: string | null;
    campaignStartUtc: string | null;
    campaignEndUtc: string | null;
    validUntil: string;
    formConfig: FormConfig;
    assessmentSlots: SlotOption[];
    interviewSlots: SlotOption[];
};

function formatDateTime(value: string | null) {
    if (!value) return "-";

    return new Date(value).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    });
}

export default function ApplyPage() {
    const params = useParams<{ id: string }>();
    const id = useMemo(() => params?.id ?? "", [params]);

    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    const [meta, setMeta] = useState<ApplyMeta | null>(null);

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [resume, setResume] = useState<File | null>(null);
    const [assessmentPreferences, setAssessmentPreferences] = useState<string[]>(["", "", ""]);
    const [interviewPreferences, setInterviewPreferences] = useState<string[]>(["", "", ""]);
    const [consentDataProcessing, setConsentDataProcessing] = useState(false);
    const [consentAudioRecording, setConsentAudioRecording] = useState(false);
    const [consentVideoRecording, setConsentVideoRecording] = useState(false);

    useEffect(() => {
        let mounted = true;

        async function loadMeta() {
            setIsLoading(true);
            setErrorMessage(null);

            if (!id) {
                setErrorMessage("Invalid application id");
                setIsLoading(false);
                return;
            }

            const response = await fetch(`/api/apply/${id}`);
            const result = await response.json();

            if (!mounted) {
                return;
            }

            if (!response.ok || !result.success) {
                setErrorMessage(result.error ?? "Unable to open this application link");
                setIsLoading(false);
                return;
            }

            setMeta(result.data as ApplyMeta);
            setIsLoading(false);
        }

        void loadMeta();

        return () => {
            mounted = false;
        };
    }, [id]);

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!meta) {
            return;
        }

        setErrorMessage(null);
        setSuccessMessage(null);

        if (meta.formConfig.requireName && !name.trim()) {
            setErrorMessage("Name is required");
            return;
        }

        if (!email.trim()) {
            setErrorMessage("Email is required");
            return;
        }

        if (meta.formConfig.requirePhone && !phone.trim()) {
            setErrorMessage("Phone is required");
            return;
        }

        if (meta.formConfig.requireResume && !resume) {
            setErrorMessage("Resume is required");
            return;
        }

        const selectedAssessment = assessmentPreferences
            .filter(Boolean)
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0);
        const selectedInterview = interviewPreferences
            .filter(Boolean)
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0);

        if (hasDuplicates(assessmentPreferences)) {
            setErrorMessage("Assessment slot preferences must be unique");
            return;
        }

        if (hasDuplicates(interviewPreferences)) {
            setErrorMessage("Interview slot preferences must be unique");
            return;
        }

        if (meta.assessmentSlots.length > 0 && selectedAssessment.length === 0) {
            setErrorMessage("Please select at least one assessment slot preference");
            return;
        }

        if (meta.interviewSlots.length > 0 && selectedInterview.length === 0) {
            setErrorMessage("Please select at least one interview slot preference");
            return;
        }

        if (!consentDataProcessing || !consentAudioRecording || !consentVideoRecording) {
            setErrorMessage("All consent checkboxes are required");
            return;
        }

        setIsSubmitting(true);

        try {
            const formData = new FormData();
            formData.append("name", name);
            formData.append("email", email);
            formData.append("phone", phone);
            if (resume) {
                formData.append("resume", resume);
            }
            formData.append("assessmentPreferenceIds", JSON.stringify(selectedAssessment));
            formData.append("interviewPreferenceIds", JSON.stringify(selectedInterview));
            formData.append("consentDataProcessing", String(consentDataProcessing));
            formData.append("consentAudioRecording", String(consentAudioRecording));
            formData.append("consentVideoRecording", String(consentVideoRecording));

            const response = await fetch(`/api/apply/${id}`, {
                method: "POST",
                body: formData,
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                setErrorMessage(result.error ?? "Failed to submit application");
                setIsSubmitting(false);
                return;
            }

            setSuccessMessage("Application submitted successfully. We will contact you soon.");
            setName("");
            setEmail("");
            setPhone("");
            setResume(null);
            setAssessmentPreferences(["", "", ""]);
            setInterviewPreferences(["", "", ""]);
            setConsentDataProcessing(false);
            setConsentAudioRecording(false);
            setConsentVideoRecording(false);
        } catch (error) {
            setErrorMessage("Failed to submit application. Please try again.");
            console.error(error);
        } finally {
            setIsSubmitting(false);
        }
    }

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#070b16] text-white">
                <p className="text-sm text-slate-300">Loading application form...</p>
            </div>
        );
    }

    if (!meta) {
        return (
            <div className="min-h-screen bg-[#070b16] px-6 py-10 text-white lg:px-10">
                <div className="mx-auto max-w-2xl rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                    {errorMessage ?? "Invalid or expired application link"}
                </div>
            </div>
        );
    }

    function updatePreference(
        current: string[],
        setter: React.Dispatch<React.SetStateAction<string[]>>,
        index: number,
        nextValue: string
    ) {
        const next = [...current];
        next[index] = nextValue;
        setter(next);
    }

    function hasDuplicates(values: string[]) {
        const selected = values.filter(Boolean);
        return new Set(selected).size !== selected.length;
    }

    return (
        <div className="min-h-screen bg-[#070b16] px-6 py-10 text-white lg:px-10">
            <div className="mx-auto max-w-2xl space-y-6">
                <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
                    <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">Candidate Application</p>
                    <h1 className="mt-2 text-3xl font-semibold">{meta.positionTitle ?? meta.title}</h1>
                    <p className="mt-2 text-sm text-slate-300">Interview: {meta.title}</p>
                    <p className="mt-1 text-xs text-slate-400">Apply before: {formatDateTime(meta.validUntil)}</p>
                </div>

                <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8 space-y-2 text-sm text-slate-300">
                    <p><span className="text-slate-400">Campaign Start:</span> {formatDateTime(meta.campaignStartUtc)}</p>
                    <p><span className="text-slate-400">Campaign End:</span> {formatDateTime(meta.campaignEndUtc)}</p>
                    <p><span className="text-slate-400">Interview ID:</span> {meta.interviewId}</p>
                </div>

                {errorMessage && (
                    <div className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                        {errorMessage}
                    </div>
                )}

                {successMessage && (
                    <div className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
                        {successMessage}
                    </div>
                )}

                <form
                    onSubmit={handleSubmit}
                    className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8 space-y-4"
                >
                    <h2 className="text-lg font-semibold">Application Form</h2>

                    {meta.formConfig.requireName && (
                        <div>
                            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-300">
                                Name <span className="text-rose-400">*</span>
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Enter your full name"
                                className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-slate-400 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30"
                            />
                        </div>
                    )}

                    <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-300">
                            Email <span className="text-rose-400">*</span>
                        </label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="Enter your email"
                            className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-slate-400 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30"
                        />
                    </div>

                    {meta.formConfig.requirePhone && (
                        <div>
                            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-300">
                                Phone <span className="text-rose-400">*</span>
                            </label>
                            <input
                                type="tel"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder="Enter your phone number"
                                className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-slate-400 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30"
                            />
                        </div>
                    )}

                    {meta.formConfig.requireResume && (
                        <div>
                            <label htmlFor="resume-upload" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-300">
                                Resume <span className="text-rose-400">*</span>
                            </label>
                            <input
                                id="resume-upload"
                                title="Upload your resume"
                                type="file"
                                accept=".pdf,.doc,.docx"
                                onChange={(e) => setResume(e.target.files?.[0] ?? null)}
                                className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white outline-none file:mr-4 file:rounded-md file:border-0 file:bg-cyan-500/80 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[#041022]"
                            />
                            <p className="mt-1 text-xs text-slate-400">Accepted: PDF, DOC, DOCX</p>
                        </div>
                    )}

                    {meta.assessmentSlots.length > 0 && (
                        <div className="space-y-3 rounded-xl border border-white/10 bg-[#091326] p-4">
                            <h3 className="text-sm font-semibold text-cyan-200">Assessment Slot Preferences</h3>
                            <p className="text-xs text-slate-400">Select up to 3 preferred assessment slots in order.</p>
                            <div className="grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
                                {meta.assessmentSlots.map((slot) => (
                                    <div key={`assessment-slot-${slot.id}`} className="rounded-lg border border-white/10 bg-white/5 p-2">
                                        <p>{formatDateTime(slot.slotStartUtc)} - {formatDateTime(slot.slotEndUtc)}</p>
                                        <p className="text-slate-400">Seats left: {slot.seatsLeft}</p>
                                    </div>
                                ))}
                            </div>
                            {[0, 1, 2].map((rankIndex) => (
                                <div key={`assessment-pref-${rankIndex}`}>
                                    <label htmlFor={`assessment-pref-select-${rankIndex}`} className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-300">
                                        Assessment Preference {rankIndex + 1}
                                    </label>
                                    <select
                                        id={`assessment-pref-select-${rankIndex}`}
                                        title={`Assessment preference ${rankIndex + 1}`}
                                        value={assessmentPreferences[rankIndex]}
                                        onChange={(event) => updatePreference(assessmentPreferences, setAssessmentPreferences, rankIndex, event.target.value)}
                                        className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30"
                                    >
                                        <option value="" className="text-black">Not selected</option>
                                        {meta.assessmentSlots.map((slot) => (
                                            <option key={`assessment-pref-option-${slot.id}`} value={String(slot.id)} className="text-black">
                                                {formatDateTime(slot.slotStartUtc)} - {formatDateTime(slot.slotEndUtc)} ({slot.seatsLeft} seats)
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            ))}
                        </div>
                    )}

                    {meta.interviewSlots.length > 0 && (
                        <div className="space-y-3 rounded-xl border border-white/10 bg-[#091326] p-4">
                            <h3 className="text-sm font-semibold text-cyan-200">Interview Slot Preferences</h3>
                            <p className="text-xs text-slate-400">Select up to 3 preferred interview slots in order.</p>
                            <div className="grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
                                {meta.interviewSlots.map((slot) => (
                                    <div key={`interview-slot-${slot.id}`} className="rounded-lg border border-white/10 bg-white/5 p-2">
                                        <p>{formatDateTime(slot.slotStartUtc)} - {formatDateTime(slot.slotEndUtc)}</p>
                                        <p className="text-slate-400">Seats left: {slot.seatsLeft}</p>
                                    </div>
                                ))}
                            </div>
                            {[0, 1, 2].map((rankIndex) => (
                                <div key={`interview-pref-${rankIndex}`}>
                                    <label htmlFor={`interview-pref-select-${rankIndex}`} className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-300">
                                        Interview Preference {rankIndex + 1}
                                    </label>
                                    <select
                                        id={`interview-pref-select-${rankIndex}`}
                                        title={`Interview preference ${rankIndex + 1}`}
                                        value={interviewPreferences[rankIndex]}
                                        onChange={(event) => updatePreference(interviewPreferences, setInterviewPreferences, rankIndex, event.target.value)}
                                        className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30"
                                    >
                                        <option value="" className="text-black">Not selected</option>
                                        {meta.interviewSlots.map((slot) => (
                                            <option key={`interview-pref-option-${slot.id}`} value={String(slot.id)} className="text-black">
                                                {formatDateTime(slot.slotStartUtc)} - {formatDateTime(slot.slotEndUtc)} ({slot.seatsLeft} seats)
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            ))}
                        </div>
                    )}

                    {hasDuplicates(assessmentPreferences) && (
                        <p className="text-xs text-rose-300">Assessment slot preferences must be unique.</p>
                    )}

                    {hasDuplicates(interviewPreferences) && (
                        <p className="text-xs text-rose-300">Interview slot preferences must be unique.</p>
                    )}

                    <div className="space-y-3 rounded-xl border border-white/10 bg-[#091326] p-4">
                        <h3 className="text-sm font-semibold text-cyan-200">Required Consents</h3>
                        <p className="text-xs text-slate-400">
                            You must provide all consents below to submit your application.
                        </p>
                        <p className="text-xs text-slate-300">
                            Policy version: <span className="font-semibold text-white">{meta.formConfig.consentPolicyVersion}</span>
                            {meta.formConfig.consentPolicyUrl ? (
                                <>
                                    {" "}
                                    |{" "}
                                    <a
                                        href={meta.formConfig.consentPolicyUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
                                    >
                                        View policy
                                    </a>
                                </>
                            ) : null}
                        </p>

                        <label htmlFor="consent-data-processing" className="flex items-start gap-3 text-sm text-slate-200">
                            <input
                                id="consent-data-processing"
                                type="checkbox"
                                checked={consentDataProcessing}
                                onChange={(e) => setConsentDataProcessing(e.target.checked)}
                                className="mt-0.5 h-4 w-4 rounded border-white/30 bg-white/10"
                            />
                            <span>I consent to processing of my personal data for recruitment purposes.</span>
                        </label>

                        <label htmlFor="consent-audio-recording" className="flex items-start gap-3 text-sm text-slate-200">
                            <input
                                id="consent-audio-recording"
                                type="checkbox"
                                checked={consentAudioRecording}
                                onChange={(e) => setConsentAudioRecording(e.target.checked)}
                                className="mt-0.5 h-4 w-4 rounded border-white/30 bg-white/10"
                            />
                            <span>I consent to audio recording for assessment and interview evaluation.</span>
                        </label>

                        <label htmlFor="consent-video-recording" className="flex items-start gap-3 text-sm text-slate-200">
                            <input
                                id="consent-video-recording"
                                type="checkbox"
                                checked={consentVideoRecording}
                                onChange={(e) => setConsentVideoRecording(e.target.checked)}
                                className="mt-0.5 h-4 w-4 rounded border-white/30 bg-white/10"
                            />
                            <span>I consent to video recording for proctoring and interview quality review.</span>
                        </label>
                    </div>

                    <button
                        type="submit"
                        disabled={isSubmitting || hasDuplicates(assessmentPreferences) || hasDuplicates(interviewPreferences)}
                        className="w-full rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-400 px-5 py-2.5 text-sm font-semibold text-[#041022] transition hover:brightness-110 disabled:opacity-70"
                    >
                        {isSubmitting ? "Submitting..." : "Submit Application"}
                    </button>
                </form>
            </div>
        </div>
    );
}
