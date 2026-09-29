import { create } from 'zustand'

interface CommandPaletteState {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

/** Whether the ⌘K palette is open; the header's search button and the shortcut share it. */
export const useCommandPaletteStore = create<CommandPaletteState>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
}))
