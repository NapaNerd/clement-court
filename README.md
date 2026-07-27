# 46 Clement Court — renovation budget dashboard

A friendly, no-tables web view of the renovation budget. Big numbers, soft
boxes, plain language. One screen, no build step, no framework.

**Live site:** https://napanerd.github.io/clement-court/

The numbers live in a Google Sheet. You press **Publish** in the sheet when
you're ready, and the dashboard picks them up on the next reload.

---

## How the pieces fit together

```
Google Sheet  ──(Publish button)──▶  hidden _dashboard_published tab
     │                                        │
     │                                        │  doGet, passcode required
     └── Apps Script (apps-script/Code.gs) ───┘
                                              │
                                              ▼
                        GitHub Pages site  ──fetch──▶  browser
                        (index.html + assets/)          caches a copy locally
```

Three things worth knowing:

- **The dashboard shows the last *published* snapshot, not your live cells.**
  Edit the sheet as much as you like; nothing changes for anyone else until you
  press Publish. Then it's live immediately — the website itself never has to
  redeploy.
- **No budget numbers are stored in this repo.** This repo is public. It holds
  only the page and its styling. The numbers travel straight from the sheet to
  the browser, and the Apps Script refuses any request without the passcode.
  `data.json` is gitignored so a local test file can never be committed.
- **The browser keeps its own copy.** After a successful load, the numbers are
  cached in that browser so the page paints instantly next time and still works
  if Google is slow or unreachable (you get a "showing saved numbers" banner).

---

## First-time setup

### 1. Convert the workbook to a real Google Sheet

The file in Drive is still an uploaded `.xlsx`. Apps Script cannot attach to an
`.xlsx`, so this step is required.

In the spreadsheet: **File → Save as Google Sheets**. That creates a *new* file
with a *new* ID — use that one from now on and put the old `.xlsx` in an
archive folder so nobody edits the wrong copy.

The new sheet must keep these tab names: `Dashboard`, `Rooms`, `Line Items`,
`Per Room Items`. (`Lists` and `README` are along for the ride.)

### 2. Install the script

1. In the new Google Sheet: **Extensions → Apps Script**.
2. Delete whatever is in `Code.gs` and paste in the contents of
   [apps-script/Code.gs](apps-script/Code.gs).
3. Click **Save** (disk icon).
4. In the function dropdown pick `publish`, then click **Run**. Google will ask
   you to authorise the script — approve it. (You'll see a "Google hasn't
   verified this app" warning because it's your own private script: click
   **Advanced → Go to …**.)
5. Reload the spreadsheet tab. A **Renovation dashboard** menu appears next to
   Help.

### 3. Set the passcode and publish

From the **Renovation dashboard** menu:

1. **Set dashboard passcode** — pick something you and Joe will both remember.
   Anyone opening the dashboard types it once per device.
2. **Publish to dashboard** — reads the tabs and shows you a summary of what it
   published, plus any warnings.

### 4. Deploy the web app

Still in the Apps Script editor:

1. **Deploy → New deployment**.
2. Gear icon → **Web app**.
3. Description: anything. **Execute as: Me**. **Who has access: Anyone**.
4. **Deploy**, then copy the **Web app URL** (it ends in `/exec`).

"Anyone" is required so the browser can fetch without a Google login. The
script still checks the passcode on every single request, so the URL on its own
returns nothing.

### 5. Point the site at it

Paste that `/exec` URL into [assets/config.js](assets/config.js):

```js
window.CC_CONFIG = {
  endpoint: 'https://script.google.com/macros/s/AKfy…/exec'
};
```

Commit and push. Done.

### 6. Turn on GitHub Pages

Repo **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**.

---

## Day to day

| I want to… | Do this |
|---|---|
| Change numbers | Edit the sheet as usual. Nothing goes live yet. |
| Push the new numbers out | **Renovation dashboard → Publish to dashboard** |
| See what *would* publish first | **Renovation dashboard → Preview what would publish** |
| Change the passcode | **Renovation dashboard → Set dashboard passcode** |
| Check when it last published | **Renovation dashboard → Show dashboard details** |

On the dashboard itself the header shows **"Numbers published 5 minutes ago"**
with a **Refresh** link. It also checks quietly whenever you come back to the
tab, so a reload is usually enough.

### If you edit `Code.gs` later

Apps Script serves the deployed *version*, not the saved file. After editing:
**Deploy → Manage deployments → pencil icon → Version: New version → Deploy.**
Otherwise the endpoint keeps running the old code.

---

## What the script reads

It finds the header row by looking for the column names, so inserting rows
above the table is safe. Columns are matched by name, never by position.

- **`Rooms`** — `Room`, `Floor`, `Sq Ft`. Stops at the `Total` row; a row
  without a `Floor` is treated as a note, not a room.
- **`Line Items`** — `Room`, `Category`, `Scope Item`, `Qty`, `Unit`,
  `Unit Cost`, `Budget`, `Actual`, `Priority`, `Phase`, `Status`, `Vendor`.
  Rows with an empty `Room` or `Scope Item` are skipped, so the trailing blank
  rows cost nothing. Budget is `Qty × Unit Cost` so editing either flows
  through; if a row has no qty pricing, the `Budget` column is used instead.
- **`Per Room Items`** — `Item`, `Category`, `Unit`, `Unit Cost`, then one
  column per room. **Room columns are matched by header name**, so reordering
  them is safe; a column that matches no room is ignored *and reported*.
- **`Dashboard`** — `Contingency percent`, `Finished sq ft per plan`, and the
  `Check: rows not matched to a room` cell.

Anything that looks off — a room in `Line Items` with no matching row in
`Rooms`, a `Per Room Items` column that matches nothing, a `Qty × Unit Cost`
that disagrees with a stated `Budget` — shows up both in the Publish dialog and
in a **"Worth a look in the spreadsheet"** box on the dashboard. It never
silently drops money.

## Where the numbers come from

Everything on the page is derived on each render; nothing computed is stored.

```
scopeTotal   = sum of Line Items budgets
extrasTotal  = sum of Per Room Items qty × unit cost, per room
hardCost     = scopeTotal + extrasTotal
cushion      = hardCost × cushion%
total        = hardCost + cushion
spent        = sum of the Actual column
perSqFt      = total / finished sq ft
```

**Phases, priorities and categories cover scope line items only.** The
per-room repeating extras are deliberately kept separate — they aren't phased
in the workbook, and the page says so. Don't fold them together.

The cushion slider on the page is a what-if for the reader; it starts at the
sheet's value and "reset to sheet" puts it back. It never writes to the sheet.

## Files

| Path | What it is |
|---|---|
| [index.html](index.html) | The whole page structure |
| [assets/styles.css](assets/styles.css) | Design tokens and layout |
| [assets/app.js](assets/app.js) | Fetch, cache, calculate, render |
| [assets/config.js](assets/config.js) | The one setting: the endpoint URL |
| [apps-script/Code.gs](apps-script/Code.gs) | Paste this into the sheet |

## A note on the passcode

The passcode keeps the budget out of casual view — it isn't stored in this
repo, and the endpoint won't answer without it. It is not bank-grade: it
travels in the request URL, and anyone you give it to can share it. For a
household renovation budget that's the right trade. If it ever needs to be
properly private, the move is a private repo on Cloudflare Pages with a real
login, not a stronger passcode here.

## Design

Built from the Claude Design handoff for this project. Display type is
**Fredoka**, body is **Nunito**, both from Google Fonts. Terracotta `#E8917A`
on a warm `#FFF6EE` background, 3px card borders, generous radii.

The guiding constraint: one of the two owners finds spreadsheets hard to read.
So — no tables, numbers bigger than their labels, plain words ("big jobs" not
"scope items", "cushion" not "contingency"), and every total visible without
clicking anything. Keep that voice for anything added later.
