import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicCareerSite } from "@/lib/career-site-store";
import { CareerSiteView } from "./career-site-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const data = await getPublicCareerSite(params.slug);
  if (!data) return { title: "Careers" };
  const company = data.site.companyName || "Company";
  const description = (data.site.aboutText || `Explore open roles at ${company}.`).slice(0, 160);
  const title = `${company} Careers`;
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export default async function CareersPage({ params }: { params: { slug: string } }) {
  const data = await getPublicCareerSite(params.slug);
  if (!data) notFound();
  return (
    <div style={{ minHeight: "100vh", background: "#ffffff" }}>
      <CareerSiteView site={data.site} jobs={data.jobs} />
    </div>
  );
}
