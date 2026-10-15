import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  redactSecretsFromUtterance,
  containsSecretPattern,
  maskSecret,
} from "./secretRedactor.ts";

describe("SecretRedactor Service Tests", () => {
  test("redacts database password from utterance and isolates into extractedSecrets", () => {
    const rawUtterance = "Connect to database demo_blog_cms on 127.0.0.1 user root password is mySecretPassWord99!";
    const result = redactSecretsFromUtterance(rawUtterance);

    assert.equal(result.hasRedaction, true);
    assert.equal(result.extractedSecrets.password, "mySecretPassWord99!");
    assert.ok(result.redactedText.includes("[REDACTED_CREDENTIAL]"));
    assert.ok(!result.redactedText.includes("mySecretPassWord99!"));
  });

  test("redacts alternative password phrasing (db password: <pass>)", () => {
    const raw = "Add connection host localhost db password: ultra_secure_db_pass_2026";
    const result = redactSecretsFromUtterance(raw);

    assert.equal(result.hasRedaction, true);
    assert.equal(result.extractedSecrets.password, "ultra_secure_db_pass_2026");
    assert.ok(!result.redactedText.includes("ultra_secure_db_pass_2026"));
  });

  test("redacts sk- API keys from utterance", () => {
    const raw = "Configure OpenAI provider with key sk-abcdef12345678901234567890abcdef";
    const result = redactSecretsFromUtterance(raw);

    assert.equal(result.hasRedaction, true);
    assert.ok(result.extractedSecrets.apiKey?.startsWith("sk-"));
    assert.ok(!result.redactedText.includes("sk-abcdef12345678901234567890abcdef"));
  });

  test("preserves non-sensitive utterances without false positive redactions", () => {
    const clean = "Show me all recent executions for the tech blog automation";
    const result = redactSecretsFromUtterance(clean);

    assert.equal(result.hasRedaction, false);
    assert.equal(result.redactedText, clean);
    assert.deepEqual(result.extractedSecrets, {});
  });

  test("containsSecretPattern accurately flags credentials", () => {
    assert.equal(containsSecretPattern("my password is secretpass"), true);
    assert.equal(containsSecretPattern("api key: abcdef12345"), true);
    assert.equal(containsSecretPattern("just a normal question about mysql tables"), false);
  });

  test("maskSecret obfuscates secret strings for safe UI rendering", () => {
    const masked = maskSecret("ipo_root_password", 3);
    assert.ok(masked.startsWith("ipo"));
    assert.ok(masked.includes("••••"));
    assert.ok(!masked.includes("root"));
  });

  test("grep verification: zero cleartext matches for password in captured payload", () => {
    const secretValue = "critical_production_password_xyz";
    const utterance = `Connect to MySQL host 127.0.0.1 user root password is ${secretValue}`;

    const { redactedText, extractedSecrets } = redactSecretsFromUtterance(utterance);

    // Simulated network message payload
    const simulatedMessagePayload = {
      content: redactedText,
      is_voice: true,
      secure_input_data: extractedSecrets,
    };

    // Serialize conversational content string (what goes to chat & LLM prompt)
    const contentString = simulatedMessagePayload.content;

    // Strict assertion: secretValue MUST NOT occur anywhere inside contentString
    assert.equal(contentString.indexOf(secretValue), -1);
    assert.ok(!new RegExp(secretValue).test(contentString));
  });
});
