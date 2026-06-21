import { useId, useMemo, useState } from "react";
import { marked } from "marked";
import termsMd from "../legal/TERMS_OF_SERVICE.md?raw";
import dataPolicyMd from "../legal/DATA_POLICY.md?raw";
import { RAW_BASE_URL, buildCopyPrompt } from "../lib/aiTranslate";

interface LegalItemProps {
  title: string;
  markdown: string;
  /** Filename under src/legal/ used to build the public GitHub-raw URL. */
  rawFile: string;
  defaultOpen?: boolean;
}

function LegalTranslate({ title, markdown, rawUrl }: { title: string; markdown: string; rawUrl: string }) {
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");

  const { prompt } = useMemo(
    () => buildCopyPrompt(`BreakBPM legal document ("${title}")`, rawUrl, markdown),
    [title, rawUrl, markdown],
  );

  async function handleCopyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyState("ok");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("fail");
      window.setTimeout(() => setCopyState("idle"), 4000);
    }
  }

  return (
    <div className="legal-translate">
      <div className="legal-translate-title">🌐 TLDR; Translation</div>
      <div className="legal-translate-actions">
        <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={handleCopyPrompt}>
          {copyState === "ok" ? "✓ Copied" : "🤖 Copy Prompt"}
        </button>
      </div>
      {copyState === "fail" && (
        <p className="legal-translate-note" style={{ color: "#800000" }}>
          Couldn't copy automatically — select the text below and copy it manually.
        </p>
      )}
      <p className="legal-translate-note">
        AI translation is for convenience only — the English version governs.
      </p>
    </div>
  );
}

function LegalItem({ title, markdown, rawFile, defaultOpen = false }: LegalItemProps) {
  const [open, setOpen] = useState(defaultOpen);
  const html = useMemo(() => marked(markdown) as string, [markdown]);
  const contentId = useId();
  const rawUrl = `${RAW_BASE_URL}legal/${rawFile}`;

  return (
    <div className="legal-item">
      <button
        type="button"
        className="legal-trigger"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="legal-trigger-arrow" aria-hidden="true">
          {open ? "▼" : "▶"}
        </span>
        <span className="legal-trigger-label">{title}</span>
      </button>
      {open && (
        <div className="legal-content" id={contentId} role="region" aria-label={title}>
          <LegalTranslate title={title} markdown={markdown} rawUrl={rawUrl} />
          <div
            className="about-markdown legal-markdown"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      )}
    </div>
  );
}

export default function LegalDisclosure({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <div className="legal-disclosure panel">
      <div className="legal-disclosure-heading">LEGAL</div>
      <LegalItem
        title="Terms of Service"
        markdown={termsMd}
        rawFile="TERMS_OF_SERVICE.md"
        defaultOpen={defaultOpen}
      />
      <LegalItem
        title="Data Policy"
        markdown={dataPolicyMd}
        rawFile="DATA_POLICY.md"
        defaultOpen={defaultOpen}
      />
    </div>
  );
}
