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
        <div className="relative min-h-screen overflow-hidden bg-[#070b16] px-6 py-10 text-white lg:px-10">
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute -left-24 top-[-120px] h-[340px] w-[340px] rounded-full bg-fuchsia-500/30 blur-3xl" />
                <div className="absolute right-[-120px] top-[120px] h-[360px] w-[360px] rounded-full bg-cyan-400/20 blur-3xl" />
            </div>

            <main className="relative mx-auto flex min-h-screen max-w-4xl items-center justify-center">
                <section className="w-full max-w-md rounded-3xl border border-white/15 bg-white/10 p-6 backdrop-blur-xl sm:p-8">
                    <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">Admin Recovery</p>
                    <h1 className="mt-2 text-2xl font-semibold">Forgot your password?</h1>
                    <p className="mt-2 text-sm text-slate-300">Enter your admin email and we will send you a reset link.</p>

                    <form className="mt-6 space-y-4" onSubmit={handleSendResetLink}>
                        <div>
                            <label htmlFor="admin-recovery-email" className="mb-1.5 block text-sm font-medium text-slate-200">
                                Email Address
                            </label>
                            <input
                                id="admin-recovery-email"
                                type="email"
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                disabled={isSubmitting}
                                placeholder="admin@vip.com"
                                className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white outline-none ring-cyan-300/50 placeholder:text-slate-400 focus:ring-2"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full rounded-xl bg-gradient-to-r from-violet-500 to-cyan-400 px-4 py-3 text-sm font-semibold text-[#041022] transition hover:brightness-110"
                        >
                            {isSubmitting ? "Sending..." : "Send reset link"}
                        </button>

                        {errorMessage ? (
                            <p className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">{errorMessage}</p>
                        ) : null}

                        {successMessage ? (
                            <p className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">{successMessage}</p>
                        ) : null}
                    </form>

                    <p className="mt-6 text-center text-sm text-slate-300">
                        Back to admin login{" "}
                        <Link href="/admin/admin_auth" className="font-semibold text-cyan-300 hover:text-cyan-200">
                            Sign in
                        </Link>
                    </p>
                </section>
            </main>
        </div>
    );
}
