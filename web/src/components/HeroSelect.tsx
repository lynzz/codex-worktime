import { ListBox, ListBoxItem, Select } from "~/components/ui";

// HeroUI 复合 Select 的常用形态:单选、字符串 key
export function HeroSelect({
  ariaLabel,
  className,
  items,
  selectedKey,
  onSelectionChange,
}: {
  ariaLabel: string;
  className?: string;
  items: { id: string; name: string }[];
  selectedKey: string;
  onSelectionChange: (key: string) => void;
}) {
  return (
    <Select
      aria-label={ariaLabel}
      className={className}
      selectedKey={selectedKey}
      onSelectionChange={(key) => key != null && onSelectionChange(String(key))}
      items={items.map((i) => ({ value: i.id, label: i.name }))}
    >
      <Select.Trigger>
        <Select.Value />
      </Select.Trigger>
      <Select.Popover>
        <ListBox items={items}>
          {(item) => (
            <ListBoxItem id={item.id} textValue={item.name}>
              {item.name}
            </ListBoxItem>
          )}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
