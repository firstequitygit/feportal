'use client'

import { createContext, useContext, type ReactNode } from 'react'

interface ImpersonationState {
  isImpersonating: boolean
}

const ImpersonationContext = createContext<ImpersonationState>({ isImpersonating: false })

export function ImpersonationProvider({
  value, children,
}: { value: ImpersonationState; children: ReactNode }) {
  return <ImpersonationContext.Provider value={value}>{children}</ImpersonationContext.Provider>
}

export function useImpersonation(): ImpersonationState {
  return useContext(ImpersonationContext)
}
