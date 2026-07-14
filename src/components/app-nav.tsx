"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CalendarDays, CalendarRange, ClipboardCheck, Home, ListChecks, Settings } from "lucide-react";
import { KlioWordmark } from "@/components/klio-wordmark";
import { signOutAction } from "@/app/login/actions";
import type { StudentDTO } from "@/lib/data/workspace";

type NavProps = { familyName: string; students: StudentDTO[]; attentionCount: number };

export function AppNav({ familyName, students, attentionCount }: NavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedStudent = searchParams.get("student");

  return (
    <aside className="app-nav parent-nav">
      <KlioWordmark />

      <nav aria-label="Klio workspace">
        <Link className={pathname === "/app" ? "active" : ""} href="/app"><Home size={17} strokeWidth={1.8} /><span>Today</span></Link>
        <Link className={pathname === "/app/week" ? "active" : ""} href="/app/week"><CalendarDays size={17} strokeWidth={1.8} /><span>This week</span></Link>
        <Link className={pathname === "/app/assignments" ? "active" : ""} href="/app/assignments"><ListChecks size={17} strokeWidth={1.8} /><span>Curriculum</span></Link>
        <Link className={pathname === "/app/review" ? "active" : ""} href="/app/review"><ClipboardCheck size={17} strokeWidth={1.8} /><span>Review & grades</span>{attentionCount > 0 ? <b>{attentionCount}</b> : null}</Link>
      </nav>

      {students.length ? <div className="nav-family"><p className="nav-kicker">Learners</p>{students.map((student) => <Link className={pathname === "/app/records" && selectedStudent === student.id ? "active" : ""} href={`/app/records?student=${student.id}`} key={student.id}><i>{student.displayName.charAt(0)}</i><span>{student.displayName}</span></Link>)}</div> : null}

      <div className="nav-attention"><Link className={pathname === "/app/records" ? "active" : ""} href="/app/records"><CalendarRange size={17} strokeWidth={1.8} /><span>Learning record</span></Link></div>

      <Link className={pathname === "/app/settings" ? "nav-account active" : "nav-account"} href="/app/settings"><span>{familyName.charAt(0)}</span><div><strong>Family account</strong><small>{familyName}</small></div><Settings size={15} /></Link>
      <form action={signOutAction}><button className="nav-signout">Sign out</button></form>
    </aside>
  );
}

export function MobileNav({ familyName, attentionCount }: NavProps) {
  const pathname = usePathname();
  const links = [
    { href: "/app", label: "Today", icon: Home, active: pathname === "/app" },
    { href: "/app/week", label: "Week", icon: CalendarDays, active: pathname === "/app/week" },
    { href: "/app/review", label: "Review", icon: ClipboardCheck, active: pathname === "/app/review", count: attentionCount },
    { href: "/app/records", label: "Records", icon: CalendarRange, active: pathname === "/app/records" },
  ];
  return (
    <nav className={`mobile-nav ${attentionCount > 0 ? "has-help" : ""}`} aria-label={`${familyName} navigation`}>
      {links.map(({ href, label, icon: Icon, active, ...item }) => <Link className={active ? "active" : ""} href={href} key={href}><Icon size={19} /><span>{label}</span>{"count" in item ? <b>{item.count}</b> : null}</Link>)}
    </nav>
  );
}
