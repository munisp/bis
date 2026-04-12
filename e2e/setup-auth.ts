/**
 * E2E Auth Setup Script
 * 
 * Run this script once to generate an authenticated session state
 * that can be reused across E2E tests:
 * 
 *   E2E_EMAIL=admin@example.com E2E_PASSWORD=secret pnpm e2e:auth
 * 
 * This saves the session to e2e/auth.json which is gitignored.
 * The auth.json file is used by dashboard.spec.ts and other authenticated tests.
 */

import { chromium } from "@playwright/test";
import * as path from "path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

async function setupAuth() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log(`[E2E Auth] Navigating to ${BASE_URL} ...`);
  await page.goto(BASE_URL);

  // Wait for the login button and click it
  const loginButton = page.locator("a, button").filter({ hasText: /sign in|log in|login|get started/i }).first();
  await loginButton.waitFor({ timeout: 10_000 });
  await loginButton.click();

  // The OAuth flow will redirect to the Manus login portal
  // In CI, use E2E_EMAIL and E2E_PASSWORD environment variables
  console.log("[E2E Auth] Waiting for OAuth redirect...");
  console.log("[E2E Auth] Please complete the login manually in the browser, then press Enter.");
  
  // Wait for redirect back to the app (up to 5 minutes for manual login)
  await page.waitForURL(`${BASE_URL}/**`, { timeout: 300_000 });

  // Save the authenticated state
  const authPath = path.join(__dirname, "auth.json");
  await context.storageState({ path: authPath });
  console.log(`[E2E Auth] Auth state saved to ${authPath}`);

  await browser.close();
}

setupAuth().catch(console.error);
