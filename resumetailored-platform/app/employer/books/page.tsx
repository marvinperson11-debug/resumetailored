import { auth } from "@clerk/nextjs/server";
import { getAccess, isEmployer } from "@/lib/plan";
import { canUseBooks, canUseFullBooks } from "@/lib/employer-plan";
import { BooksClient, type BooksTab } from "./books-client";

export const dynamic = "force-dynamic";

const VALID_TABS: BooksTab[] = ["entries", "invoices", "bank", "reports"];

export default async function BooksPage({ searchParams }: { searchParams: { tab?: string } }) {
  const { userId } = await auth();
  const access = await getAccess();
  const initialTab = VALID_TABS.find((t) => t === searchParams?.tab);
  return (
    <BooksClient
      locked={!canUseBooks(access)}
      canFull={canUseFullBooks(access)}
      canManage={!userId || isEmployer(access)}
      initialTab={initialTab}
    />
  );
}
