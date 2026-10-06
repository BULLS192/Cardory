"use client";

import { Cloud, LogIn, LogOut, UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient, isCloudConfigured } from "@/lib/supabase";

export type CloudStatus = "off" | "loading" | "syncing" | "synced" | "error";

export default function CloudAccount({
  session,
  status,
  error,
}: {
  session: Session | null;
  status: CloudStatus;
  error?: string;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  if (!isCloudConfigured) {
    return (
      <div className="cloud-account">
        <div className="cloud-account-title"><Cloud size={15} /> Cloud sync</div>
        <span className="cloud-muted">Supabase is not configured.</span>
      </div>
    );
  }

  const client = getSupabaseBrowserClient();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!client || !email.trim() || password.length < 6) return;
    setWorking(true);
    setMessage("");

    try {
      if (mode === "signup") {
        const { data, error: authError } = await client.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo:
              process.env.NEXT_PUBLIC_SITE_URL ??
              (typeof window !== "undefined" ? window.location.origin : undefined),
          },
        });
        if (authError) throw authError;
        setMessage(
          data.session
            ? "Account created. Cloud sync is starting."
            : "Account created. Check your email to confirm it, then sign in."
        );
      } else {
        const { error: authError } = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (authError) throw authError;
      }
    } catch (authError) {
      setMessage(authError instanceof Error ? authError.message : "Authentication failed.");
    } finally {
      setWorking(false);
    }
  }

  async function signOut() {
    if (!client) return;
    setWorking(true);
    setMessage("");
    const { error: authError } = await client.auth.signOut();
    if (authError) setMessage(authError.message);
    setWorking(false);
  }

  if (session?.user) {
    const statusLabel =
      status === "loading"
        ? "Loading cloud library…"
        : status === "syncing"
          ? "Saving changes…"
          : status === "error"
            ? "Sync needs attention"
            : status === "off"
              ? "Cloud idle"
              : "Cloud synced";

    return (
      <div className="cloud-account">
        <div className="cloud-account-title"><Cloud size={15} /> Cloud library</div>
        <strong className="cloud-email">{session.user.email ?? "Signed in"}</strong>
        <span className={"cloud-status " + status}>
          <i />
          {statusLabel}
        </span>
        {(error || message) && <span className="cloud-error">{error || message}</span>}
        <button className="cloud-link" type="button" onClick={() => void signOut()} disabled={working}>
          <LogOut size={14} /> Sign out
        </button>
      </div>
    );
  }

  return (
    <form className="cloud-account" onSubmit={submit}>
      <div className="cloud-account-title"><Cloud size={15} /> Multi-device sync</div>
      <span className="cloud-muted">Sign in to keep this collection in CARDORY Cloud.</span>
      <input
        className="cloud-input"
        type="email"
        autoComplete="email"
        placeholder="Email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
      />
      <input
        className="cloud-input"
        type="password"
        minLength={6}
        autoComplete={mode === "signin" ? "current-password" : "new-password"}
        placeholder="Password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />
      <button className="ghost full cloud-submit" type="submit" disabled={working}>
        {mode === "signin" ? <LogIn size={14} /> : <UserPlus size={14} />}
        {working ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>
      <button
        className="cloud-link"
        type="button"
        onClick={() => {
          setMode((current) => (current === "signin" ? "signup" : "signin"));
          setMessage("");
        }}
      >
        {mode === "signin" ? "Need an account?" : "Already have an account?"}
      </button>
      {message && <span className="cloud-error">{message}</span>}
    </form>
  );
}
