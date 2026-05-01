"use client";

import { useState } from "react";
import Link from "next/link";

type Profile = {
  id?: string;
  name?: string;
  address?: string;
  email?: string | null;
  phone?: string | null;
  registration?: string | null;
  taxId?: string | null;
  bankDetails?: string | null;
  logoPath?: string | null;
  currency?: string;
  taxRate?: number;
  notes?: string | null;
  isDefault?: boolean;
};

export default function ProfileForm({ profile, action }: { profile: Profile; action: (fd: FormData) => Promise<void> }) {
  const [logoPreview, setLogoPreview] = useState<string | null>(profile.logoPath ?? null);
  const [removed, setRemoved] = useState(false);

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="id" defaultValue={profile.id ?? ""} />

      <div className="card p-6 space-y-4">
        <h2 className="font-medium">Branding</h2>
        <div className="flex items-center gap-6">
          <div className="w-28 h-28 border border-gray-200 rounded bg-gray-50 flex items-center justify-center overflow-hidden">
            {logoPreview && !removed ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={logoPreview} alt="logo" className="w-full h-full object-contain" />
            ) : (
              <span className="text-xs text-gray-400">No logo</span>
            )}
          </div>
          <div className="space-y-2">
            <label className="btn cursor-pointer">
              Upload logo
              <input
                type="file"
                name="logo"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setRemoved(false);
                    setLogoPreview(URL.createObjectURL(f));
                  }
                }}
              />
            </label>
            {profile.logoPath && !removed && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => { setRemoved(true); setLogoPreview(null); }}
              >Remove logo</button>
            )}
            <input type="hidden" name="removeLogo" value={removed ? "1" : "0"} />
            <p className="text-xs text-gray-500">PNG, JPG, WEBP, or SVG. Max 2MB.</p>
          </div>
        </div>
      </div>

      <div className="card p-6 space-y-4">
        <h2 className="font-medium">Company details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Company name *</label>
            <input name="name" required className="input" defaultValue={profile.name ?? ""} />
          </div>
          <div>
            <label className="label">Email</label>
            <input name="email" className="input" defaultValue={profile.email ?? ""} />
          </div>
          <div className="md:col-span-2">
            <label className="label">Address</label>
            <textarea name="address" rows={3} className="input" defaultValue={profile.address ?? ""} />
          </div>
          <div>
            <label className="label">Phone</label>
            <input name="phone" className="input" defaultValue={profile.phone ?? ""} />
          </div>
          <div>
            <label className="label">Registration No.</label>
            <input name="registration" className="input" defaultValue={profile.registration ?? ""} />
          </div>
          <div>
            <label className="label">Tax / VAT ID</label>
            <input name="taxId" className="input" defaultValue={profile.taxId ?? ""} />
          </div>
          <div>
            <label className="label">Default tax rate (%)</label>
            <input name="taxRate" type="number" step="0.01" className="input" defaultValue={profile.taxRate ?? 0} />
          </div>
          <div>
            <label className="label">Currency</label>
            <input name="currency" className="input" defaultValue={profile.currency ?? "USD"} />
          </div>
          <div className="md:col-span-2">
            <label className="label">Bank / payment details</label>
            <textarea name="bankDetails" rows={3} className="input" defaultValue={profile.bankDetails ?? ""} />
          </div>
          <div className="md:col-span-2">
            <label className="label">Default footer notes</label>
            <textarea name="notes" rows={2} className="input" defaultValue={profile.notes ?? ""} />
          </div>
          <label className="md:col-span-2 inline-flex items-center gap-2 text-sm">
            <input type="checkbox" name="isDefault" defaultChecked={profile.isDefault ?? false} />
            Use as default profile for new documents
          </label>
        </div>
      </div>

      <div className="flex gap-2">
        <Link href="/settings" className="btn">Cancel</Link>
        <button className="btn btn-primary" type="submit">Save profile</button>
      </div>
    </form>
  );
}
