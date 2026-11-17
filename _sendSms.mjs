// GSM 03.38 alphabet; extension characters take two septets.
const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
const GSM_EXTENSION = new Set("\f^{}\\[]~|€");

// Estimated number of SMS parts for `text`, and the first character that
// forces UCS-2 encoding (70 instead of 160 characters per SMS), if any.
export function smsSegments(text) {
  let septets = 0;
  for (const char of text) {
    if (GSM_BASIC.has(char)) {
      septets += 1;
    } else if (GSM_EXTENSION.has(char)) {
      septets += 2;
    } else {
      return {
        count: text.length <= 70 ? 1 : Math.ceil(text.length / 67),
        nonGsm: char,
      };
    }
  }
  return {
    count: septets <= 160 ? 1 : Math.ceil(septets / 153),
    nonGsm: undefined,
  };
}

// Sends an SMS through an SMS Gate (https://sms-gate.app) phone.
export async function sendSms(
  { url, username, password, timeout = 30e3 },
  phone,
  message,
) {
  let res, body;
  try {
    res = await fetch(url, {
      body: JSON.stringify({
        phoneNumbers: [phone],
        textMessage: { text: message },
      }),
      headers: {
        authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        "content-type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(timeout),
    });
    body = await res.text();
  } catch (error) {
    if (error.name === "TimeoutError") {
      throw new Error(`SMS gateway did not answer within ${timeout} ms`);
    }
    // fetch() only says "fetch failed", the reason is in `cause`.
    if (error.cause !== undefined) {
      throw new Error(`SMS gateway unreachable: ${error.cause.message}`);
    }
    throw error;
  }
  if (!res.ok) {
    throw new Error(`SMS gateway answered ${res.status}: ${body}`);
  }
}
