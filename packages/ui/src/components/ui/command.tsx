import * as React from "react";
import { Search } from "lucide-react";
import { cn } from "../../lib/utils";

const Command = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex h-full w-full flex-col overflow-hidden rounded-md bg-[var(--card)] text-[var(--card-foreground)]", className)}
    {...props}
  />
));
Command.displayName = "Command";

interface CommandInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  onValueChange?: (value: string) => void;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
}

const CommandInput = React.forwardRef<HTMLInputElement, CommandInputProps>(({ className, onValueChange, onChange, ...props }, ref) => (
  <div className="flex items-center border-b border-[var(--border)] px-3">
    <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
    <input
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-md bg-transparent py-2 text-sm outline-none placeholder:text-[var(--muted-foreground)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      onChange={(event) => {
        onChange?.(event);
        onValueChange?.(event.currentTarget.value);
      }}
      {...props}
    />
  </div>
));
CommandInput.displayName = "CommandInput";

const CommandList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("max-h-[360px] overflow-y-auto overflow-x-hidden", className)} {...props} />
));
CommandList.displayName = "CommandList";

const CommandEmpty = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("py-6 text-center text-sm", className)} {...props} />
));
CommandEmpty.displayName = "CommandEmpty";

interface CommandGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  heading?: string;
}

const CommandGroup = React.forwardRef<HTMLDivElement, CommandGroupProps>(({ className, heading, children, ...props }, ref) => (
  <div ref={ref} className={cn("overflow-hidden p-1 text-[var(--foreground)]", className)} {...props}>
    {heading ? <p className="px-2 py-1.5 text-xs font-medium text-[var(--muted-foreground)]">{heading}</p> : null}
    {children}
  </div>
));
CommandGroup.displayName = "CommandGroup";

const CommandSeparator = React.forwardRef<HTMLHRElement, React.HTMLAttributes<HTMLHRElement>>(({ className, ...props }, ref) => (
  <hr ref={ref} className={cn("-mx-1 my-1 h-px border-0 bg-[var(--border)]", className)} {...props} />
));
CommandSeparator.displayName = "CommandSeparator";

interface CommandItemProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onSelect"> {
  onSelect?: () => void;
}

const CommandItem = React.forwardRef<HTMLButtonElement, CommandItemProps>(({ className, onSelect, onClick, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      "relative flex w-full cursor-default select-none items-start gap-1 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)] data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
      className,
    )}
    onClick={(event) => {
      onClick?.(event);
      if (!event.defaultPrevented) {
        onSelect?.();
      }
    }}
    {...props}
  />
));
CommandItem.displayName = "CommandItem";

const CommandShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn("ml-auto text-xs tracking-widest text-[var(--muted-foreground)]", className)} {...props} />
);
CommandShortcut.displayName = "CommandShortcut";

export {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};
