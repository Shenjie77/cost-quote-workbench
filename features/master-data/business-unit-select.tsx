/** One saved BU directory serves every cost input, including dialogs rendered in portals. */
import {
  createContext,
  useContext,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import type { BusinessUnitOption } from './business-units';
import { cn } from '@/lib/utils';

const BusinessUnitsContext = createContext<{
  options: BusinessUnitOption[];
  disabled: boolean;
}>({ options: [], disabled: false });

/** Supply only saved catalog choices and the current cost version's editing lock. */
export function BusinessUnitsProvider({
  options,
  disabled = false,
  children,
}: {
  options: BusinessUnitOption[];
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <BusinessUnitsContext.Provider value={{ options, disabled }}>
      {children}
    </BusinessUnitsContext.Provider>
  );
}

type BusinessUnitSelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'value' | 'defaultValue' | 'children' | 'multiple'
> & {
  value?: string;
  placeholder?: string;
};

/** Keep historical values visible while accepting only active BU names or an explicit blank. */
export function BusinessUnitSelectField({
  options,
  value = '',
  placeholder = 'Select BU',
  disabled = false,
  className = '',
  onChange,
  ...props
}: BusinessUnitSelectProps & { options: BusinessUnitOption[] }) {
  const hasSavedValue =
    !!value && !options.some((option) => option.value === value);
  return (
    <select
      {...props}
      value={value}
      disabled={disabled}
      className={cn(
        'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50',
        className,
      )}
      onChange={(event) => {
        const next = event.target.value;
        if (
          disabled ||
          (next !== '' && !options.some((option) => option.value === next))
        )
          return;
        onChange?.(event);
      }}
    >
      <option value="">{placeholder}</option>
      {hasSavedValue && (
        <option value={value} disabled>
          {value} · Saved value
        </option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
      {!options.length && <option disabled>No active BU in Master Data</option>}
    </select>
  );
}

/** Bind a cost control to the shared saved directory without copying catalog data into costs. */
export function BusinessUnitSelect(props: BusinessUnitSelectProps) {
  const directory = useContext(BusinessUnitsContext);
  return (
    <BusinessUnitSelectField
      {...props}
      options={directory.options}
      disabled={directory.disabled || props.disabled}
    />
  );
}
