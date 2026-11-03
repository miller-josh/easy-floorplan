// End to end check of the Layout Board "Done when" list. Needs the local test Postgres (see test/helpers.js).
//   node test/e2e/board.e2e.mjs
import { createRequire } from "node:module";
import { createServer } from "vite";
import { startApi } from "./server.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");

const api = await startApi(4010);
const vite = await createServer({ configFile: false, root: process.cwd(), server: { port: 5199 }, logLevel: "error",
  plugins: [(await import("@vitejs/plugin-react")).default()] });
await vite.listen();
const URL = (user, hash = "") => `http://localhost:5199/test/e2e/harness.html?user=${user}${hash}`;
const BOARD = `#board/${api.planId}`;
const browser = await chromium.launch();
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };
const open = async (user, hash, vp = { width: 1280, height: 800 }) => {
  const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", user, e.message); fails++; });
  await page.goto(URL(user, hash)); return page;
};
const saveBtn = (p) => p.getByRole("button", { name: /Save for everyone|View only/ });
const itemBox = async (p, id) => p.locator(`g.it[data-id="${id}"] rect.hit`).boundingBox();
const dragItem = async (p, id, dx, dy) => {
  const b = await itemBox(p, id); const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx / 2, y + dy / 2, { steps: 3 }); await p.mouse.move(x + dx, y + dy, { steps: 3 }); await p.mouse.up();
};
const pick = async (p, id) => { const b = await itemBox(p, id); await p.mouse.click(b.x + 3, b.y + 3); };
const movedText = (p) => p.locator(".kv").innerText();

try {
  /* 1. Josh loads the board */
  const josh = await open("user_josh", BOARD);
  await josh.waitForSelector("g.it");
  check("board renders all 91 items", (await josh.locator("g.it").count()) === 91);
  check("owner sees Share and role", (await josh.getByRole("button", { name: "Share" }).count()) === 1);
  check("starts as saved for everyone", /Saved for everyone/.test(await josh.locator(".savestate").innerText()));
  await josh.screenshot({ path: "/tmp/lb-josh-initial.png" });

  /* 2. invite Shannon (editor) and Al (viewer) through the UI */
  await josh.getByRole("button", { name: "Share" }).click();
  await josh.getByLabel("Invite role").selectOption("editor");
  await josh.getByRole("button", { name: "Create invite link" }).click();
  const editorLink = (await josh.getByTestId("invite-link").innerText()).trim();
  await josh.getByLabel("Invite role").selectOption("viewer");
  await josh.getByRole("button", { name: "Create invite link" }).click();
  await josh.waitForFunction((prev) => document.querySelector('[data-testid="invite-link"]').textContent.trim() !== prev, editorLink);
  const viewerLink = (await josh.getByTestId("invite-link").innerText()).trim();
  check("invite links are hash urls", /#invite\/[0-9a-f]{36}$/.test(editorLink));
  await josh.getByRole("button", { name: "Close" }).click();

  const shannon = await open("user_shannon", "#" + editorLink.split("#")[1]);
  await shannon.waitForSelector("g.it");
  check("editor invite lands on the board", shannon.url().includes(BOARD));
  check("editor can save (button enabled text)", (await saveBtn(shannon).innerText()) === "Save for everyone");
  const al = await open("user_al", "#" + viewerLink.split("#")[1]);
  await al.waitForSelector("g.it");
  check("viewer sees View only", (await saveBtn(al).innerText()) === "View only" && await saveBtn(al).isDisabled());
  const bad = await open("user_x", "#" + editorLink.split("#")[1]);
  await bad.waitForSelector("text=This invite link isn");
  check("used invite link is rejected", true);

  /* 3. Josh moves the oven, saves; Shannon sees it without reloading */
  await pick(josh, 7);
  check("inspector shows Pizza oven", /Pizza oven/.test(await josh.locator(".insp h2").innerText()));
  await dragItem(josh, 7, 60, 0);
  const mv = await movedText(josh);
  check("drag moves the oven (inspector says Moved)", /right|left|up|down/.test(mv), mv.replace(/\n/g, " "));
  check("draft state shown", /Unsaved/.test(await josh.locator(".savestate").innerText()));
  await saveBtn(josh).click();
  await josh.waitForFunction(() => /Saved for everyone.*by Josh/.test(document.querySelector(".savestate").textContent));
  check("josh sees 'Saved for everyone ... by Josh'", true);
  const before = await itemBox(shannon, 7);
  await shannon.waitForFunction((x) => Math.abs(document.querySelector('g.it[data-id="7"] rect.hit').getBoundingClientRect().x - x) > 5, before.x, { timeout: 15000 });
  const after = await itemBox(shannon, 7);
  check("shannon sees the oven move live", Math.abs(after.x - before.x) > 5, `x ${before.x.toFixed(0)} -> ${after.x.toFixed(0)}`);
  await al.waitForFunction(() => document.querySelector('g.it[data-id="7"]').getAttribute("transform") !== "translate(0 0) rotate(0 0 0)" && !/translate\(0 0\)/.test(document.querySelector('g.it[data-id="7"]').getAttribute("transform")), null, { timeout: 15000 });
  check("viewer also updates live", true);

  /* 4. simultaneous edits: second saver gets Keep mine / Use theirs and loses nothing */
  await pick(josh, 8); await josh.keyboard.press("ArrowUp"); await josh.keyboard.press("ArrowUp");
  await pick(shannon, 9); await shannon.keyboard.press("ArrowRight"); await shannon.keyboard.press("ArrowRight"); await shannon.keyboard.press("ArrowRight");
  await saveBtn(josh).click();
  await josh.waitForFunction(() => /Saved for everyone/.test(document.querySelector(".savestate").textContent) && !/Unsaved/.test(document.querySelector(".savestate").textContent));
  // Shannon has a draft, so the poll shows the choice instead of overwriting
  await shannon.waitForSelector(".notice:not([hidden]) >> text=Josh saved a new layout", { timeout: 15000 });
  check("draft + remote save shows Keep mine / Use theirs", await shannon.getByRole("button", { name: "Keep mine" }).isVisible() && await shannon.getByRole("button", { name: "Use theirs" }).isVisible());
  check("save is blocked until she chooses", await saveBtn(shannon).isDisabled());
  await shannon.getByRole("button", { name: "Keep mine" }).click();
  await saveBtn(shannon).click();
  await shannon.waitForFunction(() => /Saved for everyone.*by Shannon/.test(document.querySelector(".savestate").textContent));
  check("keep mine then save works", true);
  // Josh's proofer move (item 8) must still be in the final layout (nothing lost)
  const rev = await (await fetch(`http://localhost:4010/api/board/plans/${api.planId}/layout`, { headers: { Authorization: "Bearer tok:user_josh" } })).json();
  check("final layout has oven, proofer and mixer moves", rev.state.t[7] && rev.state.t[8]?.dy > 0 && rev.state.t[9]?.dx > 0, `rev ${rev.rev}`);

  /* 5. true race on the save request: second POST gets 409 -> choice */
  await josh.waitForFunction(() => /Shannon/.test(document.querySelector(".savestate").textContent), null, { timeout: 15000 });
  await pick(josh, 10); await josh.keyboard.press("ArrowUp");
  await pick(shannon, 11); await shannon.keyboard.press("ArrowUp");
  await shannon.route("**/api/board/plans/*/layout?since=*", (r) => r.abort()); // her poll can't see Josh first
  await saveBtn(josh).click();
  await josh.waitForFunction(() => !/Unsaved/.test(document.querySelector(".savestate").textContent));
  await saveBtn(shannon).click();
  await shannon.waitForSelector(".notice[role=alert]");
  check("stale save (409) produces the same choice", /Josh saved a new layout/.test(await shannon.locator(".notice[role=alert]").innerText()));
  await shannon.getByRole("button", { name: "Use theirs" }).click();
  check("use theirs drops her draft", !/Unsaved/.test(await shannon.locator(".savestate").innerText()));
  await shannon.unroute("**/api/board/plans/*/layout?since=*");

  /* 6. viewer can rearrange but not save */
  await pick(al, 13); await al.keyboard.press("ArrowLeft");
  check("viewer can try ideas locally", /Moved/.test(await al.locator(".kv").innerText()) && /right|left/.test(await al.locator(".kv").innerText()));
  check("viewer still cannot save", await saveBtn(al).isDisabled());
  const forced = await (await fetch(`http://localhost:4010/api/board/plans/${api.planId}/layout`, { method: "POST", headers: { Authorization: "Bearer tok:user_al", "Content-Type": "application/json" }, body: JSON.stringify({ expectedRev: 1, state: { t: {}, dups: [] } }) })).status;
  check("server rejects a viewer's save (403)", forced === 403);

  /* 7. history + restore */
  await josh.getByRole("button", { name: "History" }).click();
  await josh.waitForSelector(".hist li");
  const rows = await josh.locator(".hist li").count();
  const histText = await josh.locator(".hist").innerText();
  check("history lists revisions with names", rows >= 4 && /Josh/.test(histText) && /Shannon/.test(histText), `${rows} rows`);
  await josh.locator(".hist li", { hasText: "Rev 2" }).getByRole("button", { name: "Preview" }).click();
  await josh.waitForSelector(".notice.preview");
  check("preview banner shown", /Previewing rev 2/.test(await josh.locator(".notice.preview").innerText()));
  await josh.getByRole("button", { name: "Restore" }).click();
  await josh.waitForFunction(() => /Saved for everyone/.test(document.querySelector(".savestate").textContent) && !document.querySelector(".notice.preview"));
  const afterRestore = await (await fetch(`http://localhost:4010/api/board/plans/${api.planId}/revisions`, { headers: { Authorization: "Bearer tok:user_josh" } })).json();
  check("restore saved a new revision", /Restored from rev 2/.test(afterRestore.revisions[0].note || ""), `top rev ${afterRestore.revisions[0].rev}`);
  const restored = await (await fetch(`http://localhost:4010/api/board/plans/${api.planId}/layout`, { headers: { Authorization: "Bearer tok:user_josh" } })).json();
  check("restored layout equals rev 2 (only the oven moved)", Object.keys(restored.state.t).join() === "7");

  /* 8. DXF export */
  const [dl] = await Promise.all([josh.waitForEvent("download"), josh.getByRole("button", { name: "Export DXF" }).click()]);
  const dxf = await (await import("node:fs/promises")).readFile(await dl.path(), "utf8");
  check("DXF downloads (.dxf, R12, ENTITIES)", dl.suggestedFilename().endsWith(".dxf") && /AC1009/.test(dxf) && /ENTITIES/.test(dxf), `${dxf.length} bytes`);
  (await import("node:fs")).writeFileSync("/tmp/lb-export.dxf", dxf);
  (await import("node:fs")).writeFileSync("/tmp/lb-restored-state.json", JSON.stringify(restored.state));

  /* 9. mobile */
  const phone = await open("user_shannon", BOARD, { width: 390, height: 780 });
  await phone.waitForSelector("g.it");
  const sheet = await phone.locator(".sheet").boundingBox(); const aside = await phone.locator("aside").boundingBox();
  check("phone: inspector stacks under the sheet", aside.y >= sheet.y + sheet.height - 1 && sheet.width <= 390);
  const ov = await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  check("phone: no horizontal page scroll", !ov);
  await phone.screenshot({ path: "/tmp/lb-phone.png" });
  await josh.screenshot({ path: "/tmp/lb-josh-final.png" });
} catch (e) { console.log("ERROR", e); fails++; }
await browser.close(); await vite.close(); await api.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
