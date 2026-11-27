/**
 * Facture PDF + partage WhatsApp (ADR — vente complète).
 *
 * - `buildInvoicePdf()` construit un PDF de facture (jspdf) a partir des
 *   coordonnees de la vente : etablissement, succursale, client, lignes,
 *   total, devise, vendeur.
 * - `shareInvoicePdf()` partage le PDF vers WhatsApp via la Web Share API
 *   (Android/iOS : ouverture du mode de partage du systeme, l'utilisateur
 *   choisit WhatsApp et le PDF est attache). Fallback : telechargement du
 *   PDF + ouverture de wa.me avec un message pre-rempli.
 *
 * Note : wa.me ne permet pas d'attacher un fichier via un lien ; la Web Share
 * API est la seule voie honnete pour envoyer le PDF par WhatsApp sans
 * compte API WhatsApp Business.
 */

import { jsPDF } from "jspdf";

export interface InvoiceLine {
  name: string;
  qty: number;
  unitPriceMinor: number;
}

export interface InvoiceData {
  orgName: string;
  branchName: string;
  customerName: string;
  customerPhone?: string | null;
  sellerName: string;
  currency: "USD" | "CDF";
  paymentMethod: string;
  lines: InvoiceLine[];
  totalMinor: number;
  saleId?: string;
  dateLabel: string;
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Payé en espèces",
  card: "Payé par carte",
  credit: "Crédit (à régler)",
  transfer: "Virement",
};

function formatMoney(minor: number, currency: "USD" | "CDF"): string {
  return `${new Intl.NumberFormat("fr-FR").format(minor)} ${currency}`;
}

/** Construit le blob PDF de la facture. */
export function buildInvoicePdf(data: InvoiceData): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  const right = pageW - margin;

  // En-tete : etablissement + facture.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(data.orgName, margin, margin);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text("FACTURE", right, margin, { align: "right" });

  doc.setTextColor(0);
  doc.setFontSize(10);
  const y = margin + 22;
  doc.text(`Succursal : ${data.branchName}`, margin, y);
  doc.text(`Date : ${data.dateLabel}`, margin, y + 14);
  if (data.saleId) doc.text(`Réf : ${data.saleId}`, margin, y + 28);
  doc.text(`Client : ${data.customerName}`, right, y, { align: "right" });
  if (data.customerPhone) {
    doc.text(`Tél : ${data.customerPhone}`, right, y + 14, { align: "right" });
  }
  doc.text(`Vendeur : ${data.sellerName}`, right, y + 28, { align: "right" });

  // Séparateur.
  doc.setDrawColor(200);
  doc.line(margin, y + 42, right, y + 42);

  // Tableau des lignes.
  let cursor = y + 60;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Article", margin, cursor);
  doc.text("Qté", margin + 160, cursor);
  doc.text("Prix unitaire", margin + 230, cursor);
  doc.text("Total", right, cursor, { align: "right" });

  cursor += 16;
  doc.setFont("helvetica", "normal");
  for (const line of data.lines) {
    // Découpage du nom si trop long.
    const nameLines = doc.splitTextToSize(line.name, 150);
    doc.text(nameLines[0] ?? line.name, margin, cursor);
    doc.text(String(line.qty), margin + 160, cursor);
    doc.text(formatMoney(line.unitPriceMinor, data.currency), margin + 230, cursor);
    doc.text(
      formatMoney(line.qty * line.unitPriceMinor, data.currency),
      right,
      cursor,
      { align: "right" },
    );
    if (nameLines.length > 1) cursor += 14;
    cursor += 16;
  }

  // Total.
  cursor += 8;
  doc.setDrawColor(200);
  doc.line(margin, cursor - 8, right, cursor - 8);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("TOTAL", margin, cursor);
  doc.text(formatMoney(data.totalMinor, data.currency), right, cursor, {
    align: "right",
  });

  // Paiement.
  cursor += 22;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(
    PAYMENT_LABELS[data.paymentMethod] ?? data.paymentMethod,
    margin,
    cursor,
  );

  // Pied.
  doc.setTextColor(110);
  doc.setFontSize(9);
  doc.text(
    "Merci de votre confiance. Cette facture a été générée par VANNY MANAGER PRO.",
    margin,
    doc.internal.pageSize.getHeight() - 30,
  );

  return doc.output("blob");
}

/**
 * Partage le PDF vers WhatsApp.
 * - Web Share API : ouvre le sélecteur de partage du système ; l'utilisateur
 *   choisit WhatsApp et le PDF est attaché (Android/iOS).
 * - Fallback : télécharge le PDF et ouvre wa.me avec un message pré-rempli.
 */
export async function shareInvoicePdf(
  pdf: Blob,
  phone: string | null | undefined,
  message: string,
): Promise<"shared" | "downloaded"> {
  const file = new File([pdf], "facture.pdf", { type: "application/pdf" });

  if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    navigator.canShare &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file], title: "Facture", text: message });
      return "shared";
    } catch {
      // L'utilisateur a annulé ou le partage a échoué → fallback.
    }
  }

  // Fallback : téléchargement + wa.me.
  const url = URL.createObjectURL(pdf);
  const a = document.createElement("a");
  a.href = url;
  a.download = "facture.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  if (phone) {
    const digits = phone.replace(/[^\d]/g, "");
    if (digits) {
      window.open(
        `https://wa.me/${digits}?text=${encodeURIComponent(message)}`,
        "_blank",
      );
    }
  }
  return "downloaded";
}
