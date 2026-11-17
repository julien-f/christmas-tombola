import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { sendSms } from "./_sendSms.mjs";

describe("sendSms", () => {
  let server, config, fingerprint;
  let requests = [];
  let status = 200;

  before(async () => {
    const dir = mkdtempSync(join(tmpdir(), "sendSms-"));
    try {
      execFileSync(
        "openssl",
        // prettier-ignore
        ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-subj", "/CN=gateway", "-days", "1", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem")],
        { stdio: "ignore" },
      );
      const key = readFileSync(join(dir, "key.pem"));
      const cert = readFileSync(join(dir, "cert.pem"));
      fingerprint = new X509Certificate(cert).fingerprint256;
      server = createServer({ key, cert }, (req, res) => {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          requests.push({ method: req.method, url: req.url, body });
          res.statusCode = status;
          res.end();
        });
      });
    } finally {
      rmSync(dir, { recursive: true });
    }
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    config = {
      hostname: "127.0.0.1",
      port: server.address().port,
      password: "secret",
    };
  });

  after(() => server.close());

  beforeEach(() => {
    requests = [];
    status = 200;
  });

  it("posts the message when the pinned certificate matches", async () => {
    await sendSms({ ...config, fingerprint }, "+15550001", "Hi & bye");
    assert.deepEqual(requests, [
      {
        method: "POST",
        url: "/sendSMS",
        body: "message=Hi+%26+bye&password=secret&phone=%2B15550001",
      },
    ]);
  });

  it("accepts a fingerprint without colons, in lowercase", async () => {
    await sendSms(
      { ...config, fingerprint: fingerprint.replaceAll(":", "").toLowerCase() },
      "+15550001",
      "Hi",
    );
    assert.equal(requests.length, 1);
  });

  it("sends nothing when the fingerprint does not match", async () => {
    await assert.rejects(
      sendSms({ ...config, fingerprint: "00:11" }, "+15550001", "Hi"),
      /fingerprint mismatch/,
    );
    assert.deepEqual(requests, []);
  });

  it("verifies the certificate without fingerprint", async () => {
    await assert.rejects(sendSms(config, "+15550001", "Hi"), {
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    assert.deepEqual(requests, []);
  });

  it("fails when the gateway answers an error", async () => {
    status = 500;
    await assert.rejects(
      sendSms({ ...config, fingerprint }, "+15550001", "Hi"),
      /answered 500/,
    );
  });
});
