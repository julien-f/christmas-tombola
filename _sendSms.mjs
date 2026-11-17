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
    throw error;
  }
  if (!res.ok) {
    throw new Error(`SMS gateway answered ${res.status}: ${body}`);
  }
}
