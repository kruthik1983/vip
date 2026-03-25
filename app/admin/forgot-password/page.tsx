"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function AdminForgotPasswordPage() {
    const [email, setEmail] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    async function handleSendResetLink(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setErrorMessage(null);
        setSuccessMessage(null);

        if (!email.trim()) {
            setErrorMessage("Email is required.");
            return;
        }

        setIsSubmitting(true);

        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;
        const redirectTo = `${appUrl}/auth/reset-password?role=admin`;

        const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
            redirectTo,
        });

        if (error) {
            setErrorMessage(error.message);
            setIsSubmitting(false);
            return;
        }

        setSuccessMessage("Password reset link sent. Please check your email inbox.");
        setIsSubmitting(false);
    }

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#f4f7fb] px-6 py-10 text-slate-900 lg:px-10">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(56,189,248,0.22),transparent_35%),radial-gradient(circle_at_80%_12%,rgba(251,191,36,0.20),transparent_36%),radial-gradient(circle_at_50%_100%,rgba(20,184,166,0.13),transparent_44%)]" />

            <main className="relative mx-auto flex min-h-screen max-w-5xl items-center justify-center">
                <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white/92 p-6 shadow-[0_20px_70px_-34px_rgba(15,23,42,0.5)] backdrop-blur sm:p-8">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Admin Recovery</p>
                    <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Reset your admin password</h1>
                    <p className="mt-2 text-sm text-slate-600">
                        Enter your admin email and we will send a secure password reset link.
                    </p>

                    <form className="mt-6 space-y-4" onSubmit={handleSendResetLink}>
                        <div>
                            <label htmlFor="admin-recovery-email" className="mb-1.5 block text-sm font-medium text-slate-700">
                                Email Address
                            </label>
                            <input
                                id="admin-recovery-email"
                                type="email"
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                disabled={isSubmitting}
                                placeholder="admin@vip.com"
                                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-teal-300/50 placeholder:text-slate-400 focus:ring-2"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full rounded-xl bg-gradient-to-r from-teal-600 to-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110"
                        >
                            {isSubmitting ? "Sending..." : "Send reset link"}
                        </button>

                        {errorMessage ? (
                            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorMessage}</p>
                        ) : null}

                        {successMessage ? (
                            <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p>
                        ) : null}
                    </form>

                    <p className="mt-6 text-center text-sm text-slate-600">
                        Back to admin login{" "}
                        <Link href="/admin/admin_auth" className="font-semibold text-teal-700 hover:text-teal-800">
                            Sign in
                        </Link>
                    </p>
                </section>
            </main>
        </div>
    );
}
