import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";

import { sendSms, smsSegments } from "./_sendSms.mjs";

describe("smsSegments", () => {
  it("counts GSM-7 messages: 160 characters, then 153 per part", () => {
    assert.deepEqual(smsSegments("Hello"), { count: 1, nonGsm: undefined });
    assert.equal(smsSegments("é".repeat(160)).count, 1);
    assert.equal(smsSegments("a".repeat(161)).count, 2);
    assert.equal(smsSegments("a".repeat(306)).count, 2);
    assert.equal(smsSegments("a".repeat(307)).count, 3);
  });

  it("counts extension characters twice", () => {
    assert.equal(smsSegments("€".repeat(80)).count, 1);
    assert.equal(smsSegments("[".repeat(81)).count, 2);
  });

  it("counts other messages in UTF-16 units: 70, then 67 per part", () => {
    assert.deepEqual(smsSegments("ç"), { count: 1, nonGsm: "ç" });
    assert.equal(smsSegments("ç" + "a".repeat(69)).count, 1);
    assert.equal(smsSegments("ç" + "a".repeat(70)).count, 2);
    assert.deepEqual(smsSegments("a😀".repeat(24)), { count: 2, nonGsm: "😀" });
  });
});

describe("sendSms", () => {
  let server, config;
  let requests = [];
  let status = 202;
  let responseBody = "";

  before(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        requests.push({
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          contentType: req.headers["content-type"],
          body: JSON.parse(body),
        });
        // No status: never answer.
        if (status !== undefined) {
          res.statusCode = status;
          res.end(responseBody);
        }
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    config = {
      url: `http://127.0.0.1:${server.address().port}/message`,
      username: "sms",
      password: "secret",
    };
  });

  after(() => {
    server.closeAllConnections();
    server.close();
  });

  beforeEach(() => {
    requests = [];
    status = 202;
    responseBody = "";
  });

  it("posts the message with basic auth", async () => {
    await sendSms(config, "+15550001", "Hi & bye");
    assert.deepEqual(requests, [
      {
        method: "POST",
        url: "/message",
        authorization: `Basic ${Buffer.from("sms:secret").toString("base64")}`,
        contentType: "application/json",
        body: {
          phoneNumbers: ["+15550001"],
          textMessage: { text: "Hi & bye" },
        },
      },
    ]);
  });

  it("fails when the gateway does not answer in time", async () => {
    status = undefined;
    await assert.rejects(
      sendSms({ ...config, timeout: 50 }, "+15550001", "Hi"),
      /did not answer within 50 ms/,
    );
  });

  it("fails with the reason when the gateway is unreachable", async () => {
    await assert.rejects(
      sendSms({ ...config, url: "http://127.0.0.1:0/" }, "+15550001", "Hi"),
      /ECONNREFUSED/,
    );
  });

  it("fails with the gateway's message when it answers an error", async () => {
    status = 400;
    responseBody = '{"message":"invalid phone number"}';
    await assert.rejects(
      sendSms(config, "+15550001", "Hi"),
      /answered 400: \{"message":"invalid phone number"\}/,
    );
  });
});
