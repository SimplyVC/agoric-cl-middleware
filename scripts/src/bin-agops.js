#!/usr/bin/env node
// @ts-check
// @jessie-check

/* eslint-disable @jessie.js/no-nested-await */
/* global fetch, setTimeout */

import '@agoric/casting/node-fetch-shim.js';
import '@endo/init';
import '@endo/init/pre.js';

import { execFileSync } from 'child_process';
import path from 'path';
import process from 'process';
import anylogger from 'anylogger';
import { Command, CommanderError, createCommand } from 'commander';
import { makeOracleCommand } from './commands/oracle.js';

const logger = anylogger('agops');
const progname = path.basename(process.argv[1]);

const program = new Command();
program.name(progname).version('unversioned');

program.addCommand(makeOracleCommand(logger));

try {
  await program.parseAsync(process.argv);
} catch (err) {
  if (err instanceof CommanderError) {
    console.error(err.message);
  } else {
    console.error(err); // CRASH! show stack trace
  }
  process.exit(1);
}
