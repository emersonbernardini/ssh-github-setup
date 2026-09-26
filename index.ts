#!/usr/bin/env bun
/**
 * ssh-github-setup
 * -----------------
 * Generates and configures an SSH key for GitHub, with interactive
 * prompts via @clack/prompts (the same library used by `pnpm create`
 * and `bun create`).
 *
 * Usage:
 *   bun run .
 *
 * Compiled:
 *   bun build --compile --outfile ssh-github-setup
 *   ./ssh-github-setup
 */

import * as p from '@clack/prompts'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const VERSION = '1.0.0'

// Nerd Font glyphs (requires a Nerd Font in the terminal)
const ICON_KEY = '\uf084'
const ICON_CHECK = '\uf00c'

function run(cmd: string, args: string[]) {
   return spawnSync(cmd, args, { encoding: 'utf-8' })
}

function commandExists(cmd: string): boolean {
   return run('which', [cmd]).status === 0
}

// Short timeout for commands that depend on an external service
// (e.g. termux-clipboard-set without the paired Termux:API app hangs
// indefinitely waiting for a response). If it times out, the call is
// treated as a failure and execution continues.
const EXTERNAL_CMD_TIMEOUT_MS = 3000

/**
 * Copies text via a native clipboard utility (wl-copy, xclip,
 * termux-clipboard-set, pbcopy). Returns the tool name on success,
 * or null if none is available/working.
 */
function copyViaNativeTool(text: string): string | null {
   const candidates: [string, string[]][] = [
      ['wl-copy', []],
      ['xclip', ['-selection', 'clipboard']],
      ['termux-clipboard-set', []],
      ['pbcopy', []],
   ]
   for (const [cmd, args] of candidates) {
      if (commandExists(cmd)) {
         const result = spawnSync(cmd, args, {
            input: text,
            timeout: EXTERNAL_CMD_TIMEOUT_MS,
         })
         if (result.error || result.signal === 'SIGTERM') continue
         return cmd
      }
   }
   return null
}

/**
 * Copies text using the OSC 52 terminal escape sequence. This asks the
 * *terminal emulator itself* to set the clipboard, with no external
 * binary and no OS-level clipboard server required. Supported by most
 * modern terminals (Ghostty, Termux's own terminal app, kitty, iTerm2,
 * WezTerm, Windows Terminal). Cannot be verified from here — the
 * terminal may silently ignore it if unsupported.
 */
function copyViaOSC52(text: string): void {
   const encoded = Buffer.from(text, 'utf-8').toString('base64')
   process.stdout.write(`\x1b]52;c;${encoded}\x07`)
}

function copyToClipboard(text: string): { method: string; verified: boolean } {
   const nativeTool = copyViaNativeTool(text)
   if (nativeTool) return { method: nativeTool, verified: true }

   copyViaOSC52(text)
   return { method: 'OSC 52 terminal escape sequence', verified: false }
}

function openUrl(url: string): string | null {
   const candidates = ['xdg-open', 'termux-open-url', 'open']
   for (const cmd of candidates) {
      if (commandExists(cmd)) {
         const result = spawnSync(cmd, [url], {
            stdio: 'ignore',
            timeout: EXTERNAL_CMD_TIMEOUT_MS,
         })
         if (result.error || result.signal === 'SIGTERM') continue
         return cmd
      }
   }
   return null
}

async function main() {
   console.clear()
   p.intro(`${ICON_KEY}  SSH · GitHub Setup  v${VERSION}`)

   // --- Dependencies ---
   for (const bin of ['ssh-keygen', 'ssh']) {
      if (!commandExists(bin)) {
         p.log.error(`Command '${bin}' not found.`)
         p.outro('Install the openssh package and try again.')
         process.exit(1)
      }
   }

   // --- 1. Email ---
   const email = await p.text({
      message: 'Enter the email address associated with your GitHub account:',
      validate: v => (!v || v.trim().length === 0 ? 'Email is required' : undefined),
   })

   if (p.isCancel(email)) {
      p.cancel('Operation cancelled.')
      process.exit(0)
   }

   const sshDir = join(homedir(), '.ssh')
   const keyPath = join(sshDir, 'id_ed25519')
   mkdirSync(sshDir, { recursive: true, mode: 0o700 })

   // --- 2. Check for an existing key ---
   let shouldGenerate = true

   if (existsSync(keyPath)) {
      const overwrite = await p.select({
         message: `A key already exists at ${keyPath}. Overwrite it?`,
         options: [
            { value: false, label: 'No, keep the existing key' },
            { value: true, label: 'Yes, generate a new key' },
         ],
      })

      if (p.isCancel(overwrite)) {
         p.cancel('Operation cancelled.')
         process.exit(0)
      }
      shouldGenerate = overwrite
   }

   if (shouldGenerate) {
      const s = p.spinner()
      s.start('Generating ed25519 key...')
      if (existsSync(keyPath)) {
         rmSync(keyPath, { force: true })
         rmSync(`${keyPath}.pub`, { force: true })
      }
      const keygen = run('ssh-keygen', ['-t', 'ed25519', '-C', email, '-f', keyPath, '-q', '-N', ''])
      if (keygen.status !== 0) {
         s.stop('Failed to generate the key.')
         p.log.error(keygen.stderr || 'Unknown error')
         p.outro('Operation cancelled.')
         process.exit(1)
      }
      s.stop('Key created successfully.')
   } else {
      p.log.info('Keeping the existing key.')
   }

   // --- 3. ssh-agent ---
   p.log.step('Configuring the SSH agent...')

   // Reuses the agent if it's already reachable from this process.
   const alreadyRunning = run('ssh-add', ['-l']).status !== 2 // 2 = agent unreachable

   if (!alreadyRunning) {
      // Starts a new agent and reads the variables directly from its
      // output — no subshell, since an `eval` inside a separate bash
      // process wouldn't propagate SSH_AUTH_SOCK/SSH_AGENT_PID back to
      // the Bun process.
      const agentOutput = run('ssh-agent', ['-s']).stdout ?? ''
      const sock = agentOutput.match(/SSH_AUTH_SOCK=([^;]+);/)?.[1]
      const pid = agentOutput.match(/SSH_AGENT_PID=([^;]+);/)?.[1]
      if (sock) process.env.SSH_AUTH_SOCK = sock
      if (pid) process.env.SSH_AGENT_PID = pid
      p.log.info('SSH agent started.')
   } else {
      p.log.info('SSH agent already running.')
   }

   // stdio "inherit" (instead of a spinner) because, if the key has a
   // passphrase, ssh-add prompts for it directly in the terminal — the
   // spinner was hiding that prompt, giving the false impression that
   // the script had frozen.
   p.log.message('If the key has a passphrase, enter it when prompted:')
   const added = spawnSync('ssh-add', [keyPath], { stdio: 'inherit' })

   if (added.status === 0) {
      p.log.success('Key added to the SSH agent.')
   } else {
      p.log.warn('Could not confirm the key was added to the agent. Continuing anyway.')
   }

   // --- 4. Clipboard ---
   const pubkey = readFileSync(`${keyPath}.pub`, 'utf-8').trim()
   const { method, verified } = copyToClipboard(pubkey)
   if (verified) {
      p.log.success(`Key copied via ${method}.`)
   } else {
      p.log.warn(`Copy attempted via ${method} (unverified — copy manually below if needed).`)
   }
   p.log.message(pubkey)

   // --- 5. Open GitHub ---
   const url = 'https://github.com/settings/ssh/new'
   const openedVia = openUrl(url)
   if (openedVia) {
      p.log.info(`Browser opened at ${url}`)
   } else {
      p.log.info(`Visit: ${url}`)
   }

   const confirmed = await p.confirm({
      message: 'Has the key been added to GitHub? Confirm to test the connection.',
   })
   if (p.isCancel(confirmed) || !confirmed) {
      p.outro('Run the script again once the key has been added.')
      process.exit(0)
   }

   // --- 6. Connection test ---
   const testSpinner = p.spinner()
   testSpinner.start('Testing the connection to GitHub...')
   const test = spawnSync('ssh', ['-o', 'StrictHostKeyChecking=accept-new', '-T', 'git@github.com'], {
      encoding: 'utf-8',
      timeout: 15000,
   })
   const output = `${test.stdout ?? ''}${test.stderr ?? ''}`

   if (output.includes('successfully authenticated')) {
      testSpinner.stop('Authentication successful.')
      p.outro(`${ICON_CHECK}  Setup complete.`)
   } else {
      testSpinner.stop('Authentication failed.')
      p.log.error(output.trim() || 'No output returned.')
      p.outro('Check the error above.')
   }
}

main()
