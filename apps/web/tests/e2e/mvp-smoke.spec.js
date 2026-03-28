import { test, expect } from "@playwright/test";

test("team login, puzzle usage, hint/persistence flows", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Team Code").fill("TEAM01");
  await page.getByLabel("Team Name").fill("Quantum Foxes");
  await page.getByRole("button", { name: "Start Session" }).click();

  await expect(page.getByText("Team Session")).toBeVisible();

  await page.getByRole("button", { name: "Expand" }).click();
  await page.getByRole("button", { name: "Copy" }).first().click();

  await page.getByRole("button", { name: "Hints" }).click();
  await page.getByRole("button", { name: /Reveal tier1/i }).click();
  await page.getByRole("button", { name: "Close" }).click();

  await page.locator("textarea").nth(2).fill("temporary notes");
  await page.reload();
  await expect(page.locator("textarea").nth(2)).toContainText("temporary notes");

  await page.getByRole("button", { name: "Dark Mode" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Light Mode" })).toBeVisible();
});

test("inspect puzzle open challenge behavior", async ({ page }) => {
  await page.goto("/challenge/html-inspect-sample");
  await expect(page.locator("iframe")).toBeVisible();
});
