#!/usr/bin/env node
/**
 * Deprecated alias — forwards to the shipped `dsh-engram` CLI so the earlier
 * `npm run web-compaction:*` scripts keep working. New code should call
 * `node scripts/dsh-engram.mjs status|doctor|enable|revert`.
 */
await import("./dsh-engram.mjs");
