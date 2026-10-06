import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, sep, extname } from "node:path";

const appPath = "/Trade-timer/";
let server;
let address;
let workerRevision = 1;
const start = Date.parse("2026-10-06T08:00:00+13:00");
const sampleData = {
  version: 1,
  workers: [{ id: "worker", name: "Eryk", rateCents: 7000 }],
  jobs: [
    {
      id: "job",
      name: "Offline deck",
      client: "Sam",
      description: "",
      createdAt: start,
      status: "active",
      gstBasisPoints: 1500,
      markup: { enabled: false, basisPoints: 1500, scope: "entire" },
      sessions: [
        {
          id: "session",
          createdAt: start,
          start,
          finish: null,
          workers: [{ id: "worker", name: "Eryk", rateCents: 7000 }],
        },
      ],
      materials: [
        {
          id: "material",
          description: "Fixings",
          amountCents: 1000,
          gstInclusive: false,
          date: start,
        },
      ],
    },
  ],
};

test.beforeAll(async () => {
  // Test production files at the same subdirectory used by GitHub Pages, not Vite dev.
  await promisify(execFile)("npm", ["run", "build"], { cwd: process.cwd() });
  const directory = resolve("dist");
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".webmanifest": "application/manifest+json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, "http://localhost").pathname;
      if (!path.startsWith(appPath)) {
        response.writeHead(404).end();
        return;
      }
      const relative =
        decodeURIComponent(path.slice(appPath.length)) || "index.html";
      const file = resolve(directory, relative);
      if (!file.startsWith(directory + sep)) {
        response.writeHead(404).end();
        return;
      }
      let content = await readFile(file);
      if (relative === "sw.js")
        content = Buffer.concat([
          content,
          Buffer.from(`\n/* test revision ${workerRevision} */`),
        ]);
      response
        .writeHead(200, {
          "Content-Type": types[extname(file)] || "application/octet-stream",
          "Cache-Control": "no-cache",
        })
        .end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  address = `http://127.0.0.1:${server.address().port}${appPath}`;
});

test.afterAll(async () => {
  await new Promise((resolveClose) => server?.close(resolveClose));
});

async function openProduction(page) {
  await page.clock.install({ time: new Date("2026-10-06T08:59:59+13:00") });
  await page.clock.pauseAt(new Date("2026-10-06T09:00:00+13:00"));
  await page.addInitScript((sample) => {
    if (localStorage.getItem("trade-timer:v1") === null)
      localStorage.setItem("trade-timer:v1", JSON.stringify(sample));
  }, sampleData);
  await page.goto(address);
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await navigator.serviceWorker.getRegistration())?.active?.state,
      ),
    )
    .toBe("activated");
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => navigator.serviceWorker.controller !== null),
    )
    .toBe(true);
}

test("install metadata and service-worker scope resolve correctly under GitHub Pages", async ({
  page,
}) => {
  await openProduction(page);
  const manifestURL = await page
    .locator('link[rel="manifest"]')
    .evaluate((link) => link.href);
  expect(new URL(manifestURL).pathname).toBe(`${appPath}manifest.webmanifest`);
  const manifest = await page.evaluate(
    async (url) => (await fetch(url)).json(),
    manifestURL,
  );
  expect(manifest.display).toBe("standalone");
  expect(new URL(manifest.start_url, manifestURL).pathname).toBe(appPath);
  expect(new URL(manifest.scope, manifestURL).pathname).toBe(appPath);
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(
      (item) => item.sizes === `${size}x${size}` && item.purpose !== "maskable",
    );
    expect(icon.type).toBe("image/png");
    expect(new URL(icon.src, manifestURL).pathname).toMatch(
      /^\/Trade-timer\/icons\//,
    );
    const dimensions = await page.evaluate(async (url) => {
      const image = await createImageBitmap(await (await fetch(url)).blob());
      return [image.width, image.height];
    }, new URL(icon.src, manifestURL).href);
    expect(dimensions).toEqual([size, size]);
  }
  expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  const appleIcon = await page
    .locator('link[rel="apple-touch-icon"]')
    .evaluate((link) => link.href);
  expect(new URL(appleIcon).pathname).toBe(`${appPath}apple-touch-icon.png`);
  expect(
    await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistration()).scope,
    ),
  ).toBe(address);
  await expect(
    page.locator('section[aria-label="App installation"]'),
  ).toHaveCount(1);
});

test("iPhone guidance uses Safari Share and an Android-style prompt appears only when supplied by the browser", async ({
  browser,
  page,
}) => {
  const iphone = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const safari = await iphone.newPage();
    await safari.goto(address);
    await safari.getByText("Add to your phone", { exact: true }).click();
    await expect(safari.locator(".install-guide")).toContainText(
      "Safari, tap Share, then Add to Home Screen",
    );
    await expect(safari.locator('[data-action="pwa-install"]')).toHaveCount(0);
  } finally {
    await iphone.close();
  }
  await page.goto(address);
  const before = await page.evaluate(() =>
    localStorage.getItem("trade-timer:v1"),
  );
  await page.evaluate(() => {
    window.pwaPromptCalls = 0;
    const event = new Event("beforeinstallprompt", { cancelable: true });
    event.prompt = async () => {
      window.pwaPromptCalls += 1;
    };
    event.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(event);
  });
  await page.getByText("Add to your phone", { exact: true }).click();
  await page
    .getByRole("button", { name: "Install Trade Timer", exact: true })
    .click();
  expect(await page.evaluate(() => window.pwaPromptCalls)).toBe(1);
  await expect(
    page.locator('section[aria-label="App installation"]'),
  ).toContainText("On your home screen");
  expect(
    await page.evaluate(() => localStorage.getItem("trade-timer:v1")),
  ).toBe(before);
});

test("offline shell, saved materials and timestamp-based timer survive reload and reopening", async ({
  page,
  context,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openProduction(page);
  const saved = await page.evaluate(() =>
    localStorage.getItem("trade-timer:v1"),
  );
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: /Offline deck/ }).click();
  await expect(page.locator(".timer-clock")).toHaveText("01:00:00");
  await expect(page.locator('[data-total="labour"]')).toHaveText("$70.00");
  await expect(page.locator('[data-total="materials"]')).toHaveText("$10.00");
  await page.clock.fastForward(1_800_000);
  await expect(page.locator(".timer-clock")).toHaveText("01:30:00");
  await expect(page.locator('[data-total="labour"]')).toHaveText("$105.00");
  expect(
    await page.evaluate(() => localStorage.getItem("trade-timer:v1")),
  ).toBe(saved);
  await page.close();
  const reopened = await context.newPage();
  await reopened.clock.install({ time: new Date("2026-10-06T09:59:59+13:00") });
  await reopened.clock.pauseAt(new Date("2026-10-06T10:00:00+13:00"));
  await reopened.goto(address);
  await reopened.getByRole("button", { name: /Offline deck/ }).click();
  await expect(reopened.locator(".timer-clock")).toHaveText("02:00:00");
  await expect(reopened.locator('[data-total="labour"]')).toHaveText("$140.00");
  expect(
    await reopened.evaluate(() => localStorage.getItem("trade-timer:v1")),
  ).toBe(saved);
  await reopened.getByRole("button", { name: "Stop timer" }).click();
  await reopened.clock.fastForward(3_600_000);
  await expect(reopened.locator('[data-total="labour"]')).toHaveText("$140.00");
  expect(errors).toEqual([]);
});

test("a waiting update cannot interrupt an active timer or an unsaved editor", async ({
  page,
}) => {
  await openProduction(page);
  await page.getByRole("button", { name: /Offline deck/ }).click();
  await page.getByRole("button", { name: "+ Add Materials" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Description", { exact: true })
    .fill("Unsaved timber");
  await page.evaluate(() => {
    window.pwaPageSentinel = true;
  });
  workerRevision += 1;
  await page.evaluate(async () =>
    (await navigator.serviceWorker.getRegistration()).update(),
  );
  await expect
    .poll(() =>
      page.evaluate(async () =>
        Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
      ),
    )
    .toBe(true);
  await page.clock.runFor(1000);
  await expect(page.locator('[data-action="pwa-update"]')).toHaveCount(1);
  await expect(
    page.getByRole("dialog").getByLabel("Description", { exact: true }),
  ).toHaveValue("Unsaved timber");
  // A modal blocks real pointer interaction outside it; exercise the action guard directly.
  await page.locator('[data-action="pwa-update"]').dispatchEvent("click");
  await expect(page.locator("#toast")).toContainText(
    "Finish editing and stop your timers",
  );
  expect(await page.evaluate(() => window.pwaPageSentinel)).toBe(true);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.getByRole("button", { name: "Update app", exact: true }).click();
  expect(await page.evaluate(() => window.pwaPageSentinel)).toBe(true);
  await expect(page.locator(".timer-clock")).toHaveText("01:00:01");
  await page.getByRole("button", { name: "Stop timer" }).click();
  await Promise.all([
    page.waitForEvent("framenavigated", (frame) => frame === page.mainFrame()),
    page.getByRole("button", { name: "Update app", exact: true }).click(),
  ]);
  await expect(
    page.getByRole("button", { name: /Offline deck/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("trade-timer:v1")).jobs[0].sessions[0]
          .finish,
    ),
  ).not.toBeNull();
});
