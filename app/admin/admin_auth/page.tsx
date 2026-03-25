"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInAdmin } from "@/lib/admin-auth";

export default function AdminAuthPage() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [keepSignedIn, setKeepSignedIn] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setErrorMessage(null);

        if (!email.trim() || !password.trim()) {
            setErrorMessage("Email and password are required.");
            return;
        }

        setIsLoading(true);

        const result = await signInAdmin(email, password);

        if (!result.success) {
            setErrorMessage(result.message ?? "Authentication failed.");
            setIsLoading(false);
            return;
        }

        if (!keepSignedIn) {
            sessionStorage.setItem("admin_temp_session", "true");
        }

        router.push("/admin");
        router.refresh();
    }

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#f4f7fb] text-slate-900">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(56,189,248,0.22),transparent_35%),radial-gradient(circle_at_78%_16%,rgba(251,191,36,0.20),transparent_35%),radial-gradient(circle_at_50%_100%,rgba(20,184,166,0.14),transparent_45%)]" />

            <main className="relative mx-auto grid min-h-screen w-full max-w-7xl grid-cols-1 items-center gap-10 px-6 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:px-10">
                <section className="rounded-3xl border border-slate-200 bg-white/85 p-7 shadow-[0_20px_60px_-35px_rgba(15,23,42,0.55)] backdrop-blur sm:p-9">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-700">Virtual Interview Platform</p>
                    <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
                        Admin access,
                        <span className="text-transparent bg-gradient-to-r from-teal-700 via-sky-700 to-amber-600 bg-clip-text"> redesigned for speed.</span>
                    </h1>

                    <p className="mt-4 max-w-xl text-sm leading-6 text-slate-600">
                        Review org onboarding requests, approve instantly, and keep every critical action visible in one clean operational workspace.
                    </p>

                    <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <article className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
                            <p className="text-xs uppercase tracking-wide text-sky-700">Live Queue</p>
                            <p className="mt-1 text-2xl font-semibold text-sky-900">Realtime</p>
                        </article>
                        <article className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                            <p className="text-xs uppercase tracking-wide text-amber-700">Decision Loop</p>
                            <p className="mt-1 text-2xl font-semibold text-amber-900">1-click</p>
                        </article>
                        <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                            <p className="text-xs uppercase tracking-wide text-emerald-700">Audit Trail</p>
                            <p className="mt-1 text-2xl font-semibold text-emerald-900">Tracked</p>
                        </article>
                    </div>
                </section>

                <section className="w-full max-w-md justify-self-center rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_22px_70px_-30px_rgba(15,23,42,0.45)] sm:p-8 lg:justify-self-end">
                    <div className="mb-6">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Authentication</p>
                        <h2 className="mt-2 text-2xl font-semibold text-slate-900">Admin Sign In</h2>
                        <p className="mt-1 text-sm text-slate-600">Use your platform credentials to continue.</p>
                    </div>

                    <form className="space-y-4" onSubmit={handleSubmit}>
                        <div>
                            <label htmlFor="admin-email" className="mb-1.5 block text-sm font-medium text-slate-700">
                                Email Address
                            </label>
                            <input
                                id="admin-email"
                                name="email"
                                type="email"
                                placeholder="admin@vip.com"
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                disabled={isLoading}
                                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-teal-300/50 placeholder:text-slate-400 focus:ring-2"
                            />
                        </div>

                        <div>
                            <label htmlFor="admin-password" className="mb-1.5 block text-sm font-medium text-slate-700">
                                Password
                            </label>
                            <div className="flex overflow-hidden rounded-xl border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-teal-300/50">
                                <input
                                    id="admin-password"
                                    name="password"
                                    type={showPassword ? "text" : "password"}
                                    placeholder="Enter password"
                                    value={password}
                                    onChange={(event) => setPassword(event.target.value)}
                                    disabled={isLoading}
                                    className="w-full px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((prev) => !prev)}
                                    className="border-l border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                                >
                                    {showPassword ? "Hide" : "Show"}
                                </button>
                            </div>
                        </div>

                        <div className="flex items-center justify-between text-sm">
                            <label className="flex items-center gap-2 text-slate-600">
                                <input
                                    type="checkbox"
                                    checked={keepSignedIn}
                                    onChange={(event) => setKeepSignedIn(event.target.checked)}
                                    disabled={isLoading}
                                    className="h-4 w-4 rounded border border-slate-300 bg-white accent-teal-600"
                                />
                                Keep me signed in
                            </label>
                            <a href="/admin/forgot-password" className="font-medium text-teal-700 transition hover:text-teal-800">
                                Forgot password?
                            </a>
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full rounded-xl bg-gradient-to-r from-teal-600 to-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110"
                        >
                            {isLoading ? "Signing in..." : "Sign In to Admin Panel"}
                        </button>

                        {errorMessage ? (
                            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                                {errorMessage}
                            </p>
                        ) : null}

                        <p className="text-center text-sm text-slate-600">
                            Need admin access?{" "}
                            <a href="/admin/admin_register" className="font-semibold text-teal-700 hover:text-teal-800">
                                Create account
                            </a>
                        </p>
                    </form>

                    <div className="mt-6 rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs leading-5 text-teal-800">
                        Security notice: admin sessions are monitored and all critical actions are logged.
                    </div>
                </section>
            </main>
        </div>
    );
}
