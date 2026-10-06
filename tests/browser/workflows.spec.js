import { test, expect } from "@playwright/test";
const modal = (page) => page.getByRole("dialog");
async function addWorker(page, name, rate) {
  await page.getByRole("button", { name: "Add worker", exact: true }).click();
  await modal(page).getByLabel("Worker name").fill(name);
  await modal(page).getByLabel("Default hourly charge-out rate").fill(rate);
  await modal(page).getByRole("button", { name: "Save", exact: true }).click();
}
async function createJob(page) {
  await page.getByRole("button", { name: "New job", exact: true }).click();
  await modal(page)
    .getByLabel("Job name", { exact: true })
    .fill("Kauri Street deck");
  await modal(page).getByLabel("Client name").fill("Sam Williams");
  await modal(page)
    .getByLabel("Description / address")
    .fill("24 Kauri Street, Auckland");
  await modal(page)
    .getByRole("button", { name: "Create job", exact: true })
    .click();
}
async function makeCrew(page) {
  await page.goto("/");
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "Labour pool" })
    .click();
  await addWorker(page, "Eryk", "70");
  await addWorker(page, "John", "65");
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "Jobs", exact: true })
    .click();
  await createJob(page);
}
async function manualEntry(page) {
  await page.getByRole("button", { name: "+ Manual entry" }).click();
  await modal(page).getByRole("checkbox", { name: "Eryk" }).check();
  await modal(page).getByRole("checkbox", { name: "John" }).check();
  await modal(page).getByLabel("Hourly rate", { exact: true }).fill("70");
  await modal(page).getByLabel("Start date & time").fill("2026-10-05T08:00");
  await modal(page).getByLabel("Finish date & time").fill("2026-10-05T13:00");
  await expect(modal(page).locator("#duration-preview")).toHaveText(
    "5.00 hours per worker",
  );
  await modal(page).getByRole("button", { name: "Save entry" }).click();
}
test("brief calculation, editing, GST conversion, deletion and persistent history", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await makeCrew(page);
  await manualEntry(page);
  await expect(page.locator('[data-total="labour"]')).toHaveText("$700.00");
  await page.getByRole("button", { name: "+ Add Materials" }).click();
  await modal(page).getByLabel("Description", { exact: true }).fill("Timber");
  await modal(page).getByLabel("Amount (NZD)").fill("500");
  await modal(page).getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  await modal(page).getByRole("radio", { name: "Yes", exact: true }).check();
  await modal(page).getByLabel("Markup percentage").fill("15");
  await modal(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator('[data-total="subtotal"]')).toHaveText("$1,380.00");
  await expect(page.locator('[data-total="gst"]')).toHaveText("$207.00");
  await expect(page.locator('[data-total="total"]')).toHaveText("$1,587.00");
  await page.reload();
  await page.getByRole("button", { name: /Kauri Street deck/ }).click();
  await expect(page.locator('[data-total="total"]')).toHaveText("$1,587.00");
  await expect(page.locator(".session-worker")).toHaveCount(2);
  await page.getByRole("button", { name: "Edit Timber", exact: true }).click();
  await modal(page).getByLabel("Amount (NZD)").fill("575");
  await modal(page)
    .getByRole("radio", { name: "GST Inclusive", exact: true })
    .check();
  await modal(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator('[data-total="materials"]')).toHaveText("$500.00");
  await expect(page.locator('[data-total="total"]')).toHaveText("$1,587.00");
  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  await modal(page)
    .getByRole("radio", { name: "Markup materials only" })
    .check();
  await modal(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator('[data-total="markup"]')).toHaveText("$75.00");
  await expect(page.locator('[data-total="total"]')).toHaveText("$1,466.25");
  await page
    .locator(".session-row")
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await modal(page).getByLabel("Finish date & time").fill("2026-10-05T14:00");
  await modal(page)
    .getByRole("checkbox", {
      name: "All selected workers have the same hourly rate",
    })
    .uncheck();
  await modal(page).getByLabel("John", { exact: true }).fill("65");
  await modal(page).getByRole("button", { name: "Save session" }).click();
  await expect(page.locator('[data-total="labour"]')).toHaveText("$810.00");
  await page.getByRole("button", { name: "Edit Timber", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await modal(page)
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.locator('[data-total="materials"]')).toHaveText("$0.00");
  expect(errors).toEqual([]);
});
test("running timer advances, survives reload and reopening, then stops without changing after time advances", async ({
  page,
  context,
}) => {
  await makeCrew(page);
  await page.clock.install({ time: new Date("2026-10-06T07:59:59+13:00") });
  await page.clock.pauseAt(new Date("2026-10-06T08:00:00+13:00"));
  await page.getByRole("button", { name: "Start New Day" }).click();
  await modal(page).getByRole("checkbox", { name: "Eryk" }).check();
  await modal(page)
    .getByRole("button", { name: "Start timer", exact: true })
    .click();
  await page.clock.fastForward(3_600_000);
  await expect(page.locator(".timer-clock")).toHaveText("01:00:00");
  await expect(page.locator('[data-total="labour"]')).toHaveText("$70.00");
  await page.reload();
  await page.getByRole("button", { name: /Kauri Street deck/ }).click();
  await expect(page.locator(".timer-clock")).toHaveText("01:00:00");
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "Labour pool" })
    .click();
  await page.clock.fastForward(1_800_000);
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "Jobs", exact: true })
    .click();
  await page.getByRole("button", { name: /Kauri Street deck/ }).click();
  await expect(page.locator('[data-total="labour"]')).toHaveText("$105.00");
  await page.close();
  const reopened = await context.newPage();
  await reopened.clock.install({ time: new Date("2026-10-06T09:59:59+13:00") });
  await reopened.clock.pauseAt(new Date("2026-10-06T10:00:00+13:00"));
  await reopened.goto("/");
  await reopened.getByRole("button", { name: /Kauri Street deck/ }).click();
  await expect(reopened.locator(".timer-clock")).toHaveText("02:00:00");
  await expect(reopened.locator('[data-total="labour"]')).toHaveText("$140.00");
  await reopened.getByRole("button", { name: "Stop timer" }).click();
  await expect(reopened.locator(".timer-card")).toHaveCount(0);
  await reopened.clock.fastForward(3_600_000);
  await expect(reopened.locator('[data-total="labour"]')).toHaveText("$140.00");
});
test("worker pool changes preserve snapshots, completing and reopening jobs, invalid times rejected", async ({
  page,
}) => {
  await makeCrew(page);
  await manualEntry(page);
  await page
    .locator(".session-row")
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await modal(page).getByLabel("Finish date & time").fill("2026-10-05T07:00");
  await modal(page).getByRole("button", { name: "Save session" }).click();
  await expect(modal(page).getByRole("alert")).toContainText(
    "Finish must be after",
  );
  await modal(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit job", exact: true }).click();
  await modal(page).getByLabel("Job status").selectOption("completed");
  await modal(page).getByRole("button", { name: "Save job" }).click();
  await expect(page.getByRole("button", { name: "Start New Day" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Reopen job" }).click();
  await expect(
    page.getByRole("button", { name: "Start New Day" }),
  ).toBeVisible();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "Labour pool" })
    .click();
  await page.getByRole("button", { name: "Edit Eryk", exact: true }).click();
  await modal(page).getByLabel("Worker name").fill("Eryk renamed");
  await modal(page).getByLabel("Default hourly charge-out rate").fill("100");
  await modal(page).getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Edit John", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await modal(page)
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "Jobs", exact: true })
    .click();
  await page.getByRole("button", { name: /Kauri Street deck/ }).click();
  await expect(page.locator('[data-total="labour"]')).toHaveText("$700.00");
  await expect(page.locator(".session-worker").first()).toContainText("Eryk");
  await page
    .locator(".session-row")
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await expect(
    modal(page).getByRole("checkbox", { name: "John (removed from pool)" }),
  ).toBeChecked();
});
test("phone and desktop have no horizontal overflow", async ({ page }) => {
  await makeCrew(page);
  await manualEntry(page);
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});
test("live crew and rate edits recalculate without losing timer seconds; cannot complete while running", async ({
  page,
}) => {
  await makeCrew(page);
  await page.clock.install({ time: new Date("2026-10-06T07:59:59+13:00") });
  await page.clock.pauseAt(new Date("2026-10-06T08:00:17+13:00"));
  await page.getByRole("button", { name: "Start New Day" }).click();
  await modal(page).getByRole("checkbox", { name: "Eryk" }).check();
  await modal(page).getByRole("checkbox", { name: "John" }).check();
  await modal(page).getByLabel("Hourly rate", { exact: true }).fill("70");
  await modal(page)
    .getByRole("button", { name: "Start timer", exact: true })
    .click();
  await page.clock.fastForward(3_600_000);
  await expect(page.locator('[data-total="labour"]')).toHaveText("$140.00");
  const original = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("trade-timer:v1")).jobs[0].sessions[0]
        .start,
  );
  await page.getByRole("button", { name: "Edit crew / times" }).click();
  await modal(page).getByRole("checkbox", { name: "John" }).uncheck();
  await modal(page).getByLabel("Hourly rate", { exact: true }).fill("80");
  await modal(page).getByRole("button", { name: "Save session" }).click();
  await expect(page.locator('[data-total="labour"]')).toHaveText("$80.00");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("trade-timer:v1")).jobs[0].sessions[0]
          .start,
    ),
  ).toBe(original);
  await page.getByRole("button", { name: "Edit job", exact: true }).click();
  await modal(page).getByLabel("Job status").selectOption("completed");
  await modal(page).getByRole("button", { name: "Save job" }).click();
  await expect(modal(page).getByRole("alert")).toContainText(
    "Stop the running timer",
  );
});
test("overnight manual entries and GST rate changes", async ({ page }) => {
  await makeCrew(page);
  await page.getByRole("button", { name: "+ Manual entry" }).click();
  await modal(page).getByRole("checkbox", { name: "Eryk" }).check();
  await modal(page).getByLabel("Start date & time").fill("2026-10-05T22:00");
  await modal(page).getByLabel("Finish date & time").fill("2026-10-06T02:00");
  await modal(page).getByRole("button", { name: "Save entry" }).click();
  await expect(page.locator('[data-total="labour"]')).toHaveText("$280.00");
  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  await modal(page).getByLabel("GST rate").fill("0");
  await modal(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator('[data-total="gst"]')).toHaveText("$0.00");
  await expect(page.locator('[data-total="total"]')).toHaveText("$280.00");
});
test("storage denial never claims save success and retains the form for retry", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error("Storage quota exceeded");
    };
  });
  await page.getByRole("button", { name: "New job", exact: true }).click();
  await modal(page).getByLabel("Job name", { exact: true }).fill("Unsaved job");
  await modal(page).getByLabel("Client name").fill("Client");
  await modal(page)
    .getByRole("button", { name: "Create job", exact: true })
    .click();
  await expect(modal(page).getByRole("alert")).toHaveText(
    "Storage quota exceeded",
  );
  await expect(modal(page).getByLabel("Job name", { exact: true })).toHaveValue(
    "Unsaved job",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("trade-timer:v1")),
  ).toBeNull();
});

test("active timer and job data survive a full browser process restart", async ({
  playwright,
}) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const directory = await mkdtemp("/tmp/trade-timer-profile-");
  const options = {
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
    viewport: { width: 390, height: 844 },
    timezoneId: "Pacific/Auckland",
  };
  let browser;
  try {
    browser = await playwright.chromium.launchPersistentContext(
      directory,
      options,
    );
    let page = await browser.newPage();
    // Persistent browser contexts are separate from the configured test context.
    await page.goto("http://127.0.0.1:5173/");
    await page
      .locator(".bottom-nav")
      .getByRole("button", { name: "Labour pool" })
      .click();
    await addWorker(page, "Eryk", "70");
    await page
      .locator(".bottom-nav")
      .getByRole("button", { name: "Jobs", exact: true })
      .click();
    await createJob(page);
    await page.getByRole("button", { name: "Start New Day" }).click();
    await modal(page).getByRole("checkbox", { name: "Eryk" }).check();
    await modal(page)
      .getByRole("button", { name: "Start timer", exact: true })
      .click();
    const start = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("trade-timer:v1")).jobs[0].sessions[0]
          .start,
    );
    await browser.close();
    browser = await playwright.chromium.launchPersistentContext(
      directory,
      options,
    );
    page = await browser.newPage();
    await page.goto("http://127.0.0.1:5173/");
    await page.getByRole("button", { name: /Kauri Street deck/ }).click();
    await expect(
      page.getByRole("button", { name: "Stop timer" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("trade-timer:v1")).jobs[0].sessions[0]
            .start,
      ),
    ).toBe(start);
    await page.getByRole("button", { name: "Stop timer" }).click();
    await expect(page.locator(".timer-card")).toHaveCount(0);
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
