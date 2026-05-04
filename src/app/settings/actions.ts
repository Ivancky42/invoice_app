"use server";

import { prisma } from "@/lib/prisma";
import { removeStoredLogo, saveLogoFile } from "@/lib/logo-storage";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function saveProfile(formData: FormData) {
  const id = String(formData.get("id") || "");
  const data = {
    name: String(formData.get("name") || "").trim(),
    address: String(formData.get("address") || "").trim(),
    email: String(formData.get("email") || "") || null,
    phone: String(formData.get("phone") || "") || null,
    registration: String(formData.get("registration") || "") || null,
    taxId: String(formData.get("taxId") || "") || null,
    bankDetails: String(formData.get("bankDetails") || "") || null,
    currency: String(formData.get("currency") || "USD") || "USD",
    taxRate: parseFloat(String(formData.get("taxRate") || "0")) || 0,
    notes: String(formData.get("notes") || "") || null,
    isDefault: formData.get("isDefault") === "on",
  };

  if (!data.name) throw new Error("Name is required");

  const profile = id
    ? await prisma.companyProfile.update({ where: { id }, data })
    : await prisma.companyProfile.create({ data });

  const logoFile = formData.get("logo");
  if (logoFile instanceof File && logoFile.size > 0) {
    const existing = await prisma.companyProfile.findUnique({ where: { id: profile.id } });
    await removeStoredLogo(existing?.logoPath);
    const newPath = await saveLogoFile(logoFile, profile.id);
    await prisma.companyProfile.update({ where: { id: profile.id }, data: { logoPath: newPath } });
  }

  if (formData.get("removeLogo") === "1") {
    const existing = await prisma.companyProfile.findUnique({ where: { id: profile.id } });
    await removeStoredLogo(existing?.logoPath);
    await prisma.companyProfile.update({ where: { id: profile.id }, data: { logoPath: null } });
  }

  if (data.isDefault) {
    await prisma.companyProfile.updateMany({ where: { NOT: { id: profile.id } }, data: { isDefault: false } });
  } else {
    const anyDefault = await prisma.companyProfile.count({ where: { isDefault: true } });
    if (anyDefault === 0) {
      await prisma.companyProfile.update({ where: { id: profile.id }, data: { isDefault: true } });
    }
  }

  revalidatePath("/settings");
  revalidatePath("/");
  redirect("/settings");
}

export async function deleteProfile(formData: FormData) {
  const id = String(formData.get("id") || "");
  if (!id) return;
  const inUse = await prisma.document.count({ where: { companyId: id } });
  if (inUse > 0) throw new Error(`Cannot delete: ${inUse} document(s) use this profile.`);
  const existing = await prisma.companyProfile.findUnique({ where: { id } });
  await removeStoredLogo(existing?.logoPath);
  await prisma.companyProfile.delete({ where: { id } });
  if (existing?.isDefault) {
    const next = await prisma.companyProfile.findFirst({ orderBy: { createdAt: "asc" } });
    if (next) await prisma.companyProfile.update({ where: { id: next.id }, data: { isDefault: true } });
  }
  revalidatePath("/settings");
  redirect("/settings");
}

export async function setDefaultProfile(formData: FormData) {
  const id = String(formData.get("id") || "");
  if (!id) return;
  await prisma.companyProfile.updateMany({ data: { isDefault: false } });
  await prisma.companyProfile.update({ where: { id }, data: { isDefault: true } });
  revalidatePath("/settings");
  redirect("/settings");
}
