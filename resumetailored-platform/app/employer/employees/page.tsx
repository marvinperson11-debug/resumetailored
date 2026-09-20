import { getAccess, isEmployer } from "@/lib/plan";
import { EmployeesClient } from "./employees-client";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  const access = await getAccess();
  return <EmployeesClient canManage={isEmployer(access)} />;
}
