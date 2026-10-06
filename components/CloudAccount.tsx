"use client";

import { Cloud, LogIn, LogOut, UserPlus } from "lucide-react";
import { useState } from "react";
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

  async function submit(event: React.FormEvent) {
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
              (typeof wi¶»§q«^