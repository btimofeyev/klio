"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, BookOpenText, CalendarDays, Home, Settings, UsersRound } from "lucide-react";
import { KlioWordmark } from "@/components/klio-wordmark";
import { signOutAction } from "@/app/login/actions";
import type { StudentDTO } from "@/lib/data/workspace";

type NavProps = { familyName: string; students: StudentDTO[]; attentionCount: number };

export function AppNav({ familyName, attentionCount }: NavProps) {
  const pathname = usePathname();

  return (
    <aside className="app-nav parent-nav minimal-nav">
      <KlioWordmark />

      <nav aria-label="Klio workspace">
        <Link className={pathname === "/app" ? "active" : ""} href="/app"><Home size={19} strokeWidth={1.7} /><span>Home</span></Link>
        <Link className={pathname === "/app/activity" ? "active" : ""} href="/app/activity"><Bell size={19} strokeWidth={1.7} /><span>Attention</span>{attentionCount > 0 ? <b>{attentionCount}</b> : null}</Link>
        <Link className={pathname.startsWith("/app/settings/learners") || pathname === "/app/settings" ? "active" : ""} href="/app/settings"><UsersRound size={19} strokeWidth={1.7} /><span>Students</span></Link>
        <Link className={pathname === "/app/week" || pathname === "/app/assignments" ? "active" : ""} href="/app/week"><CalendarDays size={19} strokeWidth={1.7} /><span>Calendar</span></Link>
        <Link className={pathname === "/app/records" || pathname === "/app/review" ? "active" : ""} href="/app/records"><BookOpenText size={19} strokeWidth={1.7} /><span>Records</span></Link>
      </nav>

      <Link className={pathname === "/app/settings" ? "nav-account active" : "nav-account"} href="/app/settings" aria-label={`${familyName} settings`}><span>{familyName.charAt(0)}</span><Settings size={15} /></Link>
      <form action={signOutAction}><button className="nav-signout">Sign out</button></form>
    </aside>
  );
}

export function MobileNav({ familyName, attentionCount }: NavProps) {
  const pathname = usePathname();
  const links = [
    { href: "/app", label: "Home", icon: Home, active: pathname === "/app" },
    { href: "/app/activity", label: "Attention", icon: Bell, active: pathname === "/app/activity", count: attentionCount },
    { href: "/app/settings", label: "Students", icon: UsersRound, active: pathname.startsWith("/app/settings") },
    { href: "/app/week", label: "Calendar", icon: CalendarDays, active: pathname === "/app/week" || pathname === "/app/assignments" },
    { href: "/app/records", label: "Records", icon: BookOpenText, active: pathname === "/app/records" || pathname === "/app/review" },
  ];
  return (
    <nav className={`mobile-nav ${attentionCount > 0 ? "has-help" : ""}`} aria-label={`${familyName} navigation`}>
      {links.map(({ href, label, icon: Icon, active, ...item }) => <Link className={active ? "active" : ""} href={href} key={href}><Icon size={19} /><span>{label}</span>{"count" in item ? <b>{item.count}</b> : null}</Link>)}
    </nav>
  );
}
