# Changelog

Notable changes to ccprogress. Pull requests add their entry under **Unreleased**; the version in `plugin.json` changes only when a release is cut.

## Unreleased

### Added

- `/progress all` lists the plans of every session on this machine from the last 24 hours, with each one's current step and when it last moved. ([#3](https://github.com/amigoer/ccprogress/issues/3))
- Saved plans record the session's working directory, so the overview can name the project.

## 0.4.0 - 2026-10-03

### Added

- `fold_reports` option to keep the full tool rows for progress reports in the terminal. ([#6](https://github.com/amigoer/ccprogress/issues/6))
- `language` option to pin the bar's labels to English or Chinese. ([#6](https://github.com/amigoer/ccprogress/issues/6))

## 0.3.0 - 2026-10-03

### Changed

- Clearer tool description and system prompt section, and one reminder when a turn reaches four actions without a progress report. ([#4](https://github.com/amigoer/ccprogress/issues/4))

## 0.2.0 - 2026-10-03

### Added

- Elapsed time for the running step, a red timer and one alert when a step looks stuck, and a toast when the plan finishes. ([#1](https://github.com/amigoer/ccprogress/issues/1), [#2](https://github.com/amigoer/ccprogress/issues/2))
- `stuck_minutes` and `notify` options.

## 0.1.0 - 2026-10-03

### Added

- Live progress bar above the spinner in the terminal and in the band above the prompt in the Desktop app.
- `/progress` checklist, folded transcript lines, and plans restored on `/resume`.
