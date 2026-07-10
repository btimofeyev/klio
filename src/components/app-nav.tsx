import Link from "next/link";
import { Activity, BookMarked, CalendarDays, Inbox, Settings } from "lucide-react";
import { KlioWordmark } from "@/components/klio-wordmark";
import { signOutAction } from "@/app/login/actions";

const links = [
  { href: "/app", label: "Inbox", icon: Inbox },
  { href: "/app/records", label: "Records", icon: BookMarked },
  { href: "/app/plans", label: "Plans", icon: CalendarDays },
  { href: "/app/activity", label: "Activity", icon: Activity },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export function AppNav({ familyName, pending }: { familyName: string; pending: number }) {
  return (
    <aside className="app-nav">
      <div>
        <KlioWordmark />
        <p className="workspace-name">{familyName}</p>
      </div>
      <nav>
        {links.map(({ href, label, icon: Icon }) => (
          <Link href={href} key={href}>
            <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
            {label === "Activity" && pending > 0 ? <b>{pending}</b> : null}
          </Link>
        ))}
      </nav>
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
