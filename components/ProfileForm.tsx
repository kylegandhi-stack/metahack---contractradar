"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import type { CompanyProfile } from "@/lib/types";
import type { VoiceProfile } from "@/lib/voice";
import { VoiceInput } from "./VoiceInput";

export const AQUAVECTOR_PRESET: CompanyProfile = {
  name: "AquaVector Systems",
  capabilities:
    "12-person U.S. maker of hydrophones, underwater acoustic sensors, environmental monitoring instruments, and ruggedized components for autonomous underwater vehicles.",
  smallBusiness: true,
  certifications: [],
  targetAgencies: ["Department of the Navy"],
};

const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

type Props = { onSubmit: (p: CompanyProfile) => void; loading: boolean };

function Field({ id, n, label, hint, children, className }: { id: string; n: string; label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="label flex items-baseline gap-2">
        <span className="text-dim">{n}</span>
        <span>{label}</span>
        {hint && <span className="normal-case tracking-normal text-dim">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

export function ProfileForm({ onSubmit, loading }: Props) {
  const [name, setName] = useState("");
  const [capabilities, setCapabilities] = useState("");
  const [small, setSmall] = useState<"yes" | "no" | "unknown">("unknown");
  const [certs, setCerts] = useState("");
  const [agencies, setAgencies] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState<string | null>(null);

  const usePreset = () => {
    setName(AQUAVECTOR_PRESET.name);
    setCapabilities(AQUAVECTOR_PRESET.capabilities);
    setSmall("yes");
    setCerts("");
    setAgencies((AQUAVECTOR_PRESET.targetAgencies ?? []).join(", "));
    setError(null);
    setHeard(null);
  };

  // Voice fills only what the speaker actually said; everything else keeps what's already in the form.
  const applyVoice = (p: VoiceProfile, transcript: string) => {
    if (p.name) setName(p.name);
    if (p.capabilities) setCapabilities(p.capabilities);
    if (p.smallBusiness === true || p.smallBusiness === false) setSmall(p.smallBusiness ? "yes" : "no");
    if (p.certifications?.length) setCerts(p.certifications.join(", "));
    if (p.targetAgencies?.length) setAgencies(p.targetAgencies.join(", "));
    setHeard(transcript || null);
    setError(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Enter a company name.");
    if (capabilities.trim().length < 20) return setError("Describe capabilities in at least a sentence (20+ characters).");
    setError(null);
    onSubmit({
      name: name.trim(),
      capabilities: capabilities.trim(),
      smallBusiness: small === "unknown" ? null : small === "yes",
      certifications: splitList(certs),
      targetAgencies: splitList(agencies),
    });
  };

  return (
    <form onSubmit={submit} className="hud p-5 sm:p-7" aria-labelledby="profile-heading" noValidate>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 id="profile-heading" className="label text-foreground">
          <span className="text-dim">[01]</span> Mission input — company profile
        </h2>
        <div className="flex flex-wrap items-start justify-end gap-2">
          <VoiceInput disabled={loading} onResult={applyVoice} />
          <button
            type="button"
            onClick={usePreset}
            className="border border-line-strong px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-foreground transition hover:border-foreground"
          >
            Load demo: AquaVector Systems
          </button>
        </div>
      </div>

      {heard && (
        <figure className="mb-6 border-l-2 border-signal/60 bg-signal/[0.04] py-2 pl-4 pr-3">
          <blockquote className="font-mono text-[12px] leading-relaxed text-foreground/85">“{heard}”</blockquote>
          <figcaption className="label mt-1.5 text-dim">Transcribed by Muse Voice · structured by Muse Spark · check the fields before running</figcaption>
        </figure>
      )}

      <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
        <Field id="cr-name" n="A" label="Company name">
          <input id="cr-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Fictional company name" />
        </Field>
        <Field id="cr-small" n="B" label="Small business">
          <select id="cr-small" className="field" value={small} onChange={(e) => setSmall(e.target.value as typeof small)}>
            <option value="unknown">Not stated</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </Field>
        <Field id="cr-cap" n="C" label="Capabilities" className="md:col-span-2">
          <textarea id="cr-cap" rows={3} className="field resize-none" value={capabilities} onChange={(e) => setCapabilities(e.target.value)} placeholder="What you build or do, in plain language" />
        </Field>
        <Field id="cr-certs" n="D" label="Claimed certifications" hint="optional, comma-separated">
          <input id="cr-certs" className="field" value={certs} onChange={(e) => setCerts(e.target.value)} placeholder="e.g. 8(a), HUBZone, WOSB" />
        </Field>
        <Field id="cr-ag" n="E" label="Target agencies" hint="optional">
          <input id="cr-ag" className="field" value={agencies} onChange={(e) => setAgencies(e.target.value)} placeholder="e.g. Department of the Navy" />
        </Field>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        <button
          type="submit"
          disabled={loading}
          className="group inline-flex items-center gap-3 bg-foreground px-5 py-3 font-mono text-xs font-medium uppercase tracking-[0.14em] text-background transition hover:bg-signal disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {loading ? "Running agents" : "Run research"}
          {!loading && <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden />}
        </button>
        <p className="max-w-md text-xs text-dim">Fictional company details only. Output is a recommendation, not an eligibility, legal or win-probability determination.</p>
      </div>
      {error && <p role="alert" className="mt-4 font-mono text-xs uppercase tracking-[0.1em] text-hold">! {error}</p>}
    </form>
  );
}
