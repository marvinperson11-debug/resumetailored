import * as React from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../resumetailored-platform/messages/en.json";
import { LockedModuleBanner, TierUpgradeNote, QuotaBar, FirstTouchSnackbar, UpgradeCard } from "@/app/employer/components/ui";
import { EmployerSidebar } from "@/app/employer/components/employer-sidebar";
import { LockedFeature } from "@/components/locked-feature";
import { Select } from "@/app/candidate/components/ui";
import { OfficeClient } from "@/app/employer/office/office-client";
import { TeamClient } from "@/app/employer/team/team-client";
import { SettingsClient } from "@/app/employer/settings/settings-client";
import { PlanPreviewBanner } from "@/components/plan-preview-banner";
import { CandidateSidebar } from "@/components/candidate-sidebar";
import { ToolsProvider } from "@/app/candidate/components/tools-context";

const q = new URLSearchParams(location.search);
const c = q.get("case") || "";
const w = Number(q.get("w") || 1000);

const longName = "Charts, Spreadsheet Creator, Report Writer and Presentation Builder";
const profile: any = { companyName: "Acme", companyWebsite: "", industry: "", companyBio: "" };

function Case() {
  switch (c) {
    case "banner": return <LockedModuleBanner feature={longName} tier="Scale" />;
    case "upgradecard-free": return <UpgradeCard />;
    case "banner-portal": return <LockedModuleBanner featureKey="timeOff" tier="Portal" />;
    case "tiernote": return <TierUpgradeNote feature="Charts" tier="Scale" />;
    case "quota": return <QuotaBar kind="esign" used={7} limit={3} nextTierLabel="Portal" />;
    case "snackbar": return <FirstTouchSnackbar show feature="Charts" tier="Scale" onDismiss={() => {}} />;
    case "sidebar-free": return <EmployerSidebar company="Acme" isAdmin={false} planLabel="free" lockedHrefs={["/employer/office"]} quota={{ used: 7, limit: 3 }} />;
    case "sidebar-portal": return <EmployerSidebar company="Acme" isAdmin={false} planLabel="portal" lockedHrefs={[]} quota={{ used: 2, limit: 10 }} />;
    case "gate": return <LockedFeature feature="Employer Portal" variant="employer" />;
    case "select": return (
      <div style={{ width: w }}>
        <Select value="" onChange={() => {}}>
          <option value="">Use a saved resume</option>
          <option value="1">Senior Staff Machine Learning Platform Engineer — Resume (final) v12 copy</option>
          <option value="2">Marketing</option>
        </Select>
      </div>
    );
    case "office-free": return <OfficeClient canCharts={false} canSpreadsheet={false} canReport={false} canPresentation={false} canManage initialTab="calculators" />;
    case "office-scale": return <OfficeClient canCharts canSpreadsheet canReport canPresentation canManage initialTab="calculators" />;
    case "team": return <TeamClient canManage openInvite={false} seatLimit={1} />;
    case "settings-free": return <SettingsClient initial={profile} canManage tier="free" knownNames={[]} />;
    case "settings-scale": return <SettingsClient initial={profile} canManage tier="scale" knownNames={[]} />;
    case "preview": return <PlanPreviewBanner />;
    case "cand-free": return <ToolsProvider isPro={false}><CandidateSidebar role={{ plan: "free" }} /></ToolsProvider>;
    case "cand-pro": return <ToolsProvider isPro><CandidateSidebar role={{ plan: "pro" }} /></ToolsProvider>;
    default: return <p>unknown case</p>;
  }
}

(window as any).__ready = false;
const root = createRoot(document.getElementById("root")!);
root.render(
  <NextIntlClientProvider locale="en" messages={messages as any} timeZone="UTC">
    <div id="case" style={{ width: c === "select" ? undefined : w, maxWidth: "100%" }}><Case /></div>
  </NextIntlClientProvider>
);
setTimeout(() => { (window as any).__ready = true; }, 400);
