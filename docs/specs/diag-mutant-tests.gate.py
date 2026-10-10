#!/usr/bin/env python3
"""Mutation gate for the diag-mutant-tests milestone (yandex-webmaster-mcp).

usage: python3 docs/specs/diag-mutant-tests.gate.py <K1|M7|M8|M9|M10>   (from the clone root)

The live tree is never modified. For mutant <ID> the gate copies the repo
(without .git, node_modules, tmp) into tmp/mut/<ID>/clean and tmp/mut/<ID>/mutant,
links node_modules back to the clone with relative symlinks, replaces exactly one
fragment in mutant/ and runs both diagnostics test files in one node:22-alpine
container under uid 1002 (TAP reporter). The copies are removed afterwards; the
logs stay in tmp/mut/<ID>/{clean,mutant}.log.

Exit 0 only when the mutant is KILLED: the fragment occurs exactly once, the
clean copy is green and contains the expected test, and on the mutant exactly
that expected test is reported `not ok` with code ERR_ASSERTION.
Exit 1 when the mutant survives (or the expected test is missing / fails for a
reason other than an assertion). Exit 2 on a setup problem (unknown ID, fragment
missing or duplicated, clean copy red, docker failure, live file changed).

K1 is a positive control: a mutant the existing tests already kill.
"""

import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

PKG = Path('packages/yandex-webmaster-mcp')
FORMAT = PKG / 'src/format.mjs'
INDEX = PKG / 'src/index.mjs'
TESTS = (str(PKG / 'test/diagnostics-format.test.mjs'),
         str(PKG / 'test/diagnostics-tool.test.mjs'))

# id: (file, fragment, replacement, expected test name)
MUTANTS = {
    # positive control: the date is printed whole instead of its first 10 chars.
    'K1': (FORMAT,
           'return value.slice(0, 10);',
           'return value;',
           'боевой ответ: обе PRESENT-проблемы в тексте с кодом, степенью и датой'),
    # codes inside one severity are compared with localeCompare (A_B before AA).
    'M7': (FORMAT,
           'if (left.code < right.code) return -1;\n'
           '    if (left.code > right.code) return 1;\n'
           '    return 0;',
           'return left.code.localeCompare(right.code);',
           'коды внутри степени сравниваются по кодовым точкам: AA раньше A_B'),
    # any string date is cut to 10 chars, even without a YYYY-MM-DD prefix.
    'M8': (FORMAT,
           "typeof value === 'string' && DIAGNOSTICS_DAY.test(value)",
           "typeof value === 'string'",
           'строка даты без префикса YYYY-MM-DD печатается целиком'),
    # a missing state is counted as "undefined" instead of "N/A".
    'M9': (FORMAT,
           'const state = orNA(entry.state);',
           'const state = String(entry.state);',
           'запись без state считается в Other states как N/A'),
    # structuredContent keeps only `problems` and drops the rest of the API answer.
    'M10': (INDEX,
            "content: [{ type: 'text', text: formatDiagnostics(data) }],\n"
            '        structuredContent: data,',
            "content: [{ type: 'text', text: formatDiagnostics(data) }],\n"
            '        structuredContent: { problems: data.problems },',
            'get-diagnostics отдаёт в structuredContent весь ответ API, не только problems'),
}

NODE = 'node --test --test-reporter=tap ' + ' '.join(TESTS)
SKIP = shutil.ignore_patterns('.git', 'node_modules', 'tmp')


def build_tree(clone, target):
    shutil.copytree(clone, target, ignore=SKIP, symlinks=True)
    for modules in [clone / 'node_modules', *sorted(clone.glob('packages/*/node_modules'))]:
        link = target / modules.relative_to(clone)
        link.symlink_to(os.path.relpath(modules, link.parent), target_is_directory=True)


def test_result(log, name):
    """'ok' / 'assert' (not ok with ERR_ASSERTION) / 'other' (not ok otherwise) / None."""
    lines = log.splitlines()
    for index, line in enumerate(lines):
        match = re.match(r'(not ok|ok) \d+ - (.*)$', line)
        if not match or match.group(2) != name:
            continue
        if match.group(1) == 'ok':
            return 'ok'
        block = []
        for tail in lines[index + 1:]:
            if tail.strip() == '...':
                break
            block.append(tail)
        return 'assert' if "code: 'ERR_ASSERTION'" in '\n'.join(block) else 'other'
    return None


def failed_names(log):
    return [m.group(1) for m in re.finditer(r'^not ok \d+ - (.*)$', log, re.M)]


def main(argv):
    if len(argv) != 1 or argv[0] not in MUTANTS:
        print(f'usage: {sys.argv[0]} <{"|".join(MUTANTS)}>', file=sys.stderr)
        return 2
    ident = argv[0]
    path, before, after, expected = MUTANTS[ident]
    clone = Path.cwd()
    if not (clone / 'node_modules').is_dir():
        print(f'{ident}: setup: no node_modules in {clone}', file=sys.stderr)
        return 2
    original = (clone / path).read_text(encoding='utf-8')
    digest = hashlib.sha256(original.encode()).hexdigest()
    count = original.count(before)
    if count != 1:
        print(f'{ident}: setup: fragment count is {count} in {path}, expected 1', file=sys.stderr)
        return 2
    mutated = original.replace(before, after, 1)
    if mutated == original:
        print(f'{ident}: setup: mutation did not change {path}', file=sys.stderr)
        return 2

    root = clone / 'tmp' / 'mut' / ident
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)
    try:
        for name in ('clean', 'mutant'):
            build_tree(clone, root / name)
        (root / 'mutant' / path).write_text(mutated, encoding='utf-8')
        rel = root.relative_to(clone)
        inner = (f'cd /app/{rel}/clean && {NODE} > ../clean.log 2>&1; c=$?; '
                 f'cd /app/{rel}/mutant && {NODE} > ../mutant.log 2>&1; m=$?; '
                 'echo "CLEAN_RC=$c MUTANT_RC=$m"')
        proc = subprocess.run(
            ['docker', 'run', '--rm', '-u', '1002:1002', '-v', f'{clone}:/app', '-w', '/app',
             'node:22-alpine', 'sh', '-c', inner],
            capture_output=True, text=True, check=False, timeout=600)
    finally:
        for name in ('clean', 'mutant'):
            shutil.rmtree(root / name, ignore_errors=True)

    match = re.search(r'CLEAN_RC=(\d+) MUTANT_RC=(\d+)', proc.stdout)
    if proc.returncode != 0 or match is None:
        print(f'{ident}: setup: docker rc {proc.returncode}: '
              f'{(proc.stdout + proc.stderr).strip()[-500:]}', file=sys.stderr)
        return 2
    if hashlib.sha256((clone / path).read_bytes()).hexdigest() != digest:
        print(f'{ident}: setup: live {path} changed during the run', file=sys.stderr)
        return 2
    clean_rc, mutant_rc = int(match.group(1)), int(match.group(2))
    clean_log = (root / 'clean.log').read_text(encoding='utf-8', errors='replace')
    mutant_log = (root / 'mutant.log').read_text(encoding='utf-8', errors='replace')
    if clean_rc != 0:
        print(f'{ident}: setup: clean copy is red (rc {clean_rc}), failed: '
              f'{failed_names(clean_log) or "no test reported"}', file=sys.stderr)
        return 2
    if test_result(clean_log, expected) != 'ok':
        state = 'all tests green' if mutant_rc == 0 else f'failed {failed_names(mutant_log)}'
        print(f'{ident}: выжил: нет теста «{expected}» (на мутанте {state})')
        return 1
    verdict = test_result(mutant_log, expected)
    if mutant_rc != 0 and verdict == 'assert':
        print(f'{ident}: убит: not ok - {expected} (ERR_ASSERTION)')
        return 0
    if mutant_rc == 0:
        print(f'{ident}: выжил: all tests green on the mutant')
    else:
        print(f'{ident}: выжил: тест «{expected}» = {verdict}; '
              f'упали {failed_names(mutant_log)} (rc {mutant_rc})')
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
