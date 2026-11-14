import type { Metadata } from "next";
import { defaults } from "@/lib/chain";
import PrivacySettings from "@/components/settings/PrivacySettings";

export const metadata: Metadata = {
  title: `Settings — ${defaults.chainName}`,
  description: `How ${defaults.chainName} behaves in this browser.`,
};

export default function SettingsPage() {
  return (
    <div className="sd-page" style={{ maxWidth: 760 }}>
      <header className="sd-page-header">
        <span className="crumb">System</span>
        <h1>Settings</h1>
        <p>How the app behaves in this browser. These choices are saved here, not onchain, and work without a wallet.</p>
      </header>
      <PrivacySettings />
    </div>
  );
}
