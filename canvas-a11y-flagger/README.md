# Canvas A11y Flagger

Flags common accessibility problems in Canvas content. Works on a single Page, Assignment, Discussion or Syllabus, on Modules (a badge on every Page, Assignment and Discussion item) and on the Pages list. Click a badge to see that item's issues.

## Install

**Bookmarklet (recommended for most people).** Open the [install page](https://stealthmoosegoose.github.io/tampermonkey-public/canvas-a11y-flagger/) and drag the **A11y check** button to your bookmarks bar. It loads the latest version every time you click it, so there's nothing to update.

**Tampermonkey.** Open [canvas-a11y-flagger.user.js](https://raw.githubusercontent.com/Stealthmoosegoose/tampermonkey-public/main/canvas-a11y-flagger/canvas-a11y-flagger.user.js) and click **Install**. It runs on its own on every Canvas page and updates automatically.

**Standalone bookmarklet (fallback).** If Canvas blocks the bookmarklet from loading, copy everything in `canvas-a11y-flagger.bookmarklet.txt` and paste it as a new bookmark's URL. This version doesn't update itself.

## What it flags

**Errors**
- Skipped heading levels (H2 to H4), extra H1s beyond the page title, empty headings
- Images with no alt text
- Alt text that looks like a file name (`IMG_4021.jpg`, `Screenshot 3`, `week-3_diagram`)
- Linked images with empty alt text, and links with no text

**Check by hand**
- Empty alt text (fine if the image is decorative)
- Generic alt text ("image," "photo," "logo"…), alt starting with "image of," alt over 150 characters
- Vague link text ("click here," "read more," "learn more"…) and long raw URLs as link text
- Tables with no header cells
- Iframes (videos, embeds, LTI tools) with no title

**Not covered:** color contrast, video captions, reading order and attached files such as PDFs and slides.

## Files

| File | Purpose |
| --- | --- |
| `canvas-a11y-flagger.user.js` | The script. Tampermonkey installs it, and the bookmarklet loads it. Edit this one file. |
| `index.html` | Install page with the drag-to-bookmarks button, served by GitHub Pages. |
| `canvas-a11y-flagger.bookmarklet.txt` | Standalone bookmarklet, generated from the script. |
| `build-bookmarklet.mjs` | Regenerates the standalone bookmarklet: `npm install --no-save terser && node build-bookmarklet.mjs` |

## Releasing a change

1. Edit `canvas-a11y-flagger.user.js` and bump `@version`.
2. Push to `main`. Bookmarklet users get the change within a few minutes, and Tampermonkey users on its next update check.
3. Optionally rerun `build-bookmarklet.mjs` so the standalone version matches.
