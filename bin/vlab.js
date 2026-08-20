#!/usr/bin/env node

import { main } from "../src/cli.js";

main(process.argv.slice(2)).catch((error) => {
  const message = error?.message ?? String(error);
  console.error(`vlab: ${message}`);
  if (error?.details) {
    console.error(error.details);
  }
  process.exitCode = error?.exitCode ?? 1;
});
