"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

type FormConfig = {
    requireName: boolean;
    requireEmail: boolean;
    requirePhone: boolean;
    requireResume: boolean;
    requirePhoto: boolean;
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

function formatSlotLabel(slot: SlotOption) {
    return `${formatDateTime(slot.slotStartUtc)} - ${formatDateTime(slot.slotEndUtc)}`;
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
    const [photo, setPhoto] = useState<File | null>(null);
    const [assessmentPreferences, setAssessmentPreferences] = useState<string[]>(["", "", ""]);
    const [interviewPreferences, setInterviewPreferences] = useState<string[]>(["", "", ""]);
    const [consentDataProcessing, setConsentDataProcessing] = useState(false);
    const [consentAudioRecording, setConsentAudioRecording] = useState(false);
    const [consentVideoRecording, setConsentVideoRecording] = useState(false);

    const resumeInputRef = useRef<HTMLInputElement | null>(null);
    const photoInputRef = useRef<HTMLInputElement | null>(null);

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

    function hasDuplicates(values: string[]) {
        const selected = values.filter(Boolean);
        return new Set(selected).size !== selected.length;
    }

    function updatePreference(
        current: string[],
        setter: React.Dispatch<React.SetStateAction<string[]>>,
        index: number,
        nextValue: string,
    ) {
        const next = [...current];
        next[index] = nextValue;
        setter(next);
    }

    function clearResumeSelection() {
        setResume(null);
        if (resumeInputRef.current) {
            resumeInputRef.current.value = "";
        }
    }

    function clearPhotoSelection() {
        setPhoto(null);
        if (photoInputRef.current) {
            photoInputRef.current.value = "";
        }
    }

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

        if (meta.formConfig.requirePhoto && !photo) {
            setErrorMessage("Photo is required");
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
            if (photo) {
                formData.append("photo", photo);
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
            clearResumeSelection();
            clearPhotoSelection();
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
            <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#fff8ee] text-slate-900">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_18%,rgba(251,191,36,0.2),transparent_38%),radial-gradient(circle_at_85%_10%,rgba(20,184,166,0.16),transparent_38%)]" />
                <div className="relative rounded-2xl border border-amber-200 bg-white/90 px-6 py-4 text-sm font-medium text-slate-700 shadow-lg">
                    Loading application form...
                </div>
            </div>
        );
    }

    if (!meta) {
        return (
            <div className="min-h-screen bg-[#fff8ee] px-6 py-10 text-slate-900 lg:px-10">
                <div className="mx-auto max-w-2xl rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {errorMessage ?? "Invalid or expired application link"}
                </div>
            </div>
        );
    }

    const selectedAssessmentCount = assessmentPreferences.filter(Boolean).length;
    const selectedInterviewCount = interviewPreferences.filter(Boolean).length;
    const assessmentHasDuplicate = hasDuplicates(assessmentPreferences);
    const interviewHasDuplicate = hasDuplicates(interviewPreferences);

    const missingName = Boolean(meta.formConfig.requireName && !name.trim());
    const missingEmail = !email.trim();
    const missingPhone = Boolean(meta.formConfig.requirePhone && !phone.trim());
    const missingResume = Boolean(meta.formConfig.requireResume && !resume);
    const missingPhoto = Boolean(meta.formConfig.requirePhoto && !photo);
    const missingAssessmentPref = Boolean(meta.assessmentSlots.length > 0 && selectedAssessmentCount === 0);
    const missingInterviewPref = Boolean(meta.interviewSlots.length > 0 && selectedInterviewCount === 0);
    const missingConsents = !consentDataProcessing || !consentAudioRecording || !consentVideoRecording;

    const checklistItems = [
        { label: "Name", done: !missingName },
        { label: "Email", done: !missingEmail },
        { label: "Phone", done: !missingPhone || !meta.formConfig.requirePhone },
        { label: "Resume", done: !missingResume || !meta.formConfig.requireResume },
        { label: "Photo", done: !missingPhoto || !meta.formConfig.requirePhoto },
        { label: "Assessment Preferences", done: !missingAssessmentPref },
        { label: "Interview Preferences", done: !missingInterviewPref },
        { label: "All Consents", done: !missingConsents },
    ];

    const completeCount = checklistItems.filter((item) => item.done).length;

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#fff8ee] px-5 py-8 text-slate-900 sm:px-8 lg:px-12">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_18%,rgba(251,191,36,0.2),transparent_38%),radial-gradient(circle_at_85%_10%,rgba(20,184,166,0.16),transparent_38%)]" />

            <div className="relative mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.4fr_0.9fr]">
                <section className="space-y-6">
                    <header className="rounded-3xl border border-amber-200 bg-white/90 p-6 shadow-[0_20px_60px_-34px_rgba(15,23,42,0.45)] sm:p-8">
                        <p className="text-xs uppercase tracking-[0.2em] text-teal-700">Candidate Application</p>
                        <h1 className="mt-2 text-3xl font-semibold text-slate-900">{meta.positionTitle ?? meta.title}</h1>
                        <p className="mt-2 text-sm text-slate-600">Interview: {meta.title}</p>
                        <p className="mt-1 text-sm text-rose-700">Apply before: {formatDateTime(meta.validUntil)}</p>

                        <div className="mt-5 grid gap-3 sm:grid-cols-3">
                            <article className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                                <p className="text-xs uppercase tracking-wide text-amber-700">Campaign Start</p>
                                <p className="mt-1 text-sm font-semibold text-amber-900">{formatDateTime(meta.campaignStartUtc)}</p>
                            </article>
                            <article className="rounded-2xl border border-cyan-200 bg-cyan-50 p-3">
                                <p className="text-xs uppercase tracking-wide text-cyan-700">Campaign End</p>
                                <p className="mt-1 text-sm font-semibold text-cyan-900">{formatDateTime(meta.campaignEndUtc)}</p>
                            </article>
                            <article className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                <p className="text-xs uppercase tracking-wide text-slate-600">Interview ID</p>
                                <p className="mt-1 text-sm font-semibold text-slate-900">#{meta.interviewId}</p>
                            </article>
                        </div>
                    </header>

                    {errorMessage ? (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                            {errorMessage}
                        </div>
                    ) : null}

                    {successMessage ? (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                            {successMessage}
                        </div>
                    ) : null}

                    <form
                        onSubmit={handleSubmit}
                        className="space-y-5 rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_18px_55px_-35px_rgba(15,23,42,0.45)] sm:p-8"
                    >
                        <div>
                            <h2 className="text-lg font-semibold text-slate-900">Application Form</h2>
                            <p className="mt-1 text-sm text-slate-600">
                                Fill the required details and choose preferred slots. Fields with * are mandatory.
                            </p>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            {meta.formConfig.requireName ? (
                                <div>
                                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                                        Name <span className="text-rose-600">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="Enter your full name"
                                        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                                    />
                                </div>
                            ) : null}

                            <div>
                                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                                    Email <span className="text-rose-600">*</span>
                                </label>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="Enter your email"
                                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                                />
                            </div>

                            {meta.formConfig.requirePhone ? (
                                <div>
                                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                                        Phone <span className="text-rose-600">*</span>
                                    </label>
                                    <input
                                        type="tel"
                                        value={phone}
                                        onChange={(e) => setPhone(e.target.value)}
                                        placeholder="Enter your phone number"
                                        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                                    />
                                </div>
                            ) : null}

                            {meta.formConfig.requireResume ? (
                                <div>
                                    <label htmlFor="resume-upload" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                                        Resume <span className="text-rose-600">*</span>
                                    </label>
                                    <input
                                        ref={resumeInputRef}
                                        id="resume-upload"
                                        title="Upload your resume"
                                        type="file"
                                        accept=".pdf,.doc,.docx"
                                        onChange={(e) => setResume(e.target.files?.[0] ?? null)}
                                        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none file:mr-3 file:rounded-md file:border-0 file:bg-teal-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-teal-900"
                                    />
                                    <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                                        <span>Accepted: PDF, DOC, DOCX</span>
                                        {resume ? (
                                            <button
                                                type="button"
                                                onClick={clearResumeSelection}
                                                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                                            >
                                                Clear File
                                            </button>
                                        ) : null}
                                    </div>
                                    {resume ? (
                                        <p className="mt-1 text-xs font-medium text-emerald-700">Selected: {resume.name}</p>
                                    ) : null}
                                </div>
                            ) : null}

                            {meta.formConfig.requirePhoto ? (
                                <div>
                                    <label htmlFor="photo-upload" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                                        Candidate Photo <span className="text-rose-600">*</span>
                                    </label>
                                    <input
                                        ref={photoInputRef}
                                        id="photo-upload"
                                        title="Upload your photo"
                                        type="file"
                                        accept="image/png,image/jpeg,image/webp"
                                        onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                                        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none file:mr-3 file:rounded-md file:border-0 file:bg-cyan-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-cyan-900"
                                    />
                                    <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                                        <span>Accepted: JPG, PNG, WEBP (max 5MB)</span>
                                        {photo ? (
                                            <button
                                                type="button"
                                                onClick={clearPhotoSelection}
                                                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                                            >
                                                Clear Photo
                                            </button>
                                        ) : null}
                                    </div>
                                    {photo ? (
                                        <p className="mt-1 text-xs font-medium text-emerald-700">Selected: {photo.name}</p>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>

                        {meta.assessmentSlots.length > 0 ? (
                            <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <h3 className="text-sm font-semibold text-amber-900">Assessment Slot Preferences</h3>
                                    <span className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                                        Selected: {selectedAssessmentCount}/3
                                    </span>
                                </div>
                                <p className="text-xs text-amber-800">Select up to 3 preferred assessment slots in order.</p>
                                <div className="grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
                                    {meta.assessmentSlots.map((slot) => (
                                        <div key={`assessment-slot-${slot.id}`} className="rounded-lg border border-amber-200 bg-white p-2.5">
                                            <p>{formatSlotLabel(slot)}</p>
                                            <p className={`mt-1 font-medium ${slot.seatsLeft > 0 ? "text-emerald-700" : "text-rose-700"}`}>
                                                Seats left: {slot.seatsLeft}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                                {[0, 1, 2].map((rankIndex) => (
                                    <div key={`assessment-pref-${rankIndex}`}>
                                        <label htmlFor={`assessment-pref-select-${rankIndex}`} className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                                            Assessment Preference {rankIndex + 1}
                                        </label>
                                        <select
                                            id={`assessment-pref-select-${rankIndex}`}
                                            title={`Assessment preference ${rankIndex + 1}`}
                                            value={assessmentPreferences[rankIndex]}
                                            onChange={(event) =>
                                                updatePreference(
                                                    assessmentPreferences,
                                                    setAssessmentPreferences,
                                                    rankIndex,
                                                    event.target.value,
                                                )
                                            }
                                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                                        >
                                            <option value="">Not selected</option>
                                            {meta.assessmentSlots.map((slot) => (
                                                <option key={`assessment-pref-option-${slot.id}`} value={String(slot.id)} disabled={slot.seatsLeft <= 0}>
                                                    {formatSlotLabel(slot)} ({slot.seatsLeft} seats)
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        {meta.interviewSlots.length > 0 ? (
                            <div className="space-y-3 rounded-2xl border border-cyan-200 bg-cyan-50/70 p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <h3 className="text-sm font-semibold text-cyan-900">Interview Slot Preferences</h3>
                                    <span className="rounded-full border border-cyan-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-cyan-700">
                                        Selected: {selectedInterviewCount}/3
                                    </span>
                                </div>
                                <p className="text-xs text-cyan-900">Select up to 3 preferred interview slots in order.</p>
                                <div className="grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
                                    {meta.interviewSlots.map((slot) => (
                                        <div key={`interview-slot-${slot.id}`} className="rounded-lg border border-cyan-200 bg-white p-2.5">
                                            <p>{formatSlotLabel(slot)}</p>
                                            <p className={`mt-1 font-medium ${slot.seatsLeft > 0 ? "text-emerald-700" : "text-rose-700"}`}>
                                                Seats left: {slot.seatsLeft}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                                {[0, 1, 2].map((rankIndex) => (
                                    <div key={`interview-pref-${rankIndex}`}>
                                        <label htmlFor={`interview-pref-select-${rankIndex}`} className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                                            Interview Preference {rankIndex + 1}
                                        </label>
                                        <select
                                            id={`interview-pref-select-${rankIndex}`}
                                            title={`Interview preference ${rankIndex + 1}`}
                                            value={interviewPreferences[rankIndex]}
                                            onChange={(event) =>
                                                updatePreference(
                                                    interviewPreferences,
                                                    setInterviewPreferences,
                                                    rankIndex,
                                                    event.target.value,
                                                )
                                            }
                                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                                        >
                                            <option value="">Not selected</option>
                                            {meta.interviewSlots.map((slot) => (
                                                <option key={`interview-pref-option-${slot.id}`} value={String(slot.id)} disabled={slot.seatsLeft <= 0}>
                                                    {formatSlotLabel(slot)} ({slot.seatsLeft} seats)
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        {assessmentHasDuplicate ? (
                            <p className="text-xs font-medium text-rose-700">Assessment slot preferences must be unique.</p>
                        ) : null}

                        {interviewHasDuplicate ? (
                            <p className="text-xs font-medium text-rose-700">Interview slot preferences must be unique.</p>
                        ) : null}

                        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <h3 className="text-sm font-semibold text-slate-900">Required Consents</h3>
                            <p className="text-xs text-slate-500">
                                You must provide all consents below to submit your application.
                            </p>
                            <p className="text-xs text-slate-600">
                                Policy version: <span className="font-semibold text-slate-900">{meta.formConfig.consentPolicyVersion}</span>
                                {meta.formConfig.consentPolicyUrl ? (
                                    <>
                                        {" "}
                                        |{" "}
                                        <a
                                            href={meta.formConfig.consentPolicyUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-teal-700 underline underline-offset-2 hover:text-teal-600"
                                        >
                                            View policy
                                        </a>
                                    </>
                                ) : null}
                            </p>

                            <label htmlFor="consent-data-processing" className="flex items-start gap-3 text-sm text-slate-700">
                                <input
                                    id="consent-data-processing"
                                    type="checkbox"
                                    checked={consentDataProcessing}
                                    onChange={(e) => setConsentDataProcessing(e.target.checked)}
                                    className="mt-0.5 h-4 w-4 rounded border-slate-300 bg-white"
                                />
                                <span>I consent to processing of my personal data for recruitment purposes.</span>
                            </label>

                            <label htmlFor="consent-audio-recording" className="flex items-start gap-3 text-sm text-slate-700">
                                <input
                                    id="consent-audio-recording"
                                    type="checkbox"
                                    checked={consentAudioRecording}
                                    onChange={(e) => setConsentAudioRecording(e.target.checked)}
                                    className="mt-0.5 h-4 w-4 rounded border-slate-300 bg-white"
                                />
                                <span>I consent to audio recording for assessment and interview evaluation.</span>
                            </label>

                            <label htmlFor="consent-video-recording" className="flex items-start gap-3 text-sm text-slate-700">
                                <input
                                    id="consent-video-recording"
                                    type="checkbox"
                                    checked={consentVideoRecording}
                                    onChange={(e) => setConsentVideoRecording(e.target.checked)}
                                    className="mt-0.5 h-4 w-4 rounded border-slate-300 bg-white"
                                />
                                <span>I consent to video recording for proctoring and interview quality review.</span>
                            </label>
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting || assessmentHasDuplicate || interviewHasDuplicate}
                            className="w-full rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-teal-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-105 disabled:opacity-70"
                        >
                            {isSubmitting ? "Submitting..." : "Submit Application"}
                        </button>
                    </form>
                </section>

                <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
                    <div className="rounded-3xl border border-slate-200 bg-white/92 p-5 shadow-[0_18px_55px_-35px_rgba(15,23,42,0.45)]">
                        <p className="text-xs uppercase tracking-[0.15em] text-slate-500">Readiness</p>
                        <p className="mt-2 text-2xl font-semibold text-slate-900">
                            {completeCount}/{checklistItems.length}
                        </p>
                        <p className="mt-1 text-sm text-slate-600">Required steps completed</p>

                        <div className="mt-4 space-y-2">
                            {checklistItems.map((item) => (
                                <div key={item.label} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                                    <span className="text-sm text-slate-700">{item.label}</span>
                                    <span className={`text-xs font-semibold ${item.done ? "text-emerald-700" : "text-amber-700"}`}>
                                        {item.done ? "Ready" : "Pending"}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white/92 p-5 shadow-[0_18px_55px_-35px_rgba(15,23,42,0.45)]">
                        <p className="text-sm font-semibold text-slate-900">Quick Tips</p>
                        <ul className="mt-2 space-y-2 text-sm text-slate-600">
                            <li>Choose unique slot preferences to avoid submission errors.</li>
                            <li>Slots with zero seats are disabled in dropdowns.</li>
                            <li>Keep your email accurate for credentials and updates.</li>
                        </ul>
                    </div>
                </aside>
            </div>
        </div>
    );
}
