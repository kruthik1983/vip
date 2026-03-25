"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { registerOrganizationAdmin } from "@/lib/organization-auth";

function getPasswordStrength(value: string) {
    let score = 0;
    if (value.length >= 8) score += 1;
    if (/[A-Z]/.test(value)) score += 1;
    if (/[0-9]/.test(value)) score += 1;
    if (/[^A-Za-z0-9]/.test(value)) score += 1;

    if (score <= 1) return { label: "Weak", className: "bg-rose-500", width: "w-1/4" };
    if (score === 2) return { label: "Fair", className: "bg-amber-500", width: "w-2/4" };
    if (score === 3) return { label: "Good", className: "bg-sky-500", width: "w-3/4" };
    return { label: "Strong", className: "bg-emerald-500", width: "w-full" };
}

export default function OrganizationRegisterPage() {
    const router = useRouter();

    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [organizationId, setOrganizationId] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);

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

        setSuccessMessage("Organization admin account created successfully. Redirecting to sign in...");
        setIsLoading(false);

        setTimeout(() => {
            router.push("/organization/organization_auth");
        }, 1200);
    }

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#f3f9f7] text-slate-900">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(16,185,129,0.18),transparent_35%),radial-gradient(circle_at_84%_16%,rgba(56,189,248,0.18),transparent_35%),radial-gradient(circle_at_50%_100%,rgba(20,184,166,0.10),transparent_44%)]" />

            <main className="relative mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6 py-10 lg:px-10">
                <section className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.45)] backdrop-blur sm:p-8">
                    <div className="mb-6">
                        <p className="text-xs uppercase tracking-[0.18em] text-emerald-700">Setup Organization Admin</p>
                        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Create Organization Admin Account</h1>
                        <p className="mt-2 text-sm text-slate-600">Register a secure account with optional organization mapping.</p>
                    </div>

                    <form className="space-y-4" onSubmit={handleSubmit}>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                                <label htmlFor="first-name" className="mb-1.5 block text-sm font-medium text-slate-700">First Name</label>
                                <input id="first-name" type="text" value={firstName} onChange={(event) => setFirstName(event.target.value)} disabled={isLoading} placeholder="John" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2" />
                            </div>
                            <div>
                                <label htmlFor="last-name" className="mb-1.5 block text-sm font-medium text-slate-700">Last Name</label>
                                <input id="last-name" type="text" value={lastName} onChange={(event) => setLastName(event.target.value)} disabled={isLoading} placeholder="Doe" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2" />
                            </div>
                        </div>

                        <div>
                            <label htmlFor="org-email" className="mb-1.5 block text-sm font-medium text-slate-700">Email Address</label>
                            <input id="org-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={isLoading} placeholder="orgadmin@company.com" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2" />
                        </div>

                        <div>
                            <label htmlFor="org-id" className="mb-1.5 block text-sm font-medium text-slate-700">Organization ID (optional)</label>
                            <input id="org-id" type="text" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} disabled={isLoading} placeholder="e.g. 1" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-emerald-300/50 placeholder:text-slate-400 focus:ring-2" />
                        </div>

                        <div>
                            <label htmlFor="org-password" className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
                            <div className="flex overflow-hidden rounded-xl border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-emerald-300/50">
                                <input id="org-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} disabled={isLoading} placeholder="Minimum 8 characters" className="w-full px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400" />
                                <button type="button" onClick={() => setShowPassword((prev) => !prev)} className="border-l border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">{showPassword ? "Hide" : "Show"}</button>
                            </div>
                            <div className="mt-2">
                                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                                    <div className={`h-full ${passwordStrength.className} ${passwordStrength.width}`} />
                                </div>
                                <p className="mt-1 text-xs text-slate-600">Strength: {passwordStrength.label}</p>
                            </div>
                        </div>

                        <div>
                            <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium text-slate-700">Confirm Password</label>
                            <div className="flex overflow-hidden rounded-xl border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-emerald-300/50">
                                <input id="confirm-password" type={showConfirmPassword ? "text" : "password"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={isLoading} placeholder="Re-enter password" className="w-full px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400" />
                                <button type="button" onClick={() => setShowConfirmPassword((prev) => !prev)} className="border-l border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">{showConfirmPassword ? "Hide" : "Show"}</button>
                            </div>
                        </div>

                        <button type="submit" disabled={isLoading} className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110">
                            {isLoading ? "Creating account..." : "Create Organization Admin"}
                        </button>

                        {errorMessage ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorMessage}</p> : null}
                        {successMessage ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}
                    </form>

                    <p className="mt-6 text-center text-sm text-slate-600">
                        Already have access? <a href="/organization/organization_auth" className="font-semibold text-emerald-700 hover:text-emerald-800">Sign in</a>
                    </p>
                </section>
            </main>
        </div>
    );
}
