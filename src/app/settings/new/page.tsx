import ProfileForm from "../ProfileForm";
import { saveProfile } from "../actions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function NewProfilePage() {
  const count = await prisma.companyProfile.count();
  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-semibold">New company profile</h1>
      <ProfileForm profile={{ currency: "USD", taxRate: 0, isDefault: count === 0 }} action={saveProfile} />
    </div>
  );
}
