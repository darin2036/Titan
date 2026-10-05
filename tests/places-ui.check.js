// Run with an authenticated disposable workspace and the fixture intelligence provider.
// Creates records and a place. Captures responsive screenshots under output/playwright.
async (page) => {
  const fail = (message) => {
    throw new Error(message);
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  const marker = "Places QA " + Date.now();
  const { prd, spec } = await page.evaluate(async (marker) => {
    async function create(kind, title) {
      const response = await fetch("/api/v1/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          title,
          body: "A source record for the navigation check.",
          validity: "supported",
        }),
      });
      if (!response.ok) throw new Error("Couldn’t prepare navigation fixtures");
      return response.json();
    }
    const prd = await create("knowledge", marker + " PRD");
    const spec = await create("knowledge", marker + " spec");
    const work = await create("work", marker + " work");
    const response = await fetch("/api/v1/relationships", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: work.id,
        target: prd.id,
        type: "implements",
        justification: "This work implements the requirements.",
        evidence: [],
        revisions: { [work.id]: work.revision, [prd.id]: prd.revision },
      }),
    });
    if (!response.ok) throw new Error("Couldn’t prepare a connection fixture");
    return { prd, spec };
  }, marker);
  await page.reload();
  await page
    .getByRole("button", { name: "Places actions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create new place", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(marker);
  await page
    .getByRole("checkbox", { name: prd.title + " Knowledge", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: spec.title + " Knowledge", exact: true })
    .check();
  await page.getByRole("button", { name: "Create place", exact: true }).click();
  await page.getByRole("heading", { name: marker, exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Pin " + prd.title, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Unpin " + prd.title, exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Pin " + spec.title, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Unpin " + spec.title, exact: true })
    .waitFor();
  await page.getByText("Why this record?", { exact: true }).click();
  await page
    .getByText("This work implements the requirements.", { exact: true })
    .waitFor();
  await page
    .getByRole("combobox", { name: "Organization", exact: true })
    .selectOption("manual");
  await page.locator(".suggestions").waitFor({ state: "hidden" });
  await page
    .getByRole("combobox", { name: "Organization", exact: true })
    .selectOption("assisted");
  await page
    .getByRole("button", { name: "Add to place", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Organize place", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Move up " + spec.title, exact: true })
    .click();
  await page.getByRole("button", { name: "Save place", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.reload();
  await page.getByRole("heading", { name: marker, exact: true }).waitFor();
  const place = await page.evaluate(
    async (name) =>
      (await (await fetch("/api/v1/places")).json()).find(
        (place) => place.name === name,
      ),
    marker,
  );
  if (place.pinnedIds.join() !== [spec.id, prd.id].join())
    fail("Pinned order did not persist");
  const secondPlace = await page.evaluate(async (name) => {
    const response = await fetch("/api/v1/places", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        type: "project",
        organization: "manual",
        memberIds: [],
        pinnedIds: [],
      }),
    });
    if (!response.ok) throw new Error("Couldn’t prepare a reorder fixture");
    return response.json();
  }, marker + " second");
  await page.reload();
  const placesNav = page.getByRole("navigation", {
    name: "Places",
    exact: true,
  });
  const firstButton = placesNav
    .locator(".place-parent .nav")
    .filter({ hasText: marker })
    .first();
  const secondButton = placesNav
    .locator(".place-parent .nav")
    .filter({ hasText: secondPlace.name });
  await secondButton.waitFor();
  await secondButton.dragTo(firstButton, { targetPosition: { x: 20, y: 2 } });
  const names = () =>
    placesNav.locator(".place-parent .nav-title").allTextContents();
  let order = await names();
  if (order.indexOf(secondPlace.name) >= order.indexOf(marker))
    fail("Dragging did not reorder places");
  await page.reload();
  await secondButton.waitFor();
  order = await names();
  if (order.indexOf(secondPlace.name) >= order.indexOf(marker))
    fail("Place order did not survive reload");
  await secondButton.focus();
  await page.keyboard.press("Alt+ArrowDown");
  order = await names();
  if (order.indexOf(secondPlace.name) <= order.indexOf(marker))
    fail("Keyboard reordering did not move the place");
  const navigation = page.locator("#place-" + place.id);
  await navigation
    .getByRole("button", { name: "◈ " + prd.title, exact: true })
    .click();
  await page.locator("article.markdown").waitFor();
  if (await page.locator(".record-browser, .browse-canvas").count())
    fail("Record opened alongside a second browser panel");
  await page.getByRole("button", { name: "Edit page", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Page title", exact: true })
    .fill(marker + " saved draft");
  await navigation
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await page.locator(".page-composer").waitFor({ state: "hidden" });
  await page
    .getByRole("navigation", { name: "Your drafts", exact: true })
    .getByRole("button", {
      name: marker + " saved draft Unpublished changes",
      exact: true,
    })
    .waitFor();
  await page.getByRole("button", { name: "Add to place", exact: true }).click();
  await page.locator(".suggested-record").waitFor({ state: "hidden" });
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      fail("Horizontal overflow at " + width);
    if (width <= 760) {
      await page
        .getByRole("button", { name: "Navigation", exact: true })
        .click();
      await navigation
        .getByRole("button", { name: "Overview", exact: true })
        .click();
      if (await page.locator(".sidebar-content").isVisible())
        fail("Mobile navigation did not close");
    }
    const typography = await page
      .locator(".place-controls button, .place-controls select, .pin-record")
      .evaluateAll((elements) =>
        elements.map((element) => getComputedStyle(element).fontSize),
      );
    if (typography.some((size) => size !== "14px"))
      fail("Place controls do not match the control size at " + width);
    await page.screenshot({
      path: "output/playwright/titan-navigation-" + width + ".png",
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("separator", { name: "Navigation width", exact: true })
    .focus();
  await page.keyboard.press("End");
  await page.reload();
  await page.getByRole("separator").waitFor();
  if (
    (await page.getByRole("separator").getAttribute("aria-valuenow")) !== "360"
  )
    fail("Navigation width did not persist");
};
