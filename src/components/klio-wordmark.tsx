import Link from "next/link";

export function KlioWordmark() {
  return (
    <Link href="/" className="wordmark" aria-label="Klio home">
      <span className="wordmark-mark">K</span>
      <span>klio</span>
    </Link>
  );
}
