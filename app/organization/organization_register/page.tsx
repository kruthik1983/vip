"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { registerOrganizationAdmin } from "@/lib/organization-auth";

export default function OrganizationRegisterPage() {
    const router = useRouter();

    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [organizationId, setOrganizationId] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setErrorMessage(null);
        setSuccessMessage(null);

        if (!email.trim() || !password.trim() || !confirmPassword.trim()) {
            setErrorMessage("Email, password, and confirm password are required.");
            return;
        }

        if (password.length < 8) {
            setErrorMessage("Password must be at least 8 characters.");
            return;
        }

        if (password !== confirmPassword) {
            setErrorMessage("Passwords do not match.");
            return;
        }

        const parsedOrganizationId = organizationId.trim() ? Number(organizationId) : undefined;

        if (organizationId.trim() && (Number.isNaN(parsedOrganizationId) || !Number.isInteger(parsedOrganizationId!))) {
            setErrorMessage("Organization ID must be a valid integer.");
            return;
        }

        if (parsedOrganizationId !== undefined && parsedOrganizationId <= 0) {
            setErrorMessage("Organization ID must be greater than 0.");
            return;
        }

        setIsLoading(true);

        const result = await registerOrganizationAdmin(
            email,
            password,
            firstName,
            lastName,
            parsedOrganizationId,
        );

        if (!result.success) {
            setErrorMessage(result.message ?? "Unable to register organization admin account.");
            setIsLoading(false);
            return;
        }

        setSuccessMessage("Organization admin account created successfully. You can now sign in.");
        setIsLoading(false);

        setTimeout(() => {
            router.push("/organization/organization_auth");
        }, 1200);
    }

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#070b16] text-white">
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute -left-24 top-[-120px] h-[340px] w-[340px] rounded-full bg-emerald-500/30 blur-3xl" />
                <div className="absolute right-[-120px] top-[120px] h-[360px] w-[360px] rounded-full bg-cyan-400/20 blur-3xl" />
                <div className="absolute bottom-[-140px] left-1/2 h-[360px] w-[360px] -translate-x-1/2 rounded-full bg-indigo-500/20 blur-3xl" />
            </div>

            <main className="relative mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-6 py-10 lg:px-10">
                <section className="w-full max-w-lg rounded-3xl border border-white/15 bg-white/10 p-6 shadow-[0_20px_80px_-20px_rgba(16,185,129,0.45)] backdrop-blur-xl sm:p-8">
                    <div className="mb-6 text-center">
                        <p className="text-xs uppercase tracking-[0.18em] text-emerald-200">Setup Organization</p>
                        <h1 className="mt-2 text-3xl font-semibold">Create Organization Admin</h1>
                        <p className="mt-2 text-sm text-slate-300">Register an account for organization-level access.</p>
                    </div>

                    <form className="space-y-4" onSubmit={handleSubmit}>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                                <label htmlFor="first-name" className="mb-1.5 block text-sm font-medium text-slate-200">
                                    First Name
                                </label>
                                <input
                                    id="first-name"
                                    type="text"
                                    value={firstName}
                                    onChange={(event) => setFirstName(event.target.value)}
                                    disabled={isLoading}
                                    placeholder="John"
                                    className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2"
                                />
                            </div>

                            <div>
                                <label htmlFor="last-name" className="mb-1.5 block text-sm font-medium text-slate-200">
                                    Last Name
                                </label>
                                <input
                                    id="last-name"
                                    type="text"
                                    value={lastName}
                                    onChange={(event) => setLastName(event.target.value)}
                                    disabled={isLoading}
                                    placeholder="Doe"
                                    className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2"
                                />
                            </div>
                        </div>

                        <div>
                            <label htmlFor="org-email" className="mb-1.5 block text-sm font-medium text-slate-200">
                                Email Address
                            </label>
                            <input
                                id="org-email"
                                type="email"
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                disabled={isLoading}
                                placeholder="orgadmin@company.com"
                                className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2"
                            />
                        </div>

                        <div>
                            <label htmlFor="org-id" className="mb-1.5 block text-sm font-medium text-slate-200">
                                Organization ID (optional)
                            </label>
                            <input
                                id="org-id"
                                type="text"
                                value={organizationId}
                                onChange={(event) => setOrganizationId(event.target.value)}
                                disabled={isLoading}
                                placeholder="e.g. 1"
                                className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2"
                            />
                        </div>

                        <div>
                            <label htmlFor="org-password" className="mb-1.5 block text-sm font-medium text-slate-200">
                                Password
                            </label>
                            <input
                                id="org-password"
                                type="password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                disabled={isLoading}
                                placeholder="Minimum 8 characters"
                                className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2"
                            />
                        </div>

                        <div>
                            <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium text-slate-200">
                                Confirm Password
                            </label>
                            <input
                                id="confirm-password"
                                type="password"
                                value={confirmPassword}
                                onChange={(event) => setConfirmPassword(event.target.value)}
                                disabled={isLoading}
                                placeholder="Re-enter password"
                                className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-400 px-4 py-3 text-sm font-semibold text-[#041022] transition hover:brightness-110"
                        >
                            {isLoading ? "Creating account..." : "Create Organization Admin"}
                        </button>

                        {errorMessage ? (
                            <p className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">{errorMessage}</p>
                        ) : null}

                        {successMessage ? (
                            <p className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">
                                {successMessage}
                            </p>
                        ) : null}
                    </form>

                    <p className="mt-6 text-center text-sm text-slate-300">
                        Already have access?{" "}
                        <a href="/organization/organization_auth" className="font-semibold text-emerald-300 hover:text-emerald-200">
                            Sign in
                        </a>
                    </p>
                </section>
            </main>
        </div>
    );
}
