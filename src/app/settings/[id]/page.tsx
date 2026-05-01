import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import ProfileForm from "../ProfileForm";
import { saveProfile } from "../actions";

export const dynamic = "force-dynamic";

export default async function EditProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await prisma.companyProfile.findUnique({ where: { id } });
  if (!profile) return notFound();
  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-semibold">Edit profile</h1>
      <ProfileForm profile={profile} action={saveProfile} />
    </div>
  );
}
