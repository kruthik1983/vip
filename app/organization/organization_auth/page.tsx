"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInOrganizationAdmin } from "@/lib/organization-auth";

export default function OrganizationAuthPage() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
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

        const result = await signInOrganizationAdmin(email, password);

        if (!result.success) {
            setErrorMessage(result.message ?? "Authentication failed.");
            setIsLoading(false);
            return;
        }

        router.push("/organization");
        router.refresh();
    }

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#070b16] text-white">
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute -left-24 top-[-120px] h-[340px] w-[340px] rounded-full bg-emerald-500/30 blur-3xl" />
                <div className="absolute right-[-120px] top-[120px] h-[360px] w-[360px] rounded-full bg-cyan-400/20 blur-3xl" />
                <div className="absolute bottom-[-140px] left-1/2 h-[360px] w-[360px] -translate-x-1/2 rounded-full bg-indigo-500/20 blur-3xl" />
            </div>

            <main className="relative mx-auto grid min-h-screen w-full max-w-7xl grid-cols-1 gap-8 px-6 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:px-10">
                <section className="flex flex-col justify-center">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-200">Organization Console</p>
                    <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
                        Access your organization workspace
                        <span className="bg-gradient-to-r from-emerald-300 via-cyan-200 to-indigo-200 bg-clip-text text-transparent">
                            {" "}
                            and manage interviews at scale
                        </span>
                    </h1>
                    <p className="mt-4 max-w-xl text-base leading-7 text-slate-300">
                        Log in as organization admin to create roles, onboard HR users, and monitor candidate hiring pipelines.
                    </p>
                </section>

                <section className="flex items-center justify-center lg:justify-end">
                    <div className="w-full max-w-md rounded-3xl border border-white/15 bg-white/10 p-6 shadow-[0_20px_80px_-20px_rgba(16,185,129,0.45)] backdrop-blur-xl sm:p-8">
                        <div className="mb-6">
                            <p className="text-xs uppercase tracking-[0.18em] text-emerald-200">Authentication</p>
                            <h2 className="mt-2 text-2xl font-semibold text-white">Organization Login</h2>
                            <p className="mt-2 text-sm text-slate-300">Use your organization admin credentials.</p>
                        </div>

                        <form className="space-y-4" onSubmit={handleSubmit}>
                            <div>
                                <label htmlFor="org-email" className="mb-1.5 block text-sm font-medium text-slate-200">
                                    Email Address
                                </label>
                                <input
                                    id="org-email"
                                    name="email"
                                    type="email"
                                    placeholder="orgadmin@company.com"
                                    value={email}
                                    onChange={(event) => setEmail(event.target.value)}
                                    disabled={isLoading}
                                    className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2"
                                />
                            </div>

                            <div>
                                <label htmlFor="org-password" className="mb-1.5 block text-sm font-medium text-slate-200">
                                    Password
                                </label>
                                <input
                                    id="org-password"
                                    name="password"
                                    type="password"
                                    placeholder="••••••••••"
                                    value={password}
                                    onChange={(event) => setPassword(event.target.value)}
                                    disabled={isLoading}
                                    className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2"
                                />
                            </div>

                            <div className="text-right text-sm">
                                <a href="/organization/forgot-password" className="font-medium text-emerald-300 transition hover:text-emerald-200">
                                    Forgot password?
                                </a>
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-400 px-4 py-3 text-sm font-semibold text-[#041022] transition hover:brightness-110"
                            >
                                {isLoading ? "Signing in..." : "Sign In to Organization Panel"}
                            </button>

                            {errorMessage ? (
                                <p className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">{errorMessage}</p>
                            ) : null}

                            <p className="text-center text-sm text-slate-300">
                                Need an organization admin account?{" "}
                                <a href="/organization/organization_register" className="font-semibold text-emerald-300 hover:text-emerald-200">
                                    Register now
                                </a>
                            </p>
                        </form>
                    </div>
                </section>
            </main>
        </div>
    );
}
