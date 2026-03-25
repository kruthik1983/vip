"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInOrganizationAdmin } from "@/lib/organization-auth";

export default function OrganizationAuthPage() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
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
        <div className="relative min-h-screen overflow-hidden bg-[#f3f9f7] text-slate-900">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(16,185,129,0.18),transparent_35%),radial-gradient(circle_at_84%_16%,rgba(56,189,248,0.18),transparent_35%),radial-gradient(circle_at_50%_100%,rgba(20,184,166,0.10),transparent_44%)]" />

            <main className="relative mx-auto grid min-h-screen w-full max-w-7xl grid-cols-1 gap-10 px-6 py-10 lg:grid-cols-[1.08fr_0.92fr] lg:px-10">
                <section className="flex flex-col justify-center rounded-3xl border border-emerald-100 bg-white/85 p-7 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.4)] backdrop-blur sm:p-9">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Organization Workspace</p>
                    <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
                        Hiring operations,
                        <span className="bg-gradient-to-r from-emerald-700 via-teal-600 to-sky-600 bg-clip-text text-transparent">
                            {" "}
                            designed for momentum
                        </span>
                    </h1>
                    <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">
                        Sign in as organization admin to manage interviews, publish application campaigns, and track candidate progress from one control center.
                    </p>
                </section>

                <section className="flex items-center justify-center lg:justify-end">
                    <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_20px_70px_-30px_rgba(15,23,42,0.45)] sm:p-8">
                        <div className="mb-6">
                            <p className="text-xs uppercase tracking-[0.18em] text-emerald-700">Authentication</p>
                            <h2 className="mt-2 text-2xl font-semibold text-slate-900">Organization Login</h2>
                            <p className="mt-2 text-sm text-slate-600">Use your organization admin credentials.</p>
                        </div>

                        <form className="space-y-4" onSubmit={handleSubmit}>
                            <div>
                                <label htmlFor="org-email" className="mb-1.5 block text-sm font-medium text-slate-700">
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
                                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2"
                                />
                            </div>

                            <div>
                                <label htmlFor="org-password" className="mb-1.5 block text-sm font-medium text-slate-700">
                                    Password
                                </label>
                                <div className="flex overflow-hidden rounded-xl border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-emerald-300/50">
                                    <input
                                        id="org-password"
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

                            <div className="text-right text-sm">
                                <a href="/organization/forgot-password" className="font-medium text-emerald-700 transition hover:text-emerald-800">
                                    Forgot password?
                                </a>
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110"
                            >
                                {isLoading ? "Signing in..." : "Sign In to Organization Panel"}
                            </button>

                            {errorMessage ? (
                                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorMessage}</p>
                            ) : null}

                            <p className="text-center text-sm text-slate-600">
                                Need an organization admin account?{" "}
                                <a href="/organization/organization_register" className="font-semibold text-emerald-700 hover:text-emerald-800">
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
