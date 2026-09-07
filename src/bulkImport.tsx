/**
 * Bulk import, in the clinic's own file format.
 *
 * Two phases on purpose. The upload is PREVIEWED first — parsed, validated and
 * classified row by row — and nothing is written until someone reads that
 * summary and presses the button. A 776-row service master with three typos
 * should import 773 rows and name the three, not fail wholesale and not import
 * silently.
 *
 * The preview also reports what the file does to the CATEGORY lists, because
 * that is the damage nobody notices until afterwards: Zenoti's own export has
 * "body countouring " and "Medical Treatment" / "Medical Treatments" side by
 * side, and importing those verbatim gives the panel three filters for one
 * category. Near-duplicates are shown before the commit, not discovered after.
 */
import { useRef, useState } from "react";
import { bulk } from "./lib/api";
import { download } from "./lib/http";
import type { BulkPreview, BulkResult, BulkTaxonomyLevel } from "./lib/types";
import { B, Btn, Modal, Note } from "./ui";

type Entity = "services" | "categories" | "products" | "packages";

function Taxonomy({ label, level }: { label: string; level: BulkTaxonomyLevel }) {
  if (!level.new.length && !level.nearDuplicates.length) {
    return <div className="text-[12px] text-ink3">{label}: all {level.existing} already exist — nothing new.</div>;
  }
  return (
    <div className="text-[12px]">
      <B>{label}</B>
      {level.new.length > 0 && (
        <div className="mt-1">
          <span className="text-ink3">{level.new.length} new: </span>
          {level.new.slice(0, 12).map((c) => `${c.value} (${c.rows})`).join(" · ")}
          {level.new.length > 12 ? ` … +${level.new.length - 12}` : ""}
        </div>
      )}
      {level.nearDuplicates.length > 0 && (
        <Note kind="crit" className="mt-1.5 mb-0">
          <B>{level.nearDuplicates.length} look like duplicates of ones you already have.</B> Importing
          them will split one category into two in every filter:
          <ul className="mt-1 list-disc pl-4">
            {level.nearDuplicates.slice(0, 8).map((d) => (
              <li key={d.value}>“{d.value}” ({d.rows} rows) vs existing “{d.existing}”</li>
            ))}
          </ul>
          Fix the spelling in the file and re-upload, or accept both.
        </Note>
      )}
    </div>
  );
}

export function BulkImport({
  open, onClose, entity, title, onDone, formatHint,
}: {
  open: boolean;
  onClose: () => void;
  entity: Entity;
  title: string;
  onDone: () => void;
  /** One line describing the columns, so nobody has to open the template to check. */
  formatHint?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [mode, setMode] = useState<"both" | "create" | "update">("both");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => { setFile(null); setPreview(null); setResult(null); setErr(null); if (fileRef.current) fileRef.current.value = ""; };
  const close = () => { reset(); onClose(); };

  const choose = async (f: File | null) => {
    setFile(f); setPreview(null); setResult(null); setErr(null);
    if (!f) return;
    setBusy(true);
    try { setPreview(await bulk.preview(entity, f)); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const r = await bulk.commit(entity, file, mode);
      setResult(r);
      onDone();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const willWrite = preview
    ? (mode === "create" ? preview.creates : mode === "update" ? preview.updates : preview.creates + preview.updates)
    : 0;

  return (
    <Modal open={open} onClose={close} title={title} wide>
      {!result && (
        <>
          <Note className="my-0">
            {formatHint ?? "Upload a CSV or Excel file."} Nothing is written until you press Import —
            the upload is checked first and you see exactly what will change.
          </Note>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="cursor-pointer rounded-(--radius-btn) border border-border bg-surface px-3.5 py-2 text-[12.5px] font-bold text-ink2">
              {file ? "Choose a different file" : "Choose file…"}
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
                onChange={(e) => choose(e.target.files?.[0] ?? null)} />
            </label>
            {file && <span className="text-[12px] text-ink3">{file.name}</span>}
            <Btn kind="ghost" onClick={() => download(bulk.downloadUrl(entity, "template"), `zennara-${entity}-template.csv`).catch((e) => setErr((e as Error).message))}>
              Download template
            </Btn>
          </div>

          {busy && !preview && <div className="mt-3 text-[12.5px] text-ink3">Reading the file…</div>}
          {err && <Note kind="crit" className="mt-3">{err}</Note>}

          {preview && (
            <div className="mt-3 grid gap-3">
              <div className="flex flex-wrap gap-4 rounded-(--radius-card) border border-border bg-ivory px-3.5 py-2.5 text-[12.5px]">
                <span><B>{preview.total}</B> rows read</span>
                <span className="text-ok"><B>{preview.creates}</B> new</span>
                <span className="text-info"><B>{preview.updates}</B> updates</span>
                <span className={preview.errors ? "text-err" : "text-ink3"}><B>{preview.errors}</B> with problems</span>
              </div>

              {preview.taxonomy && (
                <div className="grid gap-2 rounded-(--radius-card) border border-border p-3">
                  <Taxonomy label="Categories" level={preview.taxonomy.categories} />
                  {preview.taxonomy.subCategories && <Taxonomy label="Sub-categories" level={preview.taxonomy.subCategories} />}
                </div>
              )}

              {(preview.warnings ?? 0) > 0 && (
                <details className="text-[12px]" open>
                  <summary className="cursor-pointer font-semibold text-warn">
                    {preview.warnings} rows import, but something in them could not be matched
                  </summary>
                  <div className="mt-1 max-h-40 overflow-y-auto">
                    {preview.rows.filter((r) => r.warnings?.length).slice(0, 40).map((r) => (
                      <div key={r.row} className="border-t border-border/60 py-1">
                        Row {r.row}: <span className="text-warn">{r.warnings!.join("; ")}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {preview.errors > 0 && (
                <details className="text-[12px]">
                  <summary className="cursor-pointer font-semibold text-err">{preview.errors} rows will be skipped — see why</summary>
                  <div className="mt-1 max-h-48 overflow-y-auto">
                    {preview.rows.filter((r) => r.action === "error").slice(0, 60).map((r) => (
                      <div key={r.row} className="border-t border-border/60 py-1">
                        Row {r.row}: <span className="text-err">{r.errors.join("; ")}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className="text-ink3">Apply:</span>
                {([["both", "New and updates"], ["create", "New rows only"], ["update", "Updates only"]] as const).map(([v, l]) => (
                  <button key={v} onClick={() => setMode(v)}
                    className={`rounded-full px-3 py-1 text-[11.5px] font-bold ${mode === v ? "bg-primary text-white" : "border border-border bg-surface text-ink2"}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {result && (
        <div className="grid gap-2">
          <Note kind={result.failed ? "gold" : "ok"} className="my-0">
            Imported. <B>{result.created}</B> created, <B>{result.updated}</B> updated
            {result.failed ? <>, <B>{result.failed}</B> failed</> : ""}
            {result.skipped ? `, ${result.skipped} skipped` : ""}.
          </Note>
          {result.errors?.length > 0 && (
            <details className="text-[12px]" open>
              <summary className="cursor-pointer font-semibold">Rows that did not import</summary>
              <div className="mt-1 max-h-56 overflow-y-auto">
                {result.errors.slice(0, 80).map((e, i) => (
                  <div key={i} className="border-t border-border/60 py-1">
                    Row {e.row} {e.name ? `“${e.name}”` : ""}: <span className="text-err">{e.errors.join("; ")}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Btn kind="ghost" onClick={close}>{result ? "Done" : "Cancel"}</Btn>
        {!result && (
          <Btn disabled={busy || !preview || willWrite === 0} onClick={commit}>
            {busy ? "Importing…" : `Import ${willWrite} row${willWrite === 1 ? "" : "s"}`}
          </Btn>
        )}
      </div>
    </Modal>
  );
}
