"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type InterviewQuestion = {
    id: number;
    questionText: string;
    difficultyLevel: string;
    questionOrder: number;
};

type InterviewData = {
    sessionId: number;
    candidateName: string;
    interviewTitle: string;
    positionTitle: string | null;
    durationMinutes: number | null;
    endedAt: string | null;
    result: {
        totalQuestionsAsked: number | null;
        score: number | null;
        durationSeconds: number | null;
    } | null;
    questions: InterviewQuestion[];
};

type NextQuestionData = {
    shouldEnd: boolean;
    nextQuestion?: string;
    remainingSeconds: number;
    totalQuestionsAsked: number;
};

type InterviewResponse = {
    questionText: string;
    candidateAnswer: string;
    voiceRecordingPath: string;
    answerDurationSeconds: number;
};

type BrowserSpeechRecognition = {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex: number }) => void) | null;
    onerror: ((event: { error?: string }) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
};

type BrowserSpeechSynthesis = {
    speak: (utterance: SpeechSynthesisUtterance) => void;
    cancel: () => void;
    pause: () => void;
    resume: () => void;
};

type SpeechSynthesisUtterance = {
    text: string;
    rate: number;
    pitch: number;
    volume: number;
    lang: string;
    onend: (() => void) | null;
    onerror: ((event: { error?: string }) => void) | null;
};

function CandidateInterviewContent() {
    const searchParams = useSearchParams();
    const token = useMemo(() => searchParams.get("token")?.trim() || "", [searchParams]);

    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isFetchingNext, setIsFetchingNext] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [data, setData] = useState<InterviewData | null>(null);
    const [cameraReady, setCameraReady] = useState(false);
    const [microphoneReady, setMicrophoneReady] = useState(false);
    const [fullscreenReady, setFullscreenReady] = useState(false);
    const [isCheckingEnvironment, setIsCheckingEnvironment] = useState(false);
    const [proctoringActive, setProctoringActive] = useState(false);

    // Dynamic question flow
    const [currentQuestion, setCurrentQuestion] = useState<string | null>(null);
    const [currentVoiceRecordingPath, setCurrentVoiceRecordingPath] = useState<string | null>(null);
    const [currentAnswerDurationSeconds, setCurrentAnswerDurationSeconds] = useState<number>(0);
    const [currentTranscript, setCurrentTranscript] = useState("");
    const [speechToTextSupported, setSpeechToTextSupported] = useState(false);
    const [isRecordingAnswer, setIsRecordingAnswer] = useState(false);
    const [isUploadingAnswer, setIsUploadingAnswer] = useState(false);
    const [allResponses, setAllResponses] = useState<InterviewResponse[]>([]);
    const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
    const [totalQuestionsAsked, setTotalQuestionsAsked] = useState(0);
    const [interviewComplete, setInterviewComplete] = useState(false);
    const [textToSpeechSupported, setTextToSpeechSupported] = useState(false);
    const [isReadingQuestion, setIsReadingQuestion] = useState(false);
    const lastSpokenQuestionRef = useRef<string | null>(null);
    const preferredVoiceRef = useRef<any>(null);

    const previewRef = useRef<HTMLVideoElement | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const answerRecorderRef = useRef<MediaRecorder | null>(null);
    const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
    const answerChunksRef = useRef<Blob[]>([]);
    const answerRecordingStartedAtRef = useRef<number>(0);
    const proctoringStartedAtRef = useRef<number>(0);
    const flagThrottleRef = useRef<Record<string, number>>({});

    useEffect(() => {
        let mounted = true;

        async function loadInterview() {
            setIsLoading(true);
            setErrorMessage(null);

            if (!token) {
                setErrorMessage("Missing interview token");
                setIsLoading(false);
                return;
            }

            const response = await fetch(`/api/candidate/interview?token=${encodeURIComponent(token)}`);
            const result = await response.json();

            if (!mounted) {
                return;
            }

            if (!response.ok || !result.success) {
                setErrorMessage(result.error ?? "Failed to load interview");
                setIsLoading(false);
                return;
            }

            setData(result.data as InterviewData);
            setIsLoading(false);
        }

        void loadInterview();

        return () => {
            mounted = false;
        };
    }, [token]);

    useEffect(() => {
        const handleFullscreenChange = () => {
            const active = Boolean(document.fullscreenElement);
            setFullscreenReady(active);
            if (!active && data && !data.endedAt) {
                void reportProctoringFlag("FULLSCREEN_EXIT", "WARNING", "Candidate exited fullscreen mode during interview");
            }
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === "hidden" && data && !data.endedAt) {
                void reportProctoringFlag("TAB_SWITCH", "WARNING", "Candidate switched browser tab or minimized window");
            }
        };

        const handleBlur = () => {
            if (data && !data.endedAt) {
                void reportProctoringFlag("WINDOW_BLUR", "INFO", "Candidate window lost focus");
            }
        };

        const handleOffline = () => {
            void reportProctoringFlag("NETWORK_OFFLINE", "WARNING", "Candidate device went offline during interview");
        };

        document.addEventListener("fullscreenchange", handleFullscreenChange);
        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("blur", handleBlur);
        window.addEventListener("offline", handleOffline);

        return () => {
            document.removeEventListener("fullscreenchange", handleFullscreenChange);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener("blur", handleBlur);
            window.removeEventListener("offline", handleOffline);
        };
    }, [data]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        const speechWindow = window as unknown as {
            SpeechRecognition?: new () => BrowserSpeechRecognition;
            webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
        };

        setSpeechToTextSupported(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition));

        // Check for text-to-speech support
        const hasSpeechSynthesis = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
        setTextToSpeechSupported(hasSpeechSynthesis);

        if (hasSpeechSynthesis) {
            const speechSynthesis = window.speechSynthesis as any;

            const choosePreferredVoice = () => {
                const voices = speechSynthesis.getVoices() as any[];
                if (!voices || voices.length === 0) {
                    return;
                }

                const scoreVoice = (voice: any) => {
                    const name = String(voice?.name || "").toLowerCase();
                    const lang = String(voice?.lang || "").toLowerCase();
                    let score = 0;

                    // Prefer clear English accents first.
                    if (lang.startsWith("en-us")) score += 60;
                    else if (lang.startsWith("en-gb")) score += 50;
                    else if (lang.startsWith("en")) score += 35;

                    // Prefer known natural/pro voices.
                    if (/aria|jenny|sara|zira|samantha|victoria|alloy|google us english/.test(name)) score += 40;
                    if (/microsoft|google|neural|natural/.test(name)) score += 15;

                    // Avoid novelty/low-quality voices.
                    if (/whisper|novelty|robot|child/.test(name)) score -= 30;

                    return score;
                };

                const sorted = [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a));
                preferredVoiceRef.current = sorted[0] || null;
            };

            choosePreferredVoice();
            speechSynthesis.onvoiceschanged = choosePreferredVoice;
        }
    }, []);

    useEffect(() => {
        return () => {
            stopAllRecordings();
        };
    }, []);

    // Auto-speak question when it loads.
    useEffect(() => {
        if (!currentQuestion || !textToSpeechSupported) {
            return;
        }

        if (lastSpokenQuestionRef.current === currentQuestion) {
            return;
        }

        speakQuestion(currentQuestion, true);
    }, [currentQuestion, textToSpeechSupported]);

    function stopAllRecordings() {
        stopSpeechToText();

        const answerRecorder = answerRecorderRef.current;
        if (answerRecorder && answerRecorder.state !== "inactive") {
            try {
                answerRecorder.stop();
            } catch {
                // Ignore stop errors during shutdown.
            }
        }
        answerRecorderRef.current = null;

        const proctoringRecorder = recorderRef.current;
        if (proctoringRecorder && proctoringRecorder.state !== "inactive") {
            try {
                proctoringRecorder.stop();
            } catch {
                // Ignore stop errors during shutdown.
            }
        }
        recorderRef.current = null;

        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;

        setIsRecordingAnswer(false);
        setIsUploadingAnswer(false);
        setProctoringActive(false);
    }

    function resetCurrentVoiceAnswer() {
        setCurrentVoiceRecordingPath(null);
        setCurrentAnswerDurationSeconds(0);
        setCurrentTranscript("");
        answerChunksRef.current = [];
    }

    function startSpeechToText() {
        if (typeof window === "undefined") {
            return;
        }

        const speechWindow = window as unknown as {
            SpeechRecognition?: new () => BrowserSpeechRecognition;
            webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
        };

        const SpeechRecognitionCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
        if (!SpeechRecognitionCtor) {
            return;
        }

        try {
            const recognition = new SpeechRecognitionCtor();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = "en-US";

            recognition.onresult = (event) => {
                const parts: string[] = [];
                for (let i = event.resultIndex; i < event.results.length; i += 1) {
                    const result = event.results[i] as unknown as { isFinal?: boolean; 0?: { transcript?: string } };
                    const chunk = String(result?.[0]?.transcript || "").trim();
                    if (!chunk) {
                        continue;
                    }

                    if (result?.isFinal) {
                        parts.push(chunk);
                    }
                }

                if (parts.length > 0) {
                    setCurrentTranscript((prev) => `${prev} ${parts.join(" ")}`.trim());
                }
            };

            recognition.onerror = (event) => {
                console.warn("Speech-to-text error", event?.error || "unknown");
            };

            recognition.onend = () => {
                speechRecognitionRef.current = null;
            };

            speechRecognitionRef.current = recognition;
            recognition.start();
        } catch (error) {
            console.warn("Speech-to-text unavailable", error);
        }
    }

    function stopSpeechToText() {
        try {
            speechRecognitionRef.current?.stop();
        } catch {
            // Ignore stop errors from browser speech engines.
        } finally {
            speechRecognitionRef.current = null;
        }
    }

    function speakQuestion(question: string, isAutoTrigger = false) {
        if (typeof window === "undefined" || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
            return;
        }

        // Skip duplicate only for auto-trigger mode.
        if (isAutoTrigger && lastSpokenQuestionRef.current === question) {
            return;
        }

        try {
            // Cancel any previous speech
            const speechSynthesis = window.speechSynthesis as any;
            speechSynthesis.cancel();

            const utteranceObj = new (window as any).SpeechSynthesisUtterance(question);
            utteranceObj.rate = 0.9; // Slightly slow but still natural and clear.
            utteranceObj.pitch = 1.0; // Neutral pitch for clear pronunciation.
            utteranceObj.volume = 1.0;
            utteranceObj.lang = "en-US";
            if (preferredVoiceRef.current) {
                utteranceObj.voice = preferredVoiceRef.current;
            }

            utteranceObj.onend = () => {
                setIsReadingQuestion(false);
            };

            utteranceObj.onerror = (event: any) => {
                console.warn("Text-to-speech error", event?.error || "unknown");
                setIsReadingQuestion(false);
            };

            setIsReadingQuestion(true);
            lastSpokenQuestionRef.current = question;
            // Small delay improves reliability in browsers right after cancel().
            window.setTimeout(() => {
                speechSynthesis.speak(utteranceObj);
            }, 60);
        } catch (error) {
            console.warn("Text-to-speech unavailable", error);
            setIsReadingQuestion(false);
        }
    }

    async function reportProctoringFlag(flagType: string, severity: "INFO" | "WARNING", description: string) {
        if (!token) {
            return;
        }

        const now = Date.now();
        const lastTs = flagThrottleRef.current[flagType] || 0;
        if (now - lastTs < 15000) {
            return;
        }

        flagThrottleRef.current[flagType] = now;

        try {
            await fetch("/api/candidate/interview/proctoring/flag", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ token, flagType, severity, description }),
            });
        } catch (error) {
            console.error("Failed to report proctoring flag", error);
        }
    }

    async function uploadProctoringChunk(blob: Blob) {
        if (!token || blob.size === 0) {
            return;
        }

        const elapsedSeconds = proctoringStartedAtRef.current > 0 ? Math.floor((Date.now() - proctoringStartedAtRef.current) / 1000) : null;
        const file = new File([blob], `proctoring-${Date.now()}.webm`, {
            type: blob.type || "video/webm",
        });

        const form = new FormData();
        form.append("token", token);
        form.append("recordingType", "PROCTORING");
        if (elapsedSeconds !== null) {
            form.append("durationSeconds", String(elapsedSeconds));
        }
        form.append("file", file);

        try {
            await fetch("/api/candidate/interview/proctoring/upload", {
                method: "POST",
                body: form,
            });
        } catch (error) {
            console.error("Failed to upload proctoring chunk", error);
        }
    }

    function startProctoringRecorder(stream: MediaStream) {
        if (recorderRef.current || typeof window === "undefined" || !("MediaRecorder" in window)) {
            return;
        }

        const preferredMimeTypes = [
            "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
            "video/mp4",
            "video/webm;codecs=vp9,opus",
            "video/webm;codecs=vp8,opus",
            "video/webm",
        ];

        const mediaRecorderCtor = (window as unknown as { MediaRecorder: typeof MediaRecorder }).MediaRecorder;
        const selectedMimeType = preferredMimeTypes.find((mime) => mediaRecorderCtor.isTypeSupported?.(mime)) || "video/webm";

        const recorder = new MediaRecorder(stream, {
            mimeType: selectedMimeType,
        });

        recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                void uploadProctoringChunk(event.data);
            }
        };

        // Start without a timeslice so the browser emits one full recording blob on stop.
        recorder.start();
        proctoringStartedAtRef.current = Date.now();
        recorderRef.current = recorder;
        setProctoringActive(true);
    }

    async function runEnvironmentChecks() {
        if (!token) {
            return;
        }

        setIsCheckingEnvironment(true);
        setErrorMessage(null);

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            mediaStreamRef.current = stream;

            if (previewRef.current) {
                previewRef.current.srcObject = stream;
                await previewRef.current.play().catch(() => null);
            }

            setCameraReady(stream.getVideoTracks().length > 0);
            setMicrophoneReady(stream.getAudioTracks().length > 0);

            if (!document.fullscreenElement) {
                await document.documentElement.requestFullscreen();
            }
            setFullscreenReady(Boolean(document.fullscreenElement));

            startProctoringRecorder(stream);
            await reportProctoringFlag("ENV_CHECK_OK", "INFO", "Camera, microphone and fullscreen checks passed");

            // Fetch the first question after environment checks pass
            await fetchNextQuestion();
        } catch (error) {
            setErrorMessage("Camera/microphone/fullscreen check failed. Please allow permissions and try again.");
            await reportProctoringFlag("ENV_CHECK_FAILED", "WARNING", "Environment checks failed for candidate");
            console.error(error);
        } finally {
            setIsCheckingEnvironment(false);
        }
    }

    async function uploadInterviewAnswerRecording(blob: Blob, durationSeconds: number) {
        if (blob.size === 0 || durationSeconds <= 0) {
            throw new Error("Invalid recording payload");
        }

        // Per-answer clips are not uploaded; one full-session recording is uploaded on interview stop.
        return "FULL_SESSION_RECORDING";
    }

    async function startAnswerRecording() {
        if (!mediaStreamRef.current || isRecordingAnswer || isUploadingAnswer) {
            return;
        }

        const audioTracks = mediaStreamRef.current.getAudioTracks();
        if (audioTracks.length === 0) {
            setErrorMessage("Microphone not available. Please rerun environment checks.");
            return;
        }

        try {
            resetCurrentVoiceAnswer();
            const audioStream = new MediaStream(audioTracks);
            const recorder = new MediaRecorder(audioStream, { mimeType: "audio/webm" });

            recorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    answerChunksRef.current.push(event.data);
                }
            };

            recorder.onerror = () => {
                setErrorMessage("Recording failed. Please try again.");
                setIsRecordingAnswer(false);
            };

            recorder.start();
            startSpeechToText();
            answerRecordingStartedAtRef.current = Date.now();
            answerRecorderRef.current = recorder;
            setIsRecordingAnswer(true);
            setErrorMessage(null);
        } catch (error) {
            console.error(error);
            setErrorMessage("Unable to start voice recording.");
        }
    }

    async function stopAnswerRecording() {
        const recorder = answerRecorderRef.current;
        if (!recorder || !isRecordingAnswer) {
            return;
        }

        setIsRecordingAnswer(false);
        setIsUploadingAnswer(true);
        stopSpeechToText();

        try {
            const blob = await new Promise<Blob>((resolve, reject) => {
                recorder.onstop = () => {
                    const combined = new Blob(answerChunksRef.current, { type: "audio/webm" });
                    resolve(combined);
                };
                recorder.onerror = () => reject(new Error("Failed to stop recording"));
                recorder.stop();
            });

            const durationSeconds = Math.max(1, Math.floor((Date.now() - answerRecordingStartedAtRef.current) / 1000));
            const objectPath = await uploadInterviewAnswerRecording(blob, durationSeconds);

            if (!objectPath) {
                throw new Error("Missing uploaded recording path");
            }

            setCurrentVoiceRecordingPath(objectPath);
            setCurrentAnswerDurationSeconds(durationSeconds);
            setErrorMessage(null);
        } catch (error) {
            console.error(error);
            setErrorMessage("Failed to process voice answer. Please record again.");
            resetCurrentVoiceAnswer();
        } finally {
            answerRecorderRef.current = null;
            answerChunksRef.current = [];
            setIsUploadingAnswer(false);
        }
    }

    async function handleSubmit(responsesOverride?: InterviewResponse[]) {
        if (!token || !data) {
            return;
        }

        if (!cameraReady || !microphoneReady || !fullscreenReady) {
            setErrorMessage("Please complete camera, microphone, and fullscreen checks before submitting interview.");
            return;
        }

        setErrorMessage(null);
        setSuccessMessage(null);
        setIsSubmitting(true);

        try {
            const sourceResponses = responsesOverride ?? allResponses;

            if (sourceResponses.length === 0) {
                setErrorMessage("Record at least one answer before submitting interview.");
                setIsSubmitting(false);
                return;
            }

            const responses = sourceResponses.map((r) => ({
                questionText: r.questionText,
                candidateAnswer: r.candidateAnswer,
                voiceRecordingPath: r.voiceRecordingPath,
                answerDurationSeconds: r.answerDurationSeconds,
            }));

            const response = await fetch("/api/candidate/interview", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ token, responses }),
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                setErrorMessage(result.error ?? "Failed to submit interview");
                setIsSubmitting(false);
                return;
            }

            setSuccessMessage("Interview submitted successfully.");

            const reload = await fetch(`/api/candidate/interview?token=${encodeURIComponent(token)}`);
            const reloadResult = await reload.json();
            if (reload.ok && reloadResult.success) {
                setData(reloadResult.data as InterviewData);
            }

            stopAllRecordings();
        } catch (error) {
            setErrorMessage("Failed to submit interview");
            console.error(error);
        } finally {
            setIsSubmitting(false);
        }
    }

    async function handleFinalizeInterview() {
        if (isRecordingAnswer || isUploadingAnswer || isFetchingNext) {
            setErrorMessage("Please finish recording or loading before finalizing the interview.");
            return;
        }

        const mergedResponses = [...allResponses];

        if (currentQuestion && currentVoiceRecordingPath) {
            const pendingCurrent: InterviewResponse = {
                questionText: currentQuestion,
                candidateAnswer: currentTranscript.trim() || "Voice answer recorded. Transcript unavailable.",
                voiceRecordingPath: currentVoiceRecordingPath,
                answerDurationSeconds: currentAnswerDurationSeconds,
            };

            const alreadyAdded = mergedResponses.some(
                (item) => item.questionText === pendingCurrent.questionText && item.voiceRecordingPath === pendingCurrent.voiceRecordingPath
            );

            if (!alreadyAdded) {
                mergedResponses.push(pendingCurrent);
            }
        }

        if (mergedResponses.length === 0) {
            setErrorMessage("Record at least one answer before finalizing interview.");
            return;
        }

        setAllResponses(mergedResponses);
        await handleSubmit(mergedResponses);
    }

    async function fetchNextQuestion(): Promise<void> {
        if (!token || !data) {
            return;
        }

        setIsFetchingNext(true);
        setErrorMessage(null);

        try {
            const response = await fetch("/api/candidate/interview/nextQuestion", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    token,
                    lastAnswer: currentTranscript.trim(),
                }),
            });

            const result = await response.json();

            if (!response.ok) {
                const errorMsg = result.error ?? `API error: ${response.status}`;
                setErrorMessage(errorMsg);
                console.error("Failed to fetch next question:", errorMsg, result);
                return;
            }

            if (!result.success) {
                const errorMsg = result.error ?? "Failed to load next question";
                setErrorMessage(errorMsg);
                console.error("API returned success=false:", result);
                return;
            }

            const nextData = result.data as NextQuestionData;

            if (!nextData) {
                setErrorMessage("Invalid response from server");
                console.error("No data in response:", result);
                return;
            }

            setRemainingSeconds(nextData.remainingSeconds);
            setTotalQuestionsAsked(nextData.totalQuestionsAsked);

            if (nextData.shouldEnd) {
                setInterviewComplete(true);
                setCurrentQuestion(null);
                stopAllRecordings();
            } else if (nextData.nextQuestion) {
                setCurrentQuestion(nextData.nextQuestion);
                resetCurrentVoiceAnswer();
            } else {
                setErrorMessage("No question received from server");
                console.error("nextQuestion field is undefined:", nextData);
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : "Failed to load next question";
            setErrorMessage(errorMsg);
            console.error("Exception in fetchNextQuestion:", error);
        } finally {
            setIsFetchingNext(false);
        }
    }

    async function handleAnswerSubmit(): Promise<void> {
        if (!currentQuestion || !currentVoiceRecordingPath) {
            setErrorMessage("Please record your spoken answer before continuing.");
            return;
        }

        if (isRecordingAnswer || isUploadingAnswer) {
            setErrorMessage("Please finish recording upload before continuing.");
            return;
        }

        setErrorMessage(null);

        const newResponse: InterviewResponse = {
            questionText: currentQuestion,
            candidateAnswer: currentTranscript.trim() || "Voice answer recorded. Transcript unavailable.",
            voiceRecordingPath: currentVoiceRecordingPath,
            answerDurationSeconds: currentAnswerDurationSeconds,
        };

        setAllResponses((prev) => [...prev, newResponse]);

        // Fetch next question
        await fetchNextQuestion();
    }

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#070b16] text-white">
                <p className="text-sm text-slate-300">Loading interview...</p>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="min-h-screen bg-[#070b16] px-6 py-10 text-white lg:px-10">
                <div className="mx-auto max-w-2xl rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                    {errorMessage ?? "Interview unavailable"}
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#070b16] px-6 py-10 text-white lg:px-10">
            <div className="mx-auto max-w-4xl space-y-6">
                <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
                    <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">Candidate Interview</p>
                    <h1 className="mt-2 text-3xl font-semibold">{data.positionTitle ?? data.interviewTitle}</h1>
                    <p className="mt-2 text-sm text-slate-300">Candidate: {data.candidateName}</p>
                    <p className="mt-1 text-sm text-slate-300">Duration: {data.durationMinutes ?? "-"} minutes</p>
                </div>

                {!data.endedAt ? (
                    <div className="rounded-2xl border border-cyan-300/30 bg-cyan-400/10 p-6 backdrop-blur-xl">
                        <h2 className="text-lg font-semibold text-cyan-100">Interview Environment Check</h2>
                        <p className="mt-2 text-sm text-cyan-50/90">
                            Before proceeding: enable camera, microphone, and stay in fullscreen mode.
                        </p>

                        <div className="mt-4 grid gap-4 sm:grid-cols-3">
                            <div className={`rounded-lg border px-3 py-2 text-sm ${cameraReady ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-100" : "border-white/20 bg-white/5 text-slate-200"}`}>
                                Camera: {cameraReady ? "Ready" : "Pending"}
                            </div>
                            <div className={`rounded-lg border px-3 py-2 text-sm ${microphoneReady ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-100" : "border-white/20 bg-white/5 text-slate-200"}`}>
                                Microphone: {microphoneReady ? "Ready" : "Pending"}
                            </div>
                            <div className={`rounded-lg border px-3 py-2 text-sm ${fullscreenReady ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-100" : "border-white/20 bg-white/5 text-slate-200"}`}>
                                Fullscreen: {fullscreenReady ? "Active" : "Not active"}
                            </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={runEnvironmentChecks}
                                disabled={isCheckingEnvironment}
                                className="inline-flex rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 px-5 py-2 text-sm font-semibold text-[#041022] transition hover:brightness-110 disabled:opacity-70"
                            >
                                {isCheckingEnvironment ? "Checking..." : "Run Camera/Mic/Fullscreen Check"}
                            </button>
                        </div>

                        <p className="mt-3 text-xs text-slate-300">
                            Proctoring Recorder: {proctoringActive ? "Active" : "Not active"}
                        </p>

                        <video ref={previewRef} muted playsInline className="mt-4 w-full max-w-md rounded-lg border border-white/20 bg-black/40" />
                    </div>
                ) : null}

                {errorMessage ? (
                    <div className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                        {errorMessage}
                    </div>
                ) : null}

                {successMessage ? (
                    <div className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
                        {successMessage}
                    </div>
                ) : null}

                {data.endedAt ? (
                    <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-6 backdrop-blur-xl">
                        <h2 className="text-lg font-semibold text-emerald-100">Interview Submitted</h2>
                        <p className="mt-2 text-sm text-emerald-200">
                            Total Questions Answered: {data.result?.totalQuestionsAsked ?? "-"}
                        </p>
                    </div>
                ) : interviewComplete ? (
                    <div className="space-y-4">
                        <div className="rounded-2xl border border-blue-300/30 bg-blue-400/10 p-6 backdrop-blur-xl">
                            <h2 className="text-lg font-semibold text-blue-100">Interview Complete</h2>
                            <p className="mt-2 text-sm text-blue-200">
                                You have answered {totalQuestionsAsked} questions. Click the button below to submit your interview.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={() => {
                                void handleSubmit();
                            }}
                            disabled={isSubmitting}
                            className="inline-flex rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-400 px-5 py-2 text-sm font-semibold text-[#041022] transition hover:brightness-110 disabled:opacity-70"
                        >
                            {isSubmitting ? "Submitting..." : "Submit Interview"}
                        </button>
                    </div>
                ) : currentQuestion ? (
                    <div className="space-y-4">
                        <div className="rounded-2xl border border-white/15 bg-white/5 p-5 backdrop-blur-xl">
                            <p className="text-sm font-semibold text-cyan-100">Question {totalQuestionsAsked + 1}</p>
                            <p className="mt-3 text-base text-white">{currentQuestion}</p>

                            {remainingSeconds !== null && (
                                <p className="mt-3 text-xs text-slate-400">
                                    Time remaining: {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, "0")}
                                </p>
                            )}

                            {textToSpeechSupported ? (
                                <button
                                    type="button"
                                    onClick={() => speakQuestion(currentQuestion, false)}
                                    disabled={isReadingQuestion}
                                    className="mt-3 inline-flex rounded-lg border border-blue-300/40 bg-blue-500/20 px-3 py-1 text-xs font-semibold text-blue-100 transition hover:bg-blue-500/30 disabled:opacity-70"
                                >
                                    {isReadingQuestion ? "Reading..." : "Read Question Aloud"}
                                </button>
                            ) : null}

                            <div className="mt-4 rounded-lg border border-white/20 bg-white/5 p-4">
                                <p className="text-xs uppercase tracking-wider text-slate-300">Your Spoken Answer</p>
                                <p className="mt-2 text-sm text-slate-200">
                                    Speak your answer clearly. Stop recording once finished.
                                </p>

                                <div className="mt-3 flex flex-wrap items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={startAnswerRecording}
                                        disabled={isRecordingAnswer || isUploadingAnswer}
                                        className="inline-flex rounded-lg bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-2 text-sm font-semibold text-[#041022] transition hover:brightness-110 disabled:opacity-70"
                                    >
                                        {isRecordingAnswer ? "Recording..." : "Start Recording"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={stopAnswerRecording}
                                        disabled={!isRecordingAnswer || isUploadingAnswer}
                                        className="inline-flex rounded-lg bg-gradient-to-r from-rose-400 to-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-70"
                                    >
                                        {isUploadingAnswer ? "Uploading..." : "Stop Recording"}
                                    </button>
                                </div>

                                <p className="mt-3 text-xs text-slate-300">
                                    Status: {isUploadingAnswer ? "Uploading answer audio..." : isRecordingAnswer ? "Recording in progress" : currentVoiceRecordingPath ? "Answer recorded and saved" : "No recording yet"}
                                </p>
                                {currentAnswerDurationSeconds > 0 ? (
                                    <p className="mt-1 text-xs text-slate-400">Recorded duration: {currentAnswerDurationSeconds}s</p>
                                ) : null}
                                {speechToTextSupported ? (
                                    <div className="mt-3">
                                        <p className="text-xs uppercase tracking-wider text-slate-300">Live Transcript</p>
                                        <div className="mt-1 max-h-24 overflow-y-auto rounded border border-white/15 bg-black/20 px-2 py-2 text-xs text-slate-200">
                                            {currentTranscript || "Transcript will appear while you speak."}
                                        </div>
                                    </div>
                                ) : (
                                    <p className="mt-2 text-xs text-amber-200">
                                        Browser speech-to-text is unavailable. Full interview audio/video will still be stored.
                                    </p>
                                )}
                            </div>

                            <div className="mt-4 flex gap-3">
                                <button
                                    type="button"
                                    onClick={handleAnswerSubmit}
                                    disabled={isFetchingNext || isRecordingAnswer || isUploadingAnswer || !currentVoiceRecordingPath}
                                    className="inline-flex rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 px-5 py-2 text-sm font-semibold text-[#041022] transition hover:brightness-110 disabled:opacity-70"
                                >
                                    {isFetchingNext ? "Loading next question..." : "Submit Recorded Answer"}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleFinalizeInterview}
                                    disabled={isSubmitting || isRecordingAnswer || isUploadingAnswer || isFetchingNext}
                                    className="inline-flex rounded-lg border border-amber-300/40 bg-amber-500/20 px-5 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/30 disabled:opacity-70"
                                >
                                    {isSubmitting ? "Finalizing..." : "Finalize Interview"}
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}

                {!data.endedAt && !interviewComplete && !currentQuestion && proctoringActive ? (
                    <div className="rounded-2xl border border-blue-300/30 bg-blue-400/10 p-6 backdrop-blur-xl">
                        <h2 className="text-lg font-semibold text-blue-100">Waiting for first question...</h2>
                        <p className="mt-2 text-sm text-blue-200">
                            Your environment is ready. The system is preparing your first question.
                        </p>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

export default function CandidateInterviewPage() {
    return (
        <Suspense
            fallback={<div className="flex min-h-screen items-center justify-center bg-[#070b16] text-white">Loading interview...</div>}
        >
            <CandidateInterviewContent />
        </Suspense>
    );
}
