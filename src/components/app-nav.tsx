import Link from "next/link";
import { Activity, BookMarked, CalendarDays, Home, Settings } from "lucide-react";
import { KlioWordmark } from "@/components/klio-wordmark";
import { signOutAction } from "@/app/login/actions";
import type { StudentDTO } from "@/lib/data/workspace";

const links = [
  { href: "/app", label: "Today", icon: Home },
  { href: "/app/records", label: "Evidence", icon: BookMarked },
  { href: "/app/plans", label: "Plans", icon: CalendarDays },
  { href: "/app/activity", label: "Activity", icon: Activity },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export function AppNav({ familyName, students, pending }: { familyName: string; students: StudentDTO[]; pending: number }) {
  return (
    <aside className="app-nav">
      <div>
        <KlioWordmark />
        <p className="nav-kicker">Workspace</p>
      </div>
      <nav aria-label="Workspace">
        {links.slice(0, 1).map(({ href, label, icon: Icon }) => (
          <Link href={href} key={href}>
            <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
          </Link>
        ))}
      </nav>
      {students.length ? <div className="nav-family"><p className="nav-kicker">Learners</p>{students.map((student) => <span key={student.id}><i>{student.displayName.charAt(0)}</i>{student.displayName}</span>)}</div> : null}
      <nav aria-label="Learning and records">
        <p className="nav-kicker">Learning</p>
        {links.slice(1).map(({ href, label, icon: Icon }) => (
          <Link href={href} key={`${href}-${label}`}>
            <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
            {label === "Activity" && pending > 0 ? <b>{pending}</b> : null}
          </Link>
        ))}
      </nav>
      <div className="nav-account"><span>{familyName.charAt(0)}</span><div><strong>{familyName}</strong><small>Family workspace</small></div></div>
      <form action={signOutAction}><button className="nav-signout">Sign out</button></form>
    </aside>
  );
}

export function MobileNav({ pending }: { pending: number }) {
  return (
    <nav className="mobile-nav">
      {links.slice(0, 4).map(({ href, label, icon: Icon }) => (
        <Link href={href} key={href}><Icon size={19} /><span>{label}</span>{label === "Activity" && pending ? <b>{pending}</b> : null}</Link>
      ))}
    </nav>
  );
}
