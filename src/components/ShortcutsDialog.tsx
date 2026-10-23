import { Dialog } from './Dialog'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = isMac ? '⌘' : 'Ctrl'

const GROUPS: { title: string; items: [string[], string][] }[] = [
  {
    title: 'General',
    items: [
      [[MOD, 'Z'], 'Undo'],
      [[MOD, 'Shift', 'Z'], 'Redo'],
      [[MOD, 'S'], 'Save now'],
      [[MOD, 'E'], 'Export PNG'],
      [[MOD, 'V'], 'Paste screenshots'],
      [['?'], 'Show shortcuts'],
    ],
  },
  {
    title: 'Steps',
    items: [
      [['←', '→'], 'Select previous / next step'],
      [['Alt', '←'], 'Move step left (→ right)'],
      [[MOD, 'D'], 'Duplicate step or highlight'],
      [['Del'], 'Delete selection'],
      [['Esc'], 'Deselect / back to Select tool'],
    ],
  },
  {
    title: 'Highlights',
    items: [
      [['V'], 'Select tool'],
      [['E'], 'Ellipse tool (drag or click)'],
      [['M'], 'Numbered marker tool'],
      [['1–4'], 'Red, orange, blue, green'],
      [['N'], 'Toggle number on ellipse'],
      [['Arrows'], 'Nudge (Shift: further)'],
      [[MOD, 'C'], 'Copy highlight (paste onto another step)'],
    ],
  },
  {
    title: 'View',
    items: [
      [['+', '−'], 'Zoom in / out'],
      [['0'], 'Zoom to 100%'],
      [['Shift', '1'], 'Fit flow to screen'],
      [['Space', 'drag'], 'Pan (or drag empty canvas, scroll wheel)'],
      [[MOD, 'scroll'], 'Zoom at pointer'],
    ],
  },
]

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" className="dialog-wide">
      <div className="shortcut-groups">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            <dl className="shortcuts">
              {g.items.map(([keys, label]) => (
                <div key={label}>
                  <dt>
                    {keys.map((k, i) => (
                      <kbd key={i}>{k}</kbd>
                    ))}
                  </dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  )
}

export { MOD }
