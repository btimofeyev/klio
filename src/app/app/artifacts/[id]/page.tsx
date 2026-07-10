import { notFound } from "next/navigation";
import { ArtifactView } from "@/components/artifact-view";
import { getArtifact } from "@/lib/data/artifact";

export default async function ArtifactPage({ params }: { params: Promise<{ id: string }> }) {
  const artifact = await getArtifact((await params).id);
  if (!artifact) notFound();
  return <div className="document-page"><ArtifactView artifact={artifact} /></div>;
}
