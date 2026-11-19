/** Structured startup and configuration errors with the settings location where the operator can fix them. */
import { fill } from './infra/text.ts'

export type SetupPlace = 'deployment' | 'plan'
export const SETUP_PROBLEMS = {
  foreignFile: ['deployment', '{file} was not written by super-coding-agent; move it, or choose another state directory.'],
  environmentFailed: ['deployment', 'Preparing the agent environment failed.'],
  repositoryUnset: ['plan', 'The plan Source names no repository directory.'],
  repositoryMissing: ['plan', 'The repository directory {repository} does not exist or is not an absolute path.'],
  repositoryNotGit: ['plan', '{repository} is not a git checkout.'],
} as const satisfies Record<string, readonly [SetupPlace, string]>
export type SetupCode = keyof typeof SETUP_PROBLEMS
export interface SetupProblem { place: SetupPlace; code: SetupCode; values: Record<string, string>; detail: string }

/**
 * Thrown by deployment verification checks when the state directory or the repository checkout fails a check.
 * `Setup` records it for the management overview, and the HTTP layer returns `problem` so the panel can localize it.
 */
export class SetupError extends Error {
  readonly place: SetupPlace
  constructor(readonly code: SetupCode, readonly values: Record<string, string> = {}) {
    const [place, text] = SETUP_PROBLEMS[code]
    const sentence = fill(text, values)
    super(values.output ? `${sentence}\n${values.output}` : sentence)
    this.place = place
  }
  get problem(): SetupProblem { return { place: this.place, code: this.code, values: this.values, detail: this.message } }
}
