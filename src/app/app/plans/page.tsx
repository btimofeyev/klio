import Link from "next/link";
import { CalendarDays, CheckCircle2, Circle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/data/workspace";
import { togglePlanItemAction } from "../actions";

export default async function PlansPage() {
  const workspace = await getWorkspace();
  if (!workspace) return null;
  const supabase = await createClient();
  const { data: plans } = await supabase.from("artifacts").select("id, title, summary, status, created_at, weekly_plan_items(id, title, description, scheduled_date, estimated_minutes, subject, completed_at, position)").eq("family_id", workspace.family.id).eq("type", "weekly_plan").order("created_at", { ascending: false });
  return (
    <div className="section-page">
      <header><p className="eyebrow">Rhythm, not rigidity</p><h1>Plans</h1><p>Approved plans are working documents. Mark the day as it really happens.</p></header>
      {!plans?.length ? <div className="large-empty"><CalendarDays size={30} /><h2>No plans yet</h2><p>Select recent evidence in the Inbox and ask Klio to plan the week.</p><Link className="primary-button" href="/app">Go to Inbox</Link></div> : plans.map((plan) => (
        <section className="plan-document" key={plan.id}><header><div><span>{new Date(plan.created_at).toLocaleDateString()}</span><h2><Link href={`/app/artifacts/${plan.id}`}>{plan.title}</Link></h2><p>{plan.summary}</p></div><b className={`record-state ${plan.status}`}>{plan.status}</b></header>
          <div className="plan-items">{plan.weekly_plan_items.sort((a, b) => a.position - b.position).map((item) => (
            <form action={togglePlanItemAction} className="plan-item" key={item.id}><input type="hidden" name="id" value={item.id} /><input type="hidden" name="completed" value={item.completed_at ? "false" : "true"} />
              <button aria-label={item.completed_at ? "Mark incomplete" : "Mark complete"}>{item.completed_at ? <CheckCircle2 size={20} /> : <Circle size={20} />}</button>
              <div><strong>{item.title}</strong><span>{item.scheduled_date ? new Date(`${item.scheduled_date}T12:00:00`).toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" }) : "Any day"}{item.estimated_minutes ? ` · ${item.estimated_minutes} min` : ""}{item.subject ? ` · ${item.subject}` : ""}</span><p>{item.description}</p></div>
            </form>
          ))}</div>
        </section>
      ))}
    </div>
  );
}
