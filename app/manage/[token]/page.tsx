import { headers } from "next/headers";

import {
  fetchManageData,
  type ManagePageProps,
} from "../shared";
import { ManagementDetails, ManagementError } from "../components";

export const revalidate = 0;

export default async function ManagePage({ params }: ManagePageProps) {
  const { token } = await params;
  const headerList = await headers();
  const { payload, statusCode } = await fetchManageData(token, headerList);

  if (!payload) {
    return (
      <ManagementError
        response={{
          status: "error",
          message: "We were unable to load this management link. Please try again later.",
        }}
        statusCode={statusCode}
      />
    );
  }

  if (payload.status !== "ok") {
    return <ManagementError response={payload} statusCode={statusCode} />;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center gap-10 px-6 py-16">
      <ManagementDetails
        payload={payload}
        badgeText="Manage"
        heading="Manage your meeting"
        description="Review the details below or use the quick actions to reschedule or cancel your meeting."
      />
    </main>
  );
}


