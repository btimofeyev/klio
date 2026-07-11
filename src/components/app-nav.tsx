import Link from "next/link";
import { BookMarked, CalendarDays, ClipboardCheck, FolderOpen, Home, Inbox, Library, Settings } from "lucide-react";
import { KlioWordmark } from "@/components/klio-wordmark";
import { signOutAction } from "@/app/login/actions";
import type { StudentDTO } from "@/lib/data/workspace";

const workspaceLinks = [
  { href: "/app", label: "Home", icon: Home },
  { href: "/app/inbox", label: "Inbox", icon: Inbox },
];

const learningLinks = [
  { href: "/app/plans", label: "Plans", icon: CalendarDays },
  { href: "/app/evidence", label: "Evidence", icon: BookMarked },
  { href: "/app/portfolio", label: "Portfolio", icon: Library },
  { href: "/app/records", label: "Records", icon: FolderOpen },
  { href: "/app/activity", label: "Review", icon: ClipboardCheck },
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
        {workspaceLinks.map(({ href, label, icon: Icon }) => (
          <Link href={href} key={href}>
            <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
          </Link>
        ))}
      </nav>
      {students.length ? <div className="nav-family"><p className="nav-kicker">Learners</p>{students.map((student) => <Link href={`/app/records?student=${student.id}`} key={student.id}><i>{student.displayName.charAt(0)}</i>{student.displayName}</Link>)}</div> : null}
      <nav aria-label="Learning and records">
        <p className="nav-kicker">Learning</p>
        {learningLinks.map(({ href, label, icon: Icon }) => (
          <Link href={href} key={`${href}-${label}`}>
            <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
            {label === "Review" && pending > 0 ? <b>{pending}</b> : null}
          </Link>
        ))}
      </nav>
      <div className="nav-account"><span>{familyName.charAt(0)}</span><div><strong>{familyName}</strong><small>Family workspace</small></div></div>
      <form action={signOutAction}><button className="nav-signout">Sign out</button></form>
    </aside>
  );
}

export function MobileNav({ pending }: { pending: number }) {
  const mobileLinks = [workspaceLinks[0], workspaceLinks[1], learningLinks[0], learningLinks[4]];
  return (
    <nav className="mobile-nav">
      {mobileLinks.map(({ href, label, icon: Icon }) => (
        <Link href={href} key={href}><Icon size={19} /><span>{label}</span>{label === "Review" && pending ? <b>{pending}</b> : null}</Link>
      ))}
    </nav>
  );
}
