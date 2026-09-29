import { createContext, useContext } from 'react'

/** Runs a request that may need a recent sign-in. */
export interface StepUp {
  /**
   * Run `action`. If it fails with REAUTH_REQUIRED, ask the user to confirm
   * who they are and run it ONCE more; if they dismiss the dialog, reject with
   * the original error. Any other failure rejects unchanged.
   */
  run: <T>(action: () => Promise<T>) => Promise<T>
}

/** Provided by `StepUpProvider`, which `AppLayout` mounts once for every staff page. */
export const StepUpContext = createContext<StepUp | null>(null)

/** The step-up runner. Throws outside `<StepUpProvider>`, where a destructive action has no dialog to ask with. */
export function useStepUp(): StepUp {
  const value = useContext(StepUpContext)
  if (!value) throw new Error('useStepUp must be used inside <StepUpProvider>')
  return value
}
