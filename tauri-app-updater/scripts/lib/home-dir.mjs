import { homedir } from 'node:os'

/** Windows USERPROFILE / Unix HOME / os.homedir() fallback */
export function resolveHomeDir() {
  return process.env.USERPROFILE || process.env.HOME || homedir()
}
