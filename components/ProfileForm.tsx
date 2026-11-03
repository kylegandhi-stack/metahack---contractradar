"use client";

import { useState } from "react";
import { Loader2, Search, Sparkles } from "lucide-react";
import type { CompanyProfile } from "@/lib/types";

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

export function ProfileForm({ onSubmit, loading }: Props) {
  const [name, setName] = useState("");
  const [capabilities, setCapabilities] = useState("");
  const [small, setSmall] = useState<"yes" | "no" | "unknown">("unknown");
  const [certs, setCerts] = useState("");
  const [agencies, setAgencies] = useState("");
  const [error, setError] = useState<string | null>(null);

  const usePreset = () => {
    setName(AQUAVECTOR_PRESET.name);
    setCapabilities(AQUAVECTOR_PRESET.capabilities);
    setSmall("yes");
    setCerts("");
    setAgencies((AQUAVECTOR_PRESET.targetAgencies ?? []).join(", "));
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

  const field = "w-full rounded-md border border-line bg-background px-3 py-2 text-sm placeholder:text-slate-500 focus:border-accent focus:outline-none";
  const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-muted";

  return (
    <form onSubmit={submit} className="rounded-xl border border-line bg-panel p-5" aria-labelledby="profile-heading" noValidate>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id="profile-heading" className="text-base font-semibold">Company profile</h2>
        <button type="button" onClick={usePreset} className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-sky-200 hover:bg-accent/20">
          <Sparkles className="size-3.5" aria-hidden /> Use AquaVector demo profile
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="cr-name" className={label}>Company name</label>
          <input id="cr-name" className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Fictional company name" />
        </div>
        <div>
          <label htmlFor="cr-small" className={label}>Small business?</label>
          <select id="cr-small" className={field} value={small} onChange={(e) => setSmall(e.target.value as typeof small)}>
            <option value="unknown">Not stated</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label htmlFor="cr-cap" className={label}>Capabilities</label>
          <textarea id="cr-cap" rows={3} className={field} value={capabilities} onChange={(e) => setCapabilities(e.target.value)} placeholder="What you make or do, in plain language" />
        </div>
        <div>
          <label htmlFor="cr-certs" className={label}>Claimed certifications <span className="normal-case text-slate-500">(optional, comma-separated)</span></label>
          <input id="cr-certs" className={field} value={certs} onChange={(e) => setCerts(e.target.value)} placeholder="e.g. 8(a), HUBZone, WOSB" />
        </div>
        <div>
          <label htmlFor="cr-ag" className={label}>Target agencies <span className="normal-case text-slate-500">(optional)</span></label>
          <input id="cr-ag" className={field} value={agencies} onChange={(e) => setAgencies(e.target.value)} placeholder="e.g. Department of the Navy" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={loading} className="inline-flex items-center gap-2 rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60">
          {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}
          {loading ? "Researching…" : "Find opportunities"}
        </button>
        <p className="text-xs text-muted">Use fictional company details only. Results are recommendations, not eligibility or legal determinations.</p>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    </form>
  );
}
