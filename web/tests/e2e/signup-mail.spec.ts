import { expect, test } from "@playwright/test";
import { authenticator } from "otplib";

/**
 * Full happy path required by the product spec:
 * signup → recovery kit → TOTP enrollment → compose → send → inbox.
 *
 * The test signs up a unique @localhost account. It expects the web app to be
 * running against a seeded/empty database with MAIL_DOMAIN=localhost.
 */
test("signup, enroll 2FA, compose, send and read inbox", async ({ page }) => {
  test.setTimeout(180_000);
  const unique = Date.now().toString(36);
  const email = `e2e-${unique}@localhost`;
  const password = "NyxMail-E2E!2026-secure";

  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("401") &&
      !message.text().includes("Blocked script execution in 'about:srcdoc'")
    ) {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/signup");
  await page.getByLabel("Display name").fill("E2E Operator");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: /Create encrypted account/ }).click();

  await expect(page.getByRole("heading", { name: "Save your recovery kit" })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Continue to two-factor setup/ }).click();

  const secret = await page.locator("code").filter({ hasText: /^[A-Z2-7]{16,}$/ }).first().textContent();
  expect(secret).toBeTruthy();
  const code = authenticator.generate(secret!.trim());
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: /Enable two-factor authentication/ }).click();

  await expect(page.getByRole("heading", { name: "Your backup codes" })).toBeVisible();
  await page.getByRole("button", { name: /Open my inbox/ }).click();
  await expect(page).toHaveURL(/\/mail/);

  // The account is new, but onboarding mail may exist. Compose to self so the
  // message exercises internal encrypted delivery.
  await page.getByRole("button", { name: /New message/ }).first().click();
  const composer = page.getByRole("dialog", { name: "New message" });
  await composer.getByLabel("To recipients").fill(email);
  await composer.getByLabel("To recipients").press("Enter");
  await composer.getByLabel("Subject").fill("E2E sealed hello");
  await composer.getByRole("textbox", { name: "Message body" }).click();
  await page.keyboard.type("This message was sealed in the browser.");
  await composer.getByRole("button", { name: /Send encrypted/ }).click();

  await expect(page.getByText("Message sent")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("E2E sealed hello").first()).toBeVisible({ timeout: 20_000 });

  await page.getByText("E2E sealed hello").first().click();
  await expect(
    page.frameLocator('iframe[title^="Message body"]').getByText("This message was sealed in the browser."),
  ).toBeVisible({ timeout: 20_000 });

  // Clearing the tab session removes the in-memory private key. A reload must
  // then ask for the password again rather than leaking the plaintext bundle.
  await page.evaluate(() => window.sessionStorage.clear());
  await page.reload();
  await expect(page.getByRole("heading", { name: /Unlock/ })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Unlock mailbox" }).click();
  await expect(page.getByText("E2E sealed hello").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".mail-row").first()).toBeVisible({ timeout: 15_000 });

  expect(consoleErrors).toEqual([]);
});
