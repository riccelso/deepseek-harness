import type { BashReadonlyCommandPolicy } from './bash-readonly-policy-types.ts'
import {
  dockerCommandIsDangerous,
  ghCommandIsDangerous,
} from './bash-readonly-policy-callbacks.ts'
import { DOCKER_INSPECT_SAFE_FLAGS, DOCKER_LOGS_SAFE_FLAGS } from './bash-readonly-policy-flags.ts'

export const READONLY_MULTIWORD_POLICY_ENTRIES_CORE = [
  [
    'docker inspect',
    {
      safeFlags: DOCKER_INSPECT_SAFE_FLAGS,
      additionalCommandIsDangerousCallback: dockerCommandIsDangerous,
    },
  ],
  [
    'docker logs',
    {
      safeFlags: DOCKER_LOGS_SAFE_FLAGS,
      additionalCommandIsDangerousCallback: dockerCommandIsDangerous,
    },
  ],
  [
    'gh auth status',
    {
      safeFlags: {
        '-a': 'none',
        '-h': 'string',
        '--active': 'none',
        '--hostname': 'string',
        '--json': 'string',
      },
      additionalCommandIsDangerousCallback: ghCommandIsDangerous,
    },
  ],
] as const satisfies readonly (readonly [string, BashReadonlyCommandPolicy])[]
