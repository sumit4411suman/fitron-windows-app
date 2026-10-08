import "server-only";
import QRCode from "qrcode";

/** A text (an authenticator setup link, say) as an SVG QR code, safe to inline. */
export const qrSvg = (text: string) => QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
