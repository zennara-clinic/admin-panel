import { useEffect, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { useStore } from "../store";
import { Btn, Card, In, Page } from "../ui";
import api from "../lib/api";
import { initials } from "../lib/format";

/**
 * The signed-in person's own account: photo, name, phone. Email is the
 * sign-in address and changes through its own flow, so it is shown, not
 * edited. Saves go to PUT /admin/auth/me and the session is refreshed in
 * place, so the top-bar avatar updates without signing out.
 */
export function MyProfile() {
  const { admin, branches, updateAdmin, toast } = useStore();
  const [name, setName] = useState(admin?.name ?? "");
  const [phone, setPhone] = useState(admin?.phone ?? "");
  const [photo, setPhoto] = useState<string | null>(admin?.photo ?? null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(admin?.name ?? ""); setPhone(admin?.phone ?? ""); setPhoto(admin?.photo ?? null);
  }, [admin?._id]);

  const dirty = name.trim() !== (admin?.name ?? "") || (phone.trim() || "") !== (admin?.phone ?? "") || (photo ?? null) !== (admin?.photo ?? null);
  const centres = (admin?.branchIds ?? []).map((id) => branches.find((b) => b._id === id)?.name).filter(Boolean).join(", ");

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setErr("Choose an image file"); return; }
    if (file.size > 8 * 1024 * 1024) { setErr("Keep the photo under 8 MB"); return; }
    setUploading(true); setErr(null);
    try {
      const r = await api.media.upload([file]);
      const url = r?.[0]?.url;
      if (!url) throw new Error("Upload failed");
      setPhoto(url);
    } catch (ex) { setErr((ex as Error).message); } finally { setUploading(false); }
  };

  const save = async () => {
    if (name.trim().length < 2) { setErr("Enter your name"); return; }
    setBusy(true); setErr(null);
    try {
      const next = await api.auth.updateMe({ name: name.trim(), phone: phone.trim() || null, photo });
      updateAdmin(next);
      toast("Profile saved");
    } catch (ex) { setErr((ex as Error).message); } finally { setBusy(false); }
  };

  if (!admin) return null;

  return (
    <Page title="My profile" sub="How you appear across the panel">
      <div className="mx-auto w-full max-w-[560px]">
        <Card className="p-6">
          <div className="flex items-center gap-5">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
              className="group relative grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-[26px] font-bold text-white"
              title="Change photo">
              {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : initials(admin.name || admin.email)}
              <span className="absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                {uploading ? <Loader2 className="h-5 w-5 animate-spin text-white" /> : <Camera className="h-5 w-5 text-white" />}
              </span>
            </button>
            <div className="min-w-0">
              <div className="truncate text-[16px] font-extrabold text-ink">{admin.name || admin.email}</div>
              <div className="mt-0.5 text-[12.5px] text-ink3">{admin.roleName || admin.role}{centres ? ` · ${centres}` : ""}</div>
              <div className="mt-3 flex items-center gap-3 text-[12.5px]">
                <button className="font-semibold text-primary hover:underline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? "Uploading…" : photo ? "Change photo" : "Upload photo"}
                </button>
                {photo && <button className="font-semibold text-ink3 hover:text-err" onClick={() => setPhoto(null)}>Remove</button>}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void pick(f); }} />
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <In label="Name" value={name} onChange={setName} placeholder="Your name" />
            <In label="Phone" value={phone} onChange={setPhone} placeholder="10-digit mobile" />
            <In label="Email" value={admin.email} onChange={() => undefined} readOnly full
              hint="Your sign-in address. Ask an administrator to change it." />
          </div>

          {err && <p role="alert" className="mt-3 text-[12.5px] font-semibold text-err">{err}</p>}

          <div className="mt-6 flex items-center justify-end gap-2">
            <Btn kind="ghost" disabled={!dirty || busy}
              onClick={() => { setName(admin.name ?? ""); setPhone(admin.phone ?? ""); setPhoto(admin.photo ?? null); setErr(null); }}>
              Reset
            </Btn>
            <Btn disabled={!dirty || busy || uploading} onClick={save}>{busy ? "Saving…" : "Save changes"}</Btn>
          </div>
        </Card>
      </div>
    </Page>
  );
}
