"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInAdmin } from "@/lib/admin-auth";

export default function AdminAuthPage() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
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
        <div className="relative min-h-screen overflow-hidden bg-[#070b16] text-white">
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute -left-24 top-[-120px] h-[340px] w-[340px] rounded-full bg-fuchsia-500/30 blur-3xl" />
                <div className="absolute right-[-120px] top-[120px] h-[360px] w-[360px] rounded-full bg-cyan-400/25 blur-3xl" />
                <div className="absolute bottom-[-140px] left-1/2 h-[360px] w-[360px] -translate-x-1/2 rounded-full bg-blue-500/20 blur-3xl" />
            </div>

            <main className="relative mx-auto grid min-h-screen w-full max-w-7xl grid-cols-1 gap-8 px-6 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:px-10">
                <section className="flex flex-col justify-center">
                    <div className="mb-6 flex items-center gap-3">
                        <div className="relative h-11 w-11">
                            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-400" />
                            <div className="absolute inset-[3px] rounded-[10px] bg-[#0a1020]" />
                            <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[4px] border border-cyan-300/70 bg-cyan-400/20" />
                            <div className="absolute right-1 top-1 h-2 w-2 rounded-full bg-fuchsia-400" />
                            <div className="absolute bottom-1 left-1 h-1.5 w-1.5 rounded-full bg-indigo-300" />
                        </div>
                        <div>
                            <p className="text-xs font-semibold tracking-[0.22em] text-cyan-200">VIP ADMIN PORTAL</p>
                            <p className="text-sm text-slate-300">Secure super admin authentication</p>
                        </div>
                    </div>

                    <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
                        Manage every organization,
                        <span className="bg-gradient-to-r from-fuchsia-300 via-violet-200 to-cyan-200 bg-clip-text text-transparent">
                            {" "}
                            role, and hiring pipeline
                        </span>
                    </h1>

                    <p className="mt-4 max-w-xl text-base leading-7 text-slate-300">
                        Sign in as platform admin to review organization requests, monitor interviews, and unlock full system controls.
                    </p>

                    <div className="mt-8 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
                        {[
                            { label: "Organizations", value: "120+" },
                            { label: "Active Interviews", value: "86" },
                            { label: "Pending Requests", value: "14" },
                        ].map((metric) => (
                            <article
                                key={metric.label}
                                className="rounded-xl border border-white/15 bg-white/5 p-4 backdrop-blur-sm"
                            >
                                <p className="text-2xl font-semibold text-white">{metric.value}</p>
                                <p className="text-xs uppercase tracking-wide text-slate-300">{metric.label}</p>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="flex items-center justify-center lg:justify-end">
                    <div className="w-full max-w-md rounded-3xl border border-white/15 bg-white/10 p-6 shadow-[0_20px_80px_-20px_rgba(56,189,248,0.45)] backdrop-blur-xl sm:p-8">
                        <div className="mb-6">
                            <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">Authentication</p>
                            <h2 className="mt-2 text-2xl font-semibold text-white">Admin Login</h2>
                            <p className="mt-2 text-sm text-slate-300">Use your platform credentials to continue.</p>
                        </div>

                        <form className="space-y-4" onSubmit={handleSubmit}>
                            <div>
                                <label htmlFor="admin-email" className="mb-1.5 block text-sm font-medium text-slate-200">
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
                                    className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white outline-none ring-cyan-300/50 placeholder:text-slate-400 focus:ring-2"
                                />
                            </div>

                            <div>
                                <label htmlFor="admin-password" className="mb-1.5 block text-sm font-medium text-slate-200">
                                    Password
                                </label>
                                <input
                                    id="admin-password"
                                    name="password"
                                    type="password"
                                    placeholder="••••••••••"
                                    value={password}
                                    onChange={(event) => setPassword(event.target.value)}
                                    disabled={isLoading}
                                    className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white outline-none ring-cyan-300/50 placeholder:text-slate-400 focus:ring-2"
                                />
                            </div>

                            <div className="flex items-center justify-between text-sm">
                                <label className="flex items-center gap-2 text-slate-300">
                                    <input
                                        type="checkbox"
                                        checked={keepSignedIn}
                                        onChange={(event) => setKeepSignedIn(event.target.checked)}
                                        disabled={isLoading}
                                        className="h-4 w-4 rounded border border-white/20 bg-white/10 accent-cyan-400"
                                    />
                                    Keep me signed in
                                </label>
                                <a href="/admin/forgot-password" className="font-medium text-cyan-300 transition hover:text-cyan-200">
                                    Forgot password?
                                </a>
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full rounded-xl bg-gradient-to-r from-violet-500 to-cyan-400 px-4 py-3 text-sm font-semibold text-[#041022] transition hover:brightness-110"
                            >
                                {isLoading ? "Signing in..." : "Sign In to Admin Panel"}
                            </button>

                            <button
                                type="button"
                                className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                            >
                                Continue with SSO
                            </button>

                            {errorMessage ? (
                                <p className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
                                    {errorMessage}
                                </p>
                            ) : null}

                            <p className="text-center text-sm text-slate-300">
                                Need admin access?{" "}
                                <a href="/admin/admin_register" className="font-semibold text-cyan-300 hover:text-cyan-200">
                                    Create account
                                </a>
                            </p>
                        </form>

                        <div className="mt-6 rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-3 text-xs leading-5 text-cyan-100">
                            Security notice: admin sessions are monitored and all critical actions are logged.
                        </div>
                    </div>
                </section>
            </main>
        </div>
    );
}
