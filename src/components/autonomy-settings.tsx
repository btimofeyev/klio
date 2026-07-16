"use client";

import { useState } from "react";
import { Check, ChevronDown, LoaderCircle, Sparkles } from "lucide-react";
import { exposedAutonomyActions, policyForPreset, sanitizePolicy, type AutonomyAction, type AutonomyLevel, type AutonomyPreset } from "@/lib/autonomy/policy";

const presets: Array<{ id: AutonomyPreset; name: string; detail: string }> = [
  { id: "proactive", name: "Autopilot", detail: "Runs routine and reversible work. You review outcomes and can undo schedule changes." },
  { id: "helpful", name: "Review schedule changes", detail: "Files, records, drafts, and builds practice automatically, but asks before changing the week." },
  { id: "ask_first", name: "Ask me first", detail: "Prepares changes and waits for confirmation." },
  { id: "custom", name: "Custom", detail: "Choose the few boundaries that matter to your family." },
];
const customActions: Array<{ action: AutonomyAction; label: string; allowedLevels: readonly AutonomyLevel[] }> = exposedAutonomyActions;

export function AutonomySettings({ familyId, initialPreset, initialPolicies }: { familyId: string; initialPreset: string; initialPolicies: unknown }) {
  const initial = (presets.some((item) => item.id === initialPreset) ? initialPreset : "proactive") as AutonomyPreset;
  const [preset, setPreset] = useState(initial);
  const [policy, setPolicy] = useState(() => policyForPreset(initial, sanitizePolicy(initialPolicies)));
  const [expanded, setExpanded] = useState(initial === "custom");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(nextPreset: AutonomyPreset, nextPolicy = policyForPreset(nextPreset, nextPreset === "custom" ? policy : undefined)) {
    const previousPreset = preset; const previousPolicy = policy;
    setPreset(nextPreset); setPolicy(nextPolicy); if (nextPreset === "custom") setExpanded(true); setBusy(true); setSaved(false); setError(null);
    const response = await fetch("/api/settings/autonomy", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyId, preset: nextPreset, policies: nextPreset === "custom" ? nextPolicy : {} }) });
    setBusy(false); setSaved(response.ok);
    if (!response.ok) { setPreset(previousPreset); setPolicy(previousPolicy); setError("Klio could not save that autonomy setting."); }
  }
  function change(action: AutonomyAction, level: AutonomyLevel) { const next = { ...policy, [action]: level }; void save("custom", next); }
  return <section className="autonomy-settings">
    <header><div><h2><Sparkles size={17} />How independently should Klio work?</h2><p className="settings-copy">Autopilot handles ordinary homeschool operations and surfaces what changed. Parent judgment stays reserved for official inferred grades, curriculum direction, and destructive actions.</p></div>{busy ? <LoaderCircle className="spin" size={16} /> : saved ? <span><Check size={13} />Saved</span> : null}</header>
    <div className="autonomy-presets">{presets.map((item) => <button type="button" className={preset === item.id ? "selected" : ""} onClick={() => void save(item.id)} disabled={busy} key={item.id}><span>{preset === item.id ? <Check size={13} /> : null}{item.name}{item.id === "proactive" ? <em>Recommended</em> : null}</span><small>{item.detail}</small></button>)}</div>
    <button className="autonomy-custom-toggle" type="button" onClick={() => setExpanded((value) => !value)}>Fine-tune boundaries <ChevronDown className={expanded ? "open" : ""} size={15} /></button>
    {expanded ? <div className="autonomy-custom">{customActions.map((item) => <label key={item.action}><span>{item.label}</span><select value={policy[item.action]} disabled={busy} onChange={(event) => change(item.action, event.target.value as AutonomyLevel)}>{item.allowedLevels.includes("automatic") ? <option value="automatic">Automatic</option> : null}{item.allowedLevels.includes("automatic_with_undo") ? <option value="automatic_with_undo">Automatic with undo</option> : null}{item.allowedLevels.includes("confirm") ? <option value="confirm">Parent confirms</option> : null}{item.allowedLevels.includes("ask") ? <option value="ask">Ask one question</option> : null}{item.allowedLevels.includes("never") ? <option value="never">Never</option> : null}</select></label>)}</div> : null}
    {error ? <p className="autonomy-error" role="alert">{error}</p> : null}
    <p className="autonomy-safety">Autopilot files work, records explicit completion and scores, builds and schedules focused practice, moves unfinished lessons, preserves sequence, and removes support that is no longer needed. Undo remains available for schedule and practice changes.</p>
  </section>;
}
