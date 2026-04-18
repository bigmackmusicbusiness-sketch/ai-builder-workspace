// packages/ui/primitives/Menu.tsx — Radix DropdownMenu for action menus.
import * as React from 'react';
import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import { clsx } from 'clsx';

export interface MenuItem {
  type?: 'item' | 'separator' | 'label';
  label?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  destructive?: boolean;
  onSelect?: () => void;
  items?: MenuItem[];  // for sub-menus
}

export interface MenuProps {
  trigger: React.ReactNode;
  items: MenuItem[];
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}

function renderItems(items: MenuItem[]) {
  return items.map((item, i) => {
    if (item.type === 'separator') {
      return <RadixMenu.Separator key={i} className="abw-menu__separator" />;
    }
    if (item.type === 'label') {
      return <RadixMenu.Label key={i} className="abw-menu__label">{item.label}</RadixMenu.Label>;
    }
    return (
      <RadixMenu.Item
        key={i}
        disabled={item.disabled}
        onSelect={item.onSelect}
        className={clsx('abw-menu__item', item.destructive && 'abw-menu__item--destructive')}
      >
        {item.icon && <span className="abw-menu__item-icon" aria-hidden="true">{item.icon}</span>}
        <span className="abw-menu__item-label">{item.label}</span>
        {item.shortcut && <span className="abw-menu__item-shortcut" aria-hidden="true">{item.shortcut}</span>}
      </RadixMenu.Item>
    );
  });
}

export const Menu: React.FC<MenuProps> = ({ trigger, items, align = 'end', side = 'bottom', className }) => (
  <RadixMenu.Root>
    <RadixMenu.Trigger asChild>{trigger}</RadixMenu.Trigger>
    <RadixMenu.Portal>
      <RadixMenu.Content
        align={align}
        side={side}
        sideOffset={4}
        className={clsx('abw-menu__content', className)}
      >
        {renderItems(items)}
      </RadixMenu.Content>
    </RadixMenu.Portal>
  </RadixMenu.Root>
);
Menu.displayName = 'Menu';
