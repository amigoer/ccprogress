<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="ccprogress: see which step a long Claude Code session is on, with a live progress bar beside the spinner">
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-22A06B" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/Claude%20Code-%E2%89%A5%202.1.287-D97757" alt="Requires Claude Code 2.1.287 or later">
  <img src="https://img.shields.io/badge/terminal%20%2B%20desktop-supported-1F1E1C" alt="Works in the terminal and the Desktop app">
  <a href="https://linux.do"><img src="https://img.shields.io/badge/LINUX%20DO-community-FFB003" alt="LINUX DO community"></a>
</p>

<p align="center">English · <a href="./README.zh-CN.md">简体中文</a></p>

In a long session the spinner only tells you how long Claude has been working and how many tokens it spent. **ccprogress** adds the missing part: the plan, which step is running now, and how many are left, updated live as each step starts and finishes.

## See it

<p align="center">
  <img src="./assets/readme/live-desktop.png" width="100%" alt="A real Desktop app session: the band above the prompt unfolded into a six-step checklist, two steps done in green and the third running in orange">
</p>

<p align="center"><sub>From a real Desktop app session: step 3 of 6 is running, with the checklist unfolded.</sub></p>

<p align="center">
  <img src="./assets/readme/desktop.svg" width="100%" alt="In the Desktop app the band above the prompt shows the current step, a segmented bar and the step count while working, unfolds into a checklist, and turns green when every step is done">
</p>

In the **Desktop app** the bar lives in the band above the prompt for the whole turn. **View steps** unfolds the checklist in place, and a finished plan can be dismissed or simply clears when you send your next prompt.

<p align="center">
  <img src="./assets/readme/terminal.svg" width="100%" alt="In the terminal a continuous progress bar sits right above the spinner, and each progress report folds into one dim line in the transcript">
</p>

In the **terminal** the bar sits right above the spinner, and each progress report folds into a single dim line such as `◦ 3/5 Run the tests` instead of printing the whole step list into the transcript.

## Install

```bash
claude plugin marketplace add amigoer/ccprogress
```

```bash
claude plugin install ccprogress@ccprogress
```

Or, inside a session: `/plugin marketplace add amigoer/ccprogress`, then `/plugin install ccprogress@ccprogress`. Run `/reload-plugins` in sessions that were already open. A plugin installed at user scope loads in both the terminal and the Desktop app.

Then give Claude a task with a few steps. The bar appears as soon as Claude lays out its plan.

## How it works

ccprogress is a [mod](https://code.claude.com/docs/en/plugins/mods/overview): a plugin whose code runs inside Claude Code and can draw in its interface.

**Where the steps come from.** The bar needs someone to name the steps, so ccprogress uses the first source the session has:

1. The built-in `TodoWrite` tool, where the build offers it.
2. The built-in task list (`TaskCreate` / `TaskUpdate`), read back from the task files under `~/.claude/tasks/` after each update. Current builds turn these tools on with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`; ccprogress has been checked against them in a real session.
3. Its own `update_progress` tool otherwise, as in the current Desktop app. A short system prompt section asks Claude to report its plan for tasks of three or more steps and to update it as steps start and finish. If a turn reaches four actions without a report, one short reminder is added for Claude to read; you never see it.

**Where it draws.**

- **Terminal**: a line right above the spinner while Claude works, and the band above the prompt while the session is idle.
- **Desktop app**: the band above the prompt, all the time. The Desktop app currently draws its spinner row itself and does not take a mod's drawing there.
- **Everywhere else** (the VS Code extension, `claude -p`, the Agent SDK): nothing is drawn, and `/progress` prints a text summary instead.

**Colors.** Green is done, orange is the step under way, gray is still to come.

**Timers and alerts.** While Claude works, the running step shows how long it has taken. Past 5 minutes the timer turns red and a toast says the step may be stuck, which is often a permission prompt nobody has answered. When every step is done, a toast says so with the total time.

## Commands

| Command | What it does |
| --- | --- |
| `/progress` | Shows the full checklist: a side pane in the terminal, the unfolded band in the Desktop app. Works while Claude is busy. |
| `/progress all` | Lists the plans of every session on this machine from the last 24 hours: the project, the current step, and when it last moved. |
| `/progress clear` | Clears the current plan. |

## Settings

Change these in `/config`, or with `/plugin configure ccprogress@ccprogress`.

| Option | Default | What it does |
| --- | --- | --- |
| `stuck_minutes` | `5` | Warns when the running step has taken this long. `0` turns the alert off. |
| `notify` | `toast` | `toast` alerts inside the session only. `system` also sends a desktop notification, through `osascript` on macOS or `notify-send` on Linux. |
| `fold_reports` | `true` | Shows each progress report as one dim line in the terminal transcript. Turn it off to see the full step list. |
| `language` | `auto` | Language of the bar's labels: `en`, `zh`, or `auto` to follow the language of the steps. |

## Good to know

- **Requirements**: Claude Code v2.1.287 or later, where mods are on by default. Run `claude --version` to check. Desktop app sessions under WSL do not load plugins.
- **Subagents** cannot take over the bar; only the main conversation's plan is shown.
- **Resume**: each session's plan is saved and comes back with `/resume`. Only the 50 most recent sessions are kept.
- **Cost**: each update is one small tool call, a few hundred tokens per task. The system prompt section is about 100 words and is only added while the `update_progress` tool is offered. The reminder adds about 25 words, at most once per turn.
- **Privacy**: no network calls and no extra model calls. A process starts only in the `system` notification mode, to show the notification. Plans are kept in the plugin's store under `~/.claude/plugins/store/`, and files are read only under `~/.claude/tasks/`, only when the task list tools run.
- **Trust**: a mod runs with your permissions. `claude plugin validate plugins/ccprogress` lists every event it hooks and every call it makes.
- **Early access**: the mods API still changes between Claude Code releases.

## Reading plans from other tools

Every session that runs ccprogress saves its plan in the same store, which is how `/progress all` sees them all. Other tools, such as a script listing your sessions, can read it from `~/.claude/plugins/store/ccprogress_ccprogress-*.json`. The file is one JSON object; each `plan:<session id>` key holds:

```json
{
  "goal": "Ledger CLI",
  "steps": [{ "title": "Run the tests", "status": "in_progress" }],
  "source": "tool",
  "updatedAt": 1790967588567,
  "cwd": "/Users/me/work/ledger"
}
```

`status` is `pending`, `in_progress` or `completed`; `source` says whether the steps came from the plugin's tool (`tool`), `TodoWrite` (`todo`) or the task list (`tasks`); `updatedAt` is in epoch milliseconds. Read the file, never write it: Claude Code owns it.

## Development

```text
.claude-plugin/marketplace.json     the marketplace this repository serves
plugins/ccprogress/
├── .claude-plugin/plugin.json      plugin manifest
├── hooks/register.tsx              events, the tool, the command and the drawings
├── hooks/view.tsx                  rows, checklist and transcript lines per surface
├── hooks/icons.ts                  SVG icons and the segmented bar for the Desktop app
├── hooks/plan.ts                   step parsing, summaries and the terminal bar
├── hooks/words.ts                  English and Chinese labels
├── types/index.d.ts                the $.state contract
└── tests/                          claude plugin test suites
```

Load the plugin from your checkout. It reloads each time you save:

```bash
claude --plugin-dir plugins/ccprogress
```

For the Desktop app, add the absolute path of `plugins/ccprogress` to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`, set `CLAUDE_CODE_PLUGIN_DIR_WATCH` to `1` there to reload on save, then start a new session. Disable an installed copy of ccprogress first so the two do not both load.

Check and test:

```bash
claude plugin validate --strict plugins/ccprogress
```

```bash
claude plugin test plugins/ccprogress
```

For editor types, run `/plugin-types` in a session started from the repository root; it writes the declarations to `.claude/types`, which `tsconfig.json` includes. Then:

```bash
npx -p typescript@5 tsc -p .
```

**Releases.** A pull request adds its entry under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) and leaves the version alone. A release moves those entries under a new version and bumps `version` in `plugins/ccprogress/.claude-plugin/plugin.json`, which is what makes installed copies update.

## Disclaimer

ccprogress is a community project. It is not affiliated with or endorsed by Anthropic. "Claude" is a trademark of Anthropic, PBC.

## License

[MIT](LICENSE)
