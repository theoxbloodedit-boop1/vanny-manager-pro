/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Bluetooth thermal printer (mini imprimante de vente) via the Web Bluetooth
 * API. Used by the point-of-sale screen so a seller can connect a small
 * receipt printer and print a sale ticket — entirely from the phone/browser.
 *
 * Prints ESC/POS commands, the standard for the vast majority of mini
 * thermal printers (Xprinter, Zjiang, etc.). The printer is discovered by
 * Bluetooth and connected through its GATT printer service.
 *
 * NOTE: Web Bluetooth requires a secure context (HTTPS / localhost) and a
 * Chromium-based browser (Chrome, Edge, …) on the device. The connection
 * is requested in response to a user gesture (the connect button).
 */

// GATT service used by most thermal printers (Imprimante / POS).
const PRINTER_SERVICE = "000018f0-0000-1000-8000-00805f9b34fb";
// Write characteristic (write with response). Some printers only expose
// write-without-response; we try both and fall back gracefully.
const WRITE_CHAR = "00002af1-0000-1000-8000-00805f9b34fb";
const WRITE_NO_RESP_CHAR = "00002af2-0000-1000-8000-00805f9b34fb";

export interface PrinterDevice {
  device: any;
  server: any;
  characteristic: any;
}

/** Request a Bluetooth device and connect to its printer service. */
export async function connectPrinter(): Promise<PrinterDevice> {
  if (typeof navigator === "undefined" || !("bluetooth" in navigator)) {
    throw new Error(
      "Web Bluetooth n’est pas supporté sur ce navigateur. Utilisez Chrome/Edge sur Android.",
    );
  }

  const device = await (navigator as any).bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [PRINTER_SERVICE],
  });

  const server = await device.gatt.connect();
  const services = await server.getPrimaryServices();

  // Find the printer service + a writable characteristic.
  let printerService = null;
  for (const svc of services) {
    if (svc.uuid.toLowerCase() === PRINTER_SERVICE) {
      printerService = svc;
      break;
    }
  }
  if (!printerService) {
    printerService = services[0];
  }

  const characteristics = await printerService.getCharacteristics();
  let characteristic = characteristics.find((c: any) =>
    [WRITE_CHAR, WRITE_NO_RESP_CHAR].includes(c.uuid.toLowerCase()),
  );
  if (!characteristic) {
    // Fallback: any characteristic that supports write.
    characteristic = characteristics.find((c: any) =>
      (c.properties?.write || c.properties?.writeWithoutResponse),
    );
  }
  if (!characteristic) {
    await device.gatt.disconnect();
    throw new Error("Aucune caractéristique d’écriture trouvée sur l’imprimante.");
  }

  return { device, server, characteristic };
}

/** Disconnect the printer. */
export async function disconnectPrinter(printer: PrinterDevice | null): Promise<void> {
  if (printer?.device?.gatt?.connected) {
    await printer.device.gatt.disconnect();
  }
}

/** Send raw bytes to the printer. */
async function writeBytes(printer: PrinterDevice, bytes: Uint8Array): Promise<void> {
  await printer.characteristic.writeValueWithoutResponse(bytes);
}

/** Encode a string to UTF-8 bytes. */
function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Render a sale ticket to ESC/POS bytes and print it.
 * `lines` are already-formatted strings (see buildTicket).
 */
export async function printTicket(
  printer: PrinterDevice,
  title: string,
  lines: string[],
): Promise<void> {
  const out: Uint8Array[] = [];

  // Initialize printer, center-align, bold title.
  out.push(encode("\x1b\x40")); // reset
  out.push(encode("\x1b\x61\x01")); // center
  out.push(encode("\x1b\x45\x01")); // bold on
  out.push(encode(title + "\n"));
  out.push(encode("\x1b\x45\x00")); // bold off
  out.push(encode("\x1b\x61\x00")); // left

  for (const line of lines) {
    out.push(encode(line + "\n"));
  }

  // Feed + cut.
  out.push(encode("\x1b\x64\x03")); // feed 3 lines
  out.push(new Uint8Array([0x1d, 0x56, 0x00])); // cut

  for (const chunk of out) {
    await writeBytes(printer, chunk);
  }
}

/**
 * Build the ticket lines for a sale (pure formatting, no Bluetooth).
 * Exported so the UI can preview the ticket before printing.
 */
export function buildTicket(opts: {
  orgName: string;
  branchName: string;
  dateLabel: string;
  items: { name: string; qty: number; unitPrice: string; total: string }[];
  total: string;
  payment: string;
  seller: string;
}): string[] {
  const { orgName, branchName, dateLabel, items, total, payment, seller } = opts;
  const sep = "--------------------------";
  const lines: string[] = [
    sep,
    orgName,
    branchName,
    dateLabel,
    sep,
  ];
  for (const it of items) {
    lines.push(`${it.name}  ${it.qty} x ${it.unitPrice}`);
    lines.push(`                    ${it.total}`);
  }
  lines.push(sep);
  lines.push(`TOTAL                 ${total}`);
  lines.push(`PAIEMENT              ${payment}`);
  lines.push(sep);
  lines.push(`Vendeur : ${seller}`);
  lines.push("Merci de votre visite !");
  return lines;
}
