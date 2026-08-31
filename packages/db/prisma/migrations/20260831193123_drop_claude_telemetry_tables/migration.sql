-- Drops the OpenTelemetry-based Claude usage tables. That pipeline was built and verified
-- working, then dropped in favor of the CSV-import path: it only reports from Claude
-- Code's terminal CLI (a confirmed, unfixed upstream bug keeps it from working in the VS
-- Code extension), and this org's usage is almost entirely VS Code. See
-- docs/setup/22-anthropic-usage-connector.md.
DROP TABLE IF EXISTS "claude_telemetry_events";
DROP TABLE IF EXISTS "claude_telemetry_metrics";
