#!/usr/bin/env node
// Reads the queue, validates it, and prints the resolved build order.
// Touches nothing outside this folder — run it as often as you like.
//
//   node bin/wf-queue.js plan [page] [--json]
//   node bin/wf-queue.js check
//   node bin/wf-queue.js show <section>

const path = require('path');
const { resolve, errorsIn } = require('../lib/queue');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const cmd = argv[0] || 'plan';
const json = argv.includes('--json');
const rest = argv.slice(1).filter((a) => !a.startsWith('--'));

function printProblems(problems) {
  if (!problems.length) return;
  const icon = { error: '✗', warn: '!' };
  console.log('');
  for (const p of problems) console.log(`${icon[p.level]} ${p.where}: ${p.msg}`);
}

const COMMANDS = ['plan', 'show'];

function main() {
  // A typo'd subcommand used to fall through to the plan summary and exit 0,
  // which reads as "nothing to build" rather than "you misspelled it".
  if (!COMMANDS.includes(cmd)) {
    console.error(`\u2717 unknown command: ${cmd}`);
    console.error(`usage: wf-queue.js <${COMMANDS.join('|')}> [page|section] [--json]`);
    process.exit(1);
  }

  let r;
  try { r = resolve(ROOT); }
  catch (e) { console.error('✗ ' + e.message); process.exit(1); }

  if (cmd === 'show') {
    const name = rest[0];
    if (!name) { console.error('usage: wf-queue.js show <section>'); process.exit(1); }
    const sec = r.sections.get(name);
    if (!sec) { console.error(`✗ no section named "${name}"`); process.exit(1); }
    if (json) { console.log(JSON.stringify({ ...sec, classes: [...sec.classes] }, null, 2)); return; }
    console.log(`${sec.name}  (build: ${sec.build}${sec.group ? ', group: ' + sec.group : ''})`);
    console.log(`  classes : ${[...sec.classes].join(', ') || '(none)'}`);
    console.log(`  assets  : ${sec.assets.join(', ') || '(none)'}`);
    console.log(`  reuse   : ${sec.reuse.join(', ') || '(none)'}`);
    if (sec.props) console.log('  props   : ' + sec.props.map((p) => `${p.name}:${p.type}→.${p.target}`).join(', '));
    if (sec.cms) console.log(`  cms     : ${sec.cms.collection} on .${sec.cms.element}`);
    return;
  }

  const steps = rest[0]
    ? r.steps.filter((s) => s.page === rest[0] || s.pageFile === rest[0] + '.md')
    : r.steps;

  if (json) {
    console.log(JSON.stringify({ config: r.config, steps, problems: r.problems }, null, 2));
    process.exit(errorsIn(r.problems).length ? 1 : 0);
  }

  if (cmd === 'plan') {
    if (!steps.length) console.log('(nothing to build)');
    let page = null;
    for (const s of steps) {
      if (s.page !== page) { page = s.page; console.log(`\n${page}   [${s.pageFile}]`); }
      const bits = [s.build];
      if (s.build === 'component' && s.group) bits.push('group:' + s.group);
      if (s.cms) bits.push('cms:' + s.cms.collection);
      if (s.assets.length) bits.push(s.assets.length + ' asset(s)');
      if (s.reuse.length) bits.push('reuse:' + s.reuse.join('+'));
      if (s.overrides) bits.push('overrides');
      console.log(`  → ${s.section.padEnd(24)} ${s.position} into .${s.anchor}   (${bits.join(', ')})`);
    }
  }

  printProblems(r.problems);
  const errs = errorsIn(r.problems).length;
  console.log(`\n${steps.length} step(s), ${errs} error(s), ${r.problems.length - errs} warning(s)`);
  process.exit(errs ? 1 : 0);
}

main();
