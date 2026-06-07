import { useId, useMemo, useState } from "react";
import { marked } from "marked";
import termsMd from "../legal/TERMS_OF_SERVICE.md?raw";
import dataPolicyMd from "../legal/DATA_POLICY.md?raw";

interface LegalItemProps {
  title: string;
  markdown: string;
}

function LegalItem({ title, markdown }: LegalItemProps) {
  const [open, setOpen] = useState(false);
  const html = useMemo(() => marked(markdown) as string, [markdown]);
  const contentId = useId();

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
          <div
            className="about-markdown legal-markdown"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      )}
    </div>
  );
}

export default function LegalDisclosure() {
  return (
    <div className="legal-disclosure panel">
      <div className="legal-disclosure-heading">LEGAL</div>
      <LegalItem title="Terms of Service" markdown={termsMd} />
      <LegalItem title="Data Policy" markdown={dataPolicyMd} />
    </div>
  );
}
