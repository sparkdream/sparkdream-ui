import type { Metadata } from "next";
import { defaults } from "@/lib/chain";
import ChainStatusSection from "@/components/status/ChainStatusSection";
import SiteStatusSection from "@/components/status/SiteStatusSection";

export const metadata: Metadata = {
  title: `Status — ${defaults.chainName}`,
  description: `Live checks of the services ${defaults.chainName} depends on.`,
};

export default function StatusPage() {
  return (
    <div className="sd-page" style={{ maxWidth: 760 }}>
      <header className="sd-page-header">
        <span className="crumb">System</span>
        <h1>Status</h1>
        <p>Live checks of the services this app depends on.</p>
      </header>
      <ChainStatusSection />
      <SiteStatusSection />
    </div>
  );
}
