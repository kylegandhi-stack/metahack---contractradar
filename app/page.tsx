import { Suspense } from "react";
import { Dashboard } from "@/components/Dashboard";

// Sample (fixture) mode is opt-in via ?sample=1 so it is never shown silently.
async function DashboardFromParams({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const params = await searchParams;
  return <Dashboard sampleMode={params.sample === "1"} />;
}

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<div className="label p-6">Initializing Rauros Systems…</div>}>
      <DashboardFromParams searchParams={searchParams} />
    </Suspense>
  );
}
