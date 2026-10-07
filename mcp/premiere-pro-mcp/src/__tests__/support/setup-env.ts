/**
 * Runs before every test file (jest.config.js setupFiles). Tests must never write
 * to the real data/telemetry.sqlite — the weekly report reads it. An in-memory
 * database keeps the telemetry code paths running without touching disk.
 */

process.env.BUILDX_TELEMETRY_DB = ':memory:';
// No automatic time-log writes into the real folder from tests.
process.env.BUILDX_TIME_LOG_AUTO = '0';
