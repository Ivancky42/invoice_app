import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import ClientForm from "../ClientForm";
import { saveClient } from "../actions";

export const dynamic = "force-dynamic";

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await prisma.clientProfile.findUnique({ where: { id } });
  if (!client) return notFound();
  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-semibold">Edit client</h1>
      <ClientForm client={client} action={saveClient} />
    </div>
  );
}
