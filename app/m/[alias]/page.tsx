import { notFound, redirect } from "next/navigation";

import { resolveManageLinkAlias } from "@/lib/manage-link-alias";

export const dynamic = "force-dynamic";

type ManageAliasPageProps = {
  params: Promise<{ alias: string }>;
};

export default async function ManageAliasPage({ params }: ManageAliasPageProps) {
  const { alias } = await params;

  try {
    const record = resolveManageLinkAlias(alias);
    if (!record) {
      notFound();
    }

    redirect(`/manage/${record.token}`);
  } catch (error) {
    console.error("[manage-alias] Failed to resolve alias", error);
    notFound();
  }
}


