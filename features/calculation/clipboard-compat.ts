/** Univer 1.0.3's ribbon dropdown dispatches clipboard menu names instead of command IDs. */
export function registerClipboardMenuAliases(service: {
  hasCommand(id: string): boolean;
  registerCommand(command: {
    id: string;
    type: number;
    handler: (accessor: unknown, params?: object) => Promise<boolean>;
  }): { dispose(): void };
  executeCommand(id: string, params?: object): Promise<boolean>;
}) {
  const registrations = ['copy', 'cut', 'paste']
    .filter((action) => !service.hasCommand(`sheet.command.${action}`))
    .map((action) =>
      service.registerCommand({
        id: `sheet.command.${action}`,
        type: 0,
        // Dispatch through the original command so focus, protected ranges and clipboard rules still apply.
        handler: (_accessor, params) =>
          service.executeCommand(`univer.command.${action}`, params),
      }),
    );
  return { dispose: () => registrations.forEach((item) => item.dispose()) };
}
