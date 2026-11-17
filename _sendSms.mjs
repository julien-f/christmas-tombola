import { request } from "node:https";

const normalizeFingerprint = (fingerprint) =>
  fingerprint.replaceAll(":", "").toUpperCase();

// Sends an SMS through the gateway.
//
// The certificate is verified against the system CAs unless
// `fingerprint` (SHA-256) is set: then only that exact certificate is
// accepted, e.g. a self-signed one.
export function sendSms(
  { hostname, port, password, fingerprint },
  phone,
  message,
) {
  const body = new URLSearchParams({ message, password, phone }).toString();

  return new Promise((resolve, reject) => {
    const req = request(
      {
        // A fresh connection, so that the pinned certificate is checked.
        agent: false,
        headers: {
          "content-length": Buffer.byteLength(body),
          "content-type": "application/x-www-form-urlencoded",
        },
        hostname,
        method: "POST",
        path: "/sendSMS",
        port,
        rejectUnauthorized: fingerprint === undefined,
      },
      (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`SMS gateway answered ${res.statusCode}`));
        }
      },
    );
    req.on("error", reject);

    if (fingerprint === undefined) {
      req.end(body);
      return;
    }

    // The body holds the password: only sent once the certificate matches.
    req.on("socket", (socket) => {
      socket.once("secureConnect", () => {
        const actual = socket.getPeerCertificate().fingerprint256;
        if (
          actual !== undefined &&
          normalizeFingerprint(actual) === normalizeFingerprint(fingerprint)
        ) {
          req.end(body);
        } else {
          req.destroy(
            new Error(
              `SMS gateway certificate fingerprint mismatch: ${actual}`,
            ),
          );
        }
      });
    });
  });
}
