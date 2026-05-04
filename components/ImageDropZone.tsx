"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Image input that prefers paste / drop and keeps the file picker tucked
 * behind a separate explicit button. Clicking the dropzone itself does
 * nothing (so paste-Ctrl-V is the obvious next move). Use as:
 *
 *   <ImageDropZone onFile={(file) => …} hint="Drop or paste a logo" />
 */
export function ImageDropZone({
  onFile,
  accept = "image/jpeg,image/png,image/heic,image/heif,image/webp,image/svg+xml",
  hint,
  subhint,
  pasteEnabled = true,
  compact = false,
}: {
  onFile: (file: File) => void;
  accept?: string;
  hint?: React.ReactNode;
  subhint?: React.ReactNode;
  pasteEnabled?: boolean;
  /** Smaller padding/text for use in dense forms. */
  compact?: boolean;
}) {
  const [drag, setDrag] = useState(false);
  const [pasted, setPasted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!pasteEnabled) return;
    function handlePaste(e: ClipboardEvent) {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind !== "file" || !it.type.startsWith("image/")) continue;
        const blob = it.getAsFile();
        if (!blob) continue;
        e.preventDefault();
        const ext = it.type.split("/")[1] ?? "png";
        setPasted(true);
        onFile(
          new File([blob], `clipboard-${Date.now()}.${ext}`, {
            type: it.type,
          })
        );
        return;
      }
    }
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [onFile, pasteEnabled]);

  const padding = compact ? "p-4" : "p-8";
  const hintSize = compact ? "text-sm" : "text-base";

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-center transition-colors ${padding} ${
        drag
          ? "border-stone-900 bg-stone-100"
          : "border-stone-300 bg-white"
      }`}
    >
      <span className={`font-medium ${hintSize}`}>
        {hint ?? <>Drop or paste an image</>}
      </span>
      <span className="text-xs text-stone-500">
        {subhint ?? (
          <>
            Paste with <Kbd>Ctrl</Kbd>+<Kbd>V</Kbd> ({" "}
            <Kbd>⌘</Kbd>+<Kbd>V</Kbd> on Mac), drag a file in, or
          </>
        )}
      </span>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          // Reset so re-selecting the same file fires onChange again.
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          fileInputRef.current?.click();
        }}
        className="rounded border border-stone-300 bg-white px-3 py-1 text-xs hover:bg-stone-50"
      >
        Choose file
      </button>
      {pasted && (
        <span className="text-xs text-green-700">Pasted from clipboard.</span>
      )}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-stone-300 bg-stone-100 px-1 font-mono text-[11px]">
      {children}
    </kbd>
  );
}
