export interface ShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

// Register the replacement first so a collision never loses the current binding.
export class PassthroughHotkey {
  private accelerator = "";
  constructor(
    private readonly shortcuts: ShortcutRegistry,
    private readonly toggle: () => void,
  ) {}
  set(value: unknown): { registered: boolean } {
    if (typeof value !== "string" || value.length > 80) return { registered: false };
    if (value === this.accelerator) return { registered: true };
    if (
      value &&
      !/^(?:(?:CommandOrControl|CmdOrCtrl|Command|Cmd|Control|Ctrl|Alt|Option|Shift|Super)\+)+[^+]+$/i.test(
        value,
      )
    )
      return { registered: false };
    try {
      if (value && !this.shortcuts.register(value, this.toggle)) return { registered: false };
      if (this.accelerator) this.shortcuts.unregister(this.accelerator);
      this.accelerator = value;
      return { registered: true };
    } catch {
      return { registered: false };
    }
  }
}
