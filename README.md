# Zen Container Dot

Based on [Zen Container Halo by themanontv](https://github.com/themanontv/zen-container-halo).

Places a 4px container-colored dot at the upper-left of tab favicons, including
inactive tabs. The dot replaces the standard container line. Text, backgrounds,
and borders keep Zen's normal styling.

Tabs matching the **currently viewed Space's assigned container** have no dot.
For example, in a Space assigned to Personal, Personal tabs have no dot and Work
tabs have a Work-colored dot. Matching uses container IDs, not Space names or
colors. Assign Personal to the Space; naming a Space "Personal" alone is not enough.
No Container tabs continue to have no dot. In a Space with no assigned container,
all container tabs retain their dots.

`src/userChrome.css` provides the styling; `src/container-dot.uc.js` reads Zen's
active workspace and suppresses the matching dot. Both files are required for
workspace awareness. Switching Spaces, changing the assigned container, and
restoring a session refresh the suppression. New tabs automatically inherit the
current rule, including pinned tabs and Essentials. Each window uses its own
viewed Space. The script relies on Zen's internal workspace API.

## Test the unpushed edits locally with Sine

Sine's [README](https://github.com/CosmoCreeper/Sine#-test-mods-in-a-snap)
documents installing unpublished mods from GitHub repositories. That downloads
remote files, so it will **not** test uncommitted or unpushed edits. The following
local procedure is derived from Sine's current
[mod loader](https://github.com/CosmoCreeper/Sine/blob/main/src/core/manager.sys.mjs)
and [path/script configuration](https://github.com/CosmoCreeper/Sine/blob/main/src/core/utils.sys.mjs).
It is a manual local setup, not a documented local-folder import button.

1. With Sine installed, disable the original Container Halo mod. Remove any old
   halo/dot rules previously copied into `chrome/userChrome.css` so only this
   version supplies the indicator.
2. Open `about:support`, then **Open Directory** / **Open Profile Folder** beside
   Profile Directory. Note the folder path. In Settings → Sine Mods → Sine's
   settings, enable JavaScript from unofficial sources (`sine.allow-unsafe-js`
   in `about:config`). The workspace-aware behavior requires this script.
3. **Fully quit Zen**, including other windows using that browser profile.
4. From this repository's directory, run the following, replacing the example
   path with the profile directory from step 2. It copies the mod and adds its
   entry to Sine's registry while preserving other mods. It backs up an existing
   local copy and the registry, and disables automatic updates for this test copy.

   ```bash
   python3 - '/absolute/path/to/your/zen/profile' <<'PY'
   import json, pathlib, shutil, sys, time
   repo = pathlib.Path.cwd()
   profile = pathlib.Path(sys.argv[1]).expanduser()
   registry = profile / 'chrome/sine-mods/mods.json'
   if not registry.is_file():
       raise SystemExit('Sine mods.json not found; check the profile and Sine installation.')
   manifest = json.loads((repo / 'theme.json').read_text())
   mods = json.loads(registry.read_text())
   stamp = str(time.time_ns())
   shutil.copy2(registry, registry.with_name('mods.json.backup-' + stamp))
   target = registry.parent / manifest['id']
   if target.exists():
       shutil.copytree(target, target.with_name(target.name + '.backup-' + stamp))
   shutil.copytree(repo / 'src', target / 'src', dirs_exist_ok=True)
   shutil.copy2(repo / 'theme.json', target / 'theme.json')
   manifest.update({'enabled': True, 'no-updates': True})
   mods[manifest['id']] = manifest
   registry.write_text(json.dumps(mods, indent=2) + '\n')
   print('Installed local test copy:', target)
   PY
   ```

5. Start Zen. Confirm **Zen Container Dot** is enabled in Sine Mods. Re-run step 4
   with Zen closed after editing the source files; restart to load those edits.

To undo, uninstall **Zen Container Dot** through Sine and re-enable your previous
mod if desired. The timestamped backups remain available for restoration with Zen
closed. Do not restore the entire old registry if you want to retain subsequent
changes to other mods.

## Install through Sine after publishing

Paste `https://github.com/tranquil-tr0/zen-container-dot` into Sine Mods' custom
GitHub install field. For another branch, use
`https://github.com/OWNER/REPO/tree/BRANCH`. This repository includes `theme.json`
with explicit CSS and script paths. Enable JavaScript from unofficial sources as
above, install, and restart Zen. Do not install the old remote revision to test
local edits. If keeping the same mod ID as a local test copy, uninstall that test
copy first so the remote installation replaces it cleanly.

## Behavior checks

1. Assign Personal as the container for one Space. Open Personal, Work, and No
   Container tabs there. Personal and No Container should have no dot; Work
   should retain its dot, selected or inactive.
2. Select the Work tab while still viewing the Personal Space. Personal dots
   should stay hidden: the rule follows the Space, not the selected tab.
3. Switch to a Space assigned to Work. For tabs visible there (including shared
   Essentials), Work dots should disappear and Personal dots should appear.
4. Change the viewed Space's assigned container without restarting. Verify the
   dots update. Clear its container assignment: every container tab should now
   have its dot, while No Container tabs still have none.
5. Check newly opened tabs, pinned tabs, Essentials, collapsed sidebar layouts,
   light/dark themes, and a second window viewing another Space. Verify each
   window follows its own Space. Restart and confirm the restored Space works.
6. Disable and re-enable the mod through Sine. Its dots should disappear and
   return, and disabling should restore the normal container line.

If all container tabs have dots, check that JavaScript is allowed, both files were
copied, and the Space has an assigned container. CSS alone cannot suppress the
matching dot. A browser profile (the folder shown in `about:support`) is separate
from the container identity assigned to a Zen Space.

Run the script's automated logic checks with `node --test tests/*.test.cjs`.
These cover workspace changes, assignment changes, startup, independent windows,
reload/unload cleanup, and manifest paths; actual Zen rendering needs the manual
checks above.
