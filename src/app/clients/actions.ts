"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function saveClient(formData: FormData) {
  const id = String(formData.get("id") || "");
  const data = {
    name: String(formData.get("name") || "").trim(),
    address: String(formData.get("address") || "") || null,
    email: String(formData.get("email") || "") || null,
    phone: String(formData.get("phone") || "") || null,
    shipToAttn: String(formData.get("shipToAttn") || "") || null,
    shipToAddress: String(formData.get("shipToAddress") || "") || null,
  };

  if (!data.name) throw new Error("Name is required");

  if (id) {
    await prisma.clientProfile.update({ where: { id }, data });
  } else {
    await prisma.clientProfile.create({ data });
  }

  revalidatePath("/clients");
  revalidatePath("/documents/new");
  redirect("/clients");
}

export async function deleteClient(formData: FormData) {
  const id = String(formData.get("id") || "");
  if (!id) return;
  const inUse = await prisma.document.count({ where: { clientId: id } });
  if (inUse > 0) throw new Error(`Cannot delete: ${inUse} document(s) use this client.`);
  await prisma.clientProfile.delete({ where: { id } });
  revalidatePath("/clients");
  redirect("/clients");
}
