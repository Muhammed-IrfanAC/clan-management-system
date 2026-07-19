// Shared shape for the confirm-then-mutate flow. Tabs describe the destructive action; the page
// owns the ConfirmationModal and the in-flight guard, running `action` when the user confirms.
export type ConfirmArgs = {
  title: string;
  message: string;
  variant?: 'danger' | 'warning' | 'info';
  action: () => Promise<void>;
};

export type Confirm = (args: ConfirmArgs) => void;
