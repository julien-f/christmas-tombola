import hrp from "http-request-plus";
import qs from "node:querystring";

export async function sendSms({ hostname, password, port }, dst, msg) {
  const response = await hrp.post({
    body: qs.stringify({
      message: msg,
      password,
      phone: dst,
    }),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    hostname,
    port,
    path: "/sendSMS",
    protocol: "https",
    rejectUnauthorized: false,
  });
  response.resume();
}
