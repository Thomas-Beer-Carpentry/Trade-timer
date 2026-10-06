import { test, expect } from "@playwright/test";
const project = "https://trade-timer-test.supabase.co";
const publicKey = "sb_publishable_test_public_key_12345678901234567890";
const users = new Map([
  ["me@example.test", "11111111-1111-4111-8111-111111111111"],
  ["other@example.test", "22222222-2222-4222-8222-222222222222"],
]);
function token(userId) {
  return `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated", iss: `${project}/auth/v1` })).toString("base64url")}.testsignature`;
}
async function device(browser, server) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const device = { context, offline: false };
  await context.route(`${project}/**`, async (route) => {
    if (device.offline) {
      await route.abort("internetdisconnected");
      return;
    }
    const request = route.request(),
      url = new URL(request.url());
    let payload;
    const respond = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (url.pathname === "/auth/v1/token") {
      payload = request.postDataJSON();
      const userId = users.get(payload.email);
      if (!userId)
        return respond(
          {
            error: "invalid_credentials",
            error_description: "Invalid login credentials",
          },
          400,
        );
      return respond({
        access_token: token(userId),
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: `refresh-${userId}`,
        user: {
          id: userId,
          email: payload.email,
          aud: "authenticated",
          role: "authenticated",
          app_metadata: { provider: "email" },
          user_metadata: {},
          identities: [],
          created_at: new Date().toISOString(),
        },
      });
    }
    if (url.pathname === "/auth/v1/logout") return respond({});
    const auth = request.headers().authorization?.split(" ")[1];
    let userId;
    try {
      userId = JSON.parse(
        Buffer.from(auth.split(".")[1], "base64url").toString(),
      ).sub;
    } catch {
      return respond({ message: "not signed in" }, 401);
    }
    if (url.pathname === "/rest/v1/trade_timer_data") {
      const row = server.get(userId);
      return respond(
        row ? [{ payload: row.data, revision: row.revision }] : [],
      );
    }
    if (url.pathname === "/rest/v1/rpc/save_trade_timer") {
      payload = request.postDataJSON();
      const row = server.get(userId);
      if ((row?.revision ?? 0) !== payload.expected_revision)
        return respond([]);
      const next = {
        data: payload.payload,
        revision: (row?.revision ?? 0) + 1,
      };
      server.set(userId, structuredClone(next));
      return respond([{ payload: next.data, revision: next.revision }]);
    }
    return respond({ message: "Unexpected fake API endpoint" }, 404);
  });
  const page = await context.newPage();
  device.page = page;
  await page.addInitScript(
    ({ project, publicKey }) =>
      localStorage.setItem(
        "trade-timer:cloud-config",
        JSON.stringify({ url: project, key: publicKey }),
      ),
    { project, publicKey },
  );
  await page.goto("/");
  return device;
}
async function signIn(page, email = "me@example.test") {
  await page.getByRole("button", { name: "Set up sync" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  await dialog.getByLabel("Password", { exact: true }).fill("testpassword");
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".cloud-toolbar")).toContainText("Synced");
}
async function sync(page) {
  await page.getByRole("button", { name: "Account & sync" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sync now" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
}
async function createJob(page, name = "Shared deck") {
  await page.getByRole("button", { name: "New job", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Job name", { exact: true })
    .fill(name);
  await page.getByRole("dialog").getByLabel("Client name").fill("Sam");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create job", exact: true })
    .click();
  if (await page.getByRole("button", { name: "Account & sync" }).count())
    await expect(page.locator(".cloud-toolbar")).toContainText("Synced");
}
test("same account across two browser profiles restores jobs and timer timestamps; other account sees no jobs", async ({
  browser,
}) => {
  const server = new Map(),
    first = await device(browser, server),
    second = await device(browser, server),
    third = await device(browser, server);
  try {
    await signIn(first.page);
    await createJob(first.page);
    await first.page
      .locator(".bottom-nav")
      .getByRole("button", { name: "Labour pool" })
      .click();
    await first.page
      .getByRole("button", { name: "Add worker", exact: true })
      .click();
    await first.page.getByRole("dialog").getByLabel("Worker name").fill("Eryk");
    await first.page
      .getByRole("dialog")
      .getByLabel("Default hourly charge-out rate")
      .fill("70");
    await first.page
      .getByRole("dialog")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(first.page.locator(".cloud-toolbar")).toContainText("Synced");
    await first.page
      .locator(".bottom-nav")
      .getByRole("button", { name: "Jobs", exact: true })
      .click();
    await first.page.getByRole("button", { name: /Shared deck/ }).click();
    await first.page.getByRole("button", { name: "Start New Day" }).click();
    await first.page
      .getByRole("dialog")
      .getByRole("checkbox", { name: "Eryk" })
      .check();
    await first.page
      .getByRole("dialog")
      .getByRole("button", { name: "Start timer", exact: true })
      .click();
    await expect(first.page.locator(".cloud-toolbar")).toContainText("Synced");
    const original = server.get(users.get("me@example.test")).data.jobs[0]
      .sessions[0].start;
    await signIn(second.page);
    await second.page.getByRole("button", { name: /Shared deck/ }).click();
    await expect(
      second.page.getByRole("button", { name: "Stop timer" }),
    ).toBeVisible();
    expect(
      await second.page.evaluate(
        () =>
          Object.keys(localStorage)
            .filter((k) => k.startsWith("trade-timer:cloud:v1:"))
            .map((k) => JSON.parse(localStorage.getItem(k)))[0].data.jobs[0]
            .sessions[0].start,
      ),
    ).toBe(original);
    await second.page.getByRole("button", { name: "Stop timer" }).click();
    await expect(second.page.locator(".cloud-toolbar")).toContainText("Synced");
    await sync(first.page);
    await expect(
      first.page.getByRole("button", { name: "Stop timer" }),
    ).toHaveCount(0);
    await signIn(third.page, "other@example.test");
    await expect(
      third.page.getByRole("button", { name: /Shared deck/ }),
    ).toHaveCount(0);
  } finally {
    await first.context.close();
    await second.context.close();
    await third.context.close();
  }
});
test("offline edits recover after reload, while competing device edits require an explicit choice", async ({
  browser,
}) => {
  const server = new Map(),
    first = await device(browser, server),
    second = await device(browser, server);
  try {
    await signIn(first.page);
    await createJob(first.page);
    await signIn(second.page);
    await second.page.getByRole("button", { name: /Shared deck/ }).click();
    first.offline = true;
    await first.page.getByRole("button", { name: "+ Add Materials" }).click();
    await first.page
      .getByRole("dialog")
      .getByLabel("Description", { exact: true })
      .fill("Offline timber");
    await first.page.getByRole("dialog").getByLabel("Amount (NZD)").fill("100");
    await first.page
      .getByRole("dialog")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(first.page.locator(".cloud-toolbar")).toContainText(
      "waiting to sync",
    );
    await first.page.reload();
    await first.page.getByRole("button", { name: /Shared deck/ }).click();
    await expect(
      first.page.getByText("Offline timber", { exact: true }),
    ).toBeVisible();
    await second.page.getByRole("button", { name: "+ Add Materials" }).click();
    await second.page
      .getByRole("dialog")
      .getByLabel("Description", { exact: true })
      .fill("Computer fixings");
    await second.page.getByRole("dialog").getByLabel("Amount (NZD)").fill("40");
    await second.page
      .getByRole("dialog")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(second.page.locator(".cloud-toolbar")).toContainText("Synced");
    first.offline = false;
    await sync(first.page);
    await expect(first.page.locator(".cloud-toolbar")).toContainText(
      "Sync conflict",
    );
    await first.page.getByRole("button", { name: "Account & sync" }).click();
    first.page.once("dialog", (d) => d.accept());
    await first.page
      .getByRole("dialog")
      .getByRole("button", { name: "Use cloud version" })
      .click();
    await first.page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await expect(
      first.page.getByText("Computer fixings", { exact: true }),
    ).toBeVisible();
    await expect(
      first.page.getByText("Offline timber", { exact: true }),
    ).toHaveCount(0);
    const backups = await first.page.evaluate(() =>
      Object.keys(localStorage)
        .filter((k) => k.endsWith(":backups"))
        .map((k) => JSON.parse(localStorage.getItem(k))),
    );
    expect(backups[0][0].data.jobs[0].materials[0].description).toBe(
      "Offline timber",
    );
  } finally {
    await first.context.close();
    await second.context.close();
  }
});
test("existing local records are retained and explicitly imported into an empty signed-in account", async ({
  browser,
}) => {
  const server = new Map(),
    d = await device(browser, server);
  try {
    await createJob(d.page, "Original local job");
    await signIn(d.page);
    await expect(
      d.page.getByRole("button", { name: /Original local job/ }),
    ).toHaveCount(0);
    await d.page.getByRole("button", { name: "Account & sync" }).click();
    await d.page
      .getByRole("dialog")
      .getByRole("button", { name: "Import this device's jobs" })
      .click();
    await expect(d.page.locator(".cloud-toolbar")).toContainText("Synced");
    await expect(
      d.page.getByRole("button", { name: /Original local job/ }),
    ).toBeVisible();
    expect(
      await d.page.evaluate(
        () => JSON.parse(localStorage.getItem("trade-timer:v1")).jobs[0].name,
      ),
    ).toBe("Original local job");
  } finally {
    await d.context.close();
  }
});
test("cloud setup rejects private keys and allows a public project key", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Set up sync" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Supabase Project URL")
    .fill(project);
  await page
    .getByRole("dialog")
    .getByLabel("Public publishable key")
    .fill("sb_secret_never_use_this_in_a_browser");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Connect cloud" })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Never use a secret",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("trade-timer:cloud-config")),
  ).toBeNull();
  await page
    .getByRole("dialog")
    .getByLabel("Public publishable key")
    .fill(publicKey);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Connect cloud" })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Sign in to sync" }),
  ).toBeVisible();
});
test("signing out and switching accounts preserves pending changes in the original account", async ({
  browser,
}) => {
  const server = new Map(),
    d = await device(browser, server);
  try {
    await signIn(d.page);
    await createJob(d.page, "Personal deck");
    d.offline = true;
    await d.page.getByRole("button", { name: "+ Add Materials" }).click();
    await d.page
      .getByRole("dialog")
      .getByLabel("Description", { exact: true })
      .fill("Pending timber");
    await d.page.getByRole("dialog").getByLabel("Amount (NZD)").fill("100");
    await d.page
      .getByRole("dialog")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(d.page.locator(".cloud-toolbar")).toContainText(
      "waiting to sync",
    );
    d.offline = false;
    await d.page.getByRole("button", { name: "Account & sync" }).click();
    d.page.once("dialog", (dlg) => dlg.accept());
    await d.page
      .getByRole("dialog")
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await expect(
      d.page.getByRole("button", { name: "Set up sync" }),
    ).toBeVisible();
    await signIn(d.page, "other@example.test");
    await expect(
      d.page.getByRole("button", { name: /Personal deck/ }),
    ).toHaveCount(0);
    expect(server.has(users.get("other@example.test"))).toBe(false);
    await d.page.getByRole("button", { name: "Account & sync" }).click();
    await d.page
      .getByRole("dialog")
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await expect(
      d.page.getByRole("button", { name: "Set up sync" }),
    ).toBeVisible();
    await signIn(d.page);
    await d.page.getByRole("button", { name: /Personal deck/ }).click();
    await expect(
      d.page.getByText("Pending timber", { exact: true }),
    ).toBeVisible();
  } finally {
    await d.context.close();
  }
});
test("another tab can refresh cloud data without disabling subsequent saves", async ({
  browser,
}) => {
  const server = new Map(),
    d = await device(browser, server);
  let other;
  try {
    await signIn(d.page);
    other = await d.context.newPage();
    await other.goto("/");
    await expect(other.locator(".cloud-toolbar")).toContainText("Synced");
    await createJob(d.page, "First tab deck");
    await expect(
      other.getByRole("button", { name: /First tab deck/ }),
    ).toBeVisible();
    await createJob(other, "Second tab fence");
    await d.page
      .locator(".bottom-nav")
      .getByRole("button", { name: "Jobs", exact: true })
      .click();
    await expect(
      d.page.getByRole("button", { name: /Second tab fence/ }),
    ).toBeVisible();
    expect(server.get(users.get("me@example.test")).data.jobs).toHaveLength(2);
  } finally {
    await d.context.close();
  }
});
test("an account change from another tab closes an old account form before it can save to the next workspace", async ({
  browser,
}) => {
  const server = new Map(),
    d = await device(browser, server);
  try {
    await signIn(d.page);
    const other = await d.context.newPage();
    await other.goto("/");
    await expect(other.locator(".cloud-toolbar")).toContainText("Synced");
    await d.page.getByRole("button", { name: "New job", exact: true }).click();
    await d.page
      .getByRole("dialog")
      .getByLabel("Job name", { exact: true })
      .fill("Do not cross accounts");
    await d.page.getByRole("dialog").getByLabel("Client name").fill("Sam");
    await other.getByRole("button", { name: "Account & sync" }).click();
    await other
      .getByRole("dialog")
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await expect(d.page.locator("#editor")).not.toBeVisible();
    await expect(
      d.page.getByRole("button", { name: "Set up sync" }),
    ).toBeVisible();
    expect(
      await d.page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("trade-timer:v1") || '{"jobs":[]}')
            .jobs,
      ),
    ).toHaveLength(0);
    expect(server.has(users.get("me@example.test"))).toBe(false);
  } finally {
    await d.context.close();
  }
});
