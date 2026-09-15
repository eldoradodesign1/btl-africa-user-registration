import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

type CopyablePhoneProps = {
  value: string;
  children?: ReactNode;
  className?: string;
};

/**
 * Affiche un numéro de téléphone cliquable qui se copie dans le presse-papier.
 */
export function CopyablePhone({ value, children, className = "" }: CopyablePhoneProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      className={`copyable-phone ${copied ? "is-copied" : ""} ${className}`}
      onClick={(event) => {
        event.stopPropagation();
        void handleCopy();
      }}
      title={`Copier ${value}`}
      aria-label={`Copier le numéro ${value}`}
    >
      <span>{children ?? value}</span>
      {copied ? <Check size={11} /> : <Copy size={11} className="copy-icon" />}
    </button>
  );
}
